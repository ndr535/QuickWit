// Follow this setup guide to integrate the Deno language server with your editor:
// https://deno.land/manual/getting_started/setup_your_environment
// This enables autocomplete, go to definition, etc.

// Setup type definitions for built-in Supabase Runtime APIs
import "@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

interface SpeechToTextRequest {
  // Base64-encoded audio (preferred key from client)
  audio?: string;
  // Format hint: 'wav' | 'm4a' | 'mp3' | 'webm' etc. Mapped to Content-Type.
  format?: string;
  // Legacy keys (still supported)
  audioBase64?: string;
  contentType?: string;
}

interface JsonError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

const DEEPGRAM_URL = "https://api.deepgram.com/v1/listen?model=nova-2";

const corsHeaders: HeadersInit = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With",
};

async function authenticateRequest(
  req: Request,
  _functionName: string,
): Promise<{ isAnonymous: boolean; sub?: string }> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader || typeof authHeader !== "string" || !authHeader.startsWith("Bearer ")) {
    throw jsonResponse(
      { ok: false, error: { code: "unauthorized", message: "Missing Authorization header" } },
      { status: 401 },
    );
  }
  const token = authHeader.slice(7).trim();
  if (!token) {
    throw jsonResponse(
      { ok: false, error: { code: "unauthorized", message: "Missing Authorization header" } },
      { status: 401 },
    );
  }

  const parts = token.split(".");
  if (parts.length < 2) {
    throw jsonResponse(
      { ok: false, error: { code: "unauthorized", message: "Invalid or missing token" } },
      { status: 401 },
    );
  }

  let payload: Record<string, unknown>;
  try {
    const segment = parts[1];
    const base64 = segment.replace(/-/g, "+").replace(/_/g, "/");
    const pad = base64.length % 4;
    const padded = pad === 0 ? base64 : base64 + "=".repeat(4 - pad);
    const decoded = atob(padded);
    payload = JSON.parse(decoded) as Record<string, unknown>;
  } catch {
    throw jsonResponse(
      { ok: false, error: { code: "unauthorized", message: "Invalid or missing token" } },
      { status: 401 },
    );
  }

  if (payload.role === "anon") {
    return { isAnonymous: true };
  }
  if (payload.sub && typeof payload.sub === "string" && payload.sub.trim().length > 0) {
    return { isAnonymous: false, sub: String(payload.sub).trim() };
  }

  throw jsonResponse(
    { ok: false, error: { code: "unauthorized", message: "Invalid or missing token" } },
    { status: 401 },
  );
}

const LIMIT_ANON = 30;
const LIMIT_AUTH = 60;

function getSupabaseAdmin() {
  const url = Deno.env.get("SUPABASE_URL")?.trim();
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim();
  if (!url || !serviceRoleKey) return null;
  return createClient(url, serviceRoleKey);
}

function getRateLimitUserId(
  req: Request,
  isAnonymous: boolean,
  sub?: string,
): string {
  if (!isAnonymous && sub) return sub;
  const cf = req.headers.get("cf-connecting-ip")?.trim();
  const xff = req.headers.get("x-forwarded-for")?.trim();
  const ip = cf || (xff ? xff.split(",")[0]?.trim() : null) || "unknown";
  return "ip:" + ip;
}

async function checkRateLimitAndRecord(
  admin: ReturnType<typeof createClient> | null,
  userId: string,
  isAnonymous: boolean,
): Promise<{ allowed: boolean }> {
  if (!admin) return { allowed: true };
  try {
    const limit = isAnonymous ? LIMIT_ANON : LIMIT_AUTH;
    const since = new Date(Date.now() - 86400 * 1000).toISOString();
    const { count, error: countError } = await admin
      .from("usage_logs")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId)
      .gte("created_at", since);
    if (countError) throw countError;
    const n = typeof count === "number" ? count : 0;
    if (n >= limit) return { allowed: false };
    const { error: insertError } = await admin.from("usage_logs").insert({
      user_id: userId,
      created_at: new Date().toISOString(),
    });
    if (insertError) throw insertError;
    return { allowed: true };
  } catch (_err) {
    return { allowed: true };
  }
}

function jsonResponse(
  body: unknown,
  init: ResponseInit & { status: number },
): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders,
      ...(init.headers || {}),
    },
  });
}

function getDeepgramApiKey(): string {
  const key = Deno.env.get("DEEPGRAM_API_KEY")?.trim();
  return key ?? "";
}

function base64ToUint8Array(base64: string): Uint8Array {
  // Strip any data URL prefix if it was accidentally included
  const cleaned = base64.replace(/^data:.*?;base64,/, "");
  const binary = atob(cleaned);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function callDeepgram(params: {
  audioBase64: string;
  contentType: string;
}): Promise<string> {
  const { audioBase64, contentType } = params;
  const apiKey = getDeepgramApiKey();

  if (!apiKey) {
    console.warn("[QuickWit STT] Missing DEEPGRAM_API_KEY in environment");
    throw new Error("Missing Deepgram API key");
  }

  const audioBytes = base64ToUint8Array(audioBase64);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8_000);

  let response: Response;
  try {
    response = await fetch(DEEPGRAM_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Token ${apiKey}`,
        "Content-Type": contentType,
        Accept: "application/json",
      },
      body: audioBytes,
    });
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    console.error(
      "[QuickWit STT] Deepgram HTTP error:",
      response.status,
      text,
    );
    throw new Error("Deepgram API request failed");
  }

  const data = await response.json();

  // Typical Deepgram response shape: results.channels[0].alternatives[0].transcript
  // An empty string is valid (no speech detected); only throw on unexpected shape.
  let transcript = "";
  try {
    transcript =
      data?.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? "";
  } catch {
    transcript = "";
  }

  if (typeof transcript !== "string") {
    console.error("[QuickWit STT] Unexpected Deepgram response shape:", data);
    throw new Error("Unexpected Deepgram response shape");
  }

  return transcript;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders,
    });
  }

  if (req.method !== "POST") {
    const error: JsonError = {
      code: "method_not_allowed",
      message: "Only POST requests are supported.",
    };
    return jsonResponse({ ok: false, error }, { status: 405 });
  }

  try {
    const auth = await authenticateRequest(req, "speech-to-text");
    const userId = getRateLimitUserId(req, auth.isAnonymous, auth.sub);
    const admin = getSupabaseAdmin();
    const { allowed } = await checkRateLimitAndRecord(
      admin,
      userId,
      auth.isAnonymous,
    );
    if (!allowed) {
      return jsonResponse(
        {
          ok: false,
          error: {
            code: "rate_limited",
            message:
              "Daily limit reached. Upgrade to QuickWit Pro for unlimited sessions.",
          },
        },
        { status: 429 },
      );
    }
  } catch (authResponse) {
    if (authResponse instanceof Response) {
      return authResponse;
    }
    throw authResponse;
  }

  let body: SpeechToTextRequest;
  try {
    body = (await req.json()) as SpeechToTextRequest;
  } catch (_err) {
    const error: JsonError = {
      code: "invalid_json",
      message: "Request body must be valid JSON.",
    };
    return jsonResponse({ ok: false, error }, { status: 400 });
  }

  const errors: string[] = [];

  if (!body || typeof body !== "object") {
    errors.push("Request body must be a JSON object.");
  }

  const { audio, format, audioBase64: legacyBase64, contentType: legacyContentType } = body || {};
  const audioBase64 = (typeof audio === "string" && audio) ? audio : legacyBase64;
  let contentType = typeof legacyContentType === "string" && legacyContentType ? legacyContentType : "";
  if (!contentType && typeof format === "string" && format) {
    const formatMap: Record<string, string> = {
      wav: "audio/wav",
      m4a: "audio/m4a",
      mp3: "audio/mpeg",
      mpeg: "audio/mpeg",
      webm: "audio/webm",
    };
    contentType = formatMap[format.toLowerCase()] || `audio/${format}`;
  }

  if (!audioBase64 || typeof audioBase64 !== "string") {
    errors.push(
      "Either 'audio' or 'audioBase64' is required and must be a base64 string.",
    );
  }

  if (!contentType) {
    errors.push(
      "Either 'format' (e.g. 'wav', 'm4a') or 'contentType' (e.g. 'audio/wav') is required.",
    );
  }

  if (errors.length > 0) {
    const error: JsonError = {
      code: "bad_request",
      message: "Invalid request.",
      details: { errors },
    };
    return jsonResponse({ ok: false, error }, { status: 400 });
  }

  try {
    const transcript = await callDeepgram({ audioBase64, contentType });
    return jsonResponse(
      { ok: true, transcript },
      { status: 200 },
    );
  } catch (err) {
    const error: JsonError = {
      code: "stt_error",
      message:
        err instanceof Error ? err.message : "Unexpected error calling Deepgram.",
    };
    return jsonResponse({ ok: false, error }, { status: 500 });
  }
});
