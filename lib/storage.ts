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

export function saveLesson(doc: LessonDoc): void {
  const withTime: LessonDoc = { ...doc, updatedAt: Date.now() };
  localStorage.setItem(DOC_PREFIX + doc.id, JSON.stringify(withTime));
  const metas = readIndex().filter((m) => m.id !== doc.id);
  metas.push({ id: doc.id, title: doc.title, updatedAt: withTime.updatedAt! });
  writeIndex(metas);
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
};

const AI_KEY = "viewpoint:ai";

export const DEFAULT_MODELS = {
  anthropic: ["claude-opus-4-8", "claude-sonnet-4-6", "claude-haiku-4-5"],
  gemini: ["gemini-2.0-flash", "gemini-1.5-pro", "gemini-1.5-flash"],
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
