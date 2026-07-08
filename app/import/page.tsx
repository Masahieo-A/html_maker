"use client";
// ============================================================================
// 既存 HTML のインポートページ（改善提案 §2-4）。
// ① .html ファイル選択 or 貼り付け → ② 埋め込み JSON があれば無劣化復元、
// 無ければ「デザイン維持 / 簡易構造化 / AI で構造化」の 3 経路で取り込む。
// ============================================================================
import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { loadAiSettings, fetchServerKeys, loadLesson, saveLesson, aiRequestHeaders } from "@/lib/storage";
import { parseLessonDoc } from "@/lib/validate";
import { uid } from "@/lib/ids";
import {
  extractEmbeddedDocJson,
  importDesignPreserving,
  importStructured,
} from "@/lib/importHtml";
import AiSettingsPanel from "../components/AiSettings";

// Vercel のリクエスト上限（約4.5MB）より十分小さく抑える
const MAX_FILE_SIZE = 3 * 1024 * 1024;

export default function ImportPage() {
  const router = useRouter();
  const [html, setHtml] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [hasKey, setHasKey] = useState(true);
  const [serverHasKey, setServerHasKey] = useState(false);

  useEffect(() => {
    fetchServerKeys().then((sk) => {
      const server = sk.anthropic || sk.gemini;
      setServerHasKey(server);
      setHasKey(!!loadAiSettings().apiKey || server);
    });
  }, []);

  // 本アプリ書き出し HTML なら埋め込み JSON を検出（初期値 "" では走らないので SSR 安全）
  const embeddedJson = useMemo(
    () => (html.trim() ? extractEmbeddedDocJson(html) : null),
    [html]
  );

  // 埋め込みデータの id が既存教材と衝突するか（改善提案 A-8: 上書き/別名保存の分岐）
  const embeddedConflict = useMemo(() => {
    if (!embeddedJson) return false;
    try {
      const obj = JSON.parse(embeddedJson);
      const id = typeof obj?.id === "string" ? obj.id : null;
      return !!id && !!loadLesson(id);
    } catch {
      return false;
    }
  }, [embeddedJson]);

  const onHtmlFile = (file: File) => {
    setError(null);
    // Google Drive等の「オンラインのみ」ファイルは実体が無く0バイトになりやすい
    if (file.size === 0) {
      setError(
        "ファイルの中身が読めません。Google Drive 等のオンラインのみファイルは、先に Finder でダウンロード（オフライン利用可に）してから選んでください。"
      );
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      setError(
        `HTML が大きすぎます（${(file.size / 1024 / 1024).toFixed(1)}MB）。3MB 以下のファイルを選んでください。`
      );
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setHtml(String(reader.result ?? ""));
      setFileName(file.name);
    };
    reader.readAsText(file);
  };

  /** 埋め込み JSON からの無劣化復元（§2-1）。ID衝突時は上書き/別名保存を選べる（A-8） */
  const restoreEmbedded = (mode: "overwrite" | "rename" = "overwrite") => {
    if (!embeddedJson) return;
    setError(null);
    try {
      const doc = parseLessonDoc(embeddedJson);
      if (mode === "rename") {
        doc.id = uid("lesson");
        doc.title = doc.title + "（復元）";
      }
      saveLesson(doc);
      router.push(`/editor/${doc.id}`);
    } catch (e: any) {
      setError(`埋め込みデータの復元に失敗しました: ${e.message}`);
    }
  };

  /** デザイン維持 / 簡易構造化（API キー不要・即時変換） */
  const importLocal = (mode: "design" | "structured") => {
    setError(null);
    try {
      const doc = mode === "design" ? importDesignPreserving(html) : importStructured(html);
      saveLesson(doc);
      router.push(`/editor/${doc.id}`);
    } catch (e: any) {
      setError(`変換に失敗しました: ${e.message}`);
    }
  };

  /** AI で構造化（/api/import・SSE） */
  const importWithAi = async () => {
    setError(null);
    setProgress(0);
    const ai = loadAiSettings();
    if (!ai.apiKey && !serverHasKey) {
      setShowSettings(true);
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/import", {
        method: "POST",
        headers: aiRequestHeaders(),
        body: JSON.stringify({
          provider: ai.provider,
          apiKey: ai.apiKey,
          model: ai.model,
          html,
          instruction,
        }),
      });

      // バリデーションエラー等（400系）は JSON で返る
      if (!res.ok) {
        const raw = await res.text();
        let data: any = null;
        try { data = JSON.parse(raw); } catch { /* noop */ }
        throw new Error(data?.error ?? `サーバーエラー(${res.status})`);
      }

      if (!res.body) throw new Error("ストリームが空です");

      // SSE ストリームを読み取り、進捗表示しながら完成ドキュメントを待つ
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";

      outer: while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          let evt: any;
          try { evt = JSON.parse(line.slice(6)); } catch { continue; }
          if (evt.progress != null) setProgress(evt.progress);
          if (evt.error) throw new Error(evt.error);
          if (evt.done && evt.doc) {
            saveLesson(evt.doc);
            router.push(`/editor/${evt.doc.id}`);
            break outer;
          }
        }
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const hasHtml = html.trim().length > 0;

  return (
    <>
      <header className="topbar">
        <Link className="topbar__brand" href="/">
          View<span>point</span>
        </Link>
        <div className="topbar__spacer" />
        <button className="btn" onClick={() => setShowSettings(true)}>
          ⚙ AI 設定
        </button>
      </header>

      <main className="page" style={{ maxWidth: 720 }}>
        <Link href="/" className="muted" style={{ fontSize: 13 }}>
          ← 一覧へ
        </Link>
        <h1 style={{ margin: "8px 0 4px" }}>HTML を読み込む</h1>
        <p className="muted" style={{ marginTop: 0 }}>
          外部で作った HTML や、Viewpoint で書き出した HTML を取り込んで編集できるようにします。
          Viewpoint 書き出しの HTML は無劣化で復元できます。
        </p>

        <div className="field" style={{ marginTop: 16 }}>
          <label>① HTML ファイルを選択（3MB 以下）</label>
          <input
            className="input"
            type="file"
            accept=".html,text/html"
            onChange={(e) => e.target.files?.[0] && onHtmlFile(e.target.files[0])}
          />
          {fileName && (
            <p className="hint" style={{ marginTop: 4 }}>
              📄 {fileName} を読み込みました
              <button
                className="btn btn--ghost btn--sm"
                style={{ marginLeft: 8 }}
                onClick={() => {
                  setHtml("");
                  setFileName(null);
                }}
              >
                クリア
              </button>
            </p>
          )}
        </div>

        <div className="field">
          <label>（または）HTML を貼り付け</label>
          <textarea
            className="textarea"
            style={{ minHeight: 140, fontFamily: "monospace", fontSize: 12 }}
            placeholder="<!DOCTYPE html> から始まる HTML を丸ごと貼り付けてもOKです"
            value={html}
            onChange={(e) => {
              setHtml(e.target.value);
              setFileName(null);
            }}
          />
        </div>

        {error && (
          <p style={{ color: "var(--danger)", fontSize: 13 }}>エラー: {error}</p>
        )}

        {hasHtml && embeddedJson && (
          <div className="field">
            <p className="hint" style={{ marginTop: 0 }}>
              ✅ Viewpoint で書き出した教材データを検出しました。元の教材データをそのまま復元できます。
            </p>
            {embeddedConflict ? (
              <>
                <p style={{ color: "var(--danger)", fontSize: 13, marginTop: 0 }}>
                  ⚠️ 同じIDの教材がすでに保存されています。上書きするか、別名（新しいID）で保存するか選んでください。
                </p>
                <div className="row">
                  <button
                    className="btn btn--primary"
                    onClick={() => restoreEmbedded("overwrite")}
                    disabled={busy}
                  >
                    上書きする
                  </button>
                  <button className="btn" onClick={() => restoreEmbedded("rename")} disabled={busy}>
                    別名で保存
                  </button>
                </div>
              </>
            ) : (
              <button
                className="btn btn--primary"
                onClick={() => restoreEmbedded("overwrite")}
                disabled={busy}
              >
                無劣化で復元
              </button>
            )}
          </div>
        )}

        {hasHtml && !embeddedJson && (
          <>
            <h2 style={{ fontSize: 16, marginBottom: 4 }}>② 取り込み方法を選ぶ</h2>

            <div className="field">
              <button
                className="btn btn--primary"
                onClick={() => importLocal("design")}
                disabled={busy}
              >
                デザイン維持で取り込む（推奨）
              </button>
              <p className="hint" style={{ marginTop: 4 }}>
                元の見た目（CSS）を保ったまま、セクション単位のブロックとして取り込みます。
                並べ替え・削除・ブロック単位の AI 編集ができます。
              </p>
              <p className="hint" style={{ marginTop: 4 }}>
                ✅ 見た目・CSS を完全保持（書き出し時） ／ ⚠️ 編集は生HTMLの直接編集とAI修正のみ。
                閲覧・再配布・部分修正に向いています。細かな構造編集をしたい場合は「AI で構造化」がおすすめです。
              </p>
              <p className="hint" style={{ marginTop: 4 }}>
                ※ 取り込み直後の編集画面は Viewpoint 標準スタイルで表示されますが、
                書き出したHTMLでは元のデザインがそのまま再現されます（見た目が消えたわけではありません）。
              </p>
            </div>

            <div className="field">
              <button className="btn" onClick={() => importLocal("structured")} disabled={busy}>
                簡易構造化で取り込む
              </button>
              <p className="hint" style={{ marginTop: 4 }}>
                見出し・段落・表・画像などに自動変換します（API キー不要）。
                デザインは Viewpoint 標準スタイルになります。
              </p>
              <p className="hint" style={{ marginTop: 4 }}>
                ✅ 構造化編集が可能・APIキー不要 ／ ⚠️ 色・枠・下線などの装飾は失われます。
              </p>
            </div>

            <div className="field">
              <label>AI への追加指示（任意）</label>
              <textarea
                className="textarea"
                style={{ minHeight: 60 }}
                placeholder="例: 色分けされた語句は文法的な働きとして role に対応付けて"
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
              />
              <button
                className="btn"
                style={{ marginTop: 8 }}
                onClick={importWithAi}
                disabled={busy}
              >
                {busy ? (
                  <>
                    <span className="spinner" />{" "}
                    {progress > 0
                      ? `構造化中… ${progress.toLocaleString()}文字受信`
                      : "構造化中…（まもなく開始）"}
                  </>
                ) : (
                  "AI で構造化"
                )}
              </button>
              <p className="hint" style={{ marginTop: 4 }}>
                AI が内容を変えずに Viewpoint の構造化データへ変換します（API キーが必要）。
                色分け・表・カードなどの意味を汲み取って対応付けます。
              </p>
              <p className="hint" style={{ marginTop: 4 }}>
                ✅ 構造化編集が可能・意味を汲んだ変換（枠→note など） ／ ⚠️ 細かな色は失われます。所要時間の目安は〜20秒。
              </p>
              {!hasKey && (
                <p className="hint">
                  ※ AI で構造化するには「⚙ AI 設定」で API キーを設定してください（BYOK）。
                </p>
              )}
            </div>
          </>
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
