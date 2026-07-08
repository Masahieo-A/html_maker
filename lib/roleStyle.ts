// ============================================================================
// アクセシブルな役割スタイルの共通モジュール（改善提案 B節対応）
// 目的: 色覚多様性・コントラスト面で「配布物品質」に達する既定パレットを提供し、
// 色のみに依存しない二重符号化（下線パターン）の情報源にする。
// canvas 描画（Renderer.tsx）と書き出し（exportHtml.ts）の両方から参照される想定。
// ============================================================================
import type { CSSProperties } from "react";
import type { RolePalette, Role } from "./types";

// ----------------------------------------------------------------------------
// コントラスト比（WCAG 2.x 相対輝度ベース）
// ----------------------------------------------------------------------------

/** #rgb / #rrggbb（# 省略可）を 0-255 の [r,g,b] に変換。不正な値は黒扱い。 */
function parseHexColor(hex: string): [number, number, number] {
  const h = hex.trim().replace(/^#/, "");
  if (h.length === 3) {
    const r = parseInt(h[0] + h[0], 16);
    const g = parseInt(h[1] + h[1], 16);
    const b = parseInt(h[2] + h[2], 16);
    return [r || 0, g || 0, b || 0];
  }
  if (h.length === 6) {
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return [r || 0, g || 0, b || 0];
  }
  return [0, 0, 0];
}

function channelLuminance(c: number): number {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = parseHexColor(hex);
  return 0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b);
}

/** WCAG 相対輝度ベースのコントラスト比（#rgb / #rrggbb 対応）。常に 1〜21 の範囲。 */
export function contrastRatio(fg: string, bg: string): number {
  const l1 = relativeLuminance(fg);
  const l2 = relativeLuminance(bg);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

// ----------------------------------------------------------------------------
// アクセシブルな役割プリセット（Okabe-Ito 系を暗く調整 + 淡い背景）
// 各ペアは fg/bg コントラスト比 4.5:1 以上（下記コメントの数値は contrastRatio() で実測済み）。
// verb（バーミリオン系）と object（紫・緑を避ける）は赤緑色覚でも判別できるよう色相を離してある。
// modifier は現行 #FFA500 on #FFF0D0（1.6:1・不可）を #8a4b00 まで暗くして基準を満たす。
// ----------------------------------------------------------------------------
export const ACCESSIBLE_ROLE_PRESETS: Record<string, Role> = {
  // 主語 S（青系） … 実測 7.20:1
  subject: { label: "主語 (S)", color: "#0b4a8f", bg: "#dbeafe" },
  // 動詞 V（バーミリオン系＝赤緑色覚でも判別可） … 実測 5.90:1
  verb: { label: "動詞 (V)", color: "#a3290a", bg: "#ffe1d6" },
  // 目的語 O（紫系・緑は避ける） … 実測 8.21:1
  object: { label: "目的語 (O)", color: "#5b2a86", bg: "#f0e6fb" },
  // 補語 C（青緑系） … 実測 5.87:1
  complement: { label: "補語 (C)", color: "#03665c", bg: "#d7f3ef" },
  // 修飾語 M（暗い橙系） … 実測 6.03:1
  modifier: { label: "修飾語 (M)", color: "#8a4b00", bg: "#fff0d0" },
  // 重要語句（黄系背景＋黒に近い文字） … 実測 11.28:1
  important_phrase: { label: "重要語句", color: "#3f3300", bg: "#fdf6b2" },
  // 接続語・つなぎ言葉（インディゴ系） … 実測 8.20:1
  connector: { label: "接続語", color: "#3a3f6b", bg: "#e6e8f7" },
  // 根拠・手がかり（茶系） … 実測 7.45:1
  clue: { label: "根拠・手がかり", color: "#6b3a12", bg: "#f5e2d0" },
};

/** 新規教材の既定 rolePalette。既存の生成物・Inspector の ensureImportantRole が使うキー名（important_phrase）と互換。 */
export const DEFAULT_ROLE_PALETTE: RolePalette = {
  subject: ACCESSIBLE_ROLE_PRESETS.subject,
  verb: ACCESSIBLE_ROLE_PRESETS.verb,
  object: ACCESSIBLE_ROLE_PRESETS.object,
  complement: ACCESSIBLE_ROLE_PRESETS.complement,
  modifier: ACCESSIBLE_ROLE_PRESETS.modifier,
  important_phrase: ACCESSIBLE_ROLE_PRESETS.important_phrase,
  connector: ACCESSIBLE_ROLE_PRESETS.connector,
  clue: ACCESSIBLE_ROLE_PRESETS.clue,
};

// ----------------------------------------------------------------------------
// 色に依存しない二重符号化: 役割キーの安定した並び順から下線パターンを決める
// ----------------------------------------------------------------------------
export type RoleDecoration = "solid" | "double" | "dashed" | "dotted" | "wavy";

const DECORATION_CYCLE: RoleDecoration[] = ["solid", "double", "dashed", "dotted", "wavy"];

/** パレット内での role の登録順（安定的）から下線パターンを返す。役割が見つからない場合は 'solid'。 */
export function roleDecoration(roleKey: string, palette: RolePalette): RoleDecoration {
  const keys = Object.keys(palette);
  const idx = keys.indexOf(roleKey);
  if (idx < 0) return "solid";
  return DECORATION_CYCLE[idx % DECORATION_CYCLE.length];
}

// ----------------------------------------------------------------------------
// 下線パターン → 実CSS値の単一の対応表（改善提案: Renderer.tsx の decorationStyle()
// と exportHtml.ts の decorationCss() が別実装で同じ表を持っていた重複を解消）。
// kebab-case の宣言を唯一の情報源とし、Renderer 向け(React.CSSProperties)・
// exportHtml 向け(CSS文字列)の両方をここから導出する。見た目は現状維持。
// ----------------------------------------------------------------------------
type CssDeclMap = Record<string, string>;

const DECORATION_CSS_DECLS: Record<RoleDecoration, CssDeclMap> = {
  solid: { "border-bottom": "2px solid currentColor" },
  double: { "border-bottom": "3px double currentColor" },
  dashed: { "border-bottom": "2px dashed currentColor" },
  dotted: { "border-bottom": "2px dotted currentColor" },
  wavy: {
    "text-decoration-line": "underline",
    "text-decoration-style": "wavy",
    "text-decoration-color": "currentColor",
    "text-decoration-thickness": "2px",
    "text-underline-offset": "2px",
  },
};

function kebabToCamel(key: string): string {
  return key.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

/** Renderer.tsx（React インラインスタイル）向け */
export function decorationCssProps(pattern: RoleDecoration): CSSProperties {
  const decl = DECORATION_CSS_DECLS[pattern];
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(decl)) out[kebabToCamel(k)] = v;
  return out as CSSProperties;
}

/** exportHtml.ts（style属性の文字列）向け */
export function decorationCssText(pattern: RoleDecoration): string {
  const decl = DECORATION_CSS_DECLS[pattern];
  return Object.entries(decl)
    .map(([k, v]) => `${k}:${v};`)
    .join("");
}

// ----------------------------------------------------------------------------
// パレット正規化: コントラスト不足のエントリを是正する純関数
// ----------------------------------------------------------------------------
const MIN_CONTRAST = 4.5;
/** 段階的に前景色を暗くしていく際の最大試行回数（1回で ~8% 暗くする） */
const DARKEN_STEPS = 12;

function darkenHex(hex: string, amount: number): string {
  const [r, g, b] = parseHexColor(hex);
  const factor = 1 - amount;
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  const toHex = (v: number) => clamp(v).toString(16).padStart(2, "0");
  return `#${toHex(r * factor)}${toHex(g * factor)}${toHex(b * factor)}`;
}

/**
 * fg/bg のコントラストが基準未満のエントリを是正する純関数。
 * (a) キー名がプリセットにあればプリセット値へスナップ
 * (b) なければ fg を段階的に暗くして基準（4.5:1）以上を確保
 * 元から基準を満たすエントリは変更しない（往復無劣化を壊さないため）。
 * 生成直後にのみ呼ばれる想定（パース時には呼ばない）。
 */
export function normalizeRolePalette(palette: RolePalette): RolePalette {
  const next: RolePalette = {};
  for (const key of Object.keys(palette)) {
    const role = palette[key];
    if (contrastRatio(role.color, role.bg) >= MIN_CONTRAST) {
      next[key] = role;
      continue;
    }
    const preset = ACCESSIBLE_ROLE_PRESETS[key];
    if (preset) {
      next[key] = { ...role, color: preset.color, bg: preset.bg };
      continue;
    }
    let color = role.color;
    for (let i = 0; i < DARKEN_STEPS && contrastRatio(color, role.bg) < MIN_CONTRAST; i++) {
      color = darkenHex(color, 0.08);
    }
    next[key] = { ...role, color };
  }
  return next;
}
