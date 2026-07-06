// @vitest-environment jsdom
// 自己完結 HTML 書き出し（lib/exportHtml.ts）の回帰テスト
import { describe, expect, it } from "vitest";
import { esc, exportHtml } from "@/lib/exportHtml";
import type { LessonDoc } from "@/lib/types";

function baseDoc(overrides: Partial<LessonDoc> = {}): LessonDoc {
  return {
    id: "lesson_test",
    title: "テスト教材",
    version: 1,
    rolePalette: {},
    blocks: [],
    ...overrides,
  };
}

describe("esc", () => {
  it("HTML 特殊文字をすべてエスケープする", () => {
    expect(esc(`<a href="x" onclick='y'>&`)).toBe(
      "&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;"
    );
  });
});

describe("exportHtml", () => {
  it("LessonDoc の JSON を埋め込む（ラウンドトリップ用）", () => {
    const html = exportHtml(baseDoc());
    expect(html).toContain('<script type="application/json" id="viewpoint-doc">');
    const m = html.match(
      /<script type="application\/json" id="viewpoint-doc">([\s\S]*?)<\/script>/
    );
    expect(m).toBeTruthy();
    const parsed = JSON.parse(m![1]);
    expect(parsed.id).toBe("lesson_test");
    expect(parsed.title).toBe("テスト教材");
  });

  it("埋め込み JSON 内の < はエスケープされ script を閉じない", () => {
    const html = exportHtml(
      baseDoc({
        blocks: [{ id: "b1", type: "paragraph", text: "</script><script>alert(1)</script>" }],
      })
    );
    const start = html.indexOf('id="viewpoint-doc">') + 'id="viewpoint-doc">'.length;
    const end = html.indexOf("</script>", start);
    const embedded = html.slice(start, end);
    expect(embedded).not.toContain("<script");
    expect(JSON.parse(embedded).blocks[0].text).toContain("</script>");
  });

  it("raw ブロックの script はサニタイズで除去される", () => {
    const html = exportHtml(
      baseDoc({
        blocks: [
          { id: "b1", type: "raw", html: '<p>安全</p><script>alert("x")</script>' },
        ],
      })
    );
    const body = html.slice(html.indexOf("<body"));
    expect(body).toContain("<p>安全</p>");
    expect(body).not.toContain("alert(");
  });

  it("不正な役割色はインラインスタイルに出さない", () => {
    const html = exportHtml(
      baseDoc({
        rolePalette: {
          bad: { label: "悪", color: "x;background:url(https://evil)", bg: "#fee" },
        },
        blocks: [
          {
            id: "b1",
            type: "sentence",
            tokens: [{ id: "t1", text: "word", role: "bad" }],
          },
        ],
      })
    );
    // 埋め込み JSON（不活性なデータ）には残るが、描画に使う style には出ないこと
    const withoutEmbedded = html.replace(
      /<script type="application\/json" id="viewpoint-doc">[\s\S]*?<\/script>/,
      ""
    );
    expect(withoutEmbedded).not.toContain("https://evil");
  });

  it("customCss を <style> として出力する", () => {
    const html = exportHtml(baseDoc({ customCss: ".hero{color:blue}" }));
    expect(html).toContain(".hero{color:blue}");
  });

  it("table のセルにマークを描画する", () => {
    const html = exportHtml(
      baseDoc({
        rolePalette: { r1: { label: "重要", color: "#7c2d12", bg: "#ffedd5" } },
        blocks: [
          {
            id: "b1",
            type: "table",
            columns: ["列"],
            rows: [["hello world"]],
            marks: [{ id: "m1", field: "cell:0:0", start: 0, end: 5, role: "r1" }],
          },
        ],
      })
    );
    expect(html).toContain('<span class="vp-text-mark"');
    expect(html).toContain(">hello</span>");
  });
});
