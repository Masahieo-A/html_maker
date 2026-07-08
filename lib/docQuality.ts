// ============================================================================
// 品質リント（改善提案「デフォルトの質＝プロダクトの質」対応）
// 目的: 安価なAIモデル（Gemini Flash 等）の生成でも、視覚的わかりやすさの下限を
// 決定的（非AI）に検査・保証する。ここでのチェックは常に同じ入力→同じ出力になること。
// ============================================================================
import type { LessonDoc } from "./types";
import { getBlockMarks, removeBlock, countRoleUsage } from "./docOps";
import { contrastRatio, normalizeRolePalette } from "./roleStyle";

// --- 判定の閾値（根拠はコメント参照） ----------------------------------------
/** WCAG AA（通常テキスト）基準のコントラスト比 */
const MIN_CONTRAST = 4.5;
/** 「英文段落が複数ある」とみなす最小段落数（1〜2件は例文程度で構造化不要と判断） */
const ENGLISH_PARAGRAPH_MIN_COUNT = 3;
/** 段落中の英字（ラテン文字）比率がこれ以上なら「英文段落」とみなす */
const LATIN_RATIO_THRESHOLD = 0.5;
/** これを超える文字数の段落は1画面で読み切りにくいため分割を促す */
const LONG_PARAGRAPH_LENGTH = 240;
/** これ以上のブロック数がある教材は要点整理（note）が無いと振り返りにくい */
const NOTE_BLOCK_MIN_COUNT = 8;
/** これ以上の段落数があるのにマーカーが0件だと視認性の恩恵が薄い */
const MARK_MIN_PARAGRAPHS = 4;

export type QualityIssue = {
  id: string; // 'no-sentence' 等
  level: "warn" | "info";
  message: string; // 教員向け日本語
  blockIds?: string[]; // 該当ブロック
  fix?:
    | { kind: "deterministic"; label: string } // applyQuickFixで直せる
    | { kind: "ai"; label: string; instruction: string }; // 対象ブロックを/api/editに渡す指示文
};

/** 段落テキストに占めるラテン文字（英字）の比率。仮名漢字・英字以外の記号類は分母に含めない。 */
function latinRatio(text: string): number {
  const letters = text.match(/[A-Za-zぁ-んァ-ヶー一-龠]/g);
  if (!letters || letters.length === 0) return 0;
  const latin = text.match(/[A-Za-z]/g);
  return (latin ? latin.length : 0) / letters.length;
}

/** 先頭ブロックが level1 見出しで doc.title と同文か（exportHtml.ts の先頭見出しスキップ判定と共用） */
export function isDuplicateTitleHeading(doc: LessonDoc): boolean {
  const first = doc.blocks[0];
  return !!first && first.type === "heading" && first.level === 1 && first.text.trim() === doc.title.trim();
}

/** 決定的チェック一式。呼び出し順は表示上の優先度（warn を先に）。 */
export function analyzeDoc(doc: LessonDoc): QualityIssue[] {
  const issues: QualityIssue[] = [];

  // low-contrast-roles: パレットにコントラスト不足の役割がある
  const lowContrastKeys = Object.keys(doc.rolePalette).filter(
    (key) => contrastRatio(doc.rolePalette[key].color, doc.rolePalette[key].bg) < MIN_CONTRAST
  );
  if (lowContrastKeys.length) {
    issues.push({
      id: "low-contrast-roles",
      level: "warn",
      message: `文字色と背景色のコントラストが低い役割があります（${lowContrastKeys
        .map((k) => doc.rolePalette[k].label)
        .join("、")}）。生徒に読みにくい可能性があります。`,
      fix: { kind: "deterministic", label: "コントラストを自動調整する" },
    });
  }

  // duplicate-title: 先頭h1がdoc.titleと同文
  if (isDuplicateTitleHeading(doc)) {
    const first = doc.blocks[0];
    issues.push({
      id: "duplicate-title",
      level: "warn",
      message: "先頭の見出しが教材タイトルと同じ文言です。書き出し時にタイトルと二重表示されます。",
      blockIds: [first.id],
      fix: { kind: "deterministic", label: "先頭の見出しを削除する" },
    });
  }

  // no-sentence: 英文段落が3つ以上あるのにsentence/treeブロックが0
  const englishParagraphs = doc.blocks.filter(
    (b) => b.type === "paragraph" && latinRatio(b.text) >= LATIN_RATIO_THRESHOLD
  );
  const hasSentenceOrTree = doc.blocks.some((b) => b.type === "sentence" || b.type === "tree");
  if (englishParagraphs.length >= ENGLISH_PARAGRAPH_MIN_COUNT && !hasSentenceOrTree) {
    issues.push({
      id: "no-sentence",
      level: "warn",
      message: "英文の段落が複数あるのに、語単位で色分けする sentence / tree ブロックが使われていません。",
      blockIds: englishParagraphs.map((b) => b.id),
      fix: {
        kind: "ai",
        label: "重要文を sentence ブロックに変換する",
        instruction: "この英文の重要文を語単位のsentenceブロックに変換し、S/V/O/C/Mの役割を付与して",
      },
    });
  }

  // long-paragraph: 240文字超のparagraph
  const longParagraphs = doc.blocks.filter((b) => b.type === "paragraph" && b.text.length > LONG_PARAGRAPH_LENGTH);
  if (longParagraphs.length) {
    issues.push({
      id: "long-paragraph",
      level: "warn",
      message: `${longParagraphs.length}件の段落が${LONG_PARAGRAPH_LENGTH}文字を超えています。読みやすさのため分割を検討してください。`,
      blockIds: longParagraphs.map((b) => b.id),
      fix: {
        kind: "ai",
        label: "段落を2〜3個に分割する",
        instruction: "この段落を2〜3個の短い段落に分割して",
      },
    });
  }

  // no-notes: ブロック8個以上でnoteが0（挿入は難しいため info のみ）
  if (doc.blocks.length >= NOTE_BLOCK_MIN_COUNT && !doc.blocks.some((b) => b.type === "note")) {
    issues.push({
      id: "no-notes",
      level: "info",
      message: "ブロック数が多いのに note（着眼点）ブロックがありません。要点を note で示すと生徒が振り返りやすくなります。",
    });
  }

  // no-marks: 段落が4つ以上あるのにmarksが全く無い
  const paragraphCount = doc.blocks.filter((b) => b.type === "paragraph").length;
  const hasAnyMark = doc.blocks.some((b) => (getBlockMarks(b) ?? []).length > 0);
  if (paragraphCount >= MARK_MIN_PARAGRAPHS && !hasAnyMark) {
    issues.push({
      id: "no-marks",
      level: "info",
      message: "重要語句にマーカーを付けると視認性が上がります。",
    });
  }

  // unused-roles: パレットにあるが未使用のrole
  const unused = Object.keys(doc.rolePalette).filter((key) => countRoleUsage(doc, key) === 0);
  if (unused.length) {
    issues.push({
      id: "unused-roles",
      level: "info",
      message: `パレットに登録されているが未使用の役割があります: ${unused
        .map((k) => doc.rolePalette[k].label)
        .join("、")}`,
    });
  }

  return issues;
}

/** 決定的に直せる issue のみ対応（kind:"ai" の issue は呼び出し側が /api/edit 等で処理する） */
export function applyQuickFix(doc: LessonDoc, issueId: string): LessonDoc {
  switch (issueId) {
    case "low-contrast-roles":
      return { ...doc, rolePalette: normalizeRolePalette(doc.rolePalette) };
    case "duplicate-title":
      return isDuplicateTitleHeading(doc) ? removeBlock(doc, doc.blocks[0].id) : doc;
    default:
      return doc;
  }
}
