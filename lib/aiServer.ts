// ============================================================================
// サーバー側 AI 呼び出し（BYOK）。Anthropic / Gemini を抽象化。
// callModel  : 非ストリーム（/api/edit 用）
// streamModel: ストリーム（/api/generate 用）— Edge Runtime + SSE でタイムアウト回避
// ※ このファイルはサーバー専用（API キーをクライアントへ晒さない）。
// ============================================================================

export type Provider = "anthropic" | "gemini";

export type ImagePart = { mediaType: string; data: string }; // data は base64（接頭辞なし）
export type PdfPart = { data: string }; // application/pdf の base64（接頭辞なし）

export type CallInput = {
  provider: Provider;
  apiKey: string;
  model: string;
  system: string;
  user: string;
  image?: ImagePart | null;
  pdf?: PdfPart | null;
};

// ── 非ストリーム（edit 用） ────────────────────────────────────────────────

export async function callModel(input: CallInput): Promise<string> {
  if (input.provider === "anthropic") return callAnthropic(input);
  return callGemini(input);
}

async function callAnthropic({ apiKey, model, system, user, image, pdf }: CallInput): Promise<string> {
  const content: any[] = [];
  if (pdf) content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: pdf.data } });
  if (image) content.push({ type: "image", source: { type: "base64", media_type: image.mediaType, data: image.data } });
  content.push({ type: "text", text: user });

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model, max_tokens: 8000, system, messages: [{ role: "user", content }] }),
  });
  if (!res.ok) { const t = await res.text(); throw new Error(`Anthropic API ${res.status}: ${t.slice(0, 400)}`); }
  const data = await res.json();
  const text = (data.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
  if (!text) throw new Error("Anthropic: 空のレスポンス");
  return text;
}

// Gemini 2.5 以降は「思考トークン」も maxOutputTokens から消費するため、上限が小さいと
// 思考だけで枯渇して実出力が途中で切れる（blocks が空になる等）。2.5/3 系は 65,536 まで
// 対応しているので余裕を持たせ、旧モデル（2.0 系の上限 8,192）はそのまま。
function geminiMaxOutputTokens(model: string): number {
  return /gemini-(2\.5|[3-9])/.test(model) ? 32768 : 8192;
}

const GEMINI_TRUNCATED_MSG =
  "出力がトークン上限（MAX_TOKENS）で途切れました。もう一度生成するか、指示・範囲を分割してください。";

async function callGemini({ apiKey, model, system, user, image, pdf }: CallInput): Promise<string> {
  const parts: any[] = [];
  if (pdf) parts.push({ inline_data: { mime_type: "application/pdf", data: pdf.data } });
  if (image) parts.push({ inline_data: { mime_type: image.mediaType, data: image.data } });
  parts.push({ text: user });
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts }],
      generationConfig: { temperature: 0.2, maxOutputTokens: geminiMaxOutputTokens(model), responseMimeType: "application/json" },
    }),
  });
  if (!res.ok) { const t = await res.text(); throw new Error(`Gemini API ${res.status}: ${t.slice(0, 400)}`); }
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text ?? "").join("") ?? "";
  if (data?.candidates?.[0]?.finishReason === "MAX_TOKENS") throw new Error(`Gemini: ${GEMINI_TRUNCATED_MSG}`);
  if (!text) throw new Error("Gemini: 空のレスポンス");
  return text;
}

// ── ストリーム（generate 用）────────────────────────────────────────────────
// Edge Runtime で SSE ストリームを返すことで Vercel の関数上限を回避する。
// I/O 待ち（AI API からのトークン受信）は CPU 時間としてカウントされないため
// 長い生成でも接続が維持される。

export async function streamModel(input: CallInput): Promise<AsyncIterable<string>> {
  if (input.provider === "anthropic") return streamAnthropic(input);
  return streamGemini(input);
}

async function* streamAnthropic({ apiKey, model, system, user, image, pdf }: CallInput): AsyncIterable<string> {
  const content: any[] = [];
  if (pdf) content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: pdf.data } });
  if (image) content.push({ type: "image", source: { type: "base64", media_type: image.mediaType, data: image.data } });
  content.push({ type: "text", text: user });

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model, max_tokens: 8000, stream: true, system, messages: [{ role: "user", content }] }),
  });
  if (!res.ok) { const t = await res.text(); throw new Error(`Anthropic API ${res.status}: ${t.slice(0, 400)}`); }

  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const raw = line.slice(6).trim();
        if (raw === "[DONE]") return;
        try {
          const evt = JSON.parse(raw);
          if (evt.type === "content_block_delta" && evt.delta?.type === "text_delta") yield evt.delta.text;
        } catch { /* malformed line, skip */ }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

async function* streamGemini({ apiKey, model, system, user, image, pdf }: CallInput): AsyncIterable<string> {
  const parts: any[] = [];
  if (pdf) parts.push({ inline_data: { mime_type: "application/pdf", data: pdf.data } });
  if (image) parts.push({ inline_data: { mime_type: image.mediaType, data: image.data } });
  parts.push({ text: user });

  // alt=sse → Server-Sent Events 形式で返る（Gemini のストリーミング）
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?key=${encodeURIComponent(apiKey)}&alt=sse`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts }],
      generationConfig: { temperature: 0.2, maxOutputTokens: geminiMaxOutputTokens(model), responseMimeType: "application/json" },
    }),
  });
  if (!res.ok) { const t = await res.text(); throw new Error(`Gemini API ${res.status}: ${t.slice(0, 400)}`); }

  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let finishReason = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        try {
          const evt = JSON.parse(line.slice(6));
          if (evt?.candidates?.[0]?.finishReason) finishReason = evt.candidates[0].finishReason;
          const text = evt?.candidates?.[0]?.content?.parts?.map((p: any) => p.text ?? "").join("") ?? "";
          if (text) yield text;
        } catch { /* malformed line, skip */ }
      }
    }
  } finally {
    reader.releaseLock();
  }
  // 途中で切れた出力を黙って修復にかけると「blocks が空の教材」など不可解な結果になる。
  // 明確なエラーとして伝え、ユーザーに再生成を促す。
  if (finishReason === "MAX_TOKENS") throw new Error(`Gemini: ${GEMINI_TRUNCATED_MSG}`);
}
