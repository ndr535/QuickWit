import { getDifficulty } from './settings';
import { supabase } from './supabase';

function isSupabaseUnavailableError(error) {
  if (!error) return false;
  const message = String(error.message || error);
  return (
    message.includes('Failed to fetch') ||
    message.includes('Network request failed') ||
    message.includes('fetch failed')
  );
}

export async function generatePrompt(exerciseType, difficulty, persona) {
  const normalizedType = (exerciseType || '').toLowerCase();

  let effectiveDifficulty = difficulty;
  if (typeof effectiveDifficulty !== 'string' || !effectiveDifficulty.trim) {
    // Backwards compatibility with older callers that passed an options object
    // instead of difficulty; fall back to stored difficulty setting.
    try {
      effectiveDifficulty = await getDifficulty();
    } catch (e) {
      effectiveDifficulty = 'everyday';
    }
  }

  try {
    const { data, error } = await supabase.functions.invoke('ai-proxy', {
      body: {
        action: 'generatePrompt',
        exerciseType,
        difficulty: effectiveDifficulty,
        persona,
      },
    });

    if (error || !data || !data.ok || !data.data || typeof data.data.prompt !== 'string') {
      throw error || new Error('Invalid ai-proxy generatePrompt response');
    }

    return data.data.prompt.trim();
  } catch (error) {
    if (isSupabaseUnavailableError(error)) {
      console.warn('[QuickWit AI] Edge Function unreachable, using offline fallback prompt.');
    } else {
      console.error('[QuickWit AI] generatePrompt via ai-proxy failed:', error);
    }

    // Fallback static prompts if AI is unavailable (same as previous behaviour).
    if (normalizedType === 'quickdraw' || normalizedType === 'quick-draw') {
      return 'You walk into a meeting late and everyone suddenly stops talking and stares at you. How do you break the silence in a fun way?';
    }
    if (normalizedType === 'speedrounds' || normalizedType === 'speed-rounds') {
      return 'What is the worst possible thing to say when answering the phone?';
    }
    if (normalizedType === 'hottake' || normalizedType === 'hot-take') {
      return 'Mondays';
    }
    if (normalizedType === 'reframe') {
      return 'Your friend just spilled coffee all over your notes right before a presentation. How could this secretly be great news?';
    }
    if (normalizedType === 'daily') {
      return 'You walk into a meeting late and everyone suddenly stops talking and stares at you. How do you break the silence in a fun way?';
    }
    return 'You are suddenly handed a microphone at a party and told to say the first thing that comes to mind. What do you say?';
  }
}

export async function evaluateResponse(exerciseType, prompt, userResponse) {
  const normalizedType = (exerciseType || '').toLowerCase();
  const fallback = {
    overallScore: 70,
    speedScore: 70,
    creativityScore: 70,
    relevanceScore: 70,
    coachFeedback:
      'Nice work jumping into the scene. Focus on building one clear, specific idea and heightening it with one extra playful detail.',
    highlights: [],
  };

  try {
    const { data, error } = await supabase.functions.invoke('ai-proxy', {
      body: {
        action: 'evaluateResponse',
        exerciseType: normalizedType || 'unknown',
        prompt,
        userResponse,
      },
    });

    if (error || !data || !data.ok || !data.data) {
      throw error || new Error('Invalid ai-proxy evaluateResponse response');
    }

    const parsed = data.data;

    return {
      overallScore:
        typeof parsed.overallScore === 'number'
          ? parsed.overallScore
          : fallback.overallScore,
      speedScore:
        typeof parsed.speedScore === 'number'
          ? parsed.speedScore
          : fallback.speedScore,
      creativityScore:
        typeof parsed.creativityScore === 'number'
          ? parsed.creativityScore
          : fallback.creativityScore,
      relevanceScore:
        typeof parsed.relevanceScore === 'number'
          ? parsed.relevanceScore
          : fallback.relevanceScore,
      coachFeedback:
        typeof parsed.coachFeedback === 'string' && parsed.coachFeedback.length
          ? parsed.coachFeedback
          : fallback.coachFeedback,
      highlights: Array.isArray(parsed.highlights)
        ? parsed.highlights.map((item) => String(item))
        : fallback.highlights,
    };
  } catch (error) {
    if (isSupabaseUnavailableError(error)) {
      console.warn('[QuickWit AI] Edge Function unreachable, using offline fallback evaluation.');
    } else {
      console.error('[QuickWit AI] evaluateResponse via ai-proxy failed:', error);
    }
    return fallback;
  }
}

export async function generateYesAndResponse(conversationHistory) {
  try {
    const historyArray = Array.isArray(conversationHistory) ? conversationHistory : [];

    const { data, error } = await supabase.functions.invoke('ai-proxy', {
      body: {
        action: 'yesAndResponse',
        conversationHistory: historyArray,
      },
    });

    if (error || !data || !data.ok || !data.data || typeof data.data.response !== 'string') {
      throw error || new Error('Invalid ai-proxy yesAndResponse response');
    }

    return data.data.response.trim();
  } catch (error) {
    if (isSupabaseUnavailableError(error)) {
      console.warn('[QuickWit AI] Edge Function unreachable, using friendly fallback yes-and line.');
    } else {
      console.error('[QuickWit AI] generateYesAndResponse via ai-proxy failed:', error);
    }

    // Friendly fallback so the UI still has something playful to show.
    return 'Yes, and then I lean into it even more, adding one bold, playful twist that keeps the moment moving.';
  }
}

/**
 * Generate one strong example response for the given prompt and exercise type.
 * Used on the results screen so users can see what a good answer might look like.
 * @param {string} exerciseType
 * @param {string} prompt
 * @returns {Promise<string>}
 */
export async function generateExampleResponse(exerciseType, prompt) {
  try {
    const { data, error } = await supabase.functions.invoke('ai-proxy', {
      body: {
        action: 'generateExampleResponse',
        exerciseType: exerciseType || 'unknown',
        prompt: prompt || '',
      },
    });

    if (error || !data || !data.ok || !data.data || typeof data.data.example !== 'string') {
      throw error || new Error('Invalid generateExampleResponse response');
    }

    return data.data.example.trim();
  } catch (error) {
    if (isSupabaseUnavailableError(error)) {
      console.warn('[QuickWit AI] Edge Function unreachable for generateExampleResponse.');
    } else {
      console.warn('[QuickWit AI] generateExampleResponse failed:', error);
    }
    return '';
  }
}

const SPEED_ROUNDS_FALLBACK = [
  'What is the worst possible thing to say when answering the phone?',
  'Name a superpower that would make your life significantly worse.',
  'What would a terrible magician\'s catchphrase be?',
  'Describe a children\'s book that should never exist.',
  'What is the least helpful advice you could give someone who is lost?',
];

const HECKLER_FALLBACK = {
  scenario:
    'You are giving a wedding toast that is clearly going off the rails. People are shifting in their seats and checking their watches.',
  heckle:
    'Can you please wrap it up? This is getting painful.',
};

/**
 * Speed Rounds: generate all 5 rapid-fire questions upfront.
 * Returns a string array of 5 questions respecting the current difficulty setting.
 * @returns {Promise<string[]>}
 */
export async function generateSpeedRoundsQuestions() {
  const difficulty = await getDifficulty();

  try {
    const { data, error } = await supabase.functions.invoke('ai-proxy', {
      body: {
        action: 'generateSpeedRoundsQuestions',
        difficulty,
      },
    });

    if (error || !data || !data.ok || !data.data || !Array.isArray(data.data.questions)) {
      throw error || new Error('Invalid generateSpeedRoundsQuestions response');
    }

    return data.data.questions.map((q) => String(q).trim());
  } catch (error) {
    if (isSupabaseUnavailableError(error)) {
      console.warn('[QuickWit AI] Edge Function unreachable for generateSpeedRoundsQuestions, using fallback.');
    } else {
      console.warn('[QuickWit AI] generateSpeedRoundsQuestions failed:', error);
    }
    return SPEED_ROUNDS_FALLBACK;
  }
}

/**
 * Heckler: generate one scenario plus a matching heckle upfront.
 * Returns an object { scenario, heckle }.
 */
export async function generateHecklerScenario(options = {}) {
  try {
    const { data, error } = await supabase.functions.invoke('ai-proxy', {
      body: {
        action: 'generateHecklerScenario',
        usedScenarios: options.usedScenarios || [],
      },
    });

    if (error || !data || !data.ok || !data.data) {
      throw error || new Error('Invalid generateHecklerScenario response');
    }

    const scenario = (data.data.scenario && String(data.data.scenario).trim()) || HECKLER_FALLBACK.scenario;
    const heckle = (data.data.heckle && String(data.data.heckle).trim()) || HECKLER_FALLBACK.heckle;
    return { scenario, heckle };
  } catch (error) {
    if (isSupabaseUnavailableError(error)) {
      console.warn('[QuickWit AI] Edge Function unreachable for generateHecklerScenario, using fallback.');
    } else {
      console.warn('[QuickWit AI] generateHecklerScenario failed:', error);
    }
    return { ...HECKLER_FALLBACK };
  }
}

