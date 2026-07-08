import { NextRequest, NextResponse } from "next/server";
import type { Provider } from "@/lib/aiServer";
import { checkAccess } from "@/lib/apiGuard";

export const runtime = "nodejs";

// プロバイダの「実際に使えるモデル一覧」をキーで取得する。
// モデル名は時々変わる（旧名は404）ため、ハードコードに頼らず動的に列挙する。
export async function POST(req: NextRequest) {
  const denied = checkAccess(req);
  if (denied) return NextResponse.json({ models: [], error: denied.error }, { status: denied.status });
  let body: { provider: Provider; apiKey?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ models: [], error: "不正なリクエスト" }, { status: 400 });
  }
  const provider = body.provider;
  const envKey =
    provider === "gemini" ? process.env.GEMINI_API_KEY : process.env.ANTHROPIC_API_KEY;
  const apiKey = body.apiKey || envKey || "";
  if (!apiKey) return NextResponse.json({ models: [] });

  try {
    if (provider === "gemini") {
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(
          apiKey
        )}&pageSize=200`
      );
      if (!r.ok) {
        // 接続テスト（AiSettings）が 401/403/429 を判別できるよう、
        // 上流の HTTP ステータスをそのままレスポンスのステータスにも反映する。
        const t = await r.text();
        return NextResponse.json({ models: [], error: t.slice(0, 200) }, { status: r.status });
      }
      const data = await r.json();
      const models: string[] = (data.models ?? [])
        .filter((m: any) =>
          (m.supportedGenerationMethods ?? []).includes("generateContent")
        )
        .map((m: any) => String(m.name).replace(/^models\//, ""))
        .filter(
          (id: string) =>
            id.startsWith("gemini") &&
            !id.includes("embedding") &&
            !id.includes("aqa")
        );
      return NextResponse.json({ models: dedupeSort(models) });
    } else {
      const r = await fetch("https://api.anthropic.com/v1/models?limit=100", {
        headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      });
      if (!r.ok) {
        const t = await r.text();
        return NextResponse.json({ models: [], error: t.slice(0, 200) }, { status: r.status });
      }
      const data = await r.json();
      const models: string[] = (data.data ?? []).map((m: any) => String(m.id));
      return NextResponse.json({ models: dedupeSort(models) });
    }
  } catch (e: any) {
    return NextResponse.json({ models: [], error: e?.message ?? "取得失敗" }, { status: 502 });
  }
}

function dedupeSort(arr: string[]): string[] {
  return Array.from(new Set(arr)).sort();
}
