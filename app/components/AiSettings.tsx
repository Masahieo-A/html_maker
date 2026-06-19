"use client";
import React, { useEffect, useState } from "react";
import {
  AiSettings,
  DEFAULT_MODELS,
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

  useEffect(() => {
    setS(loadAiSettings());
  }, []);

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
          <label>モデル</label>
          <select
            className="select"
            value={s.model}
            onChange={(e) => update({ model: e.target.value })}
          >
            {DEFAULT_MODELS[s.provider].map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>API キー</label>
          <input
            className="input"
            type="password"
            placeholder={s.provider === "anthropic" ? "sk-ant-..." : "AIza..."}
            value={s.apiKey}
            onChange={(e) => update({ apiKey: e.target.value })}
          />
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
