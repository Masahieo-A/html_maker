import { NextResponse } from "next/server";

export const runtime = "nodejs";

// サーバー側（Vercel 環境変数）にキーが設定されているかをクライアントへ伝える。
// 値そのものは絶対に返さない（真偽のみ）。これで UI はキー入力を省略できる。
// passcodeRequired: APP_PASSCODE が設定されていれば、各 API はパスコード必須になる。
export async function GET() {
  return NextResponse.json({
    anthropic: !!process.env.ANTHROPIC_API_KEY,
    gemini: !!process.env.GEMINI_API_KEY,
    passcodeRequired: !!process.env.APP_PASSCODE,
  });
}
