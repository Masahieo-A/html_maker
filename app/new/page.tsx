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
    // Google Drive等の「オンラインのみ」ファイルは実体が無く0バイトになりやすい
    if (file.size === 0) {
      setError(
        "ファイルの中身が読めません。Google Drive 等のオンラインのみファイルは、先に Finder でダウンロード（オフライン利用可に）してから選んでください。"
      );
      return;
    }
    // Vercel のリクエスト上限は約4.5MB。base64化で約1.37倍に膨らむため、
    // 元PDFは約3MB以下に抑える必要がある。
    if (file.size > 3.2 * 1024 * 1024) {
      setError(
        `PDF が大きすぎます（${(file.size / 1024 / 1024).toFixed(
          1
        )}MB）。サーバー上限の都合で約3MB以下が必要です。解説したいページだけを別PDFに書き出してアップロードしてください（例: プレビュー.app → 該当ページを選んで「PDFとして書き出す」）。`
      );
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
      // サーバーがJSON以外（プラットフォームのエラーページ等）を返すことがあるので安全にパース
      const rawText = await res.text();
      let data: any = null;
      try {
        data = JSON.parse(rawText);
      } catch {
        if (res.status === 413) {
          throw new Error(
            "PDF が大きすぎます（送信データが約4.5MBの上限超過）。該当ページだけのPDFを書き出すか、より小さいPDFでお試しください。"
          );
        }
        if (res.status === 504 || res.status === 408) {
          throw new Error(
            "処理が時間切れになりました（PDFが重い可能性）。ページ数の少ないPDFでお試しください。"
          );
        }
        throw new Error(
          `サーバーエラー(${res.status})。PDFが大きすぎる/重い可能性があります。1ページだけのPDFでお試しください。`
        );
      }
      if (!res.ok) throw new Error(data?.error ?? "生成に失敗しました");
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
          <label>① 解説したい PDF（約3MB以下。大きい場合は該当ページだけ書き出し）</label>
          <input
            className="input"
            type="file"
            accept="application/pdf,.pdf"
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
