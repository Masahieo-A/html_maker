// ============================================================================
// サーバー側 AI 呼び出し（BYOK）。Anthropic / Gemini を抽象化。
// 生成・部分編集とも「JSON のみ返す」をシステムプロンプトで強制（要件 §5.1/§7）。
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

export async function callModel(input: CallInput): Promise<string> {
  if (input.provider === "anthropic") return callAnthropic(input);
  return callGemini(input);
}

// Vercel無料枠の関数上限(60秒)より前にこちらで打ち切り、平文の504ではなく
// 分かりやすいエラーを投げる。
async function fetchWithTimeout(
  url: string,
  opts: RequestInit,
  ms = 45000
): Promise<Response> {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } catch (e: any) {
    if (e?.name === "AbortError") {
      throw new Error(
        "モデルの応答が時間切れになりました（約45秒・無料枠の上限）。⚙AI設定で高速モデル（gemini-2.5-flash / claude-haiku-4-5）に切り替えるか、対象範囲を1〜2文に絞ってお試しください。"
      );
    }
    throw e;
  } finally {
    clearTimeout(id);
  }
}

async function callAnthropic({
  apiKey,
  model,
  system,
  user,
  image,
  pdf,
}: CallInput): Promise<string> {
  const content: any[] = [];
  if (pdf) {
    content.push({
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data: pdf.data },
    });
  }
  if (image) {
    content.push({
      type: "image",
      source: { type: "base64", media_type: image.mediaType, data: image.data },
    });
  }
  content.push({ type: "text", text: user });

  const res = await fetchWithTimeout("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 8000,
      system,
      messages: [{ role: "user", content }],
    }),
  });

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Anthropic API ${res.status}: ${t.slice(0, 400)}`);
  }
  const data = await res.json();
  const text = (data.content ?? [])
    .filter((b: any) => b.type === "text")
    .map((b: any) => b.text)
    .join("");
  if (!text) throw new Error("Anthropic: 空のレスポンス");
  return text;
}

async function callGemini({
  apiKey,
  model,
  system,
  user,
  image,
  pdf,
}: CallInput): Promise<string> {
  const parts: any[] = [];
  if (pdf) {
    parts.push({ inline_data: { mime_type: "application/pdf", data: pdf.data } });
  }
  if (image) {
    parts.push({ inline_data: { mime_type: image.mediaType, data: image.data } });
  }
  parts.push({ text: user });
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model
  )}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const res = await fetchWithTimeout(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts }],
      generationConfig: { temperature: 0.4, maxOutputTokens: 8000 },
    }),
  });

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Gemini API ${res.status}: ${t.slice(0, 400)}`);
  }
  const data = await res.json();
  const text =
    data?.candidates?.[0]?.content?.parts
      ?.map((p: any) => p.text ?? "")
      .join("") ?? "";
  if (!text) throw new Error("Gemini: 空のレスポンス");
  return text;
}
