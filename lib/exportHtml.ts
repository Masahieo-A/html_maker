// ============================================================================
// LessonDoc → 自己完結・レスポンシブ・印刷可能な静的 HTML（要件 §5.5 / §8）
// CSS はインライン、外部依存なし。生徒のスマホで崩れないこと。
// ============================================================================
import type { Block, Branch, LessonDoc, Role, TextMark } from "./types";

export function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function roleStyle(role: Role): string {
  return `color:${esc(role.color)};background:${esc(role.bg)};`;
}

function markedTextHtml(
  text: string,
  marks: TextMark[] | undefined,
  doc: LessonDoc,
  field: string
): string {
  const valid = (marks ?? [])
    .filter((m) => m.field === field && m.start >= 0 && m.end <= text.length && m.end > m.start)
    .sort((a, b) => a.start - b.start);
  if (valid.length === 0) return esc(text);

  let html = "";
  let cursor = 0;
  for (const mark of valid) {
    if (mark.start < cursor) continue;
    if (cursor < mark.start) html += esc(text.slice(cursor, mark.start));
    const role = doc.rolePalette[mark.role];
    const value = esc(text.slice(mark.start, mark.end));
    html += role
      ? `<span class="vp-text-mark" style="${roleStyle(role)}" title="${esc(role.label)}">${value}</span>`
      : `<span class="vp-text-mark">${value}</span>`;
    cursor = mark.end;
  }
  if (cursor < text.length) html += esc(text.slice(cursor));
  return html;
}

function branchHtml(doc: LessonDoc, b: Branch): string {
  const role = doc.rolePalette[b.role];
  const chip = role
    ? `<span class="vp-role" style="${roleStyle(role)}">${esc(role.label)}</span>`
    : `<span class="vp-role vp-role--plain">${esc(b.role)}</span>`;
  const children =
    b.children && b.children.length
      ? `<div class="vp-children">${b.children.map((c) => branchHtml(doc, c)).join("")}</div>`
      : "";
  return `<div class="vp-branch"><div class="vp-node">${chip}<span class="vp-val">${esc(
    b.value
  )}</span></div>${children}</div>`;
}

function blockHtml(doc: LessonDoc, block: Block): string {
  switch (block.type) {
    case "heading":
      return `<h${block.level} class="vp-h vp-h${block.level}">${markedTextHtml(
        block.text,
        block.marks,
        doc,
        "text"
      )}</h${block.level}>`;
    case "paragraph":
      return `<p class="vp-p">${markedTextHtml(block.text, block.marks, doc, "text")}</p>`;
    case "sentence": {
      const tokens = block.tokens
        .map((t) => {
          const role = t.role ? doc.rolePalette[t.role] : null;
          if (role) {
            return `<span class="vp-tok" style="${roleStyle(
              role
            )}" title="${esc(role.label)}">${esc(t.text)}</span>`;
          }
          return `<span class="vp-tok vp-tok--plain">${esc(t.text)}</span>`;
        })
        .join(" ");
      return `<p class="vp-sentence">${tokens}</p>`;
    }
    case "tree":
      return `<div class="vp-tree"><div class="vp-branch"><div class="vp-node vp-root">${esc(
        block.root
      )}</div><div class="vp-children">${block.branches
        .map((b) => branchHtml(doc, b))
        .join("")}</div></div></div>`;
    case "analysisCard": {
      const items = block.items
        .map((item) => {
          const role = item.role ? doc.rolePalette[item.role] : null;
          const swatch = role
            ? `<span class="vp-analysis-swatch" style="background:${esc(
                role.bg
              )};border-color:${esc(role.color)};"></span>`
            : "";
          return `<div class="vp-analysis-item"><dt>${swatch}${esc(
            item.label
          )}</dt><dd>${markedTextHtml(item.value, block.marks, doc, `item:${item.id}:value`)}</dd></div>`;
        })
        .join("");
      return `<section class="vp-analysis">${
        block.tag ? `<div class="vp-analysis-tag">${esc(block.tag)}</div>` : ""
      }<h3>${markedTextHtml(block.title, block.marks, doc, "title")}</h3>${
        block.source ? `<div class="vp-analysis-source">${markedTextHtml(block.source, block.marks, doc, "source")}</div>` : ""
      }${
        block.quote ? `<blockquote class="vp-analysis-quote">${markedTextHtml(block.quote, block.marks, doc, "quote")}</blockquote>` : ""
      }<dl class="vp-analysis-items">${items}</dl>${
        block.takeaway ? `<div class="vp-analysis-takeaway">${markedTextHtml(block.takeaway, block.marks, doc, "takeaway")}</div>` : ""
      }</section>`;
    }
    case "table": {
      const head = block.columns.map((c) => `<th>${esc(c)}</th>`).join("");
      const rows = block.rows
        .map(
          (row) =>
            `<tr>${block.columns.map((_, i) => `<td>${esc(row[i] ?? "")}</td>`).join("")}</tr>`
        )
        .join("");
      return `<section class="vp-table-wrap">${
        block.title ? `<h3 class="vp-table-title">${esc(block.title)}</h3>` : ""
      }<div class="vp-table-scroll"><table class="vp-table"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div></section>`;
    }
    case "note": {
      const variant = block.variant ?? "point";
      return `<aside class="vp-note vp-note--${variant}"><div class="vp-note-label">${esc(
        block.label
      )}</div><div class="vp-note-body">${markedTextHtml(block.body, block.marks, doc, "body")}</div></aside>`;
    }
    case "image":
      return block.src
        ? `<figure class="vp-fig"><img src="${esc(block.src)}" alt="${esc(
            block.alt
          )}" loading="lazy"><figcaption>${esc(block.alt)}</figcaption></figure>`
        : "";
    case "raw":
      return `<div class="vp-raw">${block.html}</div>`;
  }
}

function legendHtml(doc: LessonDoc): string {
  const entries = Object.values(doc.rolePalette);
  if (entries.length === 0) return "";
  const items = entries
    .map(
      (r) =>
        `<span class="vp-legend-item"><span class="vp-swatch" style="${roleStyle(
          r
        )}"></span>${esc(r.label)}</span>`
    )
    .join("");
  return `<div class="vp-legend">${items}</div>`;
}

const STYLES = `
:root{--vp-fg:#1e293b;--vp-muted:#64748b;--vp-line:#cbd5e1;--vp-bg:#ffffff;}
*{box-sizing:border-box;}
body{margin:0;background:#f1f5f9;color:var(--vp-fg);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Hiragino Sans","Noto Sans JP",sans-serif;line-height:1.7;}
.vp-doc{max-width:760px;margin:0 auto;padding:28px 20px 64px;background:var(--vp-bg);min-height:100vh;}
.vp-title{font-size:1.5rem;font-weight:700;margin:0 0 4px;}
.vp-meta{color:var(--vp-muted);font-size:.85rem;margin-bottom:18px;}
.vp-h{line-height:1.4;margin:1.6em 0 .5em;}
.vp-h1{font-size:1.5rem;} .vp-h2{font-size:1.25rem;border-left:4px solid #6366f1;padding-left:.5em;} .vp-h3{font-size:1.05rem;}
.vp-p{margin:.6em 0;}
.vp-sentence{font-size:1.15rem;line-height:2.2;margin:1em 0;}
.vp-tok{padding:.12em .4em;border-radius:6px;font-weight:600;white-space:nowrap;}
.vp-tok--plain{color:var(--vp-fg);}
.vp-text-mark{padding:.05em .22em;border-radius:5px;font-weight:700;}
.vp-tree{overflow-x:auto;padding:8px 0;margin:1em 0;}
.vp-branch{display:flex;flex-direction:column;align-items:flex-start;}
.vp-node{display:inline-flex;align-items:center;gap:.4em;border:1px solid var(--vp-line);background:#fff;border-radius:8px;padding:.35em .6em;margin:.25em 0;box-shadow:0 1px 2px rgba(0,0,0,.04);}
.vp-root{font-weight:700;background:#f8fafc;}
.vp-children{margin-left:1.1em;padding-left:1.1em;border-left:2px solid var(--vp-line);}
.vp-role{font-size:.72rem;font-weight:700;padding:.1em .45em;border-radius:999px;}
.vp-role--plain{background:#e2e8f0;color:#475569;}
.vp-val{font-weight:600;}
.vp-analysis{border:1px solid var(--vp-line);border-radius:10px;padding:16px 18px;margin:18px 0;background:#fff;box-shadow:0 1px 3px rgba(15,23,42,.05);}
.vp-analysis-tag{display:inline-flex;margin-bottom:6px;padding:2px 8px;border-radius:999px;background:#eef2ff;color:#4338ca;font-size:.75rem;font-weight:700;}
.vp-analysis h3{margin:0 0 4px;font-size:1.05rem;}
.vp-analysis-source{color:var(--vp-muted);font-size:.78rem;margin-bottom:10px;}
.vp-analysis-quote{margin:10px 0;padding:10px 12px;border-left:4px solid #cbd5e1;background:#f8fafc;border-radius:6px;font-family:Georgia,"Times New Roman",serif;}
.vp-analysis-items{display:grid;grid-template-columns:minmax(96px,auto) 1fr;gap:8px 14px;margin:12px 0 0;}
.vp-analysis-item{display:contents;}
.vp-analysis dt{font-weight:700;color:var(--vp-muted);}
.vp-analysis dd{margin:0;}
.vp-analysis-swatch{width:12px;height:12px;border:1px solid;display:inline-block;border-radius:3px;margin-right:6px;vertical-align:-1px;}
.vp-analysis-takeaway{margin-top:12px;padding:9px 11px;border-radius:8px;background:#ecfdf5;color:#065f46;font-weight:600;}
.vp-table-wrap{margin:18px 0;}
.vp-table-title{font-size:1rem;margin:0 0 8px;}
.vp-table-scroll{overflow-x:auto;}
.vp-table{width:100%;border-collapse:collapse;background:#fff;border:1px solid var(--vp-line);border-radius:8px;overflow:hidden;}
.vp-table th,.vp-table td{border:1px solid var(--vp-line);padding:8px 10px;text-align:left;vertical-align:top;}
.vp-table th{background:#f8fafc;font-weight:700;}
.vp-note{border-radius:10px;padding:.8em 1em;margin:1.2em 0;border:1px solid;}
.vp-note-label{font-weight:700;font-size:.85rem;margin-bottom:.25em;}
.vp-note--point{background:#eef2ff;border-color:#c7d2fe;}
.vp-note--point .vp-note-label{color:#4338ca;}
.vp-note--tip{background:#ecfdf5;border-color:#a7f3d0;}
.vp-note--tip .vp-note-label{color:#047857;}
.vp-note--warning{background:#fff7ed;border-color:#fed7aa;}
.vp-note--warning .vp-note-label{color:#c2410c;}
.vp-fig{margin:1.2em 0;text-align:center;}
.vp-fig img{max-width:100%;border-radius:8px;}
.vp-fig figcaption{color:var(--vp-muted);font-size:.85rem;margin-top:.4em;}
.vp-legend{display:flex;flex-wrap:wrap;gap:.6em 1em;margin:0 0 18px;padding:10px 12px;background:#f8fafc;border-radius:8px;font-size:.82rem;}
.vp-legend-item{display:inline-flex;align-items:center;gap:.4em;}
.vp-swatch{width:14px;height:14px;border-radius:4px;display:inline-block;}
.vp-foot{margin-top:40px;color:var(--vp-muted);font-size:.75rem;text-align:center;}
@media print{body{background:#fff;}.vp-doc{box-shadow:none;max-width:none;}.vp-tree{overflow:visible;}}
@media(max-width:480px){.vp-doc{padding:18px 14px 48px;}.vp-sentence{font-size:1.05rem;}}
`;

export function exportHtml(doc: LessonDoc): string {
  const body = doc.blocks.map((b) => blockHtml(doc, b)).join("\n");
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(doc.title)}</title>
<style>${STYLES}</style>
</head>
<body>
<main class="vp-doc">
<h1 class="vp-title">${esc(doc.title)}</h1>
<div class="vp-meta">Viewpoint で作成した教材</div>
${legendHtml(doc)}
${body}
<div class="vp-foot">Generated by Viewpoint</div>
</main>
</body>
</html>`;
}
