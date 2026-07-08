// ============================================================================
// 永続化レイヤー（MVP は localStorage）。
// 将来 Supabase に差し替えても、この API シグネチャを保てば呼び出し側は不変。
// ============================================================================
"use client";
import type { LessonDoc } from "./types";
import { parseLessonDoc } from "./validate";
import { uid } from "./ids";

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
    id: uid("lesson"),
    title: doc.title + "（複製）",
    updatedAt: Date.now(),
  };
  saveLesson(copy);
  return copy;
}

// --- 全教材の一括バックアップ/復元（改善提案 F-3） --------------------------
// localStorage のみの保存はデータ喪失に弱いため、端末変更・ブラウザのデータ消去
// への保険として、全教材＋indexを1つのJSONに書き出し/読み込みできるようにする。

export type LessonsBackup = {
  app: "viewpoint";
  kind: "all-lessons-backup";
  version: 1;
  exportedAt: number;
  index: LessonMeta[];
  lessons: LessonDoc[];
};

/** 全教材＋indexを1つのJSON文字列に（バージョン・書き出し日時入りのエンベロープ） */
export function exportAllLessons(): string {
  const index = readIndex();
  const lessons: LessonDoc[] = [];
  for (const meta of index) {
    const doc = loadLesson(meta.id);
    if (doc) lessons.push(doc);
  }
  const backup: LessonsBackup = {
    app: "viewpoint",
    kind: "all-lessons-backup",
    version: 1,
    exportedAt: Date.now(),
    index,
    lessons,
  };
  return JSON.stringify(backup, null, 2);
}

/**
 * バックアップJSONを取り込む。各教材は parseLessonDoc で検証・正規化する。
 * 既存IDと衝突する場合は既存を壊さず新IDで複製し、タイトルに「（復元）」を付ける。
 * 壊れている要素はスキップし、件数を返す。
 */
export function importAllLessons(json: string): { imported: number; skipped: number } {
  let data: any;
  try {
    data = JSON.parse(json);
  } catch {
    throw new Error("JSONとして読み取れませんでした。ファイル形式を確認してください。");
  }
  const lessons: unknown[] = Array.isArray(data?.lessons) ? data.lessons : [];
  if (!lessons.length) {
    throw new Error(
      "教材データが見つかりませんでした。「⬇ すべてバックアップ」で書き出したJSONを選んでください。"
    );
  }

  let imported = 0;
  let skipped = 0;
  const existingIds = new Set(readIndex().map((m) => m.id));

  for (const raw of lessons) {
    try {
      const rawId = raw && typeof raw === "object" ? (raw as any).id : undefined;
      const collide = typeof rawId === "string" && existingIds.has(rawId);
      const keepId = collide ? uid("lesson") : typeof rawId === "string" ? rawId : undefined;
      const doc = parseLessonDoc(JSON.stringify(raw), keepId);
      if (collide) doc.title = doc.title + "（復元）";
      if (saveLesson(doc)) {
        existingIds.add(doc.id);
        imported++;
      } else {
        skipped++;
      }
    } catch {
      skipped++;
    }
  }
  return { imported, skipped };
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
