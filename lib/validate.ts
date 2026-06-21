// ============================================================================
// AI 出力（JSON）の安全なパースと正規化（要件 §5.1）
// 不正なら例外を投げ、呼び出し側で 1 回まで自動リトライする。
// 欠けている id は補完し、未知の role はパレットに退避する。
// ============================================================================
import type { Block, Branch, LessonDoc, RolePalette, Token } from "./types";
import { uid } from "./ids";

const VALID_TYPES = new Set([
  "heading",
  "paragraph",
  "sentence",
  "tree",
  "analysisCard",
  "table",
  "note",
  "image",
  "raw",
]);

function asString(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

/** AI が ```json フェンスや前置きを付けてきても本体を取り出す */
export function extractJson(text: string): string {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) return fence[1].trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) return text.slice(start, end + 1);
  return text.trim();
}

function coerceBranch(raw: any): Branch {
  const b: Branch = {
    id: asString(raw?.id) || uid("br"),
    role: asString(raw?.role, "枝"),
    value: asString(raw?.value),
  };
  if (Array.isArray(raw?.children) && raw.children.length) {
    b.children = raw.children.map(coerceBranch);
  }
  return b;
}

function coerceBlock(raw: any): Block | null {
  const type = raw?.type;
  if (!VALID_TYPES.has(type)) return null;
  const id = asString(raw?.id) || uid("b");
  switch (type) {
    case "heading": {
      const lvl = Number(raw?.level);
      const level = (lvl === 1 || lvl === 2 || lvl === 3 ? lvl : 2) as 1 | 2 | 3;
      return { id, type, level, text: asString(raw?.text) };
    }
    case "paragraph":
      return { id, type, text: asString(raw?.text) };
    case "sentence": {
      const tokens: Token[] = Array.isArray(raw?.tokens)
        ? raw.tokens.map((t: any) => ({
            id: asString(t?.id) || uid("t"),
            text: asString(t?.text),
            role: t?.role == null ? null : asString(t.role),
          }))
        : [];
      return { id, type, tokens };
    }
    case "tree": {
      const branches: Branch[] = Array.isArray(raw?.branches)
        ? raw.branches.map(coerceBranch)
        : [];
      return { id, type, root: asString(raw?.root, "S"), branches };
    }
    case "analysisCard": {
      const items = Array.isArray(raw?.items)
        ? raw.items.map((item: any) => ({
            id: asString(item?.id) || uid("item"),
            label: asString(item?.label, "項目"),
            value: asString(item?.value),
            role: item?.role == null ? null : asString(item.role),
          }))
        : [];
      return {
        id,
        type,
        title: asString(raw?.title, "分析"),
        tag: raw?.tag == null ? undefined : asString(raw.tag),
        source: raw?.source == null ? undefined : asString(raw.source),
        quote: raw?.quote == null ? undefined : asString(raw.quote),
        items,
        takeaway: raw?.takeaway == null ? undefined : asString(raw.takeaway),
      };
    }
    case "table": {
      const columns = Array.isArray(raw?.columns)
        ? raw.columns.map((c: any) => asString(c, ""))
        : [];
      const width = Math.max(columns.length, 1);
      const rows = Array.isArray(raw?.rows)
        ? raw.rows.map((row: any) => {
            const cells = Array.isArray(row) ? row.map((c: any) => asString(c, "")) : [];
            while (cells.length < width) cells.push("");
            return cells.slice(0, width);
          })
        : [];
      return {
        id,
        type,
        title: raw?.title == null ? undefined : asString(raw.title),
        columns: columns.length ? columns : ["項目", "内容"],
        rows,
      };
    }
    case "note": {
      const variant = ["point", "tip", "warning"].includes(raw?.variant)
        ? raw.variant
        : "point";
      return {
        id,
        type,
        label: asString(raw?.label, "メモ"),
        body: asString(raw?.body),
        variant,
      };
    }
    case "image":
      return { id, type, src: asString(raw?.src), alt: asString(raw?.alt) };
    case "raw":
      return { id, type, html: asString(raw?.html) };
    default:
      return null;
  }
}

function coercePalette(raw: any): RolePalette {
  const palette: RolePalette = {};
  if (raw && typeof raw === "object") {
    for (const key of Object.keys(raw)) {
      const r = raw[key];
      palette[key] = {
        label: asString(r?.label, key),
        color: asString(r?.color, "#334155"),
        bg: asString(r?.bg, "#e2e8f0"),
      };
    }
  }
  return palette;
}

const FALLBACK_COLORS = [
  { color: "#0d9488", bg: "#d7f3ef" },
  { color: "#c2740a", bg: "#fbeccd" },
  { color: "#2563eb", bg: "#dbeafe" },
  { color: "#9333ea", bg: "#f3e8ff" },
  { color: "#dc2626", bg: "#fee2e2" },
  { color: "#65a30d", bg: "#ecfccb" },
];

/** role が使われているのにパレットに無い場合は自動で色を割り当てる */
function ensureRoles(doc: LessonDoc): LessonDoc {
  const used = new Set<string>();
  for (const b of doc.blocks) {
    if (b.type === "sentence") b.tokens.forEach((t) => t.role && used.add(t.role));
    if (b.type === "analysisCard") b.items.forEach((item) => item.role && used.add(item.role));
  }
  const palette = { ...doc.rolePalette };
  let i = Object.keys(palette).length;
  for (const role of used) {
    if (!palette[role]) {
      const c = FALLBACK_COLORS[i % FALLBACK_COLORS.length];
      palette[role] = { label: role, ...c };
      i++;
    }
  }
  return { ...doc, rolePalette: palette };
}

/** 任意の JSON 文字列を LessonDoc に正規化。失敗時は例外。 */
export function parseLessonDoc(jsonText: string, keepId?: string): LessonDoc {
  const obj = JSON.parse(extractJson(jsonText));
  if (!obj || typeof obj !== "object") throw new Error("ルートがオブジェクトではありません");
  const blocksRaw = Array.isArray(obj.blocks) ? obj.blocks : [];
  const blocks = blocksRaw.map(coerceBlock).filter((b: Block | null): b is Block => b !== null);
  if (blocks.length === 0) throw new Error("有効なブロックが 1 つもありません");

  let doc: LessonDoc = {
    id: keepId || asString(obj.id) || uid("lesson"),
    title: asString(obj.title, "無題の教材"),
    version: Number.isFinite(obj.version) ? Number(obj.version) : 1,
    rolePalette: coercePalette(obj.rolePalette),
    blocks,
    updatedAt: Date.now(),
  };
  doc = ensureRoles(doc);
  return doc;
}

/** 単一ブロック（範囲編集の返却）を正規化。失敗時は例外。 */
export function parseBlock(jsonText: string): Block {
  const obj = JSON.parse(extractJson(jsonText));
  const block = coerceBlock(obj);
  if (!block) throw new Error("有効なブロックとして解釈できませんでした");
  return block;
}
