// Setup type definitions for built-in Supabase Runtime APIs
import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

interface TextToSpeechRequest {
  text: string;
  voiceId?: string;
}

interface JsonError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

const ELEVENLABS_BASE = "https://api.elevenlabs.io/v1/text-to-speech";

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

function getApiKey(): string {
  const key = Deno.env.get("ELEVENLABS_API_KEY")?.trim();
  return key ?? "";
}

function getDefaultVoiceId(): string {
  const id = Deno.env.get("ELEVENLABS_DEFAULT_VOICE_ID")?.trim();
  return id ?? "";
}

async function callElevenLabs(params: {
  text: string;
  voiceId: string;
}): Promise<ArrayBuffer> {
  const { text, voiceId } = params;
  const apiKey = getApiKey();

  if (!apiKey) {
    console.warn("[QuickWit TTS] Missing ELEVENLABS_API_KEY in environment");
    throw new Error("Missing ElevenLabs API key");
  }

  const url = `${ELEVENLABS_BASE}/${encodeURIComponent(voiceId)}`;

  const fetchController = new AbortController();
  const fetchTimeout = setTimeout(() => fetchController.abort(), 15_000);

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      signal: fetchController.signal,
      headers: {
        "Content-Type": "application/json",
        "xi-api-key": apiKey,
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text,
        model_id: "eleven_turbo_v2_5",
      }),
    });
  } finally {
    clearTimeout(fetchTimeout);
  }

  if (!response.ok) {
    const textBody = await response.text().catch(() => "");
    console.error(
      "[QuickWit TTS] ElevenLabs HTTP error:",
      response.status,
      textBody,
    );
    throw new Error(
      `ElevenLabs API error: ${response.status} – ${textBody.slice(0, 120)}`,
    );
  }

  return response.arrayBuffer();
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
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
    const auth = await authenticateRequest(req, "text-to-speech");
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

  let body: TextToSpeechRequest;
  try {
    body = (await req.json()) as TextToSpeechRequest;
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

  const { text, voiceId: requestVoiceId } = body || {};

  if (!text || typeof text !== "string") {
    errors.push("Field 'text' is required and must be a non-empty string.");
  }

  const voiceId = (requestVoiceId && String(requestVoiceId).trim()) ||
    getDefaultVoiceId();

  if (!voiceId) {
    errors.push(
      "Voice ID is required: provide 'voiceId' in the request body or set ELEVENLABS_DEFAULT_VOICE_ID.",
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
    const audioBuffer = await callElevenLabs({
      text: text as string,
      voiceId,
    });
    const audioBase64 = arrayBufferToBase64(audioBuffer);
    return jsonResponse(
      { ok: true, audioBase64 },
      { status: 200 },
    );
  } catch (err) {
    const error: JsonError = {
      code: "tts_error",
      message:
        err instanceof Error ? err.message : "Unexpected error calling ElevenLabs.",
    };
    return jsonResponse({ ok: false, error }, { status: 500 });
  }
});
