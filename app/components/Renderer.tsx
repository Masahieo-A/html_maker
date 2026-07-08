"use client";
// ============================================================================
// LessonDoc を編集ビューとして描画。任意ノードをクリック → onSelect。
// 「どこまでノードに分解するか = 編集可能な粒度」を体現する。
// ============================================================================
import React from "react";
import type { Block, Branch, LessonDoc, RolePalette, Selection, TextMark } from "@/lib/types";
import { sanitizeHtml } from "@/lib/sanitize";
import { moveBlockTo } from "@/lib/docOps";
import { roleDecoration, decorationCssProps } from "@/lib/roleStyle";
import { scopeCss, sanitizeCustomCss } from "@/lib/cssScope";

type Props = {
  doc: LessonDoc;
  selection: Selection;
  onSelect: (sel: Selection) => void;
  /** D&D 並べ替え用。未指定なら並べ替えは無効（ハンドルは表示するが drop しても何もしない） */
  onChange?: (next: LessonDoc) => void;
};

// --- 並べ替え中のドラッグ状態（Renderer 内で完結） --------------------------
type DragState = { draggedId: string; overId: string | null; overPos: "before" | "after" | null } | null;

/**
 * doc.blocks 上での「ドラッグ元を取り除いた後の配列における dropIdx の位置」に変換してから
 * before/after を反映する。docOps.moveBlockTo は「削除後に挿入する index」を受け取る仕様のため。
 */
function computeTargetIndex(
  doc: LessonDoc,
  draggedId: string,
  dropBlockId: string,
  pos: "before" | "after"
): number {
  const draggedIdx = doc.blocks.findIndex((b) => b.id === draggedId);
  const dropIdx = doc.blocks.findIndex((b) => b.id === dropBlockId);
  if (draggedIdx < 0 || dropIdx < 0) return dropIdx;
  const dropIdxAfterRemoval = dropIdx > draggedIdx ? dropIdx - 1 : dropIdx;
  return pos === "before" ? dropIdxAfterRemoval : dropIdxAfterRemoval + 1;
}

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
  rolePalette: RolePalette,
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
    const role = rolePalette[mark.role];
    const inner = mark.ruby ? (
      <ruby>
        {text.slice(mark.start, mark.end)}
        <rt>{mark.ruby}</rt>
      </ruby>
    ) : (
      text.slice(mark.start, mark.end)
    );
    parts.push(
      <span
        className="text-mark"
        key={mark.id}
        title={role?.label ?? mark.role}
        style={
          role
            ? { color: role.color, background: role.bg, ...decorationCssProps(roleDecoration(mark.role, rolePalette)) }
            : undefined
        }
      >
        {inner}
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

export const Legend = React.memo(function Legend({ rolePalette }: { rolePalette: RolePalette }) {
  const entries = Object.entries(rolePalette);
  if (entries.length === 0) return null;
  return (
    <div className="legend">
      {entries.map(([key, r]) => (
        <span className="legend-item" key={key}>
          <span className="swatch" style={{ background: r.bg, border: `1px solid ${r.color}` }} />
          <span style={{ color: r.color, ...decorationCssProps(roleDecoration(key, rolePalette)) }}>{r.label}</span>
        </span>
      ))}
    </div>
  );
});

const BranchView = React.memo(function BranchView({
  rolePalette,
  block,
  branch,
  sel,
  onSelect,
}: {
  rolePalette: RolePalette;
  block: Block;
  branch: Branch;
  sel: Selection;
  onSelect: Props["onSelect"];
}) {
  const role = rolePalette[branch.role];
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
        {branch.role &&
          (role ? (
            <span
              className="r-role"
              style={{ color: role.color, background: role.bg }}
            >
              {role.label}
            </span>
          ) : (
            <span className="r-role r-role--plain">{branch.role}</span>
          ))}
        <span style={{ fontWeight: 600 }}>{branch.value}</span>
      </div>
      {branch.children && branch.children.length > 0 && (
        <div className="r-children">
          {branch.children.map((c) => (
            <BranchView
              key={c.id}
              rolePalette={rolePalette}
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
});

type BlockViewProps = {
  block: Block;
  rolePalette: RolePalette;
  sel: Selection;
  onSelect: Props["onSelect"];
  dragState: DragState;
  onHandleDragStart: (blockId: string) => void;
  onBlockDragOver: (blockId: string, pos: "before" | "after") => void;
  onBlockDrop: (blockId: string) => void;
  onDragEnd: () => void;
};

/**
 * INP対策: block / rolePalette / このブロックに関係する選択・D&D状態が変わったときだけ再描画する。
 * doc をまるごと props に渡さないことで、他ブロック編集時の全ブロック再描画を防ぐ（改善提案 D-1）。
 * onSelect 以外のコールバックは prop identity が毎回変わっても構わない設計にしてあるため比較しない。
 * これが安全なのは、onBlockDrop が docRef（常に最新の doc を指す ref）から読み出す安定した
 * ハンドラだから（Renderer 側で useCallback の依存配列から doc を外して定義している）。
 * こうしないと、比較関数が古い（同一視された）props を保持し続けたブロックで drop すると、
 * 古い doc を捕まえたままの onBlockDrop が発火し、直前の他ブロック編集を巻き戻してしまう。
 */
function blockViewPropsEqual(prev: BlockViewProps, next: BlockViewProps): boolean {
  if (prev.block !== next.block) return false;
  if (prev.rolePalette !== next.rolePalette) return false;
  if (prev.onSelect !== next.onSelect) return false;

  const blockId = next.block.id;
  const selMatters = (s: Selection) => !!s && s.blockId === blockId;
  if (selMatters(prev.sel) || selMatters(next.sel)) {
    if (prev.sel !== next.sel) return false;
  }

  const dragMatters = (d: DragState) => !!d && (d.draggedId === blockId || d.overId === blockId);
  if (dragMatters(prev.dragState) || dragMatters(next.dragState)) {
    if (prev.dragState !== next.dragState) return false;
  }

  return true;
}

const BlockView = React.memo(function BlockView({
  block,
  rolePalette,
  sel,
  onSelect,
  dragState,
  onHandleDragStart,
  onBlockDragOver,
  onBlockDrop,
  onDragEnd,
}: BlockViewProps) {
  const blockSelected = isSelected(sel, { kind: "block", blockId: block.id });
  const selectBlock = (e: React.MouseEvent) => {
    if (hasActiveTextSelection()) return;
    e.stopPropagation();
    onSelect({ kind: "block", blockId: block.id });
  };

  let content: React.ReactNode;
  switch (block.type) {
    case "heading":
      content = (
        <div
          className={`r-h r-h${block.level} node ${blockSelected ? "node--selected" : ""}`}
          onClick={selectBlock}
          {...fieldProps(block.id, "text")}
        >
          {renderMarkedText(block.text, block.marks, rolePalette, "text")}
        </div>
      );
      break;
    case "paragraph":
      content = (
        <p
          className={`r-p node ${blockSelected ? "node--selected" : ""}`}
          onClick={selectBlock}
          {...fieldProps(block.id, "text")}
        >
          {renderMarkedText(block.text, block.marks, rolePalette, "text")}
        </p>
      );
      break;
    case "sentence":
      content = (
        <p
          className={`r-sentence node ${blockSelected ? "node--selected" : ""}`}
          onClick={selectBlock}
          data-vp-sentence={block.id}
        >
          {block.tokens.map((t) => {
            const role = t.role ? rolePalette[t.role] : null;
            const tselected =
              isSelected(sel, {
                kind: "token",
                blockId: block.id,
                tokenId: t.id,
              }) ||
              (sel?.kind === "token-range" &&
                sel.blockId === block.id &&
                sel.tokenIds.includes(t.id));
            return (
              <React.Fragment key={t.id}>
                <span
                  data-vp-token={t.id}
                  className={`tok ${role ? "" : "tok--plain"} ${
                    tselected ? "tok--selected" : ""
                  }`}
                  style={
                    role && t.role
                      ? { color: role.color, background: role.bg, ...decorationCssProps(roleDecoration(t.role, rolePalette)) }
                      : undefined
                  }
                  title={role?.label}
                  onClick={(e) => {
                    if (hasActiveTextSelection()) return;
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
      break;
    case "tree": {
      const rootSelected = isSelected(sel, {
        kind: "tree-root",
        blockId: block.id,
      });
      content = (
        <div
          className={`r-tree node ${blockSelected ? "node--selected" : ""}`}
          onClick={selectBlock}
        >
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
                  rolePalette={rolePalette}
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
      break;
    }
    case "analysisCard":
      content = (
        <section
          className={`r-analysis node ${blockSelected ? "node--selected" : ""}`}
          onClick={selectBlock}
        >
          <div className="r-analysis__head">
            {block.tag && (
              <span className="r-analysis__tag" {...fieldProps(block.id, "tag")}>
                {renderMarkedText(block.tag, block.marks, rolePalette, "tag")}
              </span>
            )}
            <h3 {...fieldProps(block.id, "title")}>
              {renderMarkedText(block.title, block.marks, rolePalette, "title")}
            </h3>
          </div>
          {block.source && (
            <div className="r-analysis__source" {...fieldProps(block.id, "source")}>
              {renderMarkedText(block.source, block.marks, rolePalette, "source")}
            </div>
          )}
          {block.quote && (
            <blockquote className="r-analysis__quote" {...fieldProps(block.id, "quote")}>
              {renderMarkedText(block.quote, block.marks, rolePalette, "quote")}
            </blockquote>
          )}
          <dl className="r-analysis__items">
            {block.items.map((item) => {
              const role = item.role ? rolePalette[item.role] : null;
              return (
                <div className="r-analysis__item" key={item.id}>
                  <dt>
                    {role && (
                      <span
                        className="r-analysis__swatch"
                        style={{ background: role.bg, borderColor: role.color }}
                      />
                    )}
                    <span {...fieldProps(block.id, `item:${item.id}:label`)}>
                      {renderMarkedText(item.label, block.marks, rolePalette, `item:${item.id}:label`)}
                    </span>
                  </dt>
                  <dd {...fieldProps(block.id, `item:${item.id}:value`)}>
                    {renderMarkedText(item.value, block.marks, rolePalette, `item:${item.id}:value`)}
                  </dd>
                </div>
              );
            })}
          </dl>
          {block.takeaway && (
            <div className="r-analysis__takeaway" {...fieldProps(block.id, "takeaway")}>
              {renderMarkedText(block.takeaway, block.marks, rolePalette, "takeaway")}
            </div>
          )}
        </section>
      );
      break;
    case "table":
      content = (
        <section
          className={`r-table-wrap node ${blockSelected ? "node--selected" : ""}`}
          onClick={selectBlock}
        >
          {block.title && (
            <h3 className="r-table-title" {...fieldProps(block.id, "title")}>
              {renderMarkedText(block.title, block.marks, rolePalette, "title")}
            </h3>
          )}
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
                    {block.columns.map((_, j) => {
                      const cellSelected =
                        sel?.kind === "table-cell" &&
                        sel.blockId === block.id &&
                        sel.row === i &&
                        sel.col === j;
                      return (
                        <td
                          key={j}
                          className={cellSelected ? "node--selected" : undefined}
                          style={{ cursor: "pointer" }}
                          onClick={(e) => {
                            if (hasActiveTextSelection()) return;
                            e.stopPropagation();
                            onSelect({ kind: "table-cell", blockId: block.id, row: i, col: j });
                          }}
                          {...fieldProps(block.id, `cell:${i}:${j}`)}
                        >
                          {renderMarkedText(row[j] ?? "", block.marks, rolePalette, `cell:${i}:${j}`)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      );
      break;
    case "note": {
      const variant = block.variant ?? "point";
      content = (
        <aside
          className={`r-note r-note--${variant} node ${
            blockSelected ? "node--selected" : ""
          }`}
          onClick={selectBlock}
        >
          <div className="r-note-label" {...fieldProps(block.id, "label")}>
            {renderMarkedText(block.label, block.marks, rolePalette, "label")}
          </div>
          <div {...fieldProps(block.id, "body")}>
            {renderMarkedText(block.body, block.marks, rolePalette, "body")}
          </div>
        </aside>
      );
      break;
    }
    case "image":
      content = (
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
      break;
    case "raw":
      content = (
        <div
          className={`r-raw node ${blockSelected ? "node--selected" : ""}`}
          onClick={selectBlock}
          // XSS対策: エディタ内での実行を防ぐため必ずサニタイズして描画する
          dangerouslySetInnerHTML={{ __html: sanitizeHtml(block.html) }}
        />
      );
      break;
  }

  const isDragging = dragState?.draggedId === block.id;
  const overPos = dragState?.overId === block.id ? dragState.overPos : null;

  return (
    <div
      className={`r-block ${isDragging ? "r-block--dragging" : ""} ${
        overPos === "before" ? "r-block--over-before" : ""
      } ${overPos === "after" ? "r-block--over-after" : ""}`}
      data-block-id={block.id}
      onDragOver={(e) => {
        e.preventDefault();
        const rect = e.currentTarget.getBoundingClientRect();
        const pos: "before" | "after" = e.clientY - rect.top < rect.height / 2 ? "before" : "after";
        onBlockDragOver(block.id, pos);
      }}
      onDrop={(e) => {
        e.preventDefault();
        onBlockDrop(block.id);
      }}
    >
      <span
        className="r-drag-handle"
        draggable
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", block.id);
          onHandleDragStart(block.id);
        }}
        onDragEnd={onDragEnd}
        title="ドラッグして並べ替え"
        aria-label="ブロックを並べ替え"
      >
        ⠿
      </span>
      <div className="r-block__content">{content}</div>
    </div>
  );
},
blockViewPropsEqual);

export default function Renderer({ doc, selection, onSelect, onChange }: Props) {
  const [dragState, setDragState] = React.useState<DragState>(null);

  // stale closure対策: BlockView は memo 比較で onBlockDrop の identity 変化を無視するため、
  // drop 処理は常にこの ref 経由で「最新の doc」を読む（レンダーごとに更新）。
  const docRef = React.useRef(doc);
  docRef.current = doc;

  const scopedCss = React.useMemo(() => {
    if (!doc.customCss || !doc.customCss.trim()) return "";
    // セキュリティ: インポートHTML由来の customCss がライブDOMに注入されるため、
    // @import / 外部 url() 参照等を除去してからスコープ化する（cssScope.ts 参照）。
    // </style> でのタグ抜け出しも防止（exportHtml.ts と同じ防御）。
    return scopeCss(sanitizeCustomCss(doc.customCss)).replace(/<\/style/gi, "<\\/style");
  }, [doc.customCss]);

  const onHandleDragStart = (blockId: string) => setDragState({ draggedId: blockId, overId: null, overPos: null });
  const onDragEnd = () => setDragState(null);
  const onBlockDragOver = (blockId: string, pos: "before" | "after") => {
    setDragState((prev) => {
      if (!prev) return prev;
      if (prev.overId === blockId && prev.overPos === pos) return prev;
      return { ...prev, overId: blockId, overPos: pos };
    });
  };
  // 依存配列から doc を外し、常に安定した identity を持つハンドラにする。
  // BlockView の memo 比較が onBlockDrop の identity 変化を見ないため、
  // ここが doc を直接クロージャで捕まえると古い doc に対して move してしまう
  // （直前の他ブロック編集が黙って巻き戻る）。docRef.current で常に最新を読むことで安全にする。
  const onBlockDrop = React.useCallback(
    (blockId: string) => {
      setDragState((prev) => {
        if (!prev || prev.draggedId === blockId) return null;
        if (onChange) {
          const currentDoc = docRef.current;
          const targetIndex = computeTargetIndex(currentDoc, prev.draggedId, blockId, prev.overPos ?? "after");
          onChange(moveBlockTo(currentDoc, prev.draggedId, targetIndex));
        }
        return null;
      });
    },
    [onChange]
  );

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
    // sentence ブロック内のドラッグ選択 → 語のまとまり（token-range）として扱う
    const startSentence = startEl?.closest<HTMLElement>("[data-vp-sentence]");
    const endSentence = endEl?.closest<HTMLElement>("[data-vp-sentence]");
    if (startSentence && startSentence === endSentence) {
      const tokenIds: string[] = [];
      startSentence.querySelectorAll<HTMLElement>("[data-vp-token]").forEach((el) => {
        if (range.intersectsNode(el) && el.dataset.vpToken) tokenIds.push(el.dataset.vpToken);
      });
      if (tokenIds.length > 0) {
        onSelect({
          kind: "token-range",
          blockId: startSentence.dataset.vpSentence ?? "",
          tokenIds,
          text: selectedText,
        });
        return;
      }
    }

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
    <div
      className="vp-canvas"
      onMouseUp={onMouseUp}
      onClick={() => !hasActiveTextSelection() && onSelect(null)}
    >
      {scopedCss && <style>{scopedCss}</style>}
      <Legend rolePalette={doc.rolePalette} />
      {doc.blocks.map((b) => (
        <BlockView
          key={b.id}
          block={b}
          rolePalette={doc.rolePalette}
          sel={selection}
          onSelect={onSelect}
          dragState={dragState}
          onHandleDragStart={onHandleDragStart}
          onBlockDragOver={onBlockDragOver}
          onBlockDrop={onBlockDrop}
          onDragEnd={onDragEnd}
        />
      ))}
    </div>
  );
}
