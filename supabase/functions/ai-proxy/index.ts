// Setup type definitions for built-in Supabase Runtime APIs
import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type Action = "generatePrompt" | "evaluateResponse" | "yesAndResponse" | "generateSpeedRoundsQuestions" | "generateExampleResponse" | "generateHecklerScenario";

interface AiProxyRequest {
  action: Action;
  exerciseType?: string;
  difficulty?: string;
  prompt?: string;
  usedScenarios?: string[];
  userResponse?: string;
  conversationHistory?: unknown[];
  difficulty?: string;
  persona?: string;
}

interface JsonError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

const API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-4-20250514";
const REQUEST_TIMEOUT_MS = 25_000;

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

function getApiKeyFromEnv(): string {
  const key = Deno.env.get("ANTHROPIC_API_KEY")?.trim();
  return key ?? "";
}

function getSupabaseAdmin() {
  const url = Deno.env.get("SUPABASE_URL")?.trim();
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim();
  if (!url || !serviceRoleKey) {
    return null;
  }
  return createClient(url, serviceRoleKey);
}

function normalizeExerciseTypeForCache(exerciseType: string): string | null {
  const t = (exerciseType || "").toLowerCase().replace(/-/g, "");
  if (t === "quickdraw") return "quickDraw";
  if (t === "hottake") return "hotTake";
  if (t === "reframe") return "reframe";
  return null;
}

function normalizeDifficultyForCache(difficulty: string): string {
  const d = (difficulty || "everyday").toLowerCase().trim();
  if (d === "weird" || d === "unhinged") return d;
  return "everyday";
}

async function callClaude(params: {
  system: string;
  userContent: string;
  maxTokens: number;
  temperature?: number;
}): Promise<string> {
  const { system, userContent, maxTokens, temperature = 0.8 } = params;
  const apiKey = getApiKeyFromEnv();

  if (!apiKey) {
    console.warn("[QuickWit AI] Missing ANTHROPIC_API_KEY in environment");
    throw new Error("Missing Anthropic API key");
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(API_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: maxTokens,
        system,
        temperature,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: userContent,
              },
            ],
          },
        ],
      }),
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const text = await response.text();
      console.error(
        "[QuickWit AI] Anthropic HTTP error:",
        response.status,
        text,
      );
      throw new Error("Anthropic API request failed");
    }

    const data = await response.json();

    if (
      !data ||
      !data.content ||
      !Array.isArray(data.content) ||
      !data.content[0] ||
      data.content[0].type !== "text"
    ) {
      console.error(
        "[QuickWit AI] Unexpected Anthropic response shape:",
        data,
      );
      throw new Error("Unexpected Anthropic response shape");
    }

    return data.content[0].text as string;
  } catch (error) {
    clearTimeout(timeoutId);
    console.error("[QuickWit AI] Error calling Claude:", error);
    throw error instanceof Error ? error : new Error("Unknown Claude error");
  }
}

function buildCoachSystemPrompt(): string {
  return [
    "You are QuickWit, an enthusiastic improv and wit coach.",
    "You help users practice quick thinking, playful absurdity, and positive reframing.",
    "Always keep tone: supportive, energetic, and encouraging, never harsh.",
    "Use concise, vivid language. Avoid long paragraphs.",
    "Assume the user is on a mobile device in a short practice session.",
  ].join(" ");
}

// Shared guidance so scenarios don't all happen in the same few places.
const SCENARIO_VARIETY_INSTRUCTION =
  "When you invent situations or settings, pull them randomly from a wide variety of real-life social contexts, including but not limited to: first dates and asking someone out, receiving an unexpected compliment, approaching a stranger on the street about something they are wearing, grocery store checkout lines, elevator small talk with a neighbor, running into an ex unexpectedly, being set up on a blind date, getting caught doing something embarrassing in public, a stranger sitting next to you on a plane who will not stop talking, someone cutting in line, being recognised by a fan or someone who knows your work, a job interview going sideways, meeting a partner’s parents for the first time, being the only person who does not know anyone at a party, and a street performer pulling you into their act. Avoid defaulting to offices or coffee shops; vary locations and social dynamics. Within a single session, never repeat the exact same setting.";

async function handleGeneratePrompt(params: {
  exerciseType: string;
  difficulty?: string;
}): Promise<{ prompt: string }> {
  const { exerciseType, difficulty } = params;

  const difficultyInstructions: Record<string, string> = {
    everyday:
      "SCENARIO TONE: Grounded and realistic. Use relatable situations: workplace, social awkwardness, everyday conversations. Nothing surreal or absurd.",
    weird:
      "SCENARIO TONE: Mildly absurd. Normal situations with unexpected twists, odd but recognizable. Escalate the weirdness slightly, not full chaos.",
    unhinged:
      "SCENARIO TONE: Fully outlandish and surreal. Anything goes — rubber duck territory, nothing has to make sense. Maximum absurdity.",
  };

  const selectedDifficulty =
    (difficulty || "everyday").toLowerCase() in difficultyInstructions
      ? (difficulty || "everyday").toLowerCase()
      : "everyday";

  const difficultyLine =
    difficultyInstructions[selectedDifficulty] ||
    difficultyInstructions.everyday;

  const system = [
    buildCoachSystemPrompt(),
    "You are generating a single prompt for an improv exercise.",
    "The prompt should be 1–3 sentences, specific, and fun.",
    difficultyLine,
  ].join(" ");

  const normalizedType = (exerciseType || "").toLowerCase();

  let typeInstructions = "";

  if (normalizedType === "quickdraw" || normalizedType === "quick-draw") {
    typeInstructions =
      "Exercise type: Quick Draw. Create a random social, high-energy, or absurd scenario that demands a fast verbal response. The user will have only a few seconds to react out loud. " +
      SCENARIO_VARIETY_INSTRUCTION;
  } else if (
    normalizedType === "speedrounds" || normalizedType === "speed-rounds"
  ) {
    typeInstructions =
      "Exercise type: Speed Rounds. Generate one rapid-fire question that can be answered in under 8 seconds — unexpected, absurd, or comedic. Used as a placeholder only.";
  } else if (normalizedType === "hottake" || normalizedType === "hot-take") {
    typeInstructions =
      'Exercise type: Hot Take. Return ONLY a single short mundane or random topic word or phrase for the user to give a bold opinion on. Examples: "escalators", "the word moist", "Mondays", "ice in drinks", "small talk", "reply-all emails". Keep it to 1–4 words. No explanation, no sentence, just the topic. Pick something fresh and unexpected.';
  } else if (normalizedType === "reframe") {
    typeInstructions =
      "Exercise type: Reframe. Describe a negative, awkward, or mildly frustrating situation that can be humorously or positively reframed. " +
      SCENARIO_VARIETY_INSTRUCTION;
  } else if (normalizedType === "daily") {
    typeInstructions =
      "Exercise type: Daily Session. Create a random, fun improv prompt — often a Quick Draw style fast reaction or a Reframe style flip of a situation. Keep it to 1–3 sentences. " +
      SCENARIO_VARIETY_INSTRUCTION;
  } else {
    typeInstructions =
      "Exercise type: Unknown. Create a playful, open-ended improv challenge that invites a short spoken response.";
  }

  const userContent = [
    typeInstructions,
    "",
    "Return only the prompt text that should be shown to the user.",
    "Do not add labels, explanations, or quotes around it.",
  ].join("\n");

  const prompt = (await callClaude({
    system,
    userContent,
    maxTokens: 160,
  })).trim();

  return { prompt };
}

async function getGeneratePromptResult(params: {
  exerciseType: string;
  difficulty?: string;
}): Promise<{ prompt: string }> {
  const { exerciseType, difficulty } = params;
  const normalizedExerciseType = normalizeExerciseTypeForCache(exerciseType);
  const normalizedDifficulty = normalizeDifficultyForCache(difficulty || "everyday");

  const admin = getSupabaseAdmin();
  if (admin && normalizedExerciseType) {
    const { data: rows, error: selectError } = await admin
      .from("prompt_cache")
      .select("id, prompt_text, used_count")
      .eq("exercise_type", normalizedExerciseType)
      .eq("difficulty", normalizedDifficulty)
      .limit(100);

    if (!selectError && rows && rows.length > 0) {
      const row = rows[Math.floor(Math.random() * rows.length)];
      const promptText = row?.prompt_text;
      const id = row?.id;
      if (promptText && id != null) {
        const currentUsed = typeof row?.used_count === "number" ? row.used_count : 0;
        await admin
          .from("prompt_cache")
          .update({ used_count: currentUsed + 1 })
          .eq("id", id);
        return { prompt: String(promptText).trim() };
      }
    }
  }

  const result = await handleGeneratePrompt({
    exerciseType,
    difficulty,
  });
  if (admin && normalizedExerciseType) {
    await admin.from("prompt_cache").insert({
      exercise_type: normalizedExerciseType,
      difficulty: normalizedDifficulty,
      prompt_text: result.prompt,
      used_count: 1,
    }).then(() => {}).catch(() => {});
  }
  return result;
}

async function handleEvaluateResponse(params: {
  exerciseType: string;
  prompt: string;
  userResponse: string;
}): Promise<{
  overallScore: number;
  speedScore: number;
  creativityScore: number;
  relevanceScore: number;
  coachFeedback: string;
  highlights: string[];
}> {
  const { exerciseType, prompt, userResponse } = params;
  const normalizedType = (exerciseType || "").toLowerCase();

  let system = [
    buildCoachSystemPrompt(),
    "Now you are evaluating a short spoken improv response.",
    "You will score speed, creativity, and relevance from 0–100 and give very short, concrete coaching.",
    "Be generous but honest; focus on growth and specific suggestions.",
  ].join(" ");

  let evalInstructions = "";

  if (normalizedType === "quickdraw" || normalizedType === "quick-draw") {
    system = [
      buildCoachSystemPrompt(),
      "You are evaluating a Quick Draw session — 5 rapid-fire scenarios where the user had only 5 seconds to respond out loud.",
      'The "prompt" field contains all 5 scenarios and the user\'s responses, formatted as Q1: ... / A1: ... pairs.',
      "speedScore: how quickly and decisively they responded (no hedging, no long pauses implied by short answers).",
      "creativityScore: originality, surprise, and wit across all 5 responses.",
      "relevanceScore: how well each response addressed the specific scenario.",
      "Penalise non-responses: each blank or \"(no response)\" reduces overall score by 8 points.",
      "Be enthusiastic but honest. Keep coachFeedback to 2–3 punchy sentences.",
    ].join(" ");
    evalInstructions =
      "Evaluate all 5 Quick Draw Q&A pairs together. The user had 5 seconds per scenario — reward fast, instinctive, committed answers. Call out the best and weakest response specifically.";
  } else if (
    normalizedType === "speedrounds" || normalizedType === "speed-rounds"
  ) {
    system = [
      buildCoachSystemPrompt(),
      "You are evaluating a Speed Rounds session — a rapid-fire game show where the user had 8 seconds per question.",
      'The "prompt" field contains all 5 questions and the user\'s responses, formatted as Q1: ... / A1: ... pairs.',
      "Score on: wit and cleverness (speedScore), variety across the 5 answers (creativityScore), and overall sharpness (relevanceScore).",
      "Penalise non-responses: each blank or \"(no response)\" answer reduces the overall score by 12 points.",
      "Be enthusiastic but honest. Keep coachFeedback to 2–3 punchy sentences.",
    ].join(" ");
    evalInstructions =
      "Evaluate all 5 Speed Round Q&A pairs together. Reward fast, sharp, funny answers. Penalise missing responses. The user had only 8 seconds per question, so brevity is fine — wit is what matters.";
  } else if (normalizedType === "hottake" || normalizedType === "hot-take") {
    system = [
      buildCoachSystemPrompt(),
      "You are evaluating a Hot Take session where the user delivered opinions on mundane topics.",
      'CRITICAL scoring rules: heavily penalise hedging words and phrases ("maybe", "I think", "kind of", "sort of", "I guess", "I feel like", "probably", "I don\'t know").',
      "Reward: confident delivery, specific details, unexpected angles, clear point of view.",
      "speedScore reflects how quickly the user committed (less hedging = higher).",
      "creativityScore reflects how unexpected or original the take is.",
      "relevanceScore reflects how directly and specifically they addressed the topic.",
      "A vague, wishy-washy answer should score no higher than 50 in any category.",
    ].join(" ");
    evalInstructions =
      "Evaluate all Hot Take responses together. Count and call out any hedging language. Reward strong, specific opinions. Penalise fence-sitting. The user had 5 topics — comment on the most and least confident takes.";
  } else if (normalizedType === "heckler") {
    system = [
      buildCoachSystemPrompt(),
      "You are evaluating a Heckler session. In each round, the user started speaking in response to a scenario, was interrupted by a sharp heckle, and then delivered a recovery response.",
      'The "prompt" field contains all 3 rounds with their scenarios and heckles. The "user response" field contains only the user\'s recovery responses, one per round.',
      "SpeedScore reflects how quickly and cleanly they recovered after the interruption (less flustered rambling = higher).",
      "CreativityScore reflects how witty, surprising, or playful the recoveries are.",
      "RelevanceScore reflects how well they acknowledge the heckle and then redirect back to a clear, confident point.",
      "Penalise flustered, defensive, or hostile recoveries. Reward composure, humour, and confident redirection.",
    ].join(" ");
    evalInstructions =
      "Evaluate the 3 Heckler recoveries together. For each round, imagine the heckle landing in the room and ask: did the recovery defuse the moment, acknowledge the heckle, and steer things back on track? Call out the strongest recovery and any moments where the user got stuck or defensive.";
  }

  const userContent = [
    `Exercise type: ${normalizedType || "unknown"}`,
    evalInstructions ? `${evalInstructions}\n` : "",
    "Prompt shown to the user:",
    prompt || "(none)",
    "",
    "User response (transcribed):",
    userResponse || "(none)",
    "",
    "Evaluate the response and return STRICT JSON with this exact shape and key order:",
    "{",
    '  "overallScore": number,',
    '  "speedScore": number,',
    '  "creativityScore": number,',
    '  "relevanceScore": number,',
    '  "coachFeedback": string,',
    '  "highlights": string[]',
    "}",
    "",
    "Rules:",
    "- All scores are integers from 0 to 100.",
    '- "coachFeedback" is 2–3 short sentences of coaching.',
    '- "highlights" is an array of specific phrases or moves the user did well.',
    "- Do NOT include any text before or after the JSON. Only output JSON.",
  ].join("\n");

  const fallback = {
    overallScore: 70,
    speedScore: 70,
    creativityScore: 70,
    relevanceScore: 70,
    coachFeedback:
      "Nice work jumping into the scene. Focus on building one clear, specific idea and heightening it with one extra playful detail.",
    highlights: [] as string[],
  };

  const raw = await callClaude({
    system,
    userContent,
    maxTokens: 320,
  });

  try {
    const parsed = JSON.parse(raw);

    return {
      overallScore:
        typeof parsed.overallScore === "number"
          ? parsed.overallScore
          : fallback.overallScore,
      speedScore:
        typeof parsed.speedScore === "number"
          ? parsed.speedScore
          : fallback.speedScore,
      creativityScore:
        typeof parsed.creativityScore === "number"
          ? parsed.creativityScore
          : fallback.creativityScore,
      relevanceScore:
        typeof parsed.relevanceScore === "number"
          ? parsed.relevanceScore
          : fallback.relevanceScore,
      coachFeedback:
        typeof parsed.coachFeedback === "string" &&
        parsed.coachFeedback.length
          ? parsed.coachFeedback
          : fallback.coachFeedback,
      highlights: Array.isArray(parsed.highlights)
        ? parsed.highlights.map((item: unknown) => String(item))
        : fallback.highlights,
    };
  } catch (parseError) {
    console.error(
      "[QuickWit AI] Failed to parse evaluation JSON:",
      parseError,
    );
    return fallback;
  }
}

async function handleYesAndResponse(params: {
  exerciseType: string;
  prompt: string;
  userResponse: string;
  conversationHistory?: unknown[];
  difficulty?: string;
  persona?: string;
}): Promise<{ response: string }> {
  const {
    exerciseType,
    prompt,
    userResponse,
    conversationHistory,
    difficulty,
    persona,
  } = params;

  const normalizedType = (exerciseType || "").toLowerCase();

  const systemParts = [
    buildCoachSystemPrompt(),
    'You are helping the user practice classic improv "yes, and" responses.',
    "Your job is to build positively on what has already been established, adding one clear, playful beat without negating prior offers.",
  ];

  if (persona && persona.trim()) {
    systemParts.push(
      `The user has chosen this persona or style; lean into it without breaking character: "${persona.trim()}".`,
    );
  }

  if (difficulty && difficulty.trim()) {
    systemParts.push(
      `Difficulty preference: ${difficulty.trim()} (adjust how weird or grounded the escalation is, but keep it fun and supportive).`,
    );
  }

  const system = systemParts.join(" ");

  const historyBlock = Array.isArray(conversationHistory) &&
      conversationHistory.length > 0
    ? JSON.stringify(conversationHistory)
    : "(no additional conversation history provided)";

  const userContent = [
    `Exercise type: ${normalizedType || "unknown"}`,
    "",
    "Original prompt or scenario the user responded to:",
    prompt || "(none)",
    "",
    "User's latest response:",
    userResponse || "(none)",
    "",
    "Conversation history (if any), as a JSON blob:",
    historyBlock,
    "",
    "Your task:",
    '- Suggest a single short line the user could say next that genuinely "yes-ands" what already exists.',
    "- Do not contradict the prompt or their last line.",
    "- Add one clear new idea, emotion, or detail that moves the situation forward.",
    "",
    "Return ONLY the line they might say next. No quotes, no labels, no explanation.",
  ].join("\n");

  const text = await callClaude({
    system,
    userContent,
    maxTokens: 120,
  });

  return { response: (text || "").trim() };
}

async function handleGenerateSpeedRoundsQuestions(params: {
  difficulty?: string;
}): Promise<{ questions: string[] }> {
  const difficulty = (params.difficulty || "everyday").toLowerCase();
  const difficultyInstructions: Record<string, string> = {
    everyday: "Keep questions grounded: relatable scenarios, workplace situations, everyday absurdities.",
    weird: "Make questions mildly absurd — normal premises with unexpected twists.",
    unhinged: "Fully surreal, nothing needs to make sense. Maximum absurdity.",
  };
  const difficultyLine = difficultyInstructions[difficulty] || difficultyInstructions.everyday;

  const system = [
    buildCoachSystemPrompt(),
    "You are a rapid-fire game show host generating quick-answer questions.",
    "Each question must be answerable in under 8 seconds with a funny or clever response.",
    'Questions should be varied — mix hypotheticals, "what would you say", naming challenges, and absurd scenarios across many different real-life settings (not only offices or coffee shops).',
    "Across the full list of 5 questions, avoid reusing the same underlying setting or social situation more than once.",
    difficultyLine,
  ].join(" ");

  const userContent = [
    "Generate exactly 5 rapid-fire questions for Speed Rounds.",
    "Return ONLY a JSON array of 5 strings. No numbering, no labels, no explanation.",
    'Example format: ["Question one?", "Question two?", ...]',
  ].join("\n");

  const raw = await callClaude({ system, userContent, maxTokens: 600 });
  const match = raw.match(/\[[\s\S]*\]/);
  if (match) {
    const parsed = JSON.parse(match[0]);
    if (Array.isArray(parsed) && parsed.length >= 5) {
      return { questions: parsed.slice(0, 5).map((q: unknown) => String(q).trim()) };
    }
  }
  throw new Error("Could not parse speed rounds questions");
}

async function handleGenerateExampleResponse(params: {
  exerciseType: string;
  prompt: string;
}): Promise<{ example: string }> {
  const normalizedType = (params.exerciseType || "").toLowerCase();
  const system = [
    buildCoachSystemPrompt(),
    "You are generating a single example of a strong improv response.",
    "The example should be what a skilled improviser might say — quick, creative, and on-topic.",
    "Write in first person as if you are the performer. Keep it to 1–3 sentences. Do not add labels or meta-commentary.",
  ].join(" ");

  let typeHint = "improv";
  if (normalizedType === "quickdraw" || normalizedType === "quick-draw") {
    typeHint = "Quick Draw: fast, instinctive verbal reaction to a scenario";
  } else if (normalizedType === "speedrounds" || normalizedType === "speed-rounds") {
    typeHint = "Speed Rounds: a sharp, witty one-liner answer to a rapid-fire question (under 8 seconds worth of speaking)";
  } else if (normalizedType === "hottake" || normalizedType === "hot-take") {
    typeHint = 'Hot Take: a bold, confident, specific opinion on a mundane topic — no hedging, no "I think maybe", just a strong direct take';
  } else if (normalizedType === "heckler") {
    typeHint = "Heckler: a composed, witty recovery after being interrupted by a sharp heckle";
  } else if (normalizedType === "reframe") {
    typeHint = "Reframe: turning a negative situation into something funny or positive";
  } else if (normalizedType === "daily") {
    typeHint = "Daily: a quick, witty improv response";
  }

  const userContent = [
    `Exercise type: ${typeHint}`,
    "",
    "Prompt the user saw:",
    params.prompt || "(none)",
    "",
    'Return ONLY the example response text — no quotes, no "Example:", no explanation.',
  ].join("\n");

  const text = await callClaude({ system, userContent, maxTokens: 200 });
  return { example: (text || "").trim() };
}

async function handleGenerateHecklerScenario(params: {
  usedScenarios?: string[];
}): Promise<{ scenario: string; heckle: string }> {
  const usedScenariosList = (params.usedScenarios || []).join("; ");

  const system = [
    buildCoachSystemPrompt(),
    "You are designing a single round of the Heckler exercise.",
    "In this game, the user starts speaking in response to a scenario, gets interrupted by a sharp heckle, and then delivers a recovery response.",
    "The scenario should be 1–2 sentences, high-stakes or socially awkward, where being interrupted would be challenging (for example: pitching a product to sceptical executives, giving a wedding toast that is going badly, or doing stand-up when the crowd is cold).",
    SCENARIO_VARIETY_INSTRUCTION,
    usedScenariosList
      ? ` In this particular session, do NOT reuse any of these scenarios or settings that have already been used: ${usedScenariosList}.`
      : "",
  ].join(" ");

  const userContent = [
    "Return STRICT JSON with this exact shape:",
    "{",
    '  "scenario": string, // 1–2 sentences describing what the user is doing when they get interrupted',
    '  "heckle": string   // one short line an audience member might say to interrupt them',
    "}",
    "",
    "Rules:",
    '- The heckle should feel like a real person pushing back, sceptical, or impatient (for example: "That sounds incredibly expensive, why would we ever pay for that?" or "Can you get to the point?").',
    "- Do not add any labels, commentary, or extra fields.",
  ].join("\n");

  const raw = await callClaude({ system, userContent, maxTokens: 260 });
  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const jsonMatch = raw && raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      parsed = JSON.parse(jsonMatch[0]);
    }
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Heckler JSON not parsed");
  }
  return {
    scenario: (parsed.scenario && String(parsed.scenario).trim()) || "",
    heckle: (parsed.heckle && String(parsed.heckle).trim()) || "",
  };
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
    const auth = await authenticateRequest(req, "ai-proxy");
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

  let body: AiProxyRequest;
  try {
    body = (await req.json()) as AiProxyRequest;
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

  const { action, exerciseType, prompt, userResponse } = body || {};

  if (!action || typeof action !== "string") {
    errors.push("Field 'action' is required and must be a string.");
  } else if (
    action !== "generatePrompt" &&
    action !== "evaluateResponse" &&
    action !== "yesAndResponse" &&
    action !== "generateSpeedRoundsQuestions" &&
    action !== "generateExampleResponse" &&
    action !== "generateHecklerScenario"
  ) {
    errors.push(
      "Field 'action' must be one of: 'generatePrompt', 'evaluateResponse', 'yesAndResponse', 'generateSpeedRoundsQuestions', 'generateExampleResponse', 'generateHecklerScenario'.",
    );
  }

  if (action === "generatePrompt" || action === "evaluateResponse" ||
    action === "yesAndResponse" || action === "generateExampleResponse") {
    if (!exerciseType || typeof exerciseType !== "string") {
      errors.push(
        "Field 'exerciseType' is required and must be a string for this action.",
      );
    }
  }

  if (action === "evaluateResponse" || action === "yesAndResponse") {
    if (!prompt || typeof prompt !== "string") {
      errors.push(
        "Field 'prompt' is required and must be a string for this action.",
      );
    }
    if (!userResponse || typeof userResponse !== "string") {
      errors.push(
        "Field 'userResponse' is required and must be a string for this action.",
      );
    }
  }

  if (action === "generateExampleResponse") {
    if (!prompt || typeof prompt !== "string") {
      errors.push(
        "Field 'prompt' is required and must be a string for this action.",
      );
    }
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
    if (action === "generatePrompt") {
      const result = await getGeneratePromptResult({
        exerciseType: exerciseType as string,
        difficulty: body.difficulty,
      });
      return jsonResponse(
        { ok: true, action, data: result },
        { status: 200 },
      );
    }

    if (action === "evaluateResponse") {
      const result = await handleEvaluateResponse({
        exerciseType: exerciseType as string,
        prompt: prompt as string,
        userResponse: userResponse as string,
      });
      return jsonResponse(
        { ok: true, action, data: result },
        { status: 200 },
      );
    }

    if (action === "yesAndResponse") {
      const result = await handleYesAndResponse({
        exerciseType: exerciseType as string,
        prompt: prompt as string,
        userResponse: userResponse as string,
        conversationHistory: body.conversationHistory,
        difficulty: body.difficulty,
        persona: body.persona,
      });
      return jsonResponse(
        { ok: true, action, data: result },
        { status: 200 },
      );
    }

    if (action === "generateSpeedRoundsQuestions") {
      const result = await handleGenerateSpeedRoundsQuestions({
        difficulty: body.difficulty,
      });
      return jsonResponse(
        { ok: true, action, data: result },
        { status: 200 },
      );
    }

    if (action === "generateExampleResponse") {
      const result = await handleGenerateExampleResponse({
        exerciseType: exerciseType as string,
        prompt: prompt as string,
      });
      return jsonResponse(
        { ok: true, action, data: result },
        { status: 200 },
      );
    }

    if (action === "generateHecklerScenario") {
      const result = await handleGenerateHecklerScenario({
        usedScenarios: body.usedScenarios,
      });
      return jsonResponse(
        { ok: true, action, data: result },
        { status: 200 },
      );
    }

    const error: JsonError = {
      code: "unsupported_action",
      message: "The requested action is not supported.",
    };
    return jsonResponse({ ok: false, error }, { status: 400 });
  } catch (err) {
    const error: JsonError = {
      code: "ai_error",
      message:
        err instanceof Error ? err.message : "Unexpected error calling Claude.",
    };
    return jsonResponse({ ok: false, error }, { status: 500 });
  }
});
