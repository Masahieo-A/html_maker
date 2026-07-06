// ============================================================================
// LessonDoc 生成の SSE ストリームパイプライン（サーバー用・ランタイム非依存）。
// streamModel でトークンを受信しながら進捗を SSE で流し、全文を parseLessonDoc。
// パース失敗時は「修復AI → 作り直し → 再修復」の順でリトライし、
// 最終的に {done:true, doc} か {error} を "data: {...}\n\n" 形式で送る。
// /api/generate と /api/import の双方から使える共通実装。
// ============================================================================
import {
  callModel,
  streamModel,
  type Provider,
  type ImagePart,
  type PdfPart,
} from "./aiServer";
import { parseLessonDoc } from "./validate";
import type { LessonDoc } from "./types";

const JSON_REPAIR_SYSTEM = `あなたは壊れたJSONを修復する専門AIです。
入力には、LessonDocとして出力されるべきだった壊れたJSON文字列が含まれます。

必ず守ること:
- 出力はJSONオブジェクトのみ。説明、Markdown、コードフェンスは禁止。
- LessonDocの意味をできるだけ保ったまま、JSON構文だけを修復する。
- 不足しているカンマ、エスケープされていない引用符、JSON文字列内の改行、末尾カンマを修正する。
- type:"raw" とHTML断片は使わず、必要なら heading / paragraph / analysisCard / table / note / sentence / tree に置き換える。
- section, card, example, spotlight, analysis, worksheet, question などの独自ブロック名は使わず、analysisCard に変換する。
- どうしても復元できない壊れたブロックは、安全な note ブロックに置き換える。
- id, title, version, rolePalette, blocks を持つLessonDoc JSONにする。`;

async function repairLessonDocJson(input: {
  provider: Provider;
  apiKey: string;
  model: string;
  brokenJson: string;
  errorMessage: string;
}): Promise<LessonDoc> {
  const repaired = await callModel({
    provider: input.provider,
    apiKey: input.apiKey,
    model: input.model,
    system: JSON_REPAIR_SYSTEM,
    user: `# JSON.parse のエラー\n${input.errorMessage}\n\n# 壊れたLessonDoc JSON\n${input.brokenJson}\n\n修復後のLessonDoc JSONのみを返してください。`,
  });
  return parseLessonDoc(repaired);
}

/**
 * LessonDoc を生成する SSE の ReadableStream を作る。
 * 流れるイベント: {progress} → （必要なら {retrying:true}）→ {done:true, doc} または {error}
 */
export function buildLessonDocStream(opts: {
  provider: Provider;
  apiKey: string;
  model: string;
  system: string;
  user: string;
  image?: ImagePart | null;
  pdf?: PdfPart | null;
}): ReadableStream {
  const { provider, apiKey, model, system, user } = opts;
  const image = opts.image ?? null;
  const pdf = opts.pdf ?? null;
  const encoder = new TextEncoder();

  return new ReadableStream({
    async start(controller) {
      const send = (obj: object) => {
        controller.enqueue(encoder.encode("data: " + JSON.stringify(obj) + "\n\n"));
      };

      try {
        const aiIter = await streamModel({ provider, apiKey, model, system, user, image, pdf });

        let fullText = "";
        let lastReported = 0;

        for await (const chunk of aiIter) {
          fullText += chunk;
          // 200文字ごとに進捗通知（頻度を抑えてオーバーヘッド削減）
          if (fullText.length - lastReported >= 200) {
            send({ progress: fullText.length });
            lastReported = fullText.length;
          }
        }

        let doc: LessonDoc;
        try {
          doc = parseLessonDoc(fullText);
        } catch (firstErr: any) {
          send({ progress: fullText.length, retrying: true });
          try {
            doc = await repairLessonDocJson({
              provider,
              apiKey,
              model,
              brokenJson: fullText,
              errorMessage: firstErr?.message ?? "不明",
            });
          } catch (repairErr: any) {
            // 修復も失敗 → 最初から作り直し、それでも壊れていれば再修復
            const retryUser = `${user}\n\n直前の出力はJSONパースに失敗し、修復も失敗しました（理由: ${
              repairErr?.message ?? firstErr?.message ?? "不明"
            }）。LessonDocのJSONオブジェクトのみを最初から作り直してください。Markdown、説明文、コードフェンス、type:"raw"、HTML断片は禁止です。JSON文字列内の引用符・改行・バックスラッシュは必ず正しくエスケープしてください。`;
            const retryText = await callModel({
              provider,
              apiKey,
              model,
              system,
              user: retryUser,
              image,
              pdf,
            });
            try {
              doc = parseLessonDoc(retryText);
            } catch (retryErr: any) {
              doc = await repairLessonDocJson({
                provider,
                apiKey,
                model,
                brokenJson: retryText,
                errorMessage: retryErr?.message ?? "不明",
              });
            }
          }
        }
        send({ done: true, doc });
      } catch (err: any) {
        console.error("[lessonStream] failed:", err?.message ?? err);
        send({ error: err?.message ?? "生成に失敗しました" });
      }

      controller.close();
    },
  });
}
