import { NextRequest, NextResponse } from "next/server";
import { callModel, type Provider, type ImagePart, type PdfPart } from "@/lib/aiServer";
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
  // キーは「リクエスト(UI入力) → サーバー環境変数」の順で解決（両対応）
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

  try {
    let raw = await callModel({ provider, apiKey, model, system: SCHEMA_DOC, user, image, pdf });
    try {
      const doc = parseLessonDoc(raw);
      return NextResponse.json({ doc });
    } catch (firstErr: any) {
      // 1回だけ自動リトライ（修正指示付き）
      const retryUser = `${user}\n\n直前の出力はパースに失敗しました（理由: ${firstErr.message}）。\nスキーマに厳密に従い、JSONオブジェクトのみを返してください。`;
      raw = await callModel({ provider, apiKey, model, system: SCHEMA_DOC, user: retryUser, image, pdf });
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
