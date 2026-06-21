// ============================================================================
// LessonDoc に対する純粋変換関数群（要件 §7：編集は純粋な変換 + 履歴スタック）
// すべて新しいオブジェクトを返す（イミュータブル）。これにより undo/redo が自明。
// ============================================================================
import type { Block, Branch, LessonDoc, TreeBlock } from "./types";
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
  if (!afterId) return { ...doc, blocks: [...doc.blocks, block] };
  const idx = doc.blocks.findIndex((b) => b.id === afterId);
  const blocks = [...doc.blocks];
  blocks.splice(idx + 1, 0, block);
  return { ...doc, blocks };
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
