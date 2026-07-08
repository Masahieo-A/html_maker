import { NextRequest, NextResponse } from "next/server";
import { callModel, type Provider } from "@/lib/aiServer";
import { parseBlock } from "@/lib/validate";
import { SCHEMA_BLOCK, buildEditUser } from "@/lib/prompts";
import { checkAccess } from "@/lib/apiGuard";
import type { Block } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

type Body = {
  provider: Provider;
  apiKey: string;
  model: string;
  block: unknown;
  palette: unknown;
  instruction: string;
  /** true の場合、選択ブロックを複数ブロックへ分解・構造化してよい（rawの段階的構造化の土台） */
  allowMultiple?: boolean;
};

// 複数ブロックへの分解を許可する場合のシステムプロンプト。
// SCHEMA_BLOCK（単一ブロック編集用）を土台に、配列出力のルールを追記する。
const SCHEMA_BLOCKS = `${SCHEMA_BLOCK}

# 複数ブロックへの分解モード（このリクエストではこちらを優先する）
このモードでは、与えられた1つのブロックを、意味のまとまりに応じて複数のブロック
（type: heading / paragraph / sentence / tree / analysisCard / table / note / image / raw のいずれか）に
分解・構造化してよい。分解が不要と判断した場合は要素数1の配列でよい。
出力は **ブロックのJSON配列のみ**（前置き・説明・コードフェンス禁止）。配列内の各要素は、
通常の単一ブロック編集と同じ形式の完全なブロックJSONオブジェクトにすること（idは新規発行してよい）。
分解によって元の内容・意味を変えないこと。`;

/** AI 出力から JSON 配列部分を取り出す（コードフェンス・前置きに対応） */
function extractJsonArray(text: string): string {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fence ? fence[1].trim() : text.trim();
  const start = body.indexOf("[");
  const end = body.lastIndexOf("]");
  if (start >= 0 && end > start) return body.slice(start, end + 1);
  return body;
}

/** ブロックのJSON配列をパース。各要素の妥当性チェックは parseBlock（既存の単一ブロック検証）を流用する。 */
function parseBlocksArray(raw: string): Block[] {
  const arr = JSON.parse(extractJsonArray(raw));
  if (!Array.isArray(arr)) throw new Error("配列として解釈できませんでした");
  const blocks = arr.map((item) => parseBlock(JSON.stringify(item)));
  if (!blocks.length) throw new Error("空の配列が返されました");
  return blocks;
}

export async function POST(req: NextRequest) {
  const denied = checkAccess(req);
  if (denied) return NextResponse.json({ error: denied.error }, { status: denied.status });
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "不正なリクエストです" }, { status: 400 });
  }
  const { provider, model, block, palette, instruction, allowMultiple } = body;
  const envKey =
    provider === "gemini" ? process.env.GEMINI_API_KEY : process.env.ANTHROPIC_API_KEY;
  const apiKey = body.apiKey || envKey || "";
  if (!apiKey)
    return NextResponse.json(
      { error: "API キーが未設定です（UI または Vercel 環境変数で設定してください）" },
      { status: 400 }
    );
  if (!instruction?.trim())
    return NextResponse.json({ error: "指示が空です" }, { status: 400 });

  const user = buildEditUser(block, palette, instruction);
  const system = allowMultiple ? SCHEMA_BLOCKS : SCHEMA_BLOCK;

  try {
    let raw = await callModel({ provider, apiKey, model, system, user });

    if (allowMultiple) {
      // 複数ブロック返却モード: {blocks: Block[]}
      try {
        const blocks = parseBlocksArray(raw);
        return NextResponse.json({ blocks });
      } catch (firstErr: any) {
        const retryUser = `${user}\n\n直前の出力はパースに失敗しました（理由: ${firstErr.message}）。ブロックのJSON配列のみを返してください。`;
        raw = await callModel({ provider, apiKey, model, system, user: retryUser });
        const blocks = parseBlocksArray(raw);
        return NextResponse.json({ blocks });
      }
    }

    // 単一ブロック返却モード（既存挙動と完全互換）: {block: Block}
    try {
      const updated = parseBlock(raw);
      return NextResponse.json({ block: updated });
    } catch (firstErr: any) {
      const retryUser = `${user}\n\n直前の出力はパースに失敗しました（理由: ${firstErr.message}）。同じ型・同じidで、ブロックのJSONのみを返してください。`;
      raw = await callModel({ provider, apiKey, model, system, user: retryUser });
      const updated = parseBlock(raw);
      return NextResponse.json({ block: updated });
    }
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "AI 編集に失敗しました" }, { status: 422 });
  }
}
