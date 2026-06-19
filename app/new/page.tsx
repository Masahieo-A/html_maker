"use client";
import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { loadAiSettings, fetchServerKeys, saveLesson } from "@/lib/storage";
import AiSettingsPanel from "../components/AiSettings";

export default function NewPage() {
  const router = useRouter();
  const [text, setText] = useState("");
  const [image, setImage] = useState<{ mediaType: string; data: string } | null>(null);
  const [imgPreview, setImgPreview] = useState<string | null>(null);
  const [pdf, setPdf] = useState<{ data: string } | null>(null);
  const [pdfName, setPdfName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
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

  const onFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result);
      setImgPreview(result);
      const base64 = result.split(",")[1] ?? "";
      setImage({ mediaType: file.type || "image/jpeg", data: base64 });
    };
    reader.readAsDataURL(file);
  };

  const onPdf = (file: File) => {
    setError(null);
    // 過大なPDFはAPIのリクエスト上限に当たりやすいので軽くガード
    if (file.size > 25 * 1024 * 1024) {
      setError("PDF が大きすぎます（25MB以下にしてください）");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = String(reader.result).split(",")[1] ?? "";
      setPdf({ data: base64 });
      setPdfName(file.name);
    };
    reader.readAsDataURL(file);
  };

  const generate = async () => {
    setError(null);
    const ai = loadAiSettings();
    if (!ai.apiKey && !serverHasKey) {
      setShowSettings(true);
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          provider: ai.provider,
          apiKey: ai.apiKey,
          model: ai.model,
          text,
          image,
          pdf,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "生成に失敗しました");
      saveLesson(data.doc);
      router.push(`/editor/${data.doc.id}`);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

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
        <h1 style={{ margin: "8px 0 4px" }}>AI で下書き生成</h1>
        <p className="muted" style={{ marginTop: 0 }}>
          ① 解説したい PDF をアップロード → ② 中心テーマ・フォーマット・雰囲気を入力 →
          AI が PDF を読み取って LessonDoc の下書きを作り、そこから細部を編集します。
        </p>

        {!hasKey && (
          <p className="hint">
            ※ まず「⚙ AI 設定」で API キーを設定してください（BYOK）。
          </p>
        )}

        <div className="field" style={{ marginTop: 16 }}>
          <label>① 解説したい PDF（推奨・最大25MB）</label>
          <input
            className="input"
            type="file"
            accept="application/pdf"
            onChange={(e) => e.target.files?.[0] && onPdf(e.target.files[0])}
          />
          {pdfName && (
            <p className="hint" style={{ marginTop: 4 }}>
              📄 {pdfName} を読み込みました
              <button
                className="btn btn--ghost btn--sm"
                style={{ marginLeft: 8 }}
                onClick={() => {
                  setPdf(null);
                  setPdfName(null);
                }}
              >
                クリア
              </button>
            </p>
          )}
        </div>

        <div className="field">
          <label>② 中心テーマ・フォーマット・雰囲気の指示</label>
          <textarea
            className="textarea"
            style={{ minHeight: 160 }}
            placeholder={
              "例:\n・中心テーマ: 関係代名詞 which の非制限用法を見抜く\n・フォーマット: 各文を樹形図＋色分け、要所に着眼点ノート\n・雰囲気: 高校生向けにやさしく、専門用語は最小限\n（PDFがあれば、その内容に沿って上記方針で教材化）"
            }
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </div>

        <div className="field">
          <label>③ 手書きスケッチ写真（任意・補完用）</label>
          <input
            className="input"
            type="file"
            accept="image/*"
            capture="environment"
            onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
          />
          {imgPreview && (
            <img
              src={imgPreview}
              alt="プレビュー"
              style={{ maxWidth: 200, marginTop: 8, borderRadius: 8 }}
            />
          )}
        </div>

        {error && (
          <p style={{ color: "var(--danger)", fontSize: 13 }}>エラー: {error}</p>
        )}

        <button
          className="btn btn--primary"
          style={{ marginTop: 8 }}
          disabled={busy || (!text.trim() && !pdf)}
          onClick={generate}
        >
          {busy ? (
            <>
              <span className="spinner" /> 生成中…
            </>
          ) : (
            "AIで下書き生成"
          )}
        </button>
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
