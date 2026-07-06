// ============================================================================
// 既存 HTML のインポート（改善提案 §2）。ブラウザ専用（DOMParser を使用）。
// - extractEmbeddedDocJson: 自アプリ書き出し HTML の埋め込み JSON を検出（§2-1）
// - importDesignPreserving : デザイン維持モード。<style> を customCss に集約し、
//                            body 直下の要素を 1 つ = 1 raw ブロックで取り込む（§2-3a）
// - importStructured       : 構造化モード。h1〜h3/p/table/img 等を対応する
//                            ブロックへ決定的に変換する（§2-3b）
// raw ブロックへ入れる HTML は必ず sanitizeHtml()（DOMPurify）を通す（§2-5）。
// ============================================================================
import type { Block, LessonDoc } from "./types";
import { uid } from "./ids";
import { sanitizeHtml } from "./sanitize";

/** 本アプリ書き出しHTML内の <script type="application/json" id="viewpoint-doc"> の中身を返す。無ければ null */
export function extractEmbeddedDocJson(html: string): string | null {
  if (!html || !html.includes("viewpoint-doc")) return null;
  const dom = parseHtml(html);
  const script = dom.querySelector('script#viewpoint-doc[type="application/json"]');
  const text = script?.textContent?.trim();
  return text ? text : null;
}

/** デザイン維持モード: <style> を customCss に集約し、body 直下の要素を1つ=1 raw ブロックとして取り込む */
export function importDesignPreserving(html: string): LessonDoc {
  const dom = parseHtml(html);
  const title = extractTitle(dom);

  // <style>（head 含む）を結合して customCss へ。raw 側に重複させないため DOM から除去。
  const customCss = Array.from(dom.querySelectorAll("style"))
    .map((s) => s.textContent ?? "")
    .filter((s) => s.trim().length > 0)
    .join("\n\n");
  dom.querySelectorAll("style").forEach((s) => s.remove());

  const blocks: Block[] = [];
  for (const el of Array.from(dom.body.children)) {
    const tag = el.tagName.toLowerCase();
    if (tag === "script" || tag === "noscript" || tag === "template") continue; // script 類は捨てる
    if (isEmptyElement(el)) continue; // 空テキストのみの要素はスキップ
    const clean = sanitizeHtml(el.outerHTML);
    if (!clean.trim()) continue;
    blocks.push({ id: uid("b"), type: "raw", html: clean });
  }

  const doc = baseDoc(title, ensureBlocks(blocks));
  if (customCss.trim()) doc.customCss = customCss;
  return doc;
}

/** 構造化モード: h1-h3→heading, p/li→paragraph, table→table, img→image, blockquote/details→note, その他→raw */
export function importStructured(html: string): LessonDoc {
  const dom = parseHtml(html);
  const title = extractTitle(dom);
  const blocks: Block[] = [];
  for (const el of Array.from(dom.body.children)) {
    convertElement(el, blocks);
  }
  return baseDoc(title, ensureBlocks(blocks));
}

// ── 内部ヘルパー ─────────────────────────────────────────────────────────────

function parseHtml(html: string): Document {
  return new DOMParser().parseFromString(html, "text/html");
}

/** doc.title は <title> か最初の h1、無ければ既定文言 */
function extractTitle(dom: Document): string {
  const title = dom.querySelector("title")?.textContent?.trim();
  if (title) return title;
  const h1 = dom.querySelector("h1")?.textContent?.trim();
  if (h1) return h1;
  return "インポートした教材";
}

function newLessonId(): string {
  return "lesson_" + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
}

function baseDoc(title: string, blocks: Block[]): LessonDoc {
  return { id: newLessonId(), title, version: 1, rolePalette: {}, blocks };
}

/** 1件も取り込めなかった場合の保険（空の教材にしない） */
function ensureBlocks(blocks: Block[]): Block[] {
  if (blocks.length) return blocks;
  return [
    {
      id: uid("b"),
      type: "note",
      label: "インポート結果",
      body: "取り込める内容が見つかりませんでした。HTML の中身を確認してください。",
      variant: "warning",
    },
  ];
}

// テキストが無くても保持したい「見た目要素」
const VISUAL_SELECTOR = "img,svg,video,audio,canvas,picture,iframe,object,embed,input,button,hr";

/** 空テキストのみ（かつ画像等の見た目要素も含まない）要素か */
function isEmptyElement(el: Element): boolean {
  if ((el.textContent ?? "").trim()) return false;
  if (el.matches(VISUAL_SELECTOR)) return false;
  return !el.querySelector(VISUAL_SELECTOR);
}

function textOf(el: Element | null): string {
  return (el?.textContent ?? "").replace(/\s+/g, " ").trim();
}

/** 直下に空白でないテキストノードを持つか（＝子要素だけに分解すると本文が失われるか） */
function hasDirectText(el: Element): boolean {
  return Array.from(el.childNodes).some(
    (n) => n.nodeType === 3 /* TEXT_NODE */ && (n.textContent ?? "").trim() !== ""
  );
}

// 中身へ降りて変換を試みるコンテナ要素
const CONTAINER_TAGS = new Set([
  "div",
  "section",
  "article",
  "main",
  "header",
  "footer",
  "aside",
  "figure",
]);

function convertElement(el: Element, blocks: Block[]): void {
  const tag = el.tagName.toLowerCase();
  switch (tag) {
    case "script":
    case "style":
    case "noscript":
    case "template":
    case "link":
    case "meta":
    case "br":
    case "hr":
      return; // 教材データとして持たない
    case "h1":
    case "h2":
    case "h3":
    case "h4":
    case "h5":
    case "h6": {
      const text = textOf(el);
      if (!text) return;
      const n = Number(tag.slice(1));
      const level = (n <= 1 ? 1 : n === 2 ? 2 : 3) as 1 | 2 | 3;
      blocks.push({ id: uid("b"), type: "heading", level, text });
      return;
    }
    case "p":
    case "figcaption":
    case "pre": {
      const text = textOf(el);
      if (text) blocks.push({ id: uid("b"), type: "paragraph", text });
      return;
    }
    case "ul":
    case "ol": {
      // li ごとに「・」付き paragraph
      for (const li of Array.from(el.children)) {
        if (li.tagName.toLowerCase() !== "li") continue;
        const text = textOf(li);
        if (text) blocks.push({ id: uid("b"), type: "paragraph", text: "・" + text });
      }
      return;
    }
    case "table": {
      const block = convertTable(el);
      if (block) blocks.push(block);
      return;
    }
    case "img": {
      const src = el.getAttribute("src") ?? "";
      if (!src) return;
      blocks.push({ id: uid("b"), type: "image", src, alt: el.getAttribute("alt") ?? "" });
      return;
    }
    case "blockquote": {
      const body = textOf(el);
      if (body) blocks.push({ id: uid("b"), type: "note", label: "引用", body, variant: "point" });
      return;
    }
    case "details": {
      const summary = el.querySelector("summary");
      const label = textOf(summary) || "詳細";
      const clone = el.cloneNode(true) as Element;
      clone.querySelector("summary")?.remove();
      const body = textOf(clone);
      if (label || body) {
        blocks.push({ id: uid("b"), type: "note", label, body, variant: "tip" });
      }
      return;
    }
    default: {
      // コンテナは中へ降りる（ただし直下テキストがある場合は分解すると本文が
      // 失われるため raw で丸ごと保持する）
      if (CONTAINER_TAGS.has(tag) && !hasDirectText(el)) {
        for (const child of Array.from(el.children)) convertElement(child, blocks);
        return;
      }
      pushRaw(el, blocks);
      return;
    }
  }
}

/** 変換できない要素は sanitizeHtml した outerHTML の raw ブロックへ */
function pushRaw(el: Element, blocks: Block[]): void {
  if (isEmptyElement(el)) return;
  const clean = sanitizeHtml(el.outerHTML);
  if (!clean.trim()) return;
  blocks.push({ id: uid("b"), type: "raw", html: clean });
}

function convertTable(el: Element): Block | null {
  const allRows = Array.from(el.querySelectorAll("tr"));
  if (!allRows.length) return null;

  // thead th → columns（無ければ最初の行をヘッダー扱い）
  const headerCells = Array.from(el.querySelectorAll("thead th"));
  let columns: string[];
  let bodyRows: Element[];
  if (headerCells.length) {
    columns = headerCells.map((c) => textOf(c));
    bodyRows = allRows.filter((r) => !r.closest("thead"));
  } else {
    columns = Array.from(allRows[0].querySelectorAll("th,td")).map((c) => textOf(c));
    bodyRows = allRows.slice(1);
  }
  if (!columns.length) return null;

  const width = columns.length;
  const rows = bodyRows.map((r) => {
    const cells = Array.from(r.querySelectorAll("th,td")).map((c) => textOf(c));
    while (cells.length < width) cells.push("");
    return cells.slice(0, width);
  });

  const caption = textOf(el.querySelector("caption"));
  return {
    id: uid("b"),
    type: "table",
    title: caption || undefined,
    columns,
    rows,
  };
}
