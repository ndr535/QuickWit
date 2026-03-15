import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system/legacy';
import * as Speech from 'expo-speech';
import Constants from 'expo-constants';
import { invokeEdgeFunctionWithAuth } from './supabase';

/** Optional ElevenLabs voiceId for TTS (passed to Edge Function; server can use its default if unset). */
function getDefaultVoiceId() {
  return (
    (process.env.EXPO_PUBLIC_ELEVENLABS_VOICE_ID && String(process.env.EXPO_PUBLIC_ELEVENLABS_VOICE_ID).trim()) ||
    (Constants.expoConfig?.extra?.elevenLabsVoiceId && String(Constants.expoConfig.extra.elevenLabsVoiceId).trim()) ||
    ''
  );
}

let currentRecording = null;
let currentTtsSound = null;
let currentSpeakAbort = null;
let audioModeIsRecording = false;

async function ensureAudioPermissions() {
  const permission = await Audio.requestPermissionsAsync();

  if (!permission || !permission.granted) {
    return false;
  }

  if (audioModeIsRecording) return true;

  const INTERRUPTION_MODE_IOS = 1;
  await Audio.setAudioModeAsync({
    allowsRecordingIOS: true,
    playsInSilentModeIOS: true,
    interruptionModeIOS: INTERRUPTION_MODE_IOS,
    staysActiveInBackground: false,
    shouldDuckAndroid: true,
    playThroughEarpieceAndroid: false,
  });
  audioModeIsRecording = true;

  return true;
}

async function ensureAudioModeForPlayback() {
  if (!audioModeIsRecording) return;
  try {
    const INTERRUPTION_MODE_IOS_DUCK = 2;
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      playsInSilentModeIOS: true,
      interruptionModeIOS: INTERRUPTION_MODE_IOS_DUCK,
      staysActiveInBackground: false,
      shouldDuckAndroid: true,
      playThroughEarpieceAndroid: false,
    });
    audioModeIsRecording = false;
  } catch (e) {
    // ignore
  }
}

export async function startRecording() {
  if (currentRecording) {
    try {
      await currentRecording.stopAndUnloadAsync();
    } catch (e) {
      // ignore
    }
    currentRecording = null;
  }

  const hasPermission = await ensureAudioPermissions();
  if (!hasPermission) {
    return {
      success: false,
      error: 'MIC_PERMISSION_DENIED',
    };
  }

  let recording = null;
  try {
    recording = new Audio.Recording();
    await recording.prepareToRecordAsync({
      ...Audio.RecordingOptionsPresets.HIGH_QUALITY,
      isMeteringEnabled: true,
    });
    await recording.startAsync();
    currentRecording = recording;

    return {
      success: true,
    };
  } catch (error) {
    console.error('[QuickWit Speech] Failed to start recording:', error);
    if (recording) {
      try { await recording.stopAndUnloadAsync(); } catch (e) {}
    }
    currentRecording = null;
    return {
      success: false,
      error: 'RECORDING_START_FAILED',
    };
  }
}

/** Call speech-to-text Edge Function with base64 audio; returns transcript or empty string on failure. */
async function transcribeViaEdgeFunction(audioBase64, format) {
  try {
    const data = await invokeEdgeFunctionWithAuth('speech-to-text', {
      body: { audio: audioBase64, format: format || 'm4a' },
    });

    if (!data || !data.ok || typeof data.transcript !== 'string') {
      console.log('[EdgeCall] speech-to-text transcript_returned=no');
      console.warn('[QuickWit Speech] speech-to-text invalid response:', data);
      return '';
    }

    const transcript = (data.transcript || '').trim();
    console.log('[EdgeCall] speech-to-text transcript_returned=yes len=' + transcript.length);
    return transcript;
  } catch (err) {
    console.log('[EdgeCall] speech-to-text transcript_returned=no');
    console.warn('[QuickWit Speech] speech-to-text failed:', err?.message || err);
    return '';
  }
}

export async function stopRecording() {
  if (!currentRecording) {
    return {
      success: false,
      text: '',
      error: 'NO_ACTIVE_RECORDING',
    };
  }

  let uri = null;

  try {
    await currentRecording.stopAndUnloadAsync();
    uri = currentRecording.getURI();
  } catch (error) {
    console.error('[QuickWit Speech] Failed to stop recording:', error);
    currentRecording = null;
    return {
      success: false,
      text: '',
      error: 'RECORDING_STOP_FAILED',
    };
  }

  currentRecording = null;

  if (!uri) {
    return {
      success: false,
      text: '',
      error: 'NO_RECORDING_URI',
    };
  }

  try {
    const info = await FileSystem.getInfoAsync(uri);
    if (!info || !info.exists) {
      return {
        success: false,
        text: '',
        error: 'RECORDING_FILE_MISSING',
      };
    }
  } catch (error) {
    console.error('[QuickWit Speech] Error checking recording file:', error);
  }

  let transcript = '';
  try {
    const base64data = await FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    transcript = await transcribeViaEdgeFunction(base64data, 'm4a');
  } catch (err) {
    console.error('[QuickWit Speech] Error reading or transcribing recording:', err);
  }

  return {
    success: true,
    text: transcript,
    error: null,
  };
}

function playAudioFile(isAborted, uri) {
  const INTERRUPTION_MODE_IOS_DUCK = 2;
  const MAX_PLAYBACK_SEC = 30;
  audioModeIsRecording = false;

  return Audio.setAudioModeAsync({
    allowsRecordingIOS: false,
    playsInSilentModeIOS: true,
    interruptionModeIOS: INTERRUPTION_MODE_IOS_DUCK,
    staysActiveInBackground: false,
    shouldDuckAndroid: true,
    playThroughEarpieceAndroid: false,
  }).then(() => new Promise((resolve) => {
    let sound = null;
    let settled = false;
    let timeoutId = null;
    let pollId = null;

    const finish = (reason) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      clearInterval(pollId);
      currentTtsSound = null;
      if (sound) sound.unloadAsync().catch(() => {});
      resolve();
    };

    // hasStartedPlaying: guards the callback and poll from firing before playAsync() runs,
    // since createAsync's onStatusUpdate fires immediately on load with isPlaying=false.
    let hasStartedPlaying = false;

    const onStatusUpdate = (status) => {
      if (!hasStartedPlaying) return;
      if (isAborted && isAborted()) { finish('aborted'); return; }
      if (!status.isLoaded) { finish('unloaded'); return; }
      if (status.didJustFinishAndNotLoop) { finish('didFinish'); }
    };

    Audio.Sound.createAsync(
      { uri },
      { progressUpdateIntervalMillis: 100, shouldPlay: false, volume: 1.0 },
      onStatusUpdate,
    ).then(({ sound: s }) => {
      sound = s;
      currentTtsSound = sound;

      if (isAborted && isAborted()) { finish('aborted_post_create'); return; }

      timeoutId = setTimeout(() => finish('max_timeout'), MAX_PLAYBACK_SEC * 1000);

      // Fallback polling every 300ms: catches end-of-playback if callback misses it.
      pollId = setInterval(() => {
        if (settled || !hasStartedPlaying) return;
        sound.getStatusAsync().then((st) => {
          if (settled) return;
          if (!st.isLoaded) {
            finish('poll_unloaded');
          } else if (st.positionMillis > 0 && !st.isPlaying && !st.isBuffering) {
            finish('poll_stopped');
          }
        }).catch(() => finish('poll_error'));
      }, 300);

      sound.setVolumeAsync(1.0).catch(() => {});
      if (isAborted && isAborted()) { finish('aborted_pre_play'); return; }
      sound.playAsync()
        .then(() => { hasStartedPlaying = true; })
        .catch(() => finish('playAsync_error'));
    }).catch(() => finish('create_error'));
  }));
}

async function speakWithDeviceTTS(text) {
  // Always ensure playsInSilentModeIOS is active before device TTS —
  // ensureAudioModeForPlayback is a no-op when audioModeIsRecording=false,
  // so the very first call in a session would otherwise play silently.
  try {
    const INTERRUPTION_MODE_IOS_DUCK = 2;
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      playsInSilentModeIOS: true,
      interruptionModeIOS: INTERRUPTION_MODE_IOS_DUCK,
      staysActiveInBackground: false,
      shouldDuckAndroid: true,
      playThroughEarpieceAndroid: false,
    });
    audioModeIsRecording = false;
  } catch (_e) {}

  return new Promise((resolve) => {
    try {
      Speech.speak(text, {
        onDone: resolve,
        onStopped: resolve,
        onError: resolve,
        rate: 0.95,
        pitch: 1,
        volume: 1.0,
      });
    } catch (e) {
      console.warn('[QuickWit Speech] Device TTS error:', e);
      resolve();
    }
  });
}

/**
 * Text-to-speech via text-to-speech Edge Function; falls back to device TTS (expo-speech) on failure.
 * Same signature as before: speakText(text). Abortable via stopSpeaking().
 */
export async function speakText(text) {
  const trimmed = typeof text === 'string' ? text.trim() : '';
  if (!trimmed) return;

  if (currentSpeakAbort) {
    currentSpeakAbort.abort();
    currentSpeakAbort = null;
  }

  const controller = new AbortController();
  currentSpeakAbort = controller;

  try {
    await ensureAudioModeForPlayback();
    if (controller.signal.aborted) return;

    const voiceId = getDefaultVoiceId();

    let data;
    try {
      data = await invokeEdgeFunctionWithAuth('text-to-speech', {
        body: { text: trimmed, voiceId: voiceId || undefined },
      });
    } catch (invokeErr) {
      if (controller.signal.aborted) return;
      console.warn('[QuickWit Speech] text-to-speech Edge Function failed, using device TTS:', invokeErr?.message);
      await speakWithDeviceTTS(trimmed);
      return;
    }

    if (controller.signal.aborted) return;

    if (!data?.ok || !data?.audioBase64) {
      if (!controller.signal.aborted) {
        console.warn('[QuickWit Speech] text-to-speech Edge Function failed, using device TTS: no audio');
        await speakWithDeviceTTS(trimmed);
      }
      return;
    }

    const tempPath = `${FileSystem.cacheDirectory}quickwit_tts_${Date.now()}.mp3`;
    await FileSystem.writeAsStringAsync(tempPath, data.audioBase64, {
      encoding: FileSystem.EncodingType.Base64,
    });
    if (controller.signal.aborted) return;

    await playAudioFile(() => controller.signal.aborted, tempPath);
  } catch (err) {
    if (err?.name === 'AbortError' || controller.signal.aborted) return;
    console.warn('[QuickWit Speech] TTS error, falling back to device TTS:', err?.message);
    await speakWithDeviceTTS(trimmed).catch(() => {});
  } finally {
    if (currentSpeakAbort === controller) currentSpeakAbort = null;
  }
}

/**
 * Request microphone permission up-front (before session machinery starts).
 * Returns { granted, canAskAgain } so callers can decide whether to show
 * "open settings" or a re-request button.
 */
export async function requestMicPermission() {
  try {
    const result = await Audio.requestPermissionsAsync();
    return { granted: !!result.granted, canAskAgain: result.canAskAgain !== false };
  } catch (e) {
    return { granted: false, canAskAgain: false };
  }
}

export async function getRecordingMetering() {
  if (!currentRecording) return -160;
  try {
    const status = await currentRecording.getStatusAsync();
    return status.metering ?? -160;
  } catch (e) {
    return -160;
  }
}

export function stopSpeaking() {
  if (currentSpeakAbort) {
    try { currentSpeakAbort.abort(); } catch (e) {}
    currentSpeakAbort = null;
  }
  try {
    Speech.stop();
  } catch (e) {
    // ignore
  }
  if (currentTtsSound) {
    const sound = currentTtsSound;
    currentTtsSound = null;
    try {
      sound.stopAsync().then(() => sound.unloadAsync()).catch(() => {});
    } catch (e) {
      // ignore
    }
  }
}
