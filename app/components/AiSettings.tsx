"use client";
import React, { useEffect, useState } from "react";
import {
  AiSettings,
  DEFAULT_MODELS,
  ServerKeys,
  aiRequestHeaders,
  fetchModels,
  fetchServerKeys,
  loadAiSettings,
  saveAiSettings,
} from "@/lib/storage";

type TestState = "idle" | "testing" | "ok" | "error";

// BYOK 設定パネル（要件 §7：API キーはクライアント保管、モデル選択可）。
export default function AiSettingsPanel({
  onClose,
}: {
  onClose: () => void;
}) {
  const [s, setS] = useState<AiSettings>({
    provider: "anthropic",
    apiKey: "",
    model: DEFAULT_MODELS.anthropic[0],
  });

  const [serverKeys, setServerKeys] = useState<ServerKeys>({
    anthropic: false,
    gemini: false,
    passcodeRequired: false,
  });
  const [models, setModels] = useState<string[]>(DEFAULT_MODELS.anthropic);
  const [loadingModels, setLoadingModels] = useState(false);

  // 接続テスト（改善提案 C-1）
  const [testState, setTestState] = useState<TestState>("idle");
  const [testMsg, setTestMsg] = useState("");

  // 保存フィードバック（改善提案 C-2）
  const [savedToast, setSavedToast] = useState(false);

  useEffect(() => {
    const init = loadAiSettings();
    setS(init);
    setModels(DEFAULT_MODELS[init.provider]);
    fetchServerKeys().then(setServerKeys);
  }, []);

  const serverHasForProvider = serverKeys[s.provider];

  // プロバイダ or キーが変わったら、実際に使えるモデル一覧を取得（失敗時は既定値）。
  // キー入力の1文字ごとに外部 API を叩かないよう 500ms デバウンスする。
  useEffect(() => {
    let alive = true;
    setLoadingModels(true);
    const timer = setTimeout(() => {
      fetchModels(s.provider, s.apiKey, s.passcode).then((list) => {
        if (!alive) return;
        const fallback = DEFAULT_MODELS[s.provider];
        const final = list.length ? list : fallback;
        setModels(final);
        // 現在の選択が一覧に無ければ先頭に寄せる
        setS((prev) =>
          final.includes(prev.model) ? prev : { ...prev, model: final[0] }
        );
        setLoadingModels(false);
      });
    }, 500);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.provider, s.apiKey, s.passcode, serverKeys.anthropic, serverKeys.gemini]);

  const update = (patch: Partial<AiSettings>) => {
    const next = { ...s, ...patch };
    if (patch.provider) {
      next.model = DEFAULT_MODELS[patch.provider][0];
    }
    setS(next);
    // 設定を変えたら直前の接続テスト結果は無効化する
    if (testState !== "idle") {
      setTestState("idle");
      setTestMsg("");
    }
  };

  // 現在の provider/apiKey/model で /api/models を叩き、実際に接続できるか確認する（改善提案 C-1）
  const runConnectionTest = async () => {
    setTestState("testing");
    setTestMsg("");
    try {
      const r = await fetch("/api/models", {
        method: "POST",
        headers: aiRequestHeaders(s.passcode),
        body: JSON.stringify({ provider: s.provider, apiKey: s.apiKey }),
      });
      let data: any = null;
      try {
        data = await r.json();
      } catch {
        /* noop */
      }
      if (r.ok) {
        const count = Array.isArray(data?.models) ? data.models.length : 0;
        setTestState("ok");
        setTestMsg(`✓ 接続OK（利用可能モデル${count}件）`);
      } else if (r.status === 401 || r.status === 403) {
        setTestState("error");
        setTestMsg(
          "APIキーが正しくないか権限がありません。コピーの欠け・余分な空白がないか確認してください。"
        );
      } else if (r.status === 429) {
        setTestState("error");
        setTestMsg("利用上限に達しています。しばらく待ってから再試行してください。");
      } else {
        setTestState("error");
        const detail = (data?.error ?? "").toString().slice(0, 140);
        setTestMsg(`接続に失敗しました（エラー${r.status}）${detail ? `: ${detail}` : ""}`);
      }
    } catch {
      setTestState("error");
      setTestMsg("通信エラーが発生しました。ネットワーク接続を確認してください。");
    }
  };

  const maskedKey = s.apiKey.length >= 4 ? `••••${s.apiKey.slice(-4)}` : s.apiKey ? "••••" : "";

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "#0f172a88",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 60,
        padding: 16,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: "#fff",
          borderRadius: 14,
          padding: 22,
          width: "min(460px, 100%)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 style={{ marginTop: 0, fontSize: 18 }}>AI 設定（BYOK）</h2>
        <p className="hint" style={{ marginBottom: 8 }}>
          API キーはこのブラウザ（localStorage）にのみ保存され、生成時にサーバー経由で
          各社 API に送られます。
        </p>
        <p className="hint" style={{ marginBottom: 16 }}>
          サーバ側キー: Anthropic {serverKeys.anthropic ? "✓" : "✗"} ・ Gemini{" "}
          {serverKeys.gemini ? "✓" : "✗"}
          {(serverKeys.anthropic || serverKeys.gemini) &&
            "（✓のプロバイダはこの画面でキーを入力しなくても生成・編集できます）"}
        </p>
        <div className="field">
          <label>プロバイダ</label>
          <select
            className="select"
            value={s.provider}
            onChange={(e) => update({ provider: e.target.value as AiSettings["provider"] })}
          >
            <option value="anthropic">Anthropic（Claude）</option>
            <option value="gemini">Google（Gemini）</option>
          </select>
        </div>
        <div className="field">
          <label>モデル {loadingModels && <span className="hint">（一覧取得中…）</span>}</label>
          <select
            className="select"
            value={s.model}
            onChange={(e) => update({ model: e.target.value })}
          >
            {/* 保存済みの選択が一覧に無くても表示できるよう補完 */}
            {(models.includes(s.model) ? models : [s.model, ...models]).map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <p className="hint" style={{ marginTop: 4 }}>
            キーを入力（またはサーバー設定）すると、実際に使えるモデルを自動取得します。
          </p>
        </div>
        <div className="field">
          <label>API キー{serverHasForProvider ? "（任意）" : ""}</label>
          <input
            className="input"
            type="password"
            placeholder={
              serverHasForProvider
                ? "サーバー側に設定済み（空欄でOK）"
                : s.provider === "anthropic"
                ? "sk-ant-..."
                : "AIza... または AQ....（新形式）"
            }
            value={s.apiKey}
            onChange={(e) => update({ apiKey: e.target.value })}
          />
          {s.provider === "gemini" && (
            <p className="hint" style={{ marginTop: 4 }}>
              Google の API キーは従来の <code>AIza...</code> 形式に加え、新形式の{" "}
              <code>AQ.</code> から始まるキーにも対応しています。
            </p>
          )}
          {serverHasForProvider && (
            <p className="hint" style={{ marginTop: 4 }}>
              ✓ サーバー（Vercel 環境変数）にこのプロバイダのキーが設定済みです。ここは空欄のままで生成・編集できます。
            </p>
          )}
          {maskedKey && (
            <p className="hint" style={{ marginTop: 4 }}>
              保存されるキー: {maskedKey}
            </p>
          )}
          <div className="row" style={{ marginTop: 6 }}>
            <button
              className="btn btn--sm"
              onClick={runConnectionTest}
              disabled={testState === "testing"}
              type="button"
            >
              {testState === "testing" ? (
                <>
                  <span className="spinner" /> 確認中…
                </>
              ) : (
                "接続テスト"
              )}
            </button>
          </div>
          {testMsg && (
            <p
              className="hint"
              style={{
                marginTop: 4,
                color: testState === "error" ? "var(--danger)" : undefined,
              }}
            >
              {testMsg}
            </p>
          )}
        </div>
        {serverKeys.passcodeRequired && (
          <div className="field">
            <label>アクセスパスコード（必須）</label>
            <input
              className="input"
              type="password"
              placeholder="管理者が設定した APP_PASSCODE"
              value={s.passcode ?? ""}
              onChange={(e) => update({ passcode: e.target.value })}
            />
            <p className="hint" style={{ marginTop: 4 }}>
              このサーバーは第三者利用防止のためパスコードが必要です。
            </p>
          </div>
        )}
        <div className="row" style={{ justifyContent: "flex-end", marginTop: 8, alignItems: "center" }}>
          {savedToast && (
            <span className="hint" style={{ color: "#16a34a" }}>
              ✓ 保存しました
            </span>
          )}
          <button className="btn" onClick={onClose}>
            閉じる
          </button>
          <button
            className="btn btn--primary"
            onClick={() => {
              saveAiSettings(s);
              setSavedToast(true);
              setTimeout(() => {
                setSavedToast(false);
                onClose();
              }, 700);
            }}
          >
            保存
          </button>
        </div>
      </div>
    </div>
  );
}
