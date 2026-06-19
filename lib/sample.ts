import type { LessonDoc } from "./types";
import { uid } from "./ids";

/** 要件 §4 の JSON 例を膨らませたサンプル教材 */
export function makeSampleDoc(): LessonDoc {
  return {
    id: uid("lesson"),
    title: "and / but / or を見抜く",
    version: 1,
    updatedAt: Date.now(),
    rolePalette: {
      and: { label: "and（並列）", color: "#0d9488", bg: "#d7f3ef" },
      or: { label: "or（選択）", color: "#c2740a", bg: "#fbeccd" },
      verb: { label: "動詞 (V)", color: "#2563eb", bg: "#dbeafe" },
    },
    blocks: [
      { id: uid("b"), type: "heading", level: 2, text: "and / but / or を見抜く" },
      {
        id: uid("b"),
        type: "paragraph",
        text: "等位接続詞は、前後で同じ働き（品詞・役割）の語句をつなぐ。何と何をつないでいるかを見抜くのが読解の鍵。",
      },
      {
        id: uid("b"),
        type: "sentence",
        tokens: [
          { id: uid("t"), text: "Desire", role: "and" },
          { id: uid("t"), text: "and", role: "and" },
          { id: uid("t"), text: "determination", role: "and" },
          { id: uid("t"), text: "exceed", role: "verb" },
          { id: uid("t"), text: "talent", role: null },
        ],
      },
      {
        id: uid("b"),
        type: "tree",
        root: "S（文の骨組み）",
        branches: [
          {
            id: uid("br"),
            role: "主部 (S)",
            value: "desire and determination",
            children: [
              { id: uid("br"), role: "名詞①", value: "desire" },
              { id: uid("br"), role: "名詞②", value: "determination" },
            ],
          },
          { id: uid("br"), role: "動詞 (V)", value: "exceed" },
          { id: uid("br"), role: "目的語 (O)", value: "talent" },
        ],
      },
      {
        id: uid("b"),
        type: "note",
        label: "着眼点",
        body: "and は主語の名詞 2 つ（desire / determination）をつないでいる。動詞 exceed は単数ではなく複数主語を受ける形に注意。",
        variant: "point",
      },
    ],
  };
}
