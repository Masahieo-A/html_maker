"use client";
import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  LessonMeta,
  deleteLesson,
  duplicateLesson,
  exportAllLessons,
  importAllLessons,
  listLessons,
  loadAiSettings,
  fetchServerKeys,
  saveLesson,
} from "@/lib/storage";
import { makeSampleDoc } from "@/lib/sample";
import { uid } from "@/lib/ids";
import type { LessonDoc } from "@/lib/types";
import AiSettingsPanel from "./components/AiSettings";

export default function HomePage() {
  const router = useRouter();
  const [lessons, setLessons] = useState<LessonMeta[]>([]);
  const [showSettings, setShowSettings] = useState(false);
  const [hasKey, setHasKey] = useState(true);
  const [serverHasKey, setServerHasKey] = useState(false);
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupMsg, setBackupMsg] = useState<string | null>(null);
  const backupFileRef = useRef<HTMLInputElement>(null);

  const refresh = () => setLessons(listLessons());
  useEffect(() => {
    refresh();
    fetchServerKeys().then((sk) => {
      const server = sk.anthropic || sk.gemini;
      setServerHasKey(server);
      setHasKey(!!loadAiSettings().apiKey || server);
    });
  }, []);

  const createBlank = () => {
    const doc: LessonDoc = {
      id: uid("lesson"),
      title: "無題の教材",
      version: 1,
      rolePalette: {},
      blocks: [{ id: uid("b"), type: "heading", level: 2, text: "新しい教材" }],
      updatedAt: Date.now(),
    };
    saveLesson(doc);
    router.push(`/editor/${doc.id}`);
  };

  const createSample = () => {
    const doc = makeSampleDoc();
    saveLesson(doc);
    router.push(`/editor/${doc.id}`);
  };

  // 全教材の一括バックアップ（改善提案 F-3）: JSONファイルとしてダウンロード
  const downloadBackup = () => {
    try {
      const json = exportAllLessons();
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const stamp = new Date().toISOString().slice(0, 10);
      a.href = url;
      a.download = `viewpoint-backup-${stamp}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setBackupMsg(`✓ ${lessons.length}件の教材をバックアップしました`);
    } catch (e: any) {
      setBackupMsg(`バックアップの書き出しに失敗しました: ${e.message}`);
    }
  };

  // バックアップJSONの読み込み。ID衝突は新IDで複製し「（復元）」を付ける（storage.importAllLessons）
  const onBackupFile = (file: File) => {
    setBackupBusy(true);
    setBackupMsg(null);
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const { imported, skipped } = importAllLessons(String(reader.result ?? ""));
        refresh();
        setBackupMsg(
          `✓ ${imported}件の教材を読み込みました${skipped ? `（${skipped}件はスキップ）` : ""}`
        );
      } catch (e: any) {
        setBackupMsg(`読み込みに失敗しました: ${e.message}`);
      } finally {
        setBackupBusy(false);
        if (backupFileRef.current) backupFileRef.current.value = "";
      }
    };
    reader.onerror = () => {
      setBackupMsg("ファイルの読み込みに失敗しました。");
      setBackupBusy(false);
    };
    reader.readAsText(file);
  };

  return (
    <>
      <header className="topbar">
        <div className="topbar__brand">
          View<span>point</span>
        </div>
        <div className="topbar__spacer" />
        <button className="btn" onClick={() => setShowSettings(true)}>
          ⚙ AI 設定
        </button>
      </header>

      <main className="page">
        <h1 style={{ margin: "0 0 4px" }}>教材一覧</h1>
        <p className="muted" style={{ marginTop: 0 }}>
          構造化コンポーネント方式で、英語の文構造を視覚的に伝える教材を作成・編集します。
        </p>

        <div className="row" style={{ marginTop: 16, flexWrap: "wrap" }}>
          <Link className="btn btn--primary" href="/new">
            ✨ AI で下書き生成
          </Link>
          <Link className="btn" href="/import">
            📂 HTML を読み込む
          </Link>
          <button className="btn" onClick={createBlank}>
            ＋ 空の教材
          </button>
          <button className="btn" onClick={createSample}>
            サンプルを開く
          </button>
        </div>

        {!hasKey && (
          <p className="hint" style={{ marginTop: 14 }}>
            ※ AI 生成・編集を使うには「⚙ AI 設定」で API キーを設定してください（BYOK）。
          </p>
        )}

        <div className="row" style={{ marginTop: 12, flexWrap: "wrap" }}>
          <button className="btn btn--sm" onClick={downloadBackup} disabled={backupBusy}>
            ⬇ すべてバックアップ
          </button>
          <button
            className="btn btn--sm"
            onClick={() => backupFileRef.current?.click()}
            disabled={backupBusy}
          >
            ⬆ バックアップを読み込む
          </button>
          <input
            ref={backupFileRef}
            type="file"
            accept=".json,application/json"
            style={{ display: "none" }}
            onChange={(e) => e.target.files?.[0] && onBackupFile(e.target.files[0])}
          />
        </div>
        {backupMsg && (
          <p className="hint" style={{ marginTop: 4 }}>
            {backupMsg}
          </p>
        )}
        <p className="hint" style={{ marginTop: 4 }}>
          ※ 教材はこのブラウザ（localStorage）にのみ保存されています。端末変更やブラウザのデータ消去で
          全教材が失われる可能性があるため、定期的なバックアップをおすすめします。
        </p>

        {lessons.length === 0 ? (
          <p className="muted" style={{ marginTop: 40 }}>
            まだ教材がありません。上のボタンから作成しましょう。
          </p>
        ) : (
          <div className="cards">
            {lessons.map((l) => (
              <div className="card" key={l.id}>
                <div className="card__title">{l.title}</div>
                <div className="card__meta">
                  更新: {new Date(l.updatedAt).toLocaleString("ja-JP")}
                </div>
                <div className="card__actions">
                  <Link className="btn btn--sm btn--primary" href={`/editor/${l.id}`}>
                    編集
                  </Link>
                  <button
                    className="btn btn--sm"
                    onClick={() => {
                      duplicateLesson(l.id);
                      refresh();
                    }}
                  >
                    複製
                  </button>
                  <button
                    className="btn btn--sm btn--danger"
                    onClick={() => {
                      if (confirm(`「${l.title}」を削除しますか？`)) {
                        deleteLesson(l.id);
                        refresh();
                      }
                    }}
                  >
                    削除
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {showSettings && (
        <AiSettingsPanel
          onClose={() => {
            setShowSettings(false);
            setHasKey(!!loadAiSettings().apiKey || serverHasKey);
          }}
        />
      )}
    </>
  );
}
