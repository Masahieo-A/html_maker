// ============================================================================
// 永続化レイヤー（MVP は localStorage）。
// 将来 Supabase に差し替えても、この API シグネチャを保てば呼び出し側は不変。
// ============================================================================
"use client";
import type { LessonDoc } from "./types";

const INDEX_KEY = "viewpoint:index";
const DOC_PREFIX = "viewpoint:doc:";

export type LessonMeta = {
  id: string;
  title: string;
  updatedAt: number;
};

function readIndex(): LessonMeta[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    return raw ? (JSON.parse(raw) as LessonMeta[]) : [];
  } catch {
    return [];
  }
}

function writeIndex(metas: LessonMeta[]) {
  localStorage.setItem(INDEX_KEY, JSON.stringify(metas));
}

export function listLessons(): LessonMeta[] {
  return readIndex().sort((a, b) => b.updatedAt - a.updatedAt);
}

export function loadLesson(id: string): LessonDoc | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(DOC_PREFIX + id);
    return raw ? (JSON.parse(raw) as LessonDoc) : null;
  } catch {
    return null;
  }
}

/** 保存の成否を返す。localStorage の容量超過などで失敗し得るため、呼び出し側で通知すること。 */
export function saveLesson(doc: LessonDoc): boolean {
  try {
    const withTime: LessonDoc = { ...doc, updatedAt: Date.now() };
    localStorage.setItem(DOC_PREFIX + doc.id, JSON.stringify(withTime));
    const metas = readIndex().filter((m) => m.id !== doc.id);
    metas.push({ id: doc.id, title: doc.title, updatedAt: withTime.updatedAt! });
    writeIndex(metas);
    return true;
  } catch {
    return false;
  }
}

export function deleteLesson(id: string): void {
  localStorage.removeItem(DOC_PREFIX + id);
  writeIndex(readIndex().filter((m) => m.id !== id));
}

export function duplicateLesson(id: string): LessonDoc | null {
  const doc = loadLesson(id);
  if (!doc) return null;
  const copy: LessonDoc = {
    ...structuredClone(doc),
    id: "lesson_" + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4),
    title: doc.title + "（複製）",
    updatedAt: Date.now(),
  };
  saveLesson(copy);
  return copy;
}

// --- AI 設定（BYOK） --------------------------------------------------------
export type AiSettings = {
  provider: "anthropic" | "gemini";
  apiKey: string;
  model: string;
  /** サーバーが APP_PASSCODE を要求する場合のアクセスパスコード */
  passcode?: string;
};

const AI_KEY = "viewpoint:ai";

// 動的取得に失敗したときのフォールバック既定値（実際の一覧は /api/models で取得）
export const DEFAULT_MODELS = {
  anthropic: ["claude-sonnet-5", "claude-opus-4-8", "claude-haiku-4-5"],
  gemini: ["gemini-2.5-flash", "gemini-2.5-pro"],
};

export function loadAiSettings(): AiSettings {
  if (typeof window === "undefined")
    return { provider: "anthropic", apiKey: "", model: DEFAULT_MODELS.anthropic[0] };
  try {
    const raw = localStorage.getItem(AI_KEY);
    if (raw) return JSON.parse(raw) as AiSettings;
  } catch {
    /* noop */
  }
  return { provider: "anthropic", apiKey: "", model: DEFAULT_MODELS.anthropic[0] };
}

export function saveAiSettings(s: AiSettings): void {
  localStorage.setItem(AI_KEY, JSON.stringify(s));
}

export type ServerKeys = { anthropic: boolean; gemini: boolean; passcodeRequired: boolean };

/** API 呼び出し用の共通ヘッダー（パスコード設定時のみ付与） */
export function aiRequestHeaders(passcode?: string): Record<string, string> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  const code = passcode ?? loadAiSettings().passcode;
  if (code) headers["x-viewpoint-passcode"] = code;
  return headers;
}

/** サーバー(Vercel環境変数)にキーがあるか問い合わせる。値は返さず真偽のみ。 */
export async function fetchServerKeys(): Promise<ServerKeys> {
  try {
    const r = await fetch("/api/config");
    if (r.ok) {
      const data = await r.json();
      return {
        anthropic: !!data.anthropic,
        gemini: !!data.gemini,
        passcodeRequired: !!data.passcodeRequired,
      };
    }
  } catch {
    /* noop */
  }
  return { anthropic: false, gemini: false, passcodeRequired: false };
}

/** プロバイダで実際に使えるモデル一覧をキーで取得（失敗時は空配列）。 */
export async function fetchModels(
  provider: AiSettings["provider"],
  apiKey: string,
  passcode?: string
): Promise<string[]> {
  try {
    const r = await fetch("/api/models", {
      method: "POST",
      headers: aiRequestHeaders(passcode),
      body: JSON.stringify({ provider, apiKey }),
    });
    if (r.ok) {
      const data = (await r.json()) as { models?: string[] };
      return data.models ?? [];
    }
  } catch {
    /* noop */
  }
  return [];
}
