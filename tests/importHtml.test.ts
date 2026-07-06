// @vitest-environment jsdom
// ============================================================================
// lib/importHtml.ts のテスト（DOMParser / DOMPurify を使うため jsdom 環境）。
// 実行: npx vitest run tests/importHtml.test.ts
// ============================================================================
import { describe, it, expect } from "vitest";
import {
  extractEmbeddedDocJson,
  importDesignPreserving,
  importStructured,
} from "../lib/importHtml";
import type {
  HeadingBlock,
  ImageBlock,
  ParagraphBlock,
  RawHtmlBlock,
  TableBlock,
} from "../lib/types";

// ── extractEmbeddedDocJson ───────────────────────────────────────────────────

describe("extractEmbeddedDocJson", () => {
  it("埋め込み JSON があればその中身を返す", () => {
    const json = JSON.stringify({ id: "lesson_x", title: "テスト教材", version: 1 });
    const html = `<!DOCTYPE html><html><head>
      <script type="application/json" id="viewpoint-doc">${json}</script>
    </head><body><h1>テスト教材</h1></body></html>`;
    const extracted = extractEmbeddedDocJson(html);
    expect(extracted).not.toBeNull();
    expect(JSON.parse(extracted!)).toEqual({ id: "lesson_x", title: "テスト教材", version: 1 });
  });

  it("埋め込みが無ければ null を返す", () => {
    const html = `<!DOCTYPE html><html><body><h1>普通のページ</h1></body></html>`;
    expect(extractEmbeddedDocJson(html)).toBeNull();
  });
});

// ── importStructured ─────────────────────────────────────────────────────────

describe("importStructured", () => {
  it("h1 / p / table / img が期待どおりのブロック列になる", () => {
    const html = `<!DOCTYPE html><html><head><title>関係代名詞の教材</title></head><body>
      <h1>関係代名詞</h1>
      <p>which の使い方を学びます。</p>
      <table>
        <thead><tr><th>用法</th><th>例文</th></tr></thead>
        <tbody>
          <tr><td>制限用法</td><td>The book which I read</td></tr>
          <tr><td>非制限用法</td><td>The book, which I read</td></tr>
        </tbody>
      </table>
      <img src="figure.png" alt="構造図" />
    </body></html>`;

    const doc = importStructured(html);
    expect(doc.title).toBe("関係代名詞の教材");
    expect(doc.version).toBe(1);
    expect(doc.rolePalette).toEqual({});
    expect(doc.id).toMatch(/^lesson_[a-z0-9]+$/);

    expect(doc.blocks.map((b) => b.type)).toEqual(["heading", "paragraph", "table", "image"]);

    const heading = doc.blocks[0] as HeadingBlock;
    expect(heading.level).toBe(1);
    expect(heading.text).toBe("関係代名詞");

    const para = doc.blocks[1] as ParagraphBlock;
    expect(para.text).toBe("which の使い方を学びます。");

    const table = doc.blocks[2] as TableBlock;
    expect(table.columns).toEqual(["用法", "例文"]);
    expect(table.rows).toEqual([
      ["制限用法", "The book which I read"],
      ["非制限用法", "The book, which I read"],
    ]);

    const image = doc.blocks[3] as ImageBlock;
    expect(image.src).toBe("figure.png");
    expect(image.alt).toBe("構造図");
  });

  it("ul の li は「・」付き paragraph になる", () => {
    const html = `<html><body><ul><li>一つ目</li><li>二つ目</li></ul></body></html>`;
    const doc = importStructured(html);
    const texts = doc.blocks.map((b) => (b as ParagraphBlock).text);
    expect(texts).toEqual(["・一つ目", "・二つ目"]);
  });

  it("script タグは raw ブロックに残らない（sanitizeHtml で除去される）", () => {
    const html = `<html><body>
      <pre>コード例<script>alert("xss")</script></pre>
      <script>console.log("捨てられる");</script>
    </body></html>`;
    const doc = importStructured(html);
    for (const b of doc.blocks) {
      if (b.type === "raw") {
        expect((b as RawHtmlBlock).html).not.toContain("<script");
        expect((b as RawHtmlBlock).html).not.toContain("alert(");
      }
    }
    // 変換結果全体にも script が混入していない
    expect(JSON.stringify(doc.blocks)).not.toContain("<script");
  });
});

// ── importDesignPreserving ───────────────────────────────────────────────────

describe("importDesignPreserving", () => {
  it("<style> が customCss に入り、body 直下の section が raw ブロックになる", () => {
    const html = `<!DOCTYPE html><html><head>
      <title>提言書</title>
      <style>.hero { background: linear-gradient(#123, #456); }</style>
    </head><body>
      <section class="hero"><h1>提言</h1><p>概要テキスト</p></section>
      <section class="cards"><div class="card">カード1</div></section>
      <script>alert("捨てられる");</script>
      <div>   </div>
    </body></html>`;

    const doc = importDesignPreserving(html);
    expect(doc.title).toBe("提言書");
    expect(doc.customCss).toContain(".hero");
    expect(doc.customCss).toContain("linear-gradient");

    // script と空 div はスキップされ、section 2つだけが raw ブロックになる
    expect(doc.blocks).toHaveLength(2);
    expect(doc.blocks.every((b) => b.type === "raw")).toBe(true);

    const first = doc.blocks[0] as RawHtmlBlock;
    expect(first.html).toContain("提言");
    expect(first.html).toContain("概要テキスト");
    expect(first.html).toContain('class="hero"');
    expect(first.html).not.toContain("<script");

    const second = doc.blocks[1] as RawHtmlBlock;
    expect(second.html).toContain("カード1");
  });

  it("title が無ければ最初の h1 を doc.title にする", () => {
    const html = `<html><body><section><h1>見出しタイトル</h1></section></body></html>`;
    const doc = importDesignPreserving(html);
    expect(doc.title).toBe("見出しタイトル");
  });
});
