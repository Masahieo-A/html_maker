// ============================================================================
// 既存 HTML の AI インポート（改善提案 §2-2）。
// 完成済み HTML を「内容を変えずに」LessonDoc へ構造化する。
// /api/generate と同じ SSE ストリーミング＋JSON修復リトライ（lib/lessonStream）を使う。
// ============================================================================
import { NextRequest, NextResponse } from "next/server";
import type { Provider } from "@/lib/aiServer";
import { checkAccess } from "@/lib/apiGuard";
import { buildLessonDocStream } from "@/lib/lessonStream";

// Edge Runtime: I/Oアイドル時間はCPU制限に含まれないため、
// ストリーミングでAI生成が長くても接続が維持される（Vercel無料枠タイムアウト回避）
export const runtime = "edge";

type Body = {
  provider: Provider;
  apiKey: string;
  model: string;
  html: string;
  instruction?: string;
};

// トークン節約のための上限（それ以上は打ち切り）
const HTML_MAX_CHARS = 200_000;

const SCHEMA_IMPORT = `あなたは既存の HTML 教材を「LessonDoc」という構造化データ（JSON）へ変換する支援AIです。
入力の HTML は完成済みの教材です。内容（テキスト）を一切変えないでください。要約・言い換え・翻訳・追加・削除はすべて禁止です。
出力は **JSONのみ**。前置き・説明・Markdownのコードフェンスを付けないこと。

LessonDoc の型（TypeScript）:
type LessonDoc = {
  id: string; title: string; version: number;
  rolePalette: Record<string, { label: string; color: string; bg: string }>;
  blocks: Block[];
};
type Block =
  | { id:string; type:"heading"; level:1|2|3; text:string; marks?:TextMark[] }
  | { id:string; type:"paragraph"; text:string; marks?:TextMark[] }
  | { id:string; type:"sentence"; tokens:{ id:string; text:string; role:string|null }[] }
  | { id:string; type:"tree"; root:string; branches:Branch[] }
  | { id:string; type:"analysisCard"; title:string; tag?:string; source?:string; quote?:string; items:AnalysisItem[]; takeaway?:string; marks?:TextMark[] }
  | { id:string; type:"table"; title?:string; columns:string[]; rows:string[][] }
  | { id:string; type:"note"; label:string; body:string; variant?:"point"|"tip"|"warning"; marks?:TextMark[] }
  | { id:string; type:"image"; src:string; alt:string }
  | { id:string; type:"raw"; html:string };
type Branch = { id:string; role:string; value:string; children?:Branch[] };
type AnalysisItem = { id:string; label:string; value:string; role?:string|null };
type TextMark = { id:string; field:string; start:number; end:number; role:string };

変換ルール:
- すべてのノードに一意な id を付ける（短い英数字でよい）。
- 色分けされた語句（class 名やインライン style の color で強調された語句）は「意味（働き・分類・立場）」の手がかり。同じ色＝同じ働きとして rolePalette に role（label=日本語表示名, color=前景, bg=背景。元 HTML の色をできるだけ再現）を定義し、
  英文など語単位の色分けは sentence の token role で、文章中の一部強調は heading / paragraph / note / analysisCard の marks（field は "text" や "body"、start/end は文字位置）で対応付ける。
- 表（<table>）→ table（thead → columns、tbody の各行 → rows）。
- カード状の枠（枠線・背景・影で区切られたまとまり、統計カード、事例ボックスなど）→ analysisCard（title / items / takeaway に整理）。
- コールアウト（注意・ヒント・ポイントの囲み、<blockquote>、<details> など）→ note（variant は point / tip / warning から選ぶ）。
- 見出し → heading、通常の文章 → paragraph、画像 → image。
- どうしても LessonDoc の語彙で表現できない装飾のみ type:"raw" に退避してよい。その場合 raw の html には元の HTML 断片を、タグ構造や class 名を保ったまま入れる（内容の書き換え禁止）。
- title は元 HTML の <title> や最初の見出しから取る。
- JSON文字列内の引用符・改行・バックスラッシュは必ずJSONとして正しくエスケープする。
出力: LessonDoc の JSON オブジェクトのみ。`;

/**
 * サーバー側の前処理: script / style / コメントを除去し、body の内側だけを使う。
 * class 名やインライン style の color は「色分け＝意味の手がかり」なので残す。
 */
function preprocessHtml(raw: string): string {
  let s = raw;
  s = s.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, "");
  s = s.replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, "");
  s = s.replace(/<!--[\s\S]*?-->/g, "");
  const body = s.match(/<body\b[^>]*>([\s\S]*)<\/body\s*>/i);
  if (body) s = body[1];
  s = s.replace(/\n{3,}/g, "\n\n").trim();
  if (s.length > HTML_MAX_CHARS) s = s.slice(0, HTML_MAX_CHARS);
  return s;
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
  const { provider, model, instruction } = body;
  const envKey =
    provider === "gemini" ? process.env.GEMINI_API_KEY : process.env.ANTHROPIC_API_KEY;
  const apiKey = body.apiKey || envKey || "";

  if (!apiKey)
    return NextResponse.json(
      { error: "API キーが未設定です（UI または Vercel 環境変数で設定してください）" },
      { status: 400 }
    );
  if (!body.html?.trim())
    return NextResponse.json({ error: "HTML を入力してください" }, { status: 400 });

  const html = preprocessHtml(body.html);
  if (!html)
    return NextResponse.json(
      { error: "HTML から取り込める内容が見つかりませんでした" },
      { status: 400 }
    );

  const extra = instruction?.trim()
    ? `\n\n# 教師の追加指示\n${instruction.trim()}`
    : "";
  const user = `# インポート対象の HTML（完成済み教材）\n${html}${extra}\n\nこの HTML の内容（テキスト）を一切変えずに、LessonDoc へ構造化してください。`;

  const stream = buildLessonDocStream({
    provider,
    apiKey,
    model,
    system: SCHEMA_IMPORT,
    user,
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "X-Accel-Buffering": "no",
    },
  });
}
