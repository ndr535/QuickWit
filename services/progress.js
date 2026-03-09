import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'quickwit_progress';
const SESSION_COUNT_KEY = 'quickwit_session_count';
const STREAK_MILESTONES = [3, 7, 14, 30];
const MAX_LAST_SESSIONS = 10;

function todayString() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

function yesterdayString() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

const DEFAULT = {
  lastSessionDate: null,
  currentStreak: 0,
  totalSessions: 0,
  bestScores: {},
  lastSessions: [],
  pendingCelebration: null,
};

async function load() {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT };
    const data = JSON.parse(raw);
    return {
      ...DEFAULT,
      ...data,
      bestScores: data.bestScores && typeof data.bestScores === 'object' ? data.bestScores : {},
      lastSessions: Array.isArray(data.lastSessions) ? data.lastSessions : [],
    };
  } catch (e) {
    return { ...DEFAULT };
  }
}

async function save(data) {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (e) {
    // ignore
  }
}

/**
 * @returns {Promise<{
 *   streak: number,
 *   totalSessions: number,
 *   bestScores: Record<string, number>,
 *   lastSessions: Array<{ date: string, exerciseType: string, overallScore: number }>,
 *   pendingCelebration: { personalBest?: string, streakMilestone?: number } | null
 * }>}
 */
export async function getProgress() {
  const data = await load();
  return {
    streak: data.currentStreak,
    totalSessions: data.totalSessions,
    bestScores: { ...data.bestScores },
    lastSessions: [...data.lastSessions],
    pendingCelebration: data.pendingCelebration || null,
  };
}

/**
 * @param {{ exerciseType: string, overallScore: number }} sessionResult
 */
export async function updateProgress(sessionResult) {
  const exerciseType = String(sessionResult.exerciseType || 'daily').toLowerCase();
  const overallScore = Number(sessionResult.overallScore);
  if (!Number.isFinite(overallScore)) return;

  const data = await load();
  const today = todayString();
  const yesterday = yesterdayString();

  data.totalSessions = (data.totalSessions || 0) + 1;

  const prevBest = data.bestScores[exerciseType];
  const isNewBest = prevBest == null || overallScore > prevBest;
  if (isNewBest) {
    data.bestScores[exerciseType] = overallScore;
  }

  const lastDate = data.lastSessionDate;
  if (!lastDate) {
    data.currentStreak = 1;
  } else if (lastDate === today) {
    data.currentStreak = data.currentStreak || 1;
  } else if (lastDate === yesterday) {
    data.currentStreak = (data.currentStreak || 0) + 1;
  } else {
    data.currentStreak = 1;
  }
  data.lastSessionDate = today;

  data.lastSessions = [
    { date: today, exerciseType, overallScore },
    ...(data.lastSessions || []),
  ].slice(0, MAX_LAST_SESSIONS);

  const streakMilestone = STREAK_MILESTONES.includes(data.currentStreak) ? data.currentStreak : null;
  data.pendingCelebration = null;
  if (isNewBest || streakMilestone != null) {
    data.pendingCelebration = {
      ...(isNewBest ? { personalBest: exerciseType } : {}),
      ...(streakMilestone != null ? { streakMilestone } : {}),
    };
  }

  await save(data);
}

/**
 * @returns {Promise<number>}
 */
export async function getStreak() {
  const data = await load();
  return data.currentStreak || 0;
}

/**
 * @param {string} exerciseType
 * @param {number} score
 * @returns {Promise<boolean>}
 */
export async function isNewPersonalBest(exerciseType, score) {
  const data = await load();
  const key = String(exerciseType || 'daily').toLowerCase();
  const best = data.bestScores[key];
  return best == null || score > best;
}

/** Clear pending celebration after showing confetti. */
export async function clearPendingCelebration() {
  const data = await load();
  data.pendingCelebration = null;
  await save(data);
}

/**
 * Session count for paywall gating (separate from streak/totalSessions).
 * Used to allow 6 free sessions before showing paywall.
 * @returns {Promise<number>}
 */
export async function getSessionCount() {
  try {
    const raw = await AsyncStorage.getItem(SESSION_COUNT_KEY);
    if (raw == null) return 0;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch (e) {
    return 0;
  }
}

/**
 * Increment the session count (e.g. after starting a session that counts against the free limit).
 * @returns {Promise<number>} New count after increment
 */
export async function incrementSessionCount() {
  try {
    const current = await getSessionCount();
    const next = current + 1;
    await AsyncStorage.setItem(SESSION_COUNT_KEY, String(next));
    return next;
  } catch (e) {
    return 0;
  }
}

export { STREAK_MILESTONES };
