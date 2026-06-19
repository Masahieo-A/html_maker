import { NextRequest, NextResponse } from "next/server";
import { callModel, type Provider } from "@/lib/aiServer";
import { parseBlock } from "@/lib/validate";
import { SCHEMA_BLOCK, buildEditUser } from "@/lib/prompts";

export const runtime = "nodejs";
export const maxDuration = 60;

type Body = {
  provider: Provider;
  apiKey: string;
  model: string;
  block: unknown;
  palette: unknown;
  instruction: string;
};

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "不正なリクエストです" }, { status: 400 });
  }
  const { provider, apiKey, model, block, palette, instruction } = body;
  if (!apiKey) return NextResponse.json({ error: "API キーが未設定です" }, { status: 400 });
  if (!instruction?.trim())
    return NextResponse.json({ error: "指示が空です" }, { status: 400 });

  const user = buildEditUser(block, palette, instruction);

  try {
    let raw = await callModel({ provider, apiKey, model, system: SCHEMA_BLOCK, user });
    try {
      const updated = parseBlock(raw);
      return NextResponse.json({ block: updated });
    } catch (firstErr: any) {
      const retryUser = `${user}\n\n直前の出力はパースに失敗しました（理由: ${firstErr.message}）。同じ型・同じidで、ブロックのJSONのみを返してください。`;
      raw = await callModel({ provider, apiKey, model, system: SCHEMA_BLOCK, user: retryUser });
      const updated = parseBlock(raw);
      return NextResponse.json({ block: updated });
    }
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "AI 編集に失敗しました" }, { status: 422 });
  }
}
