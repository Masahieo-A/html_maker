"use client";
import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import type { Block, LessonDoc, Selection } from "@/lib/types";
import { BLOCK_TYPE_LABELS } from "@/lib/types";
import { loadAiSettings, loadLesson, saveLesson } from "@/lib/storage";
import { addBlock, makeEmptyBlock, replaceBlock, findBlock } from "@/lib/docOps";
import { parseLessonDoc } from "@/lib/validate";
import { exportHtml } from "@/lib/exportHtml";
import { useHistory } from "../../components/useHistory";
import Renderer from "../../components/Renderer";
import Inspector from "../../components/Inspector";
import AiSettingsPanel from "../../components/AiSettings";

type Tab = "view" | "json" | "html";

export default function EditorPage() {
  const params = useParams();
  const id = String(params.id);

  const [loaded, setLoaded] = useState<LessonDoc | null | undefined>(undefined);
  const hist = useHistory<LessonDoc>({
    id,
    title: "",
    version: 1,
    rolePalette: {},
    blocks: [],
  });
  const doc = hist.present;

  const [selection, setSelection] = useState<Selection>(null);
  const [tab, setTab] = useState<Tab>("view");
  const [toast, setToast] = useState<string | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [jsonDraft, setJsonDraft] = useState("");

  // 読み込み
  useEffect(() => {
    const d = loadLesson(id);
    setLoaded(d);
    if (d) hist.reset(d);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // 自動保存（編集は即時反映）
  useEffect(() => {
    if (loaded && doc.blocks.length >= 0 && doc.title !== "") {
      const t = setTimeout(() => saveLesson(doc), 400);
      return () => clearTimeout(t);
    }
  }, [doc, loaded]);

  // キーボード: Cmd/Ctrl+Z で undo, Shift で redo
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) hist.redo();
        else hist.undo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hist]);

  const flash = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 1800);
  };

  const html = useMemo(() => (loaded ? exportHtml(doc) : ""), [doc, loaded]);

  const onAddBlock = (type: Block["type"]) => {
    const block = makeEmptyBlock(type);
    const after = selection?.blockId;
    hist.commit(addBlock(doc, block, after));
    setSelection({ kind: "block", blockId: block.id });
  };

  const onAiEdit = async (instruction: string) => {
    if (!selection) return;
    const block = findBlock(doc, selection.blockId);
    if (!block) return;
    const ai = loadAiSettings();
    if (!ai.apiKey) {
      setShowSettings(true);
      return;
    }
    setAiBusy(true);
    try {
      const res = await fetch("/api/edit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          provider: ai.provider,
          apiKey: ai.apiKey,
          model: ai.model,
          block,
          palette: doc.rolePalette,
          instruction,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "AI 編集に失敗しました");
      // id を保持して差し替え
      const updated: Block = { ...data.block, id: block.id };
      hist.commit(replaceBlock(doc, block.id, updated));
      flash("AI で更新しました");
    } catch (e: any) {
      flash("エラー: " + e.message);
    } finally {
      setAiBusy(false);
    }
  };

  const downloadHtml = () => {
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${doc.title || "lesson"}.html`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const applyJson = () => {
    try {
      const next = parseLessonDoc(jsonDraft, doc.id);
      hist.commit(next);
      flash("JSON を反映しました");
      setTab("view");
    } catch (e: any) {
      flash("JSON エラー: " + e.message);
    }
  };

  if (loaded === undefined) {
    return <main className="page">読み込み中…</main>;
  }
  if (loaded === null) {
    return (
      <main className="page">
        <p>教材が見つかりませんでした。</p>
        <Link className="btn" href="/">
          一覧へ戻る
        </Link>
      </main>
    );
  }

  return (
    <>
      <header className="topbar">
        <Link className="topbar__brand" href="/">
          View<span>point</span>
        </Link>
        <input
          className="input"
          style={{ maxWidth: 280 }}
          value={doc.title}
          onChange={(e) => hist.commit({ ...doc, title: e.target.value })}
        />
        <div className="topbar__spacer" />
        <button className="btn btn--sm" disabled={!hist.canUndo} onClick={hist.undo} title="元に戻す (⌘Z)">
          ↶ 元に戻す
        </button>
        <button className="btn btn--sm" disabled={!hist.canRedo} onClick={hist.redo} title="やり直す (⇧⌘Z)">
          ↷ やり直す
        </button>
        <button
          className="btn btn--sm"
          onClick={() => {
            saveLesson(doc);
            flash("保存しました");
          }}
        >
          保存
        </button>
        <button className="btn btn--sm" onClick={() => setShowSettings(true)}>
          ⚙ AI
        </button>
      </header>

      {/* タブ */}
      <div style={{ padding: "12px 18px 0", display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <div className="tabs">
          {(["view", "json", "html"] as Tab[]).map((t) => (
            <button
              key={t}
              className={`tab ${tab === t ? "tab--active" : ""}`}
              onClick={() => {
                if (t === "json") setJsonDraft(JSON.stringify(doc, null, 2));
                setTab(t);
              }}
            >
              {t === "view" ? "教材ビュー" : t === "json" ? "ソース(JSON)" : "書き出し(HTML)"}
            </button>
          ))}
        </div>
        {tab === "view" && (
          <div className="row" style={{ flexWrap: "wrap" }}>
            <span className="hint">追加:</span>
            {(Object.keys(BLOCK_TYPE_LABELS) as Block["type"][]).map((t) => (
              <button key={t} className="btn btn--sm" onClick={() => onAddBlock(t)}>
                ＋{BLOCK_TYPE_LABELS[t]}
              </button>
            ))}
          </div>
        )}
        {tab === "html" && (
          <button className="btn btn--sm btn--primary" onClick={downloadHtml}>
            ⬇ HTML をダウンロード
          </button>
        )}
      </div>

      {tab === "view" && (
        <div className="editor">
          <div className="editor__main">
            <Renderer doc={doc} selection={selection} onSelect={setSelection} />
            {doc.blocks.length === 0 && (
              <p className="muted">上の「追加」からブロックを足してください。</p>
            )}
          </div>
          <aside className="editor__side">
            <Inspector
              doc={doc}
              selection={selection}
              onChange={hist.commit}
              onSelect={setSelection}
              onAiEdit={onAiEdit}
              aiBusy={aiBusy}
            />
          </aside>
        </div>
      )}

      {tab === "json" && (
        <main className="page">
          <p className="hint">
            JSON が信頼できる唯一の実体です。編集して「反映」するとビュー・HTML に即時反映されます。
          </p>
          <textarea
            className="code"
            style={{ width: "100%", minHeight: 420, border: "none" }}
            value={jsonDraft}
            onChange={(e) => setJsonDraft(e.target.value)}
            spellCheck={false}
          />
          <div className="row" style={{ marginTop: 10 }}>
            <button className="btn btn--primary" onClick={applyJson}>
              JSON を反映
            </button>
            <button className="btn" onClick={() => setJsonDraft(JSON.stringify(doc, null, 2))}>
              現在の状態に戻す
            </button>
          </div>
        </main>
      )}

      {tab === "html" && (
        <main className="page" style={{ maxWidth: 1100 }}>
          <p className="hint">
            生徒配布用の自己完結 HTML（CSSインライン・レスポンシブ・印刷可）。プレビューと書き出しコード。
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }} className="html-split">
            <iframe
              title="preview"
              style={{ width: "100%", height: 480, border: "1px solid var(--line)", borderRadius: 10, background: "#fff" }}
              srcDoc={html}
            />
            <pre className="code" style={{ height: 480, overflow: "auto", margin: 0 }}>
              {html}
            </pre>
          </div>
        </main>
      )}

      {toast && <div className="toast">{toast}</div>}
      {showSettings && <AiSettingsPanel onClose={() => setShowSettings(false)} />}
    </>
  );
}
