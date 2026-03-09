import AsyncStorage from '@react-native-async-storage/async-storage';

const VOICE_KEY = 'quickwit_voice_enabled';
const DIFFICULTY_KEY = 'quickwit_difficulty';

const DIFFICULTY_VALUES = ['everyday', 'weird', 'unhinged'];

/** @returns {Promise<boolean>} Voice enabled (default true) */
export async function getVoiceEnabled() {
  try {
    const v = await AsyncStorage.getItem(VOICE_KEY);
    if (v === 'false' || v === '0') return false;
    if (v === 'true' || v === '1') return true;
    return true;
  } catch (e) {
    return true;
  }
}

/** @param {boolean} enabled */
export async function setVoiceEnabled(enabled) {
  try {
    await AsyncStorage.setItem(VOICE_KEY, enabled ? 'true' : 'false');
  } catch (e) {
    // ignore
  }
}

/** @returns {Promise<'everyday'|'weird'|'unhinged'>} */
export async function getDifficulty() {
  try {
    const d = await AsyncStorage.getItem(DIFFICULTY_KEY);
    const lower = (d || '').toLowerCase();
    if (DIFFICULTY_VALUES.includes(lower)) return lower;
    return 'everyday';
  } catch (e) {
    return 'everyday';
  }
}

/** @param {'everyday'|'weird'|'unhinged'} value */
export async function setDifficulty(value) {
  const lower = (value || 'everyday').toLowerCase();
  if (!DIFFICULTY_VALUES.includes(lower)) return;
  try {
    await AsyncStorage.setItem(DIFFICULTY_KEY, lower);
  } catch (e) {
    // ignore
  }
}

export { DIFFICULTY_VALUES };
