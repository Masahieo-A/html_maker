// ============================================================================
// customCss のスコープ化・サニタイズ（DOM非依存の純関数群）
// 元は Renderer.tsx にあった素朴な CSS 文字列変換（完全な CSS パーサは使わず
// 「}」区切り＋「{」直前のセレクタ処理で十分とする方針）をここへ集約した。
//
// 重要: これは「編集画面（Renderer.tsx）のライブ DOM への注入」専用。
// exportHtml.ts の書き出しHTML（生徒がローカルで開く自己完結の配布物）では
// customCss を意図的にスコープ化・サニタイズせずそのまま出力する
// ＝「配布HTML全体が教材そのもの」であり、body/html セレクタ等を含む「素の」
// CSSとして渡すことを許容する設計のため。exportHtml.ts 側は変更しないこと。
// ============================================================================

const CANVAS_SCOPE = ".vp-canvas";

/**
 * 再帰的にスコープ化してよい at-rule（中身がセレクタ+宣言のネストルールであるもの）。
 * @keyframes（0%/from 等のキーフレームセレクタ）・@font-face・@page 等は
 * 中身がセレクタではない（or CSS全体スコープの対象外）ため、対象外＝無変換で通す。
 */
const RECURSIVE_AT_RULE = /^@(-webkit-|-moz-|-ms-|-o-)?(media|supports|container|layer)\b/i;

export function scopeSelectorList(selectorList: string): string {
  return selectorList
    .split(",")
    .map((sel) => sel.trim())
    .filter(Boolean)
    .map((sel) => {
      if (/^(html|body)$/i.test(sel)) return CANVAS_SCOPE;
      if (sel.startsWith(CANVAS_SCOPE)) return sel; // 二重プレフィックス防止
      return `${CANVAS_SCOPE} ${sel}`;
    })
    .join(", ");
}

/**
 * 各セレクタに .vp-canvas を前置し、body/html はコンテナ自体に置換する。
 * @media / @supports / @container / @layer の中身だけ再帰的に処理し、
 * @keyframes / @font-face / @page 等はボディを無変換のまま通す。
 */
export function scopeCss(css: string): string {
  let result = "";
  let i = 0;
  while (i < css.length) {
    const braceIdx = css.indexOf("{", i);
    if (braceIdx < 0) {
      // 末尾の不完全な断片はそのまま出力
      result += css.slice(i);
      break;
    }
    const header = css.slice(i, braceIdx).trim();
    if (header.startsWith("@")) {
      // at-rule: 対応する閉じ括弧までをブレースの深さで探す
      let depth = 1;
      let j = braceIdx + 1;
      while (j < css.length && depth > 0) {
        if (css[j] === "{") depth++;
        else if (css[j] === "}") depth--;
        j++;
      }
      const inner = css.slice(braceIdx + 1, j - 1);
      const shouldRecurse = RECURSIVE_AT_RULE.test(header);
      result += `${header}{${shouldRecurse ? scopeCss(inner) : inner}}`;
      i = j;
      continue;
    }
    const declEnd = css.indexOf("}", braceIdx + 1);
    if (declEnd < 0) {
      result += css.slice(i);
      break;
    }
    const decls = css.slice(braceIdx + 1, declEnd);
    if (header) result += `${scopeSelectorList(header)}{${decls}}`;
    i = declEnd + 1;
  }
  return result;
}

// ----------------------------------------------------------------------------
// セキュリティ: 編集画面（Renderer.tsx）のライブ DOM への注入前サニタイズ。
// customCss はインポートHTML（外部由来・細工され得る）に含まれるため、
// @import／外部 url() 参照を通じて教員のセッションから任意の外部リクエストを
// 発火できてしまう露出面になり得る（role の色は safeCssColor で守られているが、
// customCss の宣言値は素通しのため）。scopeCss の前段で必ず適用すること。
// ----------------------------------------------------------------------------

/** url(...) の中身が data: 以外の「スキーム付き」参照（http/https・プロトコル相対 // 等）かどうか */
function isExternalUrlRef(raw: string): boolean {
  const url = raw.trim().replace(/^['"]|['"]$/g, "");
  if (/^data:/i.test(url)) return false;
  if (url.startsWith("//")) return true; // プロトコル相対
  return /^[a-z][a-z0-9+.-]*:/i.test(url); // 明示的スキーム（http: https: 等）
}

/**
 * @import ルールの除去、外部 url() 参照の無効化、expression() 等の危険構文の除去を行う。
 * data: URI や相対パス（同一オリジン想定）の url() は温存する。
 */
export function sanitizeCustomCss(css: string): string {
  let out = css;
  // @import ルールを丸ごと除去（"@import ...;" の形。ブロックを持たないため次の ; までで良い）
  out = out.replace(/@import\b[^;]*;/gi, "");
  // expression(...) など明白に危険な構文を除去
  out = out.replace(/expression\s*\([^)]*\)/gi, "");
  // url(...) のうち data: 以外のスキーム参照を無効化（宣言自体は残し構文エラーを避ける）
  out = out.replace(/url\(\s*(['"]?)([^'")]*)\1\s*\)/gi, (match, _q, raw) =>
    isExternalUrlRef(raw) ? "url()" : match
  );
  return out;
}
