import { NextRequest, NextResponse } from "next/server";
import { callModel, type Provider, type ImagePart } from "@/lib/aiServer";
import { parseLessonDoc } from "@/lib/validate";
import { SCHEMA_DOC } from "@/lib/prompts";

export const runtime = "nodejs";
export const maxDuration = 60;

type Body = {
  provider: Provider;
  apiKey: string;
  model: string;
  text: string;
  image?: ImagePart | null;
};

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "不正なリクエストです" }, { status: 400 });
  }
  const { provider, apiKey, model, text, image } = body;
  if (!apiKey) return NextResponse.json({ error: "API キーが未設定です" }, { status: 400 });
  if (!text?.trim()) return NextResponse.json({ error: "本文が空です" }, { status: 400 });

  const user = `# 教師の入力\n${text}\n\nこの内容から LessonDoc を生成してください。`;

  try {
    let raw = await callModel({ provider, apiKey, model, system: SCHEMA_DOC, user, image });
    try {
      const doc = parseLessonDoc(raw);
      return NextResponse.json({ doc });
    } catch (firstErr: any) {
      // 1回だけ自動リトライ（修正指示付き）
      const retryUser = `${user}\n\n直前の出力はパースに失敗しました（理由: ${firstErr.message}）。\nスキーマに厳密に従い、JSONオブジェクトのみを返してください。`;
      raw = await callModel({ provider, apiKey, model, system: SCHEMA_DOC, user: retryUser, image });
      const doc = parseLessonDoc(raw);
      return NextResponse.json({ doc });
    }
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "生成に失敗しました" },
      { status: 422 }
    );
  }
}
