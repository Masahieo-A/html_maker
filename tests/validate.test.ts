// @vitest-environment jsdom
// AI 出力の正規化（lib/validate.ts）の回帰テスト
import { describe, expect, it } from "vitest";
import { extractJson, parseBlock, parseLessonDoc } from "@/lib/validate";

describe("extractJson", () => {
  it("コードフェンス付きでも本体を取り出す", () => {
    expect(extractJson('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });
  it("前置き付きでも { } の範囲を取り出す", () => {
    expect(extractJson('以下です。{"a":1} 以上。')).toBe('{"a":1}');
  });
});

describe("parseLessonDoc", () => {
  it("最小限の LessonDoc を正規化する", () => {
    const doc = parseLessonDoc(
      JSON.stringify({
        title: "テスト",
        blocks: [{ type: "paragraph", text: "本文" }],
      })
    );
    expect(doc.title).toBe("テスト");
    expect(doc.blocks).toHaveLength(1);
    expect(doc.blocks[0].type).toBe("paragraph");
    expect(doc.blocks[0].id).toBeTruthy();
  });

  it("独自ブロック名 comparisonTable を table に正規化する", () => {
    const doc = parseLessonDoc(
      JSON.stringify({
        title: "t",
        blocks: [{ type: "comparison-table", columns: ["a"], rows: [["1"]] }],
      })
    );
    expect(doc.blocks[0].type).toBe("table");
  });

  it("不正な色は安全な既定色に置き換える（CSSインジェクション対策）", () => {
    const doc = parseLessonDoc(
      JSON.stringify({
        title: "t",
        rolePalette: {
          bad: { label: "悪", color: "red;background:url(https://evil)", bg: "#fff" },
        },
        blocks: [{ type: "paragraph", text: "x" }],
      })
    );
    expect(doc.rolePalette.bad.color).toBe("#334155");
    expect(doc.rolePalette.bad.bg).toBe("#fff");
  });

  it("customCss を保持する", () => {
    const doc = parseLessonDoc(
      JSON.stringify({
        title: "t",
        customCss: ".x{color:red}",
        blocks: [{ type: "paragraph", text: "x" }],
      })
    );
    expect(doc.customCss).toBe(".x{color:red}");
  });

  it("table の marks を保持する", () => {
    const doc = parseLessonDoc(
      JSON.stringify({
        title: "t",
        blocks: [
          {
            type: "table",
            columns: ["a"],
            rows: [["hello"]],
            marks: [{ field: "cell:0:0", start: 0, end: 5, role: "r1" }],
          },
        ],
      })
    );
    const table = doc.blocks[0] as { marks?: unknown[] };
    expect(table.marks).toHaveLength(1);
  });
});

describe("parseBlock", () => {
  it("単一ブロックを正規化する", () => {
    const block = parseBlock('{"id":"b1","type":"note","label":"L","body":"B"}');
    expect(block.type).toBe("note");
    expect(block.id).toBe("b1");
  });
  it("解釈できなければ例外を投げる", () => {
    expect(() => parseBlock('{"type":"unknown-xyz"}')).toThrow();
  });
});
