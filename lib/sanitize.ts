// ============================================================================
// raw ブロック等の HTML サニタイズ（XSS 対策）。
// DOMPurify はブラウザ専用のため、SSR 時は空文字を返す（raw の描画・書き出しは
// すべてクライアントで行われるので実害なし）。
// ============================================================================
import DOMPurify from "dompurify";

export function sanitizeHtml(html: string): string {
  if (typeof window === "undefined") return "";
  return DOMPurify.sanitize(html, {
    // 既定設定で script / on* 属性 / javascript: URL は除去される。
    // 埋め込み系は教材で不要なので明示的に禁止。
    FORBID_TAGS: ["script", "iframe", "object", "embed", "form"],
    FORBID_ATTR: ["srcdoc"],
  });
}

/** rolePalette の色として安全な値だけを通す（CSS インジェクション対策） */
export function safeCssColor(value: string, fallback: string): string {
  const v = (value ?? "").trim();
  // #rgb / #rrggbb / #rrggbbaa、rgb()/rgba()/hsl()/hsla()、英字のみの色名を許可
  if (/^#[0-9a-fA-F]{3,8}$/.test(v)) return v;
  if (/^(rgb|rgba|hsl|hsla)\(\s*[\d.,%\s/]+\)$/.test(v)) return v;
  if (/^[a-zA-Z]+$/.test(v)) return v;
  return fallback;
}
