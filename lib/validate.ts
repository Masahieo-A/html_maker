// ============================================================================
// AI 出力（JSON）の安全なパースと正規化（要件 §5.1）
// 不正なら例外を投げ、呼び出し側で 1 回まで自動リトライする。
// 欠けている id は補完し、未知の role はパレットに退避する。
// ============================================================================
import type { Block, Branch, LessonDoc, RolePalette, TextMark, Token } from "./types";
import { uid } from "./ids";
import { safeCssColor } from "./sanitize";

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

function coerceMarks(raw: any): TextMark[] | undefined {
  if (!Array.isArray(raw?.marks)) return undefined;
  const marks = raw.marks
    .map((m: any) => ({
      id: asString(m?.id) || uid("mark"),
      field: asString(m?.field),
      start: Number(m?.start),
      end: Number(m?.end),
      role: asString(m?.role),
      // ruby は任意フィールド。未指定・空文字は undefined にして後方互換を保つ。
      ruby: m?.ruby == null ? undefined : asString(m.ruby) || undefined,
    }))
    .filter((m: TextMark) => m.field && m.role && Number.isFinite(m.start) && Number.isFinite(m.end) && m.end > m.start);
  return marks.length ? marks : undefined;
}

function joinTextParts(parts: unknown[]): string {
  return parts
    .map((part) => {
      if (typeof part === "string") return part;
      if (part && typeof part === "object") {
        const raw = part as any;
        return asString(raw.text) || asString(raw.body) || asString(raw.value) || asString(raw.content);
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function summarizeUnknown(raw: any): string {
  if (!raw || typeof raw !== "object") return asString(raw);
  const parts = [
    asString(raw.text),
    asString(raw.body),
    asString(raw.content),
    asString(raw.description),
    asString(raw.explanation),
    asString(raw.summary),
    Array.isArray(raw.items) ? joinTextParts(raw.items) : "",
    Array.isArray(raw.children) ? joinTextParts(raw.children) : "",
  ].filter(Boolean);
  if (parts.length) return parts.join("\n");
  try {
    return JSON.stringify(raw);
  } catch {
    return "";
  }
}

function normalizeBlockType(raw: any): string {
  const type = asString(raw?.type).replace(/[-_\s]/g, "").toLowerCase();
  if (["h", "h1", "h2", "h3", "heading", "title", "subtitle"].includes(type)) return "heading";
  if (["p", "paragraph", "text", "body", "content"].includes(type)) return "paragraph";
  if (["sentence", "tokens", "tokenizedsentence"].includes(type)) return "sentence";
  if (["tree", "map", "conceptmap", "structure", "flow", "diagram"].includes(type)) return "tree";
  if (
    [
      "analysiscard",
      "analysis",
      "card",
      "case",
      "casecard",
      "example",
      "spotlight",
      "worksheet",
      "question",
      "exercise",
      "pointcard",
      "section",
    ].includes(type)
  )
    return "analysisCard";
  if (["table", "matrix", "comparison", "comparisontable"].includes(type)) return "table";
  if (["note", "tip", "warning", "hint", "callout"].includes(type)) return "note";
  if (["image", "figure", "fig"].includes(type)) return "image";
  if (["raw", "html"].includes(type)) return "raw";
  if (Array.isArray(raw?.columns) || Array.isArray(raw?.rows)) return "table";
  if (Array.isArray(raw?.items) || raw?.quote || raw?.source || raw?.takeaway) return "analysisCard";
  if (raw?.level || raw?.title) return "heading";
  if (raw?.text || raw?.body || raw?.content) return "paragraph";
  return type;
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
  const type = normalizeBlockType(raw);
  if (!VALID_TYPES.has(type)) return null;
  const id = asString(raw?.id) || uid("b");
  switch (type) {
    case "heading": {
      const lvl = Number(raw?.level);
      const level = (lvl === 1 || lvl === 2 || lvl === 3 ? lvl : 2) as 1 | 2 | 3;
      return { id, type, level, text: asString(raw?.text) || asString(raw?.title), marks: coerceMarks(raw) };
    }
    case "paragraph":
      return { id, type, text: asString(raw?.text) || asString(raw?.body) || asString(raw?.content), marks: coerceMarks(raw) };
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
            value: asString(item?.value) || asString(item?.text) || asString(item?.body) || asString(item?.content),
            role: item?.role == null ? null : asString(item.role),
          }))
        : [];
      const fallbackItems = items.length
        ? items
        : [
            {
              id: uid("item"),
              label: "内容",
              value: summarizeUnknown(raw),
              role: null,
            },
          ];
      return {
        id,
        type,
        title: asString(raw?.title) || asString(raw?.heading) || asString(raw?.label, "分析"),
        tag: raw?.tag == null ? undefined : asString(raw.tag),
        source: raw?.source == null ? undefined : asString(raw.source),
        quote: raw?.quote == null ? undefined : asString(raw.quote),
        items: fallbackItems,
        takeaway: raw?.takeaway == null ? undefined : asString(raw.takeaway),
        marks: coerceMarks(raw),
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
        rows: rows.length ? rows : [["内容", summarizeUnknown(raw)]],
        marks: coerceMarks(raw),
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
        marks: coerceMarks(raw),
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
        color: safeCssColor(asString(r?.color), "#334155"),
        bg: safeCssColor(asString(r?.bg), "#e2e8f0"),
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
  const blocksRaw = Array.isArray(obj.blocks)
    ? obj.blocks
    : Array.isArray(obj.sections)
      ? obj.sections
      : Array.isArray(obj.cards)
        ? obj.cards
        : Array.isArray(obj.content)
          ? obj.content
          : Array.isArray(obj.items)
            ? obj.items
            : [];
  let blocks = blocksRaw.map(coerceBlock).filter((b: Block | null): b is Block => b !== null);
  if (blocks.length === 0) {
    const fallbackText =
      summarizeUnknown(obj) ||
      `AIの出力を教材ブロックとして解釈できませんでした。出力形式を調整して再生成してください。`;
    blocks = [
      {
        id: uid("b"),
        type: "note",
        label: "生成結果の確認が必要です",
        body: fallbackText.slice(0, 4000),
        variant: "warning",
      },
    ];
  }

  let doc: LessonDoc = {
    id: keepId || asString(obj.id) || uid("lesson"),
    title: asString(obj.title, "無題の教材"),
    version: Number.isFinite(obj.version) ? Number(obj.version) : 1,
    rolePalette: coercePalette(obj.rolePalette),
    blocks,
    customCss: asString(obj.customCss) || undefined,
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
