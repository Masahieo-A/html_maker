"use client";
// ============================================================================
// LessonDoc を編集ビューとして描画。任意ノードをクリック → onSelect。
// 「どこまでノードに分解するか = 編集可能な粒度」を体現する。
// ============================================================================
import React from "react";
import type { Block, Branch, LessonDoc, Selection, TextMark } from "@/lib/types";

type Props = {
  doc: LessonDoc;
  selection: Selection;
  onSelect: (sel: Selection) => void;
};

function isSelected(sel: Selection, test: NonNullable<Selection>): boolean {
  if (!sel) return false;
  if (sel.kind !== test.kind) return false;
  if (sel.blockId !== test.blockId) return false;
  if (test.kind === "token" && sel.kind === "token")
    return sel.tokenId === test.tokenId;
  if (test.kind === "branch" && sel.kind === "branch")
    return sel.branchId === test.branchId;
  return true;
}

function hasActiveTextSelection(): boolean {
  const selection = window.getSelection();
  return !!selection && !selection.isCollapsed && !!selection.toString().trim();
}

function renderMarkedText(
  text: string,
  marks: TextMark[] | undefined,
  doc: LessonDoc,
  field: string
) {
  const valid = (marks ?? [])
    .filter((m) => m.field === field && m.start >= 0 && m.end <= text.length && m.end > m.start)
    .sort((a, b) => a.start - b.start);
  if (valid.length === 0) return text;

  const parts: React.ReactNode[] = [];
  let cursor = 0;
  for (const mark of valid) {
    if (mark.start < cursor) continue;
    if (cursor < mark.start) parts.push(text.slice(cursor, mark.start));
    const role = doc.rolePalette[mark.role];
    parts.push(
      <span
        className="text-mark"
        key={mark.id}
        title={role?.label ?? mark.role}
        style={role ? { color: role.color, background: role.bg } : undefined}
      >
        {text.slice(mark.start, mark.end)}
      </span>
    );
    cursor = mark.end;
  }
  if (cursor < text.length) parts.push(text.slice(cursor));
  return parts;
}

function fieldProps(blockId: string, field: string) {
  return {
    "data-vp-block": blockId,
    "data-vp-field": field,
  };
}

export function Legend({ doc }: { doc: LessonDoc }) {
  const entries = Object.values(doc.rolePalette);
  if (entries.length === 0) return null;
  return (
    <div className="legend">
      {entries.map((r, i) => (
        <span className="legend-item" key={i}>
          <span
            className="swatch"
            style={{ background: r.bg, border: `1px solid ${r.color}` }}
          />
          {r.label}
        </span>
      ))}
    </div>
  );
}

function BranchView({
  doc,
  block,
  branch,
  sel,
  onSelect,
}: {
  doc: LessonDoc;
  block: Block;
  branch: Branch;
  sel: Selection;
  onSelect: Props["onSelect"];
}) {
  const role = doc.rolePalette[branch.role];
  const selected = isSelected(sel, {
    kind: "branch",
    blockId: block.id,
    branchId: branch.id,
  });
  return (
    <div className="r-branch">
      <div
        className={`r-node node ${selected ? "node--selected" : ""}`}
        onClick={(e) => {
          e.stopPropagation();
          onSelect({ kind: "branch", blockId: block.id, branchId: branch.id });
        }}
      >
        {role ? (
          <span
            className="r-role"
            style={{ color: role.color, background: role.bg }}
          >
            {role.label}
          </span>
        ) : (
          <span className="r-role r-role--plain">{branch.role}</span>
        )}
        <span style={{ fontWeight: 600 }}>{branch.value}</span>
      </div>
      {branch.children && branch.children.length > 0 && (
        <div className="r-children">
          {branch.children.map((c) => (
            <BranchView
              key={c.id}
              doc={doc}
              block={block}
              branch={c}
              sel={sel}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function BlockView({
  doc,
  block,
  sel,
  onSelect,
}: {
  doc: LessonDoc;
  block: Block;
  sel: Selection;
  onSelect: Props["onSelect"];
}) {
  const blockSelected = isSelected(sel, { kind: "block", blockId: block.id });
  const selectBlock = (e: React.MouseEvent) => {
    if (hasActiveTextSelection()) return;
    e.stopPropagation();
    onSelect({ kind: "block", blockId: block.id });
  };

  switch (block.type) {
    case "heading":
      return (
        <div
          className={`r-h r-h${block.level} node ${blockSelected ? "node--selected" : ""}`}
          onClick={selectBlock}
          {...fieldProps(block.id, "text")}
        >
          {renderMarkedText(block.text, block.marks, doc, "text")}
        </div>
      );
    case "paragraph":
      return (
        <p
          className={`r-p node ${blockSelected ? "node--selected" : ""}`}
          onClick={selectBlock}
          {...fieldProps(block.id, "text")}
        >
          {renderMarkedText(block.text, block.marks, doc, "text")}
        </p>
      );
    case "sentence":
      return (
        <p className="r-sentence">
          {block.tokens.map((t) => {
            const role = t.role ? doc.rolePalette[t.role] : null;
            const tselected = isSelected(sel, {
              kind: "token",
              blockId: block.id,
              tokenId: t.id,
            });
            return (
              <React.Fragment key={t.id}>
                <span
                  className={`tok ${role ? "" : "tok--plain"} ${
                    tselected ? "tok--selected" : ""
                  }`}
                  style={
                    role ? { color: role.color, background: role.bg } : undefined
                  }
                  title={role?.label}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelect({
                      kind: "token",
                      blockId: block.id,
                      tokenId: t.id,
                    });
                  }}
                >
                  {t.text}
                </span>{" "}
              </React.Fragment>
            );
          })}
        </p>
      );
    case "tree": {
      const rootSelected = isSelected(sel, {
        kind: "tree-root",
        blockId: block.id,
      });
      return (
        <div className="r-tree">
          <div className="r-branch">
            <div
              className={`r-node r-node--root node ${
                rootSelected ? "node--selected" : ""
              }`}
              onClick={(e) => {
                e.stopPropagation();
                onSelect({ kind: "tree-root", blockId: block.id });
              }}
            >
              {block.root}
            </div>
            <div className="r-children">
              {block.branches.map((b) => (
                <BranchView
                  key={b.id}
                  doc={doc}
                  block={block}
                  branch={b}
                  sel={sel}
                  onSelect={onSelect}
                />
              ))}
            </div>
          </div>
        </div>
      );
    }
    case "analysisCard":
      return (
        <section
          className={`r-analysis node ${blockSelected ? "node--selected" : ""}`}
          onClick={selectBlock}
        >
          <div className="r-analysis__head">
            {block.tag && <span className="r-analysis__tag">{block.tag}</span>}
            <h3 {...fieldProps(block.id, "title")}>
              {renderMarkedText(block.title, block.marks, doc, "title")}
            </h3>
          </div>
          {block.source && (
            <div className="r-analysis__source" {...fieldProps(block.id, "source")}>
              {renderMarkedText(block.source, block.marks, doc, "source")}
            </div>
          )}
          {block.quote && (
            <blockquote className="r-analysis__quote" {...fieldProps(block.id, "quote")}>
              {renderMarkedText(block.quote, block.marks, doc, "quote")}
            </blockquote>
          )}
          <dl className="r-analysis__items">
            {block.items.map((item) => {
              const role = item.role ? doc.rolePalette[item.role] : null;
              return (
                <div className="r-analysis__item" key={item.id}>
                  <dt>
                    {role && (
                      <span
                        className="r-analysis__swatch"
                        style={{ background: role.bg, borderColor: role.color }}
                      />
                    )}
                    {item.label}
                  </dt>
                  <dd {...fieldProps(block.id, `item:${item.id}:value`)}>
                    {renderMarkedText(item.value, block.marks, doc, `item:${item.id}:value`)}
                  </dd>
                </div>
              );
            })}
          </dl>
          {block.takeaway && (
            <div className="r-analysis__takeaway" {...fieldProps(block.id, "takeaway")}>
              {renderMarkedText(block.takeaway, block.marks, doc, "takeaway")}
            </div>
          )}
        </section>
      );
    case "table":
      return (
        <section
          className={`r-table-wrap node ${blockSelected ? "node--selected" : ""}`}
          onClick={selectBlock}
        >
          {block.title && <h3 className="r-table-title">{block.title}</h3>}
          <div className="r-table-scroll">
            <table className="r-table">
              <thead>
                <tr>
                  {block.columns.map((c, i) => (
                    <th key={i}>{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {block.rows.map((row, i) => (
                  <tr key={i}>
                    {block.columns.map((_, j) => (
                      <td key={j}>{row[j] ?? ""}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      );
    case "note": {
      const variant = block.variant ?? "point";
      return (
        <aside
          className={`r-note r-note--${variant} node ${
            blockSelected ? "node--selected" : ""
          }`}
          onClick={selectBlock}
        >
          <div className="r-note-label">{block.label}</div>
          <div {...fieldProps(block.id, "body")}>
            {renderMarkedText(block.body, block.marks, doc, "body")}
          </div>
        </aside>
      );
    }
    case "image":
      return (
        <figure
          className={`r-fig node ${blockSelected ? "node--selected" : ""}`}
          onClick={selectBlock}
        >
          {block.src ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={block.src} alt={block.alt} />
          ) : (
            <div className="hint" style={{ padding: 18 }}>
              画像URL未設定（インスペクタで設定）
            </div>
          )}
          <figcaption>{block.alt}</figcaption>
        </figure>
      );
    case "raw":
      return (
        <div
          className={`r-raw node ${blockSelected ? "node--selected" : ""}`}
          onClick={selectBlock}
          dangerouslySetInnerHTML={{ __html: block.html }}
        />
      );
  }
}

export default function Renderer({ doc, selection, onSelect }: Props) {
  const onMouseUp = () => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) return;
    const selectedText = selection.toString();
    if (!selectedText.trim()) return;
    const range = selection.getRangeAt(0);
    const startEl =
      range.startContainer.nodeType === Node.ELEMENT_NODE
        ? (range.startContainer as Element)
        : range.startContainer.parentElement;
    const endEl =
      range.endContainer.nodeType === Node.ELEMENT_NODE
        ? (range.endContainer as Element)
        : range.endContainer.parentElement;
    const startField = startEl?.closest<HTMLElement>("[data-vp-block][data-vp-field]");
    const endField = endEl?.closest<HTMLElement>("[data-vp-block][data-vp-field]");
    if (!startField || !endField || startField !== endField) return;

    const preRange = document.createRange();
    preRange.selectNodeContents(startField);
    preRange.setEnd(range.startContainer, range.startOffset);
    const start = preRange.toString().length;
    const end = start + selectedText.length;
    onSelect({
      kind: "text-range",
      blockId: startField.dataset.vpBlock ?? "",
      field: startField.dataset.vpField ?? "",
      start,
      end,
      text: selectedText,
    });
  };

  return (
    <div onMouseUp={onMouseUp} onClick={() => !hasActiveTextSelection() && onSelect(null)}>
      <Legend doc={doc} />
      {doc.blocks.map((b) => (
        <BlockView
          key={b.id}
          doc={doc}
          block={b}
          sel={selection}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}
