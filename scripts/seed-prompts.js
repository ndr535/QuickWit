/**
 * Seed prompt_cache table by calling the Anthropic API directly.
 * Bypasses the Edge Function to avoid rate limits during bulk seeding.
 *
 * Run: node scripts/seed-prompts.js
 *
 * Required in .env:
 *   EXPO_PUBLIC_SUPABASE_URL
 *   EXPO_PUBLIC_SUPABASE_ANON_KEY
 *   ANTHROPIC_API_KEY
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-sonnet-4-20250514';
const DELAY_MS = 600;

const EXERCISE_TYPES = ['quickDraw', 'hotTake', 'reframe'];
const DIFFICULTIES = ['everyday', 'weird', 'unhinged'];
const PROMPTS_PER_COMBO = 50;

// ---------------------------------------------------------------------------
// Prompt-building constants (mirrors ai-proxy/index.ts)
// ---------------------------------------------------------------------------

const SCENARIO_VARIETY_INSTRUCTION =
  'When you invent situations or settings, pull them randomly from a wide variety of real-life social contexts, including but not limited to: first dates and asking someone out, receiving an unexpected compliment, approaching a stranger on the street about something they are wearing, grocery store checkout lines, elevator small talk with a neighbor, running into an ex unexpectedly, being set up on a blind date, getting caught doing something embarrassing in public, a stranger sitting next to you on a plane who will not stop talking, someone cutting in line, being recognised by a fan or someone who knows your work, a job interview going sideways, meeting a partner\'s parents for the first time, being the only person who does not know anyone at a party, and a street performer pulling you into their act. Avoid defaulting to offices or coffee shops; vary locations and social dynamics. Within a single session, never repeat the exact same setting.';

const UNIQUENESS_INSTRUCTION =
  'CRITICAL: Every prompt must be a completely unique scenario with a different setting, situation, and social dynamic. Never reuse farmer\'s markets, twin siblings, matching outfits, grocery store checkouts, or any scenario already generated in this session. Each prompt should feel like it came from a completely different slice of life.';

const DIFFICULTY_INSTRUCTIONS = {
  everyday:
    'SCENARIO TONE: Grounded and realistic. Use relatable situations: workplace, social awkwardness, everyday conversations. Nothing surreal or absurd.',
  weird:
    'SCENARIO TONE: Mildly absurd. Normal situations with unexpected twists, odd but recognizable. Escalate the weirdness slightly, not full chaos.',
  unhinged:
    'SCENARIO TONE: Fully outlandish and surreal. Anything goes — rubber duck territory, nothing has to make sense. Maximum absurdity.',
};

const TYPE_INSTRUCTIONS = {
  quickdraw:
    'Exercise type: Quick Draw. Create a random social, high-energy, or absurd scenario that demands a fast verbal response. The user will have only a few seconds to react out loud. ' +
    SCENARIO_VARIETY_INSTRUCTION,
  hottake:
    'Exercise type: Hot Take. Return ONLY a single short mundane or random topic word or phrase for the user to give a bold opinion on. Examples: "escalators", "the word moist", "Mondays", "ice in drinks", "small talk", "reply-all emails". Keep it to 1–4 words. No explanation, no sentence, just the topic. Pick something fresh and unexpected.',
  reframe:
    'Exercise type: Reframe. Describe a negative, awkward, or mildly frustrating situation that can be humorously or positively reframed. ' +
    SCENARIO_VARIETY_INSTRUCTION,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildSystemPrompt(exerciseType, difficulty) {
  const coach = [
    'You are QuickWit, an enthusiastic improv and wit coach.',
    'You help users practice quick thinking, playful absurdity, and positive reframing.',
    'Always keep tone: supportive, energetic, and encouraging, never harsh.',
    'Use concise, vivid language. Avoid long paragraphs.',
    'Assume the user is on a mobile device in a short practice session.',
  ].join(' ');

  const difficultyLine =
    DIFFICULTY_INSTRUCTIONS[difficulty] || DIFFICULTY_INSTRUCTIONS.everyday;

  return [
    coach,
    'You are generating a single prompt for an improv exercise.',
    'The prompt should be 1–3 sentences, specific, and fun.',
    difficultyLine,
    UNIQUENESS_INSTRUCTION,
  ].join(' ');
}

function buildUserContent(exerciseType, existingPrompts) {
  const typeKey = exerciseType.toLowerCase();
  const typeInstructions =
    TYPE_INSTRUCTIONS[typeKey] ||
    'Exercise type: Unknown. Create a playful, open-ended improv challenge that invites a short spoken response.';

  const usedBlock =
    existingPrompts.length > 0
      ? [
          '',
          'Already used scenarios — do not repeat these settings or dynamics:',
          ...existingPrompts.map((p, i) => `${i + 1}. ${p}`),
        ].join('\n')
      : '';

  return [
    typeInstructions,
    usedBlock,
    '',
    'Return only the prompt text that should be shown to the user.',
    'Do not add labels, explanations, or quotes around it.',
  ]
    .join('\n')
    .trim();
}

async function callClaude(system, userContent) {
  const res = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 160,
      temperature: 0.9,
      system,
      messages: [{ role: 'user', content: [{ type: 'text', text: userContent }] }],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Anthropic HTTP ${res.status}: ${text.slice(0, 200)}`);
  }

  const data = await res.json();
  const text = data?.content?.[0]?.text;
  if (typeof text !== 'string' || !text.trim()) {
    throw new Error('Unexpected Anthropic response shape');
  }
  return text.trim();
}

async function fetchExistingPrompts(supabase, exerciseType, difficulty) {
  const { data, error } = await supabase
    .from('prompt_cache')
    .select('prompt_text')
    .eq('exercise_type', exerciseType)
    .eq('difficulty', difficulty);

  if (error) {
    console.warn(`  ⚠ Could not fetch existing prompts (${error.message}); proceeding without context.`);
    return [];
  }
  return (data || []).map((row) => row.prompt_text).filter(Boolean);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.error('Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY in .env');
    process.exit(1);
  }
  if (!ANTHROPIC_API_KEY) {
    console.error('Missing ANTHROPIC_API_KEY in .env');
    process.exit(1);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  let totalStored = 0;

  for (const exerciseType of EXERCISE_TYPES) {
    for (const difficulty of DIFFICULTIES) {
      console.log(`\n── ${exerciseType} / ${difficulty} ──`);

      // Fetch all prompts already in the DB for this combo.
      const dbPrompts = await fetchExistingPrompts(supabase, exerciseType, difficulty);
      console.log(`  ${dbPrompts.length} existing prompts loaded from DB.`);

      // Also accumulate prompts generated in this run so each new generation
      // can see what was just created, not only what was already in the DB.
      const sessionPrompts = [];

      const system = buildSystemPrompt(exerciseType, difficulty);

      for (let i = 0; i < PROMPTS_PER_COMBO; i++) {
        const allKnownPrompts = [...dbPrompts, ...sessionPrompts];

        try {
          const userContent = buildUserContent(exerciseType, allKnownPrompts);
          const prompt = await callClaude(system, userContent);

          const { error } = await supabase.from('prompt_cache').insert({
            exercise_type: exerciseType,
            difficulty,
            prompt_text: prompt,
          });

          if (error) throw error;

          sessionPrompts.push(prompt);
          totalStored++;
          console.log(`  [${i + 1}/${PROMPTS_PER_COMBO}] ✓ ${prompt.slice(0, 80)}${prompt.length > 80 ? '…' : ''}`);
        } catch (err) {
          console.error(`  [${i + 1}/${PROMPTS_PER_COMBO}] ✗ ${err.message}`);
        }

        if (i < PROMPTS_PER_COMBO - 1) await sleep(DELAY_MS);
      }
    }
  }

  console.log(`\nDone. Total prompts stored this run: ${totalStored}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
