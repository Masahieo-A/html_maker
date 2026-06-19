import { NextRequest, NextResponse } from "next/server";
import { streamModel, type Provider, type ImagePart, type PdfPart } from "@/lib/aiServer";
import { parseLessonDoc } from "@/lib/validate";
import { SCHEMA_DOC } from "@/lib/prompts";

// Edge Runtime: I/Oアイドル時間はCPU制限に含まれないため、
// ストリーミングでAI生成が長くても接続が維持される（Vercel無料枠タイムアウト回避）
export const runtime = "edge";

type Body = {
  provider: Provider;
  apiKey: string;
  model: string;
  text: string;
  image?: ImagePart | null;
  pdf?: PdfPart | null;
};

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "不正なリクエストです" }, { status: 400 });
  }
  const { provider, model, text, image, pdf } = body;
  const envKey =
    provider === "gemini" ? process.env.GEMINI_API_KEY : process.env.ANTHROPIC_API_KEY;
  const apiKey = body.apiKey || envKey || "";

  if (!apiKey)
    return NextResponse.json(
      { error: "API キーが未設定です（UI または Vercel 環境変数で設定してください）" },
      { status: 400 }
    );
  if (!text?.trim() && !pdf)
    return NextResponse.json(
      { error: "PDF か 指示テキストのどちらかを入力してください" },
      { status: 400 }
    );

  const user = pdf
    ? `# 解説したい資料\n添付の PDF が、教材化したい元資料です。まずこの PDF を読み取ってください。\n\n# 中心テーマ・フォーマット・雰囲気の指示\n${
        text || "（特に指定なし。PDFの要点を視覚的に分かりやすく教材化してください）"
      }\n\nPDF の内容を踏まえ、上の指示の中心テーマ・構成・雰囲気に沿って LessonDoc を生成してください。`
    : `# 教師の入力\n${text}\n\nこの内容から LessonDoc を生成してください。`;

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: object) => {
        controller.enqueue(encoder.encode("data: " + JSON.stringify(obj) + "\n\n"));
      };

      try {
        const aiIter = await streamModel({
          provider,
          apiKey,
          model,
          system: SCHEMA_DOC,
          user,
          image: image ?? null,
          pdf: pdf ?? null,
        });

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

        const doc = parseLessonDoc(fullText);
        send({ done: true, doc });
      } catch (err: any) {
        console.error("[generate] failed:", err?.message ?? err);
        send({ error: err?.message ?? "生成に失敗しました" });
      }

      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "X-Accel-Buffering": "no",
    },
  });
}
