// ============================================================================
// Viewpoint データモデル（要件定義 §4）
// これが AI 生成の出力スキーマ・描画・編集すべての基準（信頼できる唯一の実体）。
// ============================================================================

export type Role = {
  /** 役割の表示名（例: "and（並列）"）。色＋ラベルの二重符号化のためラベルは必須。 */
  label: string;
  /** 文字色（前景） */
  color: string;
  /** 背景色 */
  bg: string;
};

/** 役割名（rolePalette のキー）→ 色 のパレット。色分けは"意味（働き）"を表す。 */
export type RolePalette = Record<string, Role>;

export type LessonDoc = {
  id: string;
  title: string;
  version: number;
  rolePalette: RolePalette;
  blocks: Block[];
  /** 保存・並べ替え用メタ（任意） */
  updatedAt?: number;
};

export type Block =
  | HeadingBlock
  | ParagraphBlock
  | SentenceBlock
  | TreeBlock
  | NoteBlock
  | ImageBlock
  | RawHtmlBlock; // 逃げ道（語彙で表せない例外用）

export type HeadingBlock = {
  id: string;
  type: "heading";
  level: 1 | 2 | 3;
  text: string;
};

export type ParagraphBlock = {
  id: string;
  type: "paragraph";
  text: string;
};

// 文：1語ずつをノードとして持ち、役割（=色）を割り当てる
export type SentenceBlock = {
  id: string;
  type: "sentence";
  tokens: Token[];
};
export type Token = {
  id: string;
  text: string;
  /** role は rolePalette のキー。色を持たない語は null。 */
  role: string | null;
};

// 樹形図：root + 枝。枝は入れ子可能（実際の係り受け・多層構造に対応）。
// 線・配置は AI に描かせず、構造データを決定的なレイアウタで描画する。
export type TreeBlock = {
  id: string;
  type: "tree";
  root: string;
  branches: Branch[];
};
export type Branch = {
  id: string;
  role: string;
  value: string;
  children?: Branch[];
};

// 注釈ボックス（着眼点・ヒントなど）
export type NoteBlock = {
  id: string;
  type: "note";
  label: string;
  body: string;
  variant?: "point" | "tip" | "warning";
};

export type ImageBlock = {
  id: string;
  type: "image";
  src: string;
  alt: string;
};

export type RawHtmlBlock = {
  id: string;
  type: "raw";
  html: string;
};

// ----------------------------------------------------------------------------
// 選択対象（ノード）の参照
// ----------------------------------------------------------------------------
export type Selection =
  | { kind: "block"; blockId: string }
  | { kind: "token"; blockId: string; tokenId: string }
  | { kind: "tree-root"; blockId: string }
  | { kind: "branch"; blockId: string; branchId: string }
  | null;

export const BLOCK_TYPE_LABELS: Record<Block["type"], string> = {
  heading: "見出し",
  paragraph: "段落",
  sentence: "文（語の色分け）",
  tree: "樹形図",
  note: "注釈",
  image: "画像",
  raw: "生HTML",
};
