import { NextRequest, NextResponse } from "next/server";
import type { Provider, ImagePart, PdfPart } from "@/lib/aiServer";
import { SCHEMA_DOC } from "@/lib/prompts";
import { checkAccess } from "@/lib/apiGuard";
import { buildLessonDocStream } from "@/lib/lessonStream";

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
  const denied = checkAccess(req);
  if (denied) return NextResponse.json({ error: denied.error }, { status: denied.status });
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

  // SSE パイプライン（進捗・JSON修復・リトライ込み）は lib/lessonStream に共通化
  const stream = buildLessonDocStream({
    provider,
    apiKey,
    model,
    system: SCHEMA_DOC,
    user,
    image: image ?? null,
    pdf: pdf ?? null,
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "X-Accel-Buffering": "no",
    },
  });
}
