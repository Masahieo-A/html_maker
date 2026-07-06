// ============================================================================
// API ルート共通の入口ガード。
// 1) APP_PASSCODE（Vercel 環境変数）が設定されている場合、
//    ヘッダー x-viewpoint-passcode の一致を必須にする。
//    → サーバー側 API キーを第三者に使われる「オープンプロキシ化」を防ぐ。
// 2) IP 単位の簡易レートリミット（インスタンス内メモリ）。
//    Edge/Serverless ではインスタンスごとに独立するが、無いよりは十分効く。
// ============================================================================

export const PASSCODE_HEADER = "x-viewpoint-passcode";

const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 30;
const hits = new Map<string, number[]>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const list = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  list.push(now);
  hits.set(ip, list);
  // Map が無限に育たないよう時々掃除
  if (hits.size > 1000) {
    for (const [k, v] of hits) {
      if (v.every((t) => now - t >= WINDOW_MS)) hits.delete(k);
    }
  }
  return list.length > MAX_REQUESTS_PER_WINDOW;
}

/**
 * アクセス可否を判定する。拒否時は { error, status } を返し、許可時は null。
 */
export function checkAccess(req: Request): { error: string; status: number } | null {
  const passcode = process.env.APP_PASSCODE;
  if (passcode) {
    const sent = req.headers.get(PASSCODE_HEADER) ?? "";
    if (sent !== passcode) {
      return {
        error: "アクセスパスコードが一致しません（⚙ AI 設定で入力してください）",
        status: 401,
      };
    }
  }
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown";
  if (rateLimited(ip)) {
    return { error: "リクエストが多すぎます。1分ほど待って再試行してください。", status: 429 };
  }
  return null;
}
