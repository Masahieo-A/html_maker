"use client";
// ============================================================================
// 選択ノードのプロパティ編集（要件 §5.2）＋ 範囲指定 AI 編集（§5.3）。
// 編集は常に「新しい doc を返す純粋変換」として onChange で親に渡す（履歴対応）。
// ============================================================================
import React, { useCallback, useMemo, useState } from "react";
import type {
  AnalysisCardBlock,
  Block,
  LessonDoc,
  NoteBlock,
  RawHtmlBlock,
  Selection,
  SentenceBlock,
  TableBlock,
  TextMark,
  TreeBlock,
} from "@/lib/types";
import { BLOCK_TYPE_LABELS } from "@/lib/types";
import {
  addChildBranch,
  countRoleUsage,
  duplicateBlock,
  findBlock,
  findBranch,
  moveBlock,
  removeBranch,
  removeRole,
  replaceBlock,
  updateBlock,
  updateBranch,
} from "@/lib/docOps";
import { analyzeDoc, applyQuickFix, type QualityIssue } from "@/lib/docQuality";
import { uid } from "@/lib/ids";

type Props = {
  doc: LessonDoc;
  selection: Selection;
  onChange: (next: LessonDoc) => void;
  onSelect: (sel: Selection) => void;
  onAiEdit: (instruction: string) => void;
  aiBusy: boolean;
  /** ブロック削除（confirm() 廃止、呼び出し側でトースト+元に戻すを提供） */
  onDeleteBlock: (blockId: string) => void;
  /** 1ブロック→複数ブロックへの分解（rawの段階的構造化・品質チェックのAI修正で使用） */
  onAiEditMulti: (blockId: string, instruction: string) => Promise<void>;
};

/** ブロック要素へスクロール（移動・複製・品質チェックからの誘導用。Renderer側の data-block-id と対応） */
function scrollToBlock(blockId: string) {
  requestAnimationFrame(() => {
    document.querySelector(`[data-block-id="${blockId}"]`)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  });
}

function RoleSelect({
  doc,
  value,
  onChange,
}: {
  doc: LessonDoc;
  value: string | null;
  onChange: (role: string | null) => void;
}) {
  return (
    <select
      className="select"
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value || null)}
    >
      <option value="">（役割なし）</option>
      {Object.entries(doc.rolePalette).map(([key, r]) => (
        <option key={key} value={key}>
          {r.label}（{key}）
        </option>
      ))}
    </select>
  );
}

export default function Inspector({
  doc,
  selection,
  onChange,
  onSelect,
  onAiEdit,
  aiBusy,
  onDeleteBlock,
  onAiEditMulti,
}: Props) {
  const [instruction, setInstruction] = useState("");

  if (!selection) {
    return (
      <div>
        <div className="insp__title">インスペクタ</div>
        <p className="hint">
          中央のビューで見出し・段落・単語・樹形図の枝・注釈などをクリックすると、ここで編集できます。
        </p>
        <div className="divider" />
        <QualityPanel doc={doc} onChange={onChange} onAiEditMulti={onAiEditMulti} />
        <div className="divider" />
        <CustomCssEditor doc={doc} onChange={onChange} />
        <div className="divider" />
        <PaletteEditor doc={doc} onChange={onChange} />
      </div>
    );
  }

  const block = findBlock(doc, selection.blockId);
  if (!block) return <p className="hint">ノードが見つかりません。</p>;

  // 範囲指定 AI 編集パネル（全選択共通で下部に表示）
  const aiPanel = (
    <>
      <div className="divider" />
      <div className="insp__title">範囲指定 AI 編集</div>
      <p className="hint" style={{ marginBottom: 6 }}>
        選択中のノードだけを AI に渡し、改善後のデータで差し替えます。
      </p>
      <textarea
        className="textarea"
        placeholder="例: この枝をもっと詳しく / この文の色分けを見直して"
        value={instruction}
        onChange={(e) => setInstruction(e.target.value)}
        style={{ minHeight: 64 }}
      />
      <button
        className="btn btn--primary"
        style={{ marginTop: 8, width: "100%", justifyContent: "center" }}
        disabled={aiBusy || !instruction.trim()}
        onClick={() => onAiEdit(instruction.trim())}
      >
        {aiBusy ? <span className="spinner" /> : "AI で更新"}
      </button>
    </>
  );

  return (
    <div>
      <div className="insp__title">インスペクタ</div>

      {/* 子要素（語・枝・セル・範囲）選択中でも、常に親ブロックへ戻れる導線を出す */}
      {selection.kind !== "block" && (
        <button
          className="btn btn--sm"
          style={{ marginBottom: 12 }}
          onClick={() => onSelect({ kind: "block", blockId: block.id })}
        >
          ◀ ブロック全体を選択（{BLOCK_TYPE_LABELS[block.type]}）
        </button>
      )}

      {selection.kind === "text-range" && (
        // key: 選択範囲のアイデンティティ（ブロック+フィールド+開始/終了位置）が変わったら
        // TextRangeEditor を再マウントし、内部state（特に ruby 入力）をリセットする。
        // リセットしないと、範囲を変えて「重要語句にする」等を押した際に前の範囲用の
        // ルビ入力が無関係な範囲へ混入してしまう。
        <TextRangeEditor
          key={`${block.id}:${selection.field}:${selection.start}:${selection.end}`}
          doc={doc}
          block={block}
          selection={selection}
          onChange={onChange}
        />
      )}

      {/* ブロック種別バッジ + 並べ替え/複製/削除（ブロック選択時） */}
      {selection.kind === "block" && (
        <BlockToolbar doc={doc} block={block} onChange={onChange} onSelect={onSelect} onDeleteBlock={onDeleteBlock} />
      )}

      {selection.kind === "block" && block.type === "heading" && (
        <>
          <span className="insp__chip">見出し</span>
          <div className="field">
            <label>レベル</label>
            <select
              className="select"
              value={block.level}
              onChange={(e) =>
                onChange(
                  updateBlock(doc, block.id, (b) => ({
                    ...(b as any),
                    level: Number(e.target.value),
                  }))
                )
              }
            >
              <option value={1}>H1</option>
              <option value={2}>H2</option>
              <option value={3}>H3</option>
            </select>
          </div>
          <div className="field">
            <label>テキスト</label>
            <input
              className="input"
              value={block.text}
              onChange={(e) =>
                onChange(
                  updateBlock(doc, block.id, (b) => ({ ...(b as any), text: e.target.value }))
                )
              }
            />
          </div>
        </>
      )}

      {selection.kind === "block" && block.type === "paragraph" && (
        <>
          <span className="insp__chip">段落</span>
          <div className="field">
            <label>本文</label>
            <textarea
              className="textarea"
              value={block.text}
              onChange={(e) =>
                onChange(
                  updateBlock(doc, block.id, (b) => ({ ...(b as any), text: e.target.value }))
                )
              }
            />
          </div>
        </>
      )}

      {selection.kind === "block" && block.type === "note" && (
        <NoteEditor doc={doc} block={block} onChange={onChange} />
      )}

      {selection.kind === "block" && block.type === "image" && (
        <>
          <span className="insp__chip">画像</span>
          <div className="field">
            <label>画像URL</label>
            <input
              className="input"
              value={block.src}
              placeholder="https://..."
              onChange={(e) =>
                onChange(
                  updateBlock(doc, block.id, (b) => ({ ...(b as any), src: e.target.value }))
                )
              }
            />
          </div>
          <div className="field">
            <label>代替テキスト / キャプション</label>
            <input
              className="input"
              value={block.alt}
              onChange={(e) =>
                onChange(
                  updateBlock(doc, block.id, (b) => ({ ...(b as any), alt: e.target.value }))
                )
              }
            />
          </div>
        </>
      )}

      {selection.kind === "block" && block.type === "raw" && (
        <RawEditor doc={doc} block={block} onChange={onChange} onAiEditMulti={onAiEditMulti} />
      )}

      {selection.kind === "block" && block.type === "analysisCard" && (
        <AnalysisCardEditor doc={doc} block={block} onChange={onChange} />
      )}

      {selection.kind === "block" && block.type === "table" && (
        <TableEditor doc={doc} block={block} onChange={onChange} />
      )}

      {selection.kind === "block" && block.type === "sentence" && (
        <SentenceEditor
          doc={doc}
          block={block}
          onChange={onChange}
          onSelect={onSelect}
        />
      )}

      {selection.kind === "token" && block.type === "sentence" && (
        <TokenEditor
          doc={doc}
          block={block}
          tokenId={selection.tokenId}
          onChange={onChange}
        />
      )}

      {selection.kind === "token-range" && block.type === "sentence" && (
        <TokenRangeEditor
          doc={doc}
          block={block}
          tokenIds={selection.tokenIds}
          text={selection.text}
          onChange={onChange}
        />
      )}

      {selection.kind === "table-cell" && block.type === "table" && (
        <TableCellEditor
          doc={doc}
          block={block}
          row={selection.row}
          col={selection.col}
          onChange={onChange}
        />
      )}

      {selection.kind === "tree-root" && block.type === "tree" && (
        <>
          <span className="insp__chip">樹形図 ルート</span>
          <div className="field">
            <label>ルートのラベル</label>
            <input
              className="input"
              value={block.root}
              onChange={(e) =>
                onChange(
                  updateBlock(doc, block.id, (b) => ({ ...(b as any), root: e.target.value }))
                )
              }
            />
          </div>
        </>
      )}

      {selection.kind === "branch" && block.type === "tree" && (
        <BranchEditor
          doc={doc}
          block={block}
          branchId={selection.branchId}
          onChange={onChange}
          onSelect={onSelect}
        />
      )}

      <MarksManager doc={doc} block={block} onChange={onChange} />

      {aiPanel}

      <div className="divider" />
      <details>
        <summary className="hint" style={{ cursor: "pointer" }}>
          役割パレット（色 = 意味）を編集
        </summary>
        <PaletteEditor doc={doc} onChange={onChange} />
      </details>
    </div>
  );
}

function getBlockMarks(block: Block): TextMark[] {
  return "marks" in block && Array.isArray(block.marks) ? block.marks : [];
}

function withBlockMarks(block: Block, marks: TextMark[]): Block {
  if (
    block.type === "heading" ||
    block.type === "paragraph" ||
    block.type === "analysisCard" ||
    block.type === "table" ||
    block.type === "note"
  ) {
    return { ...block, marks };
  }
  return block;
}

/** マーク対象フィールドの生テキストを取得（マーカー一覧の抜粋表示用） */
function getFieldText(block: Block, field: string): string {
  switch (block.type) {
    case "heading":
    case "paragraph":
      return field === "text" ? block.text : "";
    case "note":
      if (field === "body") return block.body;
      if (field === "label") return block.label;
      return "";
    case "analysisCard": {
      if (field === "title") return block.title;
      if (field === "tag") return block.tag ?? "";
      if (field === "source") return block.source ?? "";
      if (field === "quote") return block.quote ?? "";
      if (field === "takeaway") return block.takeaway ?? "";
      const m = field.match(/^item:(.+):(label|value)$/);
      if (m) {
        const item = block.items.find((i) => i.id === m[1]);
        return item ? (m[2] === "label" ? item.label : item.value) : "";
      }
      return "";
    }
    case "table": {
      if (field === "title") return block.title ?? "";
      const m = field.match(/^cell:(\d+):(\d+)$/);
      if (m) return block.rows[Number(m[1])]?.[Number(m[2])] ?? "";
      return "";
    }
    default:
      return "";
  }
}

function ensureImportantRole(doc: LessonDoc): LessonDoc {
  if (doc.rolePalette.important_phrase) return doc;
  return {
    ...doc,
    rolePalette: {
      ...doc.rolePalette,
      important_phrase: {
        label: "重要語句",
        color: "#7c2d12",
        bg: "#ffedd5",
      },
    },
  };
}

function TextRangeEditor({
  doc,
  block,
  selection,
  onChange,
}: {
  doc: LessonDoc;
  block: Block;
  selection: Extract<NonNullable<Selection>, { kind: "text-range" }>;
  onChange: (d: LessonDoc) => void;
}) {
  const defaultRole =
    (doc.rolePalette.important_phrase && "important_phrase") ||
    Object.keys(doc.rolePalette).find((key) => doc.rolePalette[key].label.includes("重要")) ||
    Object.keys(doc.rolePalette)[0] ||
    "";
  const [role, setRole] = useState(defaultRole);
  const [ruby, setRuby] = useState("");

  // includeRuby: 明示的に「適用」ボタンを押したときのみ true。「重要語句にする」等の
  // クイック適用ボタンは ruby を付けない（旧仕様は常に付けていたため、範囲を変えて
  // クイック適用すると前の範囲用に入力したルビが無関係な範囲に混入していた）。
  const applyMark = (roleKey: string, opts?: { includeRuby?: boolean }) => {
    const baseDoc = roleKey === "important_phrase" ? ensureImportantRole(doc) : doc;
    const mark: TextMark = {
      id: uid("mark"),
      field: selection.field,
      start: selection.start,
      end: selection.end,
      role: roleKey,
      ruby: opts?.includeRuby ? ruby.trim() || undefined : undefined,
    };
    // 重なった既存マークは置き換える（重複マークは描画時に黙って消えるため）
    onChange(
      updateBlock(baseDoc, block.id, (b) =>
        withBlockMarks(b, [
          ...getBlockMarks(b).filter(
            (m) =>
              m.field !== selection.field ||
              m.end <= selection.start ||
              m.start >= selection.end
          ),
          mark,
        ])
      )
    );
  };

  const removeOverlapping = () => {
    onChange(
      updateBlock(doc, block.id, (b) =>
        withBlockMarks(
          b,
          getBlockMarks(b).filter(
            (m) =>
              m.field !== selection.field ||
              m.end <= selection.start ||
              m.start >= selection.end
          )
        )
      )
    );
  };

  return (
    <>
      <span className="insp__chip">範囲選択</span>
      <p className="hint" style={{ marginTop: 0 }}>
        選択範囲: 「{selection.text}」
      </p>
      <div className="field">
        <label>マーカーの意味</label>
        <RoleSelect doc={doc} value={role || null} onChange={(next) => setRole(next ?? "")} />
      </div>
      <div className="field">
        <label>ルビ（任意）</label>
        <input
          className="input"
          placeholder="例: きゅうじょ / rescue"
          value={ruby}
          onChange={(e) => setRuby(e.target.value)}
        />
      </div>
      <div className="row" style={{ flexWrap: "wrap" }}>
        <button
          className="btn btn--primary btn--sm"
          disabled={!role}
          onClick={() => role && applyMark(role, { includeRuby: true })}
        >
          適用
        </button>
        <button className="btn btn--sm" onClick={() => applyMark("important_phrase")}>
          重要語句にする
        </button>
        <button className="btn btn--sm btn--danger" onClick={removeOverlapping}>
          この範囲のマーカー解除
        </button>
      </div>
      <div className="divider" />
    </>
  );
}

// --- ブロック共通ツールバー（上下移動・削除） --------------------------------
function BlockToolbar({
  doc,
  block,
  onChange,
  onSelect,
  onDeleteBlock,
}: {
  doc: LessonDoc;
  block: Block;
  onChange: (d: LessonDoc) => void;
  onSelect: (s: Selection) => void;
  onDeleteBlock: (blockId: string) => void;
}) {
  const moveAndFollow = (dir: -1 | 1) => {
    onChange(moveBlock(doc, block.id, dir));
    scrollToBlock(block.id);
  };
  const duplicateAndFollow = () => {
    const idx = doc.blocks.findIndex((b) => b.id === block.id);
    const next = duplicateBlock(doc, block.id);
    onChange(next);
    const clone = idx >= 0 ? next.blocks[idx + 1] : undefined;
    if (clone) {
      onSelect({ kind: "block", blockId: clone.id });
      scrollToBlock(clone.id);
    }
  };
  return (
    <div className="row" style={{ marginBottom: 12, flexWrap: "wrap" }}>
      <button className="btn btn--sm" onClick={() => moveAndFollow(-1)}>
        ↑ 上へ
      </button>
      <button className="btn btn--sm" onClick={() => moveAndFollow(1)}>
        ↓ 下へ
      </button>
      <button className="btn btn--sm" onClick={duplicateAndFollow}>
        ⧉ 複製
      </button>
      <button className="btn btn--sm btn--danger" onClick={() => onDeleteBlock(block.id)}>
        削除
      </button>
    </div>
  );
}

function RawEditor({
  doc,
  block,
  onChange,
  onAiEditMulti,
}: {
  doc: LessonDoc;
  block: RawHtmlBlock;
  onChange: (d: LessonDoc) => void;
  onAiEditMulti: (blockId: string, instruction: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const structure = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await onAiEditMulti(
        block.id,
        "この生HTMLブロックを、内容に応じて見出し・段落・文（sentence）・表・注釈などの適切な種類のブロックに分解・構造化してください。内容や意味を変えないこと。分解不要なら1個のブロックのままでよい。"
      );
    } catch (e: any) {
      setError(e?.message ?? "構造化に失敗しました");
    } finally {
      setBusy(false);
    }
  }, [block.id, onAiEditMulti]);

  return (
    <>
      <span className="insp__chip">生HTML</span>
      <div className="field">
        <label>HTML</label>
        <textarea
          className="textarea"
          style={{ minHeight: 140, fontFamily: "monospace", fontSize: 12.5 }}
          value={block.html}
          onChange={(e) =>
            onChange(updateBlock(doc, block.id, (b) => ({ ...(b as any), html: e.target.value })))
          }
        />
      </div>
      <p className="hint" style={{ marginTop: 0 }}>
        生HTMLのままだと構造編集・色分けの恩恵が受けられません。AIで段落・表・文ブロック等に分解できます。
      </p>
      <button className="btn btn--sm btn--primary" disabled={busy} onClick={structure}>
        {busy ? <span className="spinner" /> : "✨ AIで構造化（段落・表・文ブロック等に分解）"}
      </button>
      {error && (
        <p className="hint" style={{ color: "var(--danger)", marginTop: 6 }}>
          エラー: {error}
        </p>
      )}
    </>
  );
}

function AnalysisCardEditor({
  doc,
  block,
  onChange,
}: {
  doc: LessonDoc;
  block: AnalysisCardBlock;
  onChange: (d: LessonDoc) => void;
}) {
  // ローカル state を持たず doc を直接パッチする（選択切替・undo・AI編集に常に追従）
  const patch = (p: Partial<AnalysisCardBlock>) =>
    onChange(updateBlock(doc, block.id, (b) => ({ ...(b as AnalysisCardBlock), ...p })));
  const patchItem = (id: string, p: Partial<AnalysisCardBlock["items"][number]>) =>
    patch({ items: block.items.map((item) => (item.id === id ? { ...item, ...p } : item)) });
  return (
    <>
      <span className="insp__chip">分析カード</span>
      <div className="field">
        <label>タグ</label>
        <input className="input" value={block.tag ?? ""} onChange={(e) => patch({ tag: e.target.value || undefined })} />
      </div>
      <div className="field">
        <label>タイトル</label>
        <input className="input" value={block.title} onChange={(e) => patch({ title: e.target.value })} />
      </div>
      <div className="field">
        <label>出典・位置</label>
        <input className="input" value={block.source ?? ""} onChange={(e) => patch({ source: e.target.value || undefined })} />
      </div>
      <div className="field">
        <label>引用・対象</label>
        <textarea className="textarea" value={block.quote ?? ""} onChange={(e) => patch({ quote: e.target.value || undefined })} />
      </div>
      <div className="field">
        <label>項目</label>
        {block.items.map((item) => (
          <div
            key={item.id}
            style={{
              border: "1px solid var(--line)",
              borderRadius: 8,
              padding: 8,
              marginBottom: 8,
            }}
          >
            <div className="row" style={{ marginBottom: 6 }}>
              <input
                className="input"
                placeholder="ラベル（例: 根拠）"
                value={item.label}
                onChange={(e) => patchItem(item.id, { label: e.target.value })}
              />
              <button
                className="btn btn--sm btn--danger"
                onClick={() => patch({ items: block.items.filter((i) => i.id !== item.id) })}
              >
                ×
              </button>
            </div>
            <textarea
              className="textarea"
              style={{ minHeight: 48, marginBottom: 6 }}
              placeholder="内容"
              value={item.value}
              onChange={(e) => patchItem(item.id, { value: e.target.value })}
            />
            <RoleSelect
              doc={doc}
              value={item.role ?? null}
              onChange={(role) => patchItem(item.id, { role })}
            />
          </div>
        ))}
        <button
          className="btn btn--sm"
          onClick={() =>
            patch({
              items: [...block.items, { id: uid("item"), label: "項目", value: "", role: null }],
            })
          }
        >
          ＋ 項目を追加
        </button>
      </div>
      <div className="field">
        <label>まとめ</label>
        <textarea className="textarea" value={block.takeaway ?? ""} onChange={(e) => patch({ takeaway: e.target.value || undefined })} />
      </div>
    </>
  );
}

function TableEditor({
  doc,
  block,
  onChange,
}: {
  doc: LessonDoc;
  block: TableBlock;
  onChange: (d: LessonDoc) => void;
}) {
  // ローカル state を持たず doc を直接パッチする（選択切替・undo・AI編集に常に追従）
  const patch = (p: Partial<TableBlock>) =>
    onChange(updateBlock(doc, block.id, (b) => ({ ...(b as TableBlock), ...p })));
  const setCell = (i: number, j: number, v: string) =>
    patch({
      rows: block.rows.map((row, ri) => (ri === i ? row.map((c, ci) => (ci === j ? v : c)) : row)),
    });
  const addColumn = () =>
    patch({
      columns: [...block.columns, "新しい列"],
      rows: block.rows.map((r) => [...r, ""]),
    });
  const removeColumn = (j: number) => {
    if (block.columns.length <= 1) return;
    patch({
      columns: block.columns.filter((_, i) => i !== j),
      rows: block.rows.map((r) => r.filter((_, i) => i !== j)),
    });
  };
  return (
    <>
      <span className="insp__chip">表</span>
      <div className="field">
        <label>タイトル</label>
        <input className="input" value={block.title ?? ""} onChange={(e) => patch({ title: e.target.value || undefined })} />
      </div>
      <div className="field">
        <label>列名</label>
        {block.columns.map((c, j) => (
          <div className="row" key={j} style={{ marginBottom: 6 }}>
            <input
              className="input"
              value={c}
              onChange={(e) =>
                patch({ columns: block.columns.map((col, i) => (i === j ? e.target.value : col)) })
              }
            />
            <button
              className="btn btn--sm btn--danger"
              title="この列を削除"
              disabled={block.columns.length <= 1}
              onClick={() => removeColumn(j)}
            >
              ×
            </button>
          </div>
        ))}
        <button className="btn btn--sm" onClick={addColumn}>
          ＋ 列を追加
        </button>
      </div>
      <div className="field">
        <label>行（セルはビュー上のクリックでも編集可）</label>
        {block.rows.map((row, i) => (
          <div
            key={i}
            style={{
              border: "1px solid var(--line)",
              borderRadius: 8,
              padding: 8,
              marginBottom: 8,
            }}
          >
            {block.columns.map((c, j) => (
              <div className="row" key={j} style={{ marginBottom: 4 }}>
                <span className="hint" style={{ minWidth: 64, fontSize: 11 }}>
                  {c}
                </span>
                <input
                  className="input"
                  value={row[j] ?? ""}
                  onChange={(e) => setCell(i, j, e.target.value)}
                />
              </div>
            ))}
            <button
              className="btn btn--sm btn--danger"
              onClick={() => patch({ rows: block.rows.filter((_, ri) => ri !== i) })}
            >
              この行を削除
            </button>
          </div>
        ))}
        <button
          className="btn btn--sm"
          onClick={() => patch({ rows: [...block.rows, block.columns.map(() => "")] })}
        >
          ＋ 行を追加
        </button>
      </div>
    </>
  );
}

function TableCellEditor({
  doc,
  block,
  row,
  col,
  onChange,
}: {
  doc: LessonDoc;
  block: TableBlock;
  row: number;
  col: number;
  onChange: (d: LessonDoc) => void;
}) {
  const value = block.rows[row]?.[col];
  if (value === undefined) return <p className="hint">セルが見つかりません。</p>;
  return (
    <>
      <span className="insp__chip">セル</span>
      <div className="field">
        <label>
          {row + 1} 行目 ・ 「{block.columns[col] ?? `${col + 1} 列目`}」
        </label>
        <textarea
          className="textarea"
          value={value}
          onChange={(e) =>
            onChange(
              updateBlock(doc, block.id, (b) => {
                const t = b as TableBlock;
                return {
                  ...t,
                  rows: t.rows.map((r, ri) =>
                    ri === row ? r.map((c, ci) => (ci === col ? e.target.value : c)) : r
                  ),
                };
              })
            )
          }
        />
      </div>
      <p className="hint">セル内の文字をドラッグ選択するとマーカーも付けられます。</p>
    </>
  );
}

function NoteEditor({
  doc,
  block,
  onChange,
}: {
  doc: LessonDoc;
  block: NoteBlock;
  onChange: (d: LessonDoc) => void;
}) {
  return (
    <>
      <span className="insp__chip">注釈</span>
      <div className="field">
        <label>種類</label>
        <select
          className="select"
          value={block.variant ?? "point"}
          onChange={(e) =>
            onChange(
              updateBlock(doc, block.id, (b) => ({ ...(b as any), variant: e.target.value }))
            )
          }
        >
          <option value="point">着眼点</option>
          <option value="tip">ヒント</option>
          <option value="warning">注意</option>
        </select>
      </div>
      <div className="field">
        <label>ラベル</label>
        <input
          className="input"
          value={block.label}
          onChange={(e) =>
            onChange(updateBlock(doc, block.id, (b) => ({ ...(b as any), label: e.target.value })))
          }
        />
      </div>
      <div className="field">
        <label>本文</label>
        <textarea
          className="textarea"
          value={block.body}
          onChange={(e) =>
            onChange(updateBlock(doc, block.id, (b) => ({ ...(b as any), body: e.target.value })))
          }
        />
      </div>
    </>
  );
}

function SentenceEditor({
  doc,
  block,
  onChange,
  onSelect,
}: {
  doc: LessonDoc;
  block: SentenceBlock;
  onChange: (d: LessonDoc) => void;
  onSelect: (s: Selection) => void;
}) {
  const setTokens = (tokens: SentenceBlock["tokens"]) =>
    onChange(replaceBlock(doc, block.id, { ...block, tokens }));

  return (
    <>
      <span className="insp__chip">文（語の色分け）</span>
      <p className="hint" style={{ marginBottom: 8 }}>
        各語をクリックすると 1 語ずつ役割を編集できます。下で追加・削除も可能。
      </p>
      {block.tokens.map((t, i) => (
        <div className="token-edit-row" key={t.id}>
          <input
            className="input"
            value={t.text}
            onChange={(e) => {
              const tokens = [...block.tokens];
              tokens[i] = { ...t, text: e.target.value };
              setTokens(tokens);
            }}
            onFocus={() =>
              onSelect({ kind: "token", blockId: block.id, tokenId: t.id })
            }
          />
          <button
            className="btn btn--sm btn--danger"
            onClick={() => setTokens(block.tokens.filter((x) => x.id !== t.id))}
          >
            ×
          </button>
        </div>
      ))}
      <button
        className="btn btn--sm"
        onClick={() =>
          setTokens([...block.tokens, { id: uid("t"), text: "語", role: null }])
        }
      >
        ＋ 語を追加
      </button>
    </>
  );
}

function TokenEditor({
  doc,
  block,
  tokenId,
  onChange,
}: {
  doc: LessonDoc;
  block: SentenceBlock;
  tokenId: string;
  onChange: (d: LessonDoc) => void;
}) {
  const token = block.tokens.find((t) => t.id === tokenId);
  if (!token) return <p className="hint">語が見つかりません。</p>;
  const patch = (p: Partial<typeof token>) =>
    onChange(
      replaceBlock(doc, block.id, {
        ...block,
        tokens: block.tokens.map((t) => (t.id === tokenId ? { ...t, ...p } : t)),
      })
    );
  return (
    <>
      <span className="insp__chip">単語</span>
      <div className="field">
        <label>テキスト</label>
        <input className="input" value={token.text} onChange={(e) => patch({ text: e.target.value })} />
      </div>
      <div className="field">
        <label>役割（色）</label>
        <RoleSelect doc={doc} value={token.role} onChange={(role) => patch({ role })} />
      </div>
    </>
  );
}

function TokenRangeEditor({
  doc,
  block,
  tokenIds,
  text,
  onChange,
}: {
  doc: LessonDoc;
  block: SentenceBlock;
  tokenIds: string[];
  text: string;
  onChange: (d: LessonDoc) => void;
}) {
  const apply = (role: string | null) =>
    onChange(
      replaceBlock(doc, block.id, {
        ...block,
        tokens: block.tokens.map((t) => (tokenIds.includes(t.id) ? { ...t, role } : t)),
      })
    );
  return (
    <>
      <span className="insp__chip">語の範囲（{tokenIds.length} 語）</span>
      <p className="hint" style={{ marginTop: 0 }}>
        選択範囲: 「{text}」
      </p>
      <div className="field">
        <label>まとめて役割（色）を割り当て</label>
        <RoleSelect doc={doc} value={null} onChange={(role) => apply(role)} />
      </div>
      <button className="btn btn--sm btn--danger" onClick={() => apply(null)}>
        この範囲の役割を外す
      </button>
      <div className="divider" />
    </>
  );
}

function MarksManager({
  doc,
  block,
  onChange,
}: {
  doc: LessonDoc;
  block: Block;
  onChange: (d: LessonDoc) => void;
}) {
  const marks = getBlockMarks(block);
  if (marks.length === 0) return null;
  return (
    <>
      <div className="divider" />
      <div className="insp__title">マーカー一覧</div>
      {marks.map((m) => {
        const fieldText = getFieldText(block, m.field);
        const excerpt = fieldText.slice(m.start, m.end) || `${m.field} ${m.start}-${m.end}`;
        const role = doc.rolePalette[m.role];
        return (
          <div key={m.id} style={{ marginBottom: 8 }}>
            <div className="row" style={{ alignItems: "center" }}>
              <span
                className="text-mark"
                style={role ? { color: role.color, background: role.bg } : undefined}
              >
                {excerpt.length > 24 ? excerpt.slice(0, 24) + "…" : excerpt}
              </span>
              <span className="hint" style={{ flex: 1 }}>
                {role?.label ?? m.role}
              </span>
              <button
                className="btn btn--sm btn--danger"
                title="このマーカーを削除"
                onClick={() =>
                  onChange(
                    updateBlock(doc, block.id, (b) =>
                      withBlockMarks(b, getBlockMarks(b).filter((x) => x.id !== m.id))
                    )
                  )
                }
              >
                ×
              </button>
            </div>
            <input
              className="input"
              style={{ marginTop: 4 }}
              placeholder="ルビ（任意）"
              value={m.ruby ?? ""}
              onChange={(e) =>
                onChange(
                  updateBlock(doc, block.id, (b) =>
                    withBlockMarks(
                      b,
                      getBlockMarks(b).map((x) => (x.id === m.id ? { ...x, ruby: e.target.value || undefined } : x))
                    )
                  )
                )
              }
            />
          </div>
        );
      })}
    </>
  );
}

function BranchEditor({
  doc,
  block,
  branchId,
  onChange,
  onSelect,
}: {
  doc: LessonDoc;
  block: TreeBlock;
  branchId: string;
  onChange: (d: LessonDoc) => void;
  onSelect: (s: Selection) => void;
}) {
  const branch = findBranch(block.branches, branchId);
  if (!branch) return <p className="hint">枝が見つかりません。</p>;
  return (
    <>
      <span className="insp__chip">樹形図 枝</span>
      <div className="field">
        <label>役割ラベル（色は役割パレットと連動）</label>
        <input
          className="input"
          value={branch.role}
          onChange={(e) =>
            onChange(replaceBlock(doc, block.id, updateBranch(block, branchId, { role: e.target.value })))
          }
        />
      </div>
      <div className="field">
        <label>中身</label>
        <input
          className="input"
          value={branch.value}
          onChange={(e) =>
            onChange(replaceBlock(doc, block.id, updateBranch(block, branchId, { value: e.target.value })))
          }
        />
      </div>
      <div className="row" style={{ flexWrap: "wrap" }}>
        <button
          className="btn btn--sm"
          onClick={() =>
            onChange(
              replaceBlock(doc, block.id, {
                ...block,
                branches: addChildBranch(block.branches, branchId),
              })
            )
          }
        >
          ＋ 子の枝
        </button>
        <button
          className="btn btn--sm btn--danger"
          onClick={() => {
            onChange(
              replaceBlock(doc, block.id, {
                ...block,
                branches: removeBranch(block.branches, branchId),
              })
            );
            onSelect({ kind: "tree-root", blockId: block.id });
          }}
        >
          枝を削除
        </button>
      </div>
    </>
  );
}

// --- 役割パレット編集（色は意味。doc 単位で定義・再利用） --------------------
function PaletteEditor({
  doc,
  onChange,
}: {
  doc: LessonDoc;
  onChange: (d: LessonDoc) => void;
}) {
  const [newKey, setNewKey] = useState("");
  const [confirmingKey, setConfirmingKey] = useState<string | null>(null);
  const entries = Object.entries(doc.rolePalette);
  return (
    <div>
      <div className="insp__title">役割パレット（色 = 意味）</div>
      {entries.length === 0 && <p className="hint">まだ役割がありません。</p>}
      {entries.map(([key, role]) => {
        const usage = countRoleUsage(doc, key);
        return (
          <div key={key} style={{ marginBottom: 10 }}>
            <div className="row">
              <input
                type="color"
                value={role.color}
                title="文字色"
                onChange={(e) =>
                  onChange({
                    ...doc,
                    rolePalette: {
                      ...doc.rolePalette,
                      [key]: { ...role, color: e.target.value },
                    },
                  })
                }
                style={{ width: 32, height: 32, padding: 0, border: "none", background: "none" }}
              />
              <input
                type="color"
                value={role.bg}
                title="背景色"
                onChange={(e) =>
                  onChange({
                    ...doc,
                    rolePalette: {
                      ...doc.rolePalette,
                      [key]: { ...role, bg: e.target.value },
                    },
                  })
                }
                style={{ width: 32, height: 32, padding: 0, border: "none", background: "none" }}
              />
              <input
                className="input"
                value={role.label}
                onChange={(e) =>
                  onChange({
                    ...doc,
                    rolePalette: {
                      ...doc.rolePalette,
                      [key]: { ...role, label: e.target.value },
                    },
                  })
                }
              />
              <button
                className="btn btn--sm btn--danger"
                title="この役割を削除"
                onClick={() => setConfirmingKey(key)}
              >
                ×
              </button>
            </div>
            <div className="hint" style={{ marginTop: 2 }}>
              {usage > 0 ? `${usage}箇所で使用中` : "未使用"}
            </div>
            {confirmingKey === key && (
              <div className="row" style={{ marginTop: 4, flexWrap: "wrap", alignItems: "center" }}>
                <span className="hint">
                  本当に削除？{usage > 0 ? "使用箇所からも色分けが外れます" : ""}
                </span>
                <button
                  className="btn btn--sm btn--danger"
                  onClick={() => {
                    onChange(removeRole(doc, key));
                    setConfirmingKey(null);
                  }}
                >
                  削除する
                </button>
                <button className="btn btn--sm" onClick={() => setConfirmingKey(null)}>
                  やめる
                </button>
              </div>
            )}
          </div>
        );
      })}
      <div className="row" style={{ marginTop: 6 }}>
        <input
          className="input"
          placeholder="新しい役割キー（例: sv）"
          value={newKey}
          onChange={(e) => setNewKey(e.target.value)}
        />
        <button
          className="btn btn--sm"
          disabled={!newKey.trim() || !!doc.rolePalette[newKey.trim()]}
          onClick={() => {
            const key = newKey.trim();
            onChange({
              ...doc,
              rolePalette: {
                ...doc.rolePalette,
                [key]: { label: key, color: "#334155", bg: "#e2e8f0" },
              },
            });
            setNewKey("");
          }}
        >
          追加
        </button>
      </div>
    </div>
  );
}

// --- 教材スタイル（customCss）編集（改善提案 A-1/A-2） -----------------------
function CustomCssEditor({
  doc,
  onChange,
}: {
  doc: LessonDoc;
  onChange: (d: LessonDoc) => void;
}) {
  const has = !!(doc.customCss && doc.customCss.trim());
  const [open, setOpen] = useState(has);

  if (!has && !open) {
    return (
      <button className="btn btn--sm" onClick={() => setOpen(true)}>
        ＋ 教材スタイル(CSS)を追加
      </button>
    );
  }

  return (
    <div>
      <div className="insp__title">教材スタイル（CSS）</div>
      <p className="hint" style={{ marginTop: 0 }}>
        {has
          ? "インポート時に取り込まれた元デザインのCSSです。書き出しHTMLにも適用されます。"
          : "この教材専用のCSSを直接記述できます。書き出しHTMLにも適用されます。"}
      </p>
      <textarea
        className="textarea"
        style={{ minHeight: 120, fontFamily: "monospace", fontSize: 12.5 }}
        placeholder="例: .highlight { color: #b91c1c; }"
        value={doc.customCss ?? ""}
        onChange={(e) => onChange({ ...doc, customCss: e.target.value || undefined })}
      />
      {has && (
        <button
          className="btn btn--sm btn--danger"
          style={{ marginTop: 6 }}
          onClick={() => onChange({ ...doc, customCss: undefined })}
        >
          教材スタイルを削除
        </button>
      )}
    </div>
  );
}

// --- 品質チェック（改善提案「デフォルトの質＝プロダクトの質」対応） ----------
function QualityPanel({
  doc,
  onChange,
  onAiEditMulti,
}: {
  doc: LessonDoc;
  onChange: (d: LessonDoc) => void;
  onAiEditMulti: (blockId: string, instruction: string) => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [errorFor, setErrorFor] = useState<{ id: string; message: string } | null>(null);
  // doc が変わるたびに再計算（決定的チェックのため軽量）。バッジ表示のため常時計算する。
  const issues = useMemo(() => analyzeDoc(doc), [doc]);
  const warnCount = issues.filter((i) => i.level === "warn").length;

  const handleQuickFix = useCallback(
    (issueId: string) => onChange(applyQuickFix(doc, issueId)),
    [doc, onChange]
  );

  const handleAiFix = useCallback(
    async (issue: QualityIssue) => {
      if (issue.fix?.kind !== "ai") return;
      const targetIds = issue.blockIds ?? [];
      if (targetIds.length === 0) return;
      setBusyId(issue.id);
      setErrorFor(null);
      try {
        for (const blockId of targetIds) {
          await onAiEditMulti(blockId, issue.fix.instruction);
        }
      } catch (e: any) {
        setErrorFor({ id: issue.id, message: e?.message ?? "AI修正に失敗しました" });
      } finally {
        setBusyId(null);
      }
    },
    [onAiEditMulti]
  );

  return (
    <div>
      <button className="btn btn--sm" onClick={() => setExpanded((v) => !v)}>
        ✨ 品質チェック{warnCount > 0 ? `（${warnCount}）` : ""}
      </button>
      {expanded && (
        <div style={{ marginTop: 10 }}>
          {issues.length === 0 && <p className="hint">✓ 問題は見つかりませんでした</p>}
          {issues.map((issue) => (
            <div
              key={issue.id}
              style={{
                border: "1px solid var(--line)",
                borderRadius: 8,
                padding: 8,
                marginBottom: 8,
              }}
            >
              <span
                className="insp__chip"
                style={
                  issue.level === "warn"
                    ? { background: "#fef3c7", color: "#92400e" }
                    : undefined
                }
              >
                {issue.level === "warn" ? "warn" : "info"}
              </span>
              <p className="hint" style={{ margin: "4px 0 8px", color: "var(--fg)" }}>
                {issue.message}
              </p>
              <div className="row" style={{ flexWrap: "wrap" }}>
                {issue.blockIds && issue.blockIds.length > 0 && (
                  <button className="btn btn--sm" onClick={() => scrollToBlock(issue.blockIds![0])}>
                    該当ブロックへ
                  </button>
                )}
                {issue.fix?.kind === "deterministic" && (
                  <button className="btn btn--sm btn--primary" onClick={() => handleQuickFix(issue.id)}>
                    {issue.fix.label}
                  </button>
                )}
                {issue.fix?.kind === "ai" && (
                  <button
                    className="btn btn--sm btn--primary"
                    disabled={busyId === issue.id}
                    onClick={() => handleAiFix(issue)}
                  >
                    {busyId === issue.id ? <span className="spinner" /> : issue.fix.label}
                  </button>
                )}
              </div>
              {errorFor?.id === issue.id && (
                <p className="hint" style={{ color: "var(--danger)", marginTop: 6 }}>
                  エラー: {errorFor.message}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
