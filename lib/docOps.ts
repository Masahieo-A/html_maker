// ============================================================================
// LessonDoc に対する純粋変換関数群（要件 §7：編集は純粋な変換 + 履歴スタック）
// すべて新しいオブジェクトを返す（イミュータブル）。これにより undo/redo が自明。
// ============================================================================
import type { Block, Branch, LessonDoc, TextMark, TreeBlock } from "./types";
import { uid } from "./ids";

export function findBlock(doc: LessonDoc, blockId: string): Block | undefined {
  return doc.blocks.find((b) => b.id === blockId);
}

export function updateBlock(
  doc: LessonDoc,
  blockId: string,
  patch: (b: Block) => Block
): LessonDoc {
  return {
    ...doc,
    blocks: doc.blocks.map((b) => (b.id === blockId ? patch(b) : b)),
  };
}

export function replaceBlock(
  doc: LessonDoc,
  blockId: string,
  next: Block
): LessonDoc {
  return { ...doc, blocks: doc.blocks.map((b) => (b.id === blockId ? next : b)) };
}

export function removeBlock(doc: LessonDoc, blockId: string): LessonDoc {
  return { ...doc, blocks: doc.blocks.filter((b) => b.id !== blockId) };
}

export function moveBlock(doc: LessonDoc, blockId: string, dir: -1 | 1): LessonDoc {
  const idx = doc.blocks.findIndex((b) => b.id === blockId);
  if (idx < 0) return doc;
  const next = idx + dir;
  if (next < 0 || next >= doc.blocks.length) return doc;
  const blocks = [...doc.blocks];
  [blocks[idx], blocks[next]] = [blocks[next], blocks[idx]];
  return { ...doc, blocks };
}

export function addBlock(doc: LessonDoc, block: Block, afterId?: string): LessonDoc {
  const idx = afterId ? doc.blocks.findIndex((b) => b.id === afterId) : -1;
  // afterId 未指定・不明のときは末尾に追加
  if (idx < 0) return { ...doc, blocks: [...doc.blocks, block] };
  const blocks = [...doc.blocks];
  blocks.splice(idx + 1, 0, block);
  return { ...doc, blocks };
}

/** 任意位置への移動（D&D用）。targetIndex は移動後の並びでの挿入位置（0..length にクランプ）。 */
export function moveBlockTo(doc: LessonDoc, blockId: string, targetIndex: number): LessonDoc {
  const idx = doc.blocks.findIndex((b) => b.id === blockId);
  if (idx < 0) return doc;
  const blocks = [...doc.blocks];
  const [item] = blocks.splice(idx, 1);
  const clamped = Math.max(0, Math.min(targetIndex, blocks.length));
  blocks.splice(clamped, 0, item);
  return { ...doc, blocks };
}

/**
 * 1ブロックを複数ブロックに置換（rawの段階的構造化などに使用）。
 * AIが返す blocks は id が重複・既存ブロックと衝突していても検出できないため、
 * duplicateBlock と同じ再採番ロジック（regenerateBlockIds）で常に新規採番する。
 */
export function replaceBlockWithMany(doc: LessonDoc, blockId: string, blocks: Block[]): LessonDoc {
  const idx = doc.blocks.findIndex((b) => b.id === blockId);
  if (idx < 0) return doc;
  const renumbered = blocks.map((b) => regenerateBlockIds(b));
  const next = [...doc.blocks];
  next.splice(idx, 1, ...renumbered);
  return { ...doc, blocks: next };
}

function regenerateBranchIds(branches: Branch[]): Branch[] {
  return branches.map((b) => ({
    ...b,
    id: uid("br"),
    ...(b.children ? { children: regenerateBranchIds(b.children) } : {}),
  }));
}

/** ブロック複製用: id・トークン/枝/項目/マークの id をすべて採番し直す（元ブロックとの衝突防止） */
function regenerateBlockIds(block: Block): Block {
  const id = uid("b");
  switch (block.type) {
    case "heading":
    case "paragraph":
      return { ...block, id, marks: block.marks?.map((m) => ({ ...m, id: uid("mark") })) };
    case "sentence":
      return { ...block, id, tokens: block.tokens.map((t) => ({ ...t, id: uid("t") })) };
    case "tree":
      return { ...block, id, branches: regenerateBranchIds(block.branches) };
    case "analysisCard":
      return {
        ...block,
        id,
        items: block.items.map((i) => ({ ...i, id: uid("item") })),
        marks: block.marks?.map((m) => ({ ...m, id: uid("mark") })),
      };
    case "table":
    case "note":
      return { ...block, id, marks: block.marks?.map((m) => ({ ...m, id: uid("mark") })) };
    case "image":
    case "raw":
      return { ...block, id };
  }
}

/** ブロック複製（新id採番、直後に挿入） */
export function duplicateBlock(doc: LessonDoc, blockId: string): LessonDoc {
  const idx = doc.blocks.findIndex((b) => b.id === blockId);
  if (idx < 0) return doc;
  const clone = regenerateBlockIds(doc.blocks[idx]);
  const blocks = [...doc.blocks];
  blocks.splice(idx + 1, 0, clone);
  return { ...doc, blocks };
}

// --- role の使用状況・削除 ----------------------------------------------------

/** marks を持つブロック種別から marks 配列を取り出す（無ければ undefined）。docQuality からも利用。 */
export function getBlockMarks(b: Block): TextMark[] | undefined {
  switch (b.type) {
    case "heading":
    case "paragraph":
    case "analysisCard":
    case "table":
    case "note":
      return b.marks;
    default:
      return undefined;
  }
}

/** marks を持つブロック種別に marks 配列を設定し直す（analysisCard は items も持つため呼び出し側で個別処理） */
function withBlockMarksField(b: Block, marks: TextMark[] | undefined): Block {
  switch (b.type) {
    case "heading":
    case "paragraph":
    case "table":
    case "note":
      return { ...b, marks };
    default:
      return b;
  }
}

function countBranchRole(branches: Branch[], roleKey: string): number {
  let n = 0;
  for (const b of branches) {
    if (b.role === roleKey) n++;
    if (b.children) n += countBranchRole(b.children, roleKey);
  }
  return n;
}

/** roleKey と一致する枝の role を空文字化する（Branch.role は必須文字列のため undefined にはできない） */
function clearBranchRole(branches: Branch[], roleKey: string): Branch[] {
  return branches.map((b) => {
    const cleared = b.role === roleKey ? { ...b, role: "" } : b;
    return cleared.children ? { ...cleared, children: clearBranchRole(cleared.children, roleKey) } : cleared;
  });
}

/** roleKey がパレット中で何箇所使われているか（sentence token / tree branch / analysisCard item / marks） */
export function countRoleUsage(doc: LessonDoc, roleKey: string): number {
  let count = 0;
  for (const b of doc.blocks) {
    if (b.type === "sentence") count += b.tokens.filter((t) => t.role === roleKey).length;
    if (b.type === "tree") count += countBranchRole(b.branches, roleKey);
    if (b.type === "analysisCard") count += b.items.filter((i) => i.role === roleKey).length;
    const marks = getBlockMarks(b);
    if (marks) count += marks.filter((m) => m.role === roleKey).length;
  }
  return count;
}

/**
 * パレットから role を削除し、全ブロック（sentence token / tree branch / analysisCard item / marks）
 * から該当 role を除去する。sentence token・analysisCard item は role:null 化、marks は role 必須のため
 * 除去（該当マークを削除）、tree branch は role が必須文字列のため空文字化する。
 */
export function removeRole(doc: LessonDoc, roleKey: string): LessonDoc {
  const rolePalette = { ...doc.rolePalette };
  delete rolePalette[roleKey];

  const blocks = doc.blocks.map((b): Block => {
    if (b.type === "sentence") {
      return { ...b, tokens: b.tokens.map((t) => (t.role === roleKey ? { ...t, role: null } : t)) };
    }
    if (b.type === "tree") {
      return { ...b, branches: clearBranchRole(b.branches, roleKey) };
    }
    if (b.type === "analysisCard") {
      const items = b.items.map((i) => (i.role === roleKey ? { ...i, role: null } : i));
      const marks = b.marks?.filter((m) => m.role !== roleKey);
      return { ...b, items, marks: marks && marks.length ? marks : undefined };
    }
    const marks = getBlockMarks(b);
    if (marks) {
      const next = marks.filter((m) => m.role !== roleKey);
      return withBlockMarksField(b, next.length ? next : undefined);
    }
    return b;
  });

  return { ...doc, rolePalette, blocks };
}

/** 種別ごとの空ブロックを生成 */
export function makeEmptyBlock(type: Block["type"]): Block {
  switch (type) {
    case "heading":
      return { id: uid("b"), type: "heading", level: 2, text: "新しい見出し" };
    case "paragraph":
      return { id: uid("b"), type: "paragraph", text: "本文を入力してください。" };
    case "sentence":
      return {
        id: uid("b"),
        type: "sentence",
        tokens: [
          { id: uid("t"), text: "New", role: null },
          { id: uid("t"), text: "sentence", role: null },
        ],
      };
    case "tree":
      return {
        id: uid("b"),
        type: "tree",
        root: "S（文の骨組み）",
        branches: [{ id: uid("br"), role: "主部 (S)", value: "..." }],
      };
    case "analysisCard":
      return {
        id: uid("b"),
        type: "analysisCard",
        title: "分析カード",
        tag: "着眼点",
        source: "",
        quote: "",
        items: [
          { id: uid("item"), label: "対象", value: "何を扱うか" },
          { id: uid("item"), label: "根拠", value: "どう判断できるか" },
          { id: uid("item"), label: "効果", value: "何が分かるようになるか" },
        ],
        takeaway: "この見方を使うと理解が安定します。",
      };
    case "table":
      return {
        id: uid("b"),
        type: "table",
        title: "整理表",
        columns: ["項目", "内容", "根拠"],
        rows: [["例", "説明", "判断材料"]],
      };
    case "note":
      return {
        id: uid("b"),
        type: "note",
        label: "着眼点",
        body: "ここに注釈を入力。",
        variant: "point",
      };
    case "image":
      return { id: uid("b"), type: "image", src: "", alt: "画像の説明" };
    case "raw":
      return { id: uid("b"), type: "raw", html: "<p>生HTML</p>" };
  }
}

// --- 樹形図の枝操作（入れ子対応） ---------------------------------------------

export function mapBranches(
  branches: Branch[],
  fn: (b: Branch) => Branch
): Branch[] {
  return branches.map((b) => {
    const mapped = fn(b);
    if (mapped.children && mapped.children.length) {
      return { ...mapped, children: mapBranches(mapped.children, fn) };
    }
    return mapped;
  });
}

export function findBranch(branches: Branch[], id: string): Branch | undefined {
  for (const b of branches) {
    if (b.id === id) return b;
    if (b.children) {
      const found = findBranch(b.children, id);
      if (found) return found;
    }
  }
  return undefined;
}

export function updateBranch(
  tree: TreeBlock,
  branchId: string,
  patch: Partial<Pick<Branch, "role" | "value">>
): TreeBlock {
  return { ...tree, branches: mapBranches(tree.branches, (b) => (b.id === branchId ? { ...b, ...patch } : b)) };
}

export function removeBranch(branches: Branch[], id: string): Branch[] {
  return branches
    .filter((b) => b.id !== id)
    .map((b) => (b.children ? { ...b, children: removeBranch(b.children, id) } : b));
}

export function addChildBranch(branches: Branch[], parentId: string): Branch[] {
  return branches.map((b) => {
    if (b.id === parentId) {
      const child: Branch = { id: uid("br"), role: "枝", value: "..." };
      return { ...b, children: [...(b.children ?? []), child] };
    }
    if (b.children) return { ...b, children: addChildBranch(b.children, parentId) };
    return b;
  });
}
