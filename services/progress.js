import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';

const KEY_PREFIX = 'quickwit_';
const LEGACY_PROGRESS_KEY = 'quickwit_progress';
const LEGACY_SESSION_COUNT_KEY = 'quickwit_session_count';
const STREAK_MILESTONES = [3, 7, 14, 30];
const MAX_LAST_SESSIONS = 10;

/** One-time migration: copy legacy global keys to user-scoped keys if scoped keys are missing. */
async function migrateLegacyProgressToScoped(keys) {
  if (keys.scopeId === 'guest') return;
  try {
    const existingProgress = await AsyncStorage.getItem(keys.progressKey);
    if (!existingProgress || String(existingProgress).trim() === '') {
      const legacy = await AsyncStorage.getItem(LEGACY_PROGRESS_KEY);
      if (legacy && String(legacy).trim() !== '') {
        await AsyncStorage.setItem(keys.progressKey, legacy);
        await AsyncStorage.removeItem(LEGACY_PROGRESS_KEY);
      }
    }
    const existingCount = await AsyncStorage.getItem(keys.sessionCountKey);
    if (existingCount == null || String(existingCount) === '') {
      const legacyCount = await AsyncStorage.getItem(LEGACY_SESSION_COUNT_KEY);
      if (legacyCount != null && String(legacyCount) !== '') {
        await AsyncStorage.setItem(keys.sessionCountKey, legacyCount);
        await AsyncStorage.removeItem(LEGACY_SESSION_COUNT_KEY);
      }
    }
  } catch (e) {
    // ignore
  }
}

/** Resolve storage scope from current auth (user id or 'guest'). */
async function getStorageKeys() {
  try {
    const { data } = await supabase.auth.getSession();
    const id = data?.session?.user?.id;
    const scope = id ? String(id) : 'guest';
    return {
      progressKey: KEY_PREFIX + 'progress_' + scope,
      sessionCountKey: KEY_PREFIX + 'session_count_' + scope,
      scopeId: scope,
    };
  } catch (e) {
    return {
      progressKey: KEY_PREFIX + 'progress_guest',
      sessionCountKey: KEY_PREFIX + 'session_count_guest',
      scopeId: 'guest',
    };
  }
}

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
    const keys = await getStorageKeys();
    await migrateLegacyProgressToScoped(keys);
    const raw = await AsyncStorage.getItem(keys.progressKey);
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
    const { progressKey } = await getStorageKeys();
    await AsyncStorage.setItem(progressKey, JSON.stringify(data));
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
    const keys = await getStorageKeys();
    await migrateLegacyProgressToScoped(keys);
    const raw = await AsyncStorage.getItem(keys.sessionCountKey);
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
    const { sessionCountKey } = await getStorageKeys();
    await AsyncStorage.setItem(sessionCountKey, String(next));
    return next;
  } catch (e) {
    return 0;
  }
}

/** Remove all progress/storage keys for a user (e.g. after account deletion). */
export async function clearProgressForUserId(userId) {
  if (!userId) return;
  const scope = String(userId);
  const keys = [
    KEY_PREFIX + 'progress_' + scope,
    KEY_PREFIX + 'session_count_' + scope,
    KEY_PREFIX + 'streak_' + scope,
    KEY_PREFIX + 'best_streak_' + scope,
    KEY_PREFIX + 'last_session_date_' + scope,
  ];
  try {
    await AsyncStorage.multiRemove(keys);
  } catch (e) {
    // ignore
  }
}

export { getStorageKeys, STREAK_MILESTONES };
