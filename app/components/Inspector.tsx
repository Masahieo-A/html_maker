"use client";
// ============================================================================
// 選択ノードのプロパティ編集（要件 §5.2）＋ 範囲指定 AI 編集（§5.3）。
// 編集は常に「新しい doc を返す純粋変換」として onChange で親に渡す（履歴対応）。
// ============================================================================
import React, { useState } from "react";
import type {
  Block,
  Branch,
  LessonDoc,
  NoteBlock,
  Selection,
  SentenceBlock,
  TreeBlock,
} from "@/lib/types";
import {
  addChildBranch,
  findBlock,
  findBranch,
  moveBlock,
  removeBlock,
  removeBranch,
  replaceBlock,
  updateBlock,
  updateBranch,
} from "@/lib/docOps";
import { uid } from "@/lib/ids";

type Props = {
  doc: LessonDoc;
  selection: Selection;
  onChange: (next: LessonDoc) => void;
  onSelect: (sel: Selection) => void;
  onAiEdit: (instruction: string) => void;
  aiBusy: boolean;
};

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

      {/* ブロック種別バッジ + 並べ替え/削除（ブロック選択時） */}
      {selection.kind === "block" && (
        <BlockToolbar doc={doc} block={block} onChange={onChange} onSelect={onSelect} />
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
        <>
          <span className="insp__chip">生HTML</span>
          <div className="field">
            <label>HTML</label>
            <textarea
              className="textarea"
              style={{ minHeight: 140, fontFamily: "monospace", fontSize: 12.5 }}
              value={block.html}
              onChange={(e) =>
                onChange(
                  updateBlock(doc, block.id, (b) => ({ ...(b as any), html: e.target.value }))
                )
              }
            />
          </div>
        </>
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

      {aiPanel}
    </div>
  );
}

// --- ブロック共通ツールバー（上下移動・削除） --------------------------------
function BlockToolbar({
  doc,
  block,
  onChange,
  onSelect,
}: {
  doc: LessonDoc;
  block: Block;
  onChange: (d: LessonDoc) => void;
  onSelect: (s: Selection) => void;
}) {
  return (
    <div className="row" style={{ marginBottom: 12, flexWrap: "wrap" }}>
      <button className="btn btn--sm" onClick={() => onChange(moveBlock(doc, block.id, -1))}>
        ↑ 上へ
      </button>
      <button className="btn btn--sm" onClick={() => onChange(moveBlock(doc, block.id, 1))}>
        ↓ 下へ
      </button>
      <button
        className="btn btn--sm btn--danger"
        onClick={() => {
          if (confirm("このブロックを削除しますか？")) {
            onChange(removeBlock(doc, block.id));
            onSelect(null);
          }
        }}
      >
        削除
      </button>
    </div>
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
  const entries = Object.entries(doc.rolePalette);
  return (
    <div>
      <div className="insp__title">役割パレット（色 = 意味）</div>
      {entries.length === 0 && <p className="hint">まだ役割がありません。</p>}
      {entries.map(([key, role]) => (
        <div className="row" key={key} style={{ marginBottom: 8 }}>
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
        </div>
      ))}
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
