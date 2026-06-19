import { NextResponse } from "next/server";

export const runtime = "nodejs";

// サーバー側（Vercel 環境変数）にキーが設定されているかをクライアントへ伝える。
// 値そのものは絶対に返さない（真偽のみ）。これで UI はキー入力を省略できる。
export async function GET() {
  return NextResponse.json({
    anthropic: !!process.env.ANTHROPIC_API_KEY,
    gemini: !!process.env.GEMINI_API_KEY,
  });
}
