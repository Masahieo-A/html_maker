"use client";
import React, { useEffect, useState } from "react";
import {
  AiSettings,
  DEFAULT_MODELS,
  ServerKeys,
  fetchModels,
  fetchServerKeys,
  loadAiSettings,
  saveAiSettings,
} from "@/lib/storage";

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
  });
  const [models, setModels] = useState<string[]>(DEFAULT_MODELS.anthropic);
  const [loadingModels, setLoadingModels] = useState(false);

  useEffect(() => {
    const init = loadAiSettings();
    setS(init);
    setModels(DEFAULT_MODELS[init.provider]);
    fetchServerKeys().then(setServerKeys);
  }, []);

  const serverHasForProvider = serverKeys[s.provider];

  // プロバイダ or キーが変わったら、実際に使えるモデル一覧を取得（失敗時は既定値）
  useEffect(() => {
    let alive = true;
    setLoadingModels(true);
    fetchModels(s.provider, s.apiKey).then((list) => {
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
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.provider, s.apiKey, serverKeys.anthropic, serverKeys.gemini]);

  const update = (patch: Partial<AiSettings>) => {
    const next = { ...s, ...patch };
    if (patch.provider) {
      next.model = DEFAULT_MODELS[patch.provider][0];
    }
    setS(next);
  };

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
        <p className="hint" style={{ marginBottom: 16 }}>
          API キーはこのブラウザ（localStorage）にのみ保存され、生成時にサーバー経由で
          各社 API に送られます。
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
                : "AIza..."
            }
            value={s.apiKey}
            onChange={(e) => update({ apiKey: e.target.value })}
          />
          {serverHasForProvider && (
            <p className="hint" style={{ marginTop: 4 }}>
              ✓ サーバー（Vercel 環境変数）にこのプロバイダのキーが設定済みです。ここは空欄のままで生成・編集できます。
            </p>
          )}
        </div>
        <div className="row" style={{ justifyContent: "flex-end", marginTop: 8 }}>
          <button className="btn" onClick={onClose}>
            閉じる
          </button>
          <button
            className="btn btn--primary"
            onClick={() => {
              saveAiSettings(s);
              onClose();
            }}
          >
            保存
          </button>
        </div>
      </div>
    </div>
  );
}
