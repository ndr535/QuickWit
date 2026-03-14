import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Animated,
  ScrollView,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { generatePrompt, evaluateResponse, generateSpeedRoundsQuestions, generateHecklerScenario } from '../services/ai';
import {
  startRecording as speechStartRecording,
  stopRecording as speechStopRecording,
  speakText,
  stopSpeaking,
  getRecordingMetering,
  requestMicPermission,
} from '../services/speech';
import { getVoiceEnabled } from '../services/settings';
import { updateProgress, getSessionCount, incrementSessionCount } from '../services/progress';
import { checkSubscriptionStatus } from '../services/purchases';
import GradientBackground from '../components/GradientBackground';

const COLORS = {
  background: '#1A1A2E',
  card: '#16213E',
  accent: '#E94560',
  text: '#FFFFFF',
  muted: '#A5B1C2',
};

const ROUNDS_BY_EXERCISE = { 'quick-draw': 5, heckler: 3, 'speed-rounds': 5, 'hot-take': 5, reframe: 3 };
const TRANSCRIPT_PREVIEW_MS = 2500;
// Temporary: lowered from 6 to 2 for testing.
const FREE_SESSION_LIMIT = 6;

function getTotalRounds(type) {
  const key = (type || '').toLowerCase();
  return ROUNDS_BY_EXERCISE[key] ?? 1;
}

const EXERCISE_LABELS = {
  'quick-draw': 'Quick Draw',
  quickDraw: 'Quick Draw',
  'speed-rounds': 'Speed Rounds',
  speedrounds: 'Speed Rounds',
  'hot-take': 'Hot Take',
  hottake: 'Hot Take',
  heckler: 'Heckler',
  reframe: 'Reframe',
  daily: 'Daily Session',
};

function getPlaceholderPrompt(type, round) {
  switch (type) {
    case 'quick-draw':
    case 'quickDraw':
      return `Round ${round}: A surprise situation just landed in your lap. Respond immediately.`;
    case 'speed-rounds':
    case 'speedrounds':
      return 'What is the worst possible thing to say when answering the phone?';
    case 'hot-take':
    case 'hottake':
      return 'Mondays';
    case 'reframe':
      return `Round ${round}: Take a frustrating situation and reframe it as an opportunity or a joke.`;
    case 'daily':
      return `Round ${round}: You walk into a meeting late and everyone stops talking and stares at you. How do you break the silence?`;
    default:
      return `Round ${round}: Get ready for a new QuickWit improv challenge.`;
  }
}

export default function SessionScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();

  const exerciseTypeParam = params.exerciseType || params.type;

  // Core session state
  const [round, setRound] = useState(1);
  const [promptText, setPromptText] = useState('');
  const [isPromptLoading, setIsPromptLoading] = useState(false);
  const [promptError, setPromptError] = useState(null);

  // Input state (manual hold-to-record and text fallback)
  const [userInput, setUserInput] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [transcriptPreview, setTranscriptPreview] = useState('');
  const [micPermissionDenied, setMicPermissionDenied] = useState(false);
  const [showTextInputFallback, setShowTextInputFallback] = useState(false);

  // Auto-recording (Speed Rounds, Hot Take, Quick Draw, Heckler)
  const [speedQuestions, setSpeedQuestions] = useState([]);
  const [allResponses, setAllResponses] = useState([]);
  const [roundTimer, setRoundTimer] = useState(0);
  const [autoRecording, setAutoRecording] = useState(false);

  // Refs for async/interval state
  const micPulseScale = useRef(new Animated.Value(1)).current;
  const waveformAnims = useRef([1, 2, 3, 4, 5].map(() => new Animated.Value(0.3))).current;
  const waveformLoop = useRef(null);
  const lastSpokenPromptRef = useRef(null);
  const timerRef = useRef(null);
  const silenceRef = useRef(null);
  const roundLock = useRef(false);
  const roundRef = useRef(1);
  const totalRoundsRef = useRef(1);
  const speedQuestionsRef = useRef([]);
  const allResponsesRef = useRef([]);
  const exerciseTypeRef = useRef(exerciseTypeParam);
  const usedHotTakeTopicsRef = useRef([]);
  const usedQuickDrawSettingsRef = useRef([]);
  const usedHecklerScenariosRef = useRef([]);
  const hecklerPhaseRef = useRef('initial'); // 'initial' | 'recovery'
  const currentHecklerScenarioRef = useRef(null);
  const currentHeckleRef = useRef(null);
  const hecklerRoundsRef = useRef([]);

  // Paywall gate: allow if pro, or session count < FREE_SESSION_LIMIT (then increment). Fail open on RevenueCat/errors.
  const [gateState, setGateState] = useState('checking');
  const gateChecked = useRef(false);
  const isScreenActiveRef = useRef(true);

  // Mic permission preflight: 'checking' until gate passes, then 'granted' or 'denied'.
  const [permissionState, setPermissionState] = useState('checking');
  const canAskMicAgainRef = useRef(true);

  useEffect(() => {
    if (gateChecked.current) return;
    let cancelled = false;

    async function runGate() {
      try {
        const isPro = await checkSubscriptionStatus();
        if (cancelled) return;
        if (isPro) {
          setGateState('allowed');
          return;
        }
        let count = 0;
        try {
          count = await getSessionCount();
        } catch (_e) {
          if (!cancelled) setGateState('allowed');
          return;
        }
        if (cancelled) return;
        if (count >= FREE_SESSION_LIMIT) {
          setGateState('paywall');
          return;
        }
        try {
          await incrementSessionCount();
        } catch (_e) {}
        if (!cancelled) setGateState('allowed');
      } catch (_e) {
        if (!cancelled) setGateState('allowed');
      } finally {
        gateChecked.current = true;
      }
    }
    runGate();
    return () => { cancelled = true; };
  }, []);

  const exerciseLabel = useMemo(() => {
    const key = exerciseTypeParam || '';
    return EXERCISE_LABELS[key] || 'Session';
  }, [exerciseTypeParam]);

  const normalizedExerciseType = useMemo(() => {
    const raw = exerciseTypeParam || '';
    return String(raw).toLowerCase();
  }, [exerciseTypeParam]);

  const isSpeedRounds = useMemo(
    () => normalizedExerciseType === 'speed-rounds' || normalizedExerciseType === 'speedrounds',
    [normalizedExerciseType],
  );
  const isHotTake = useMemo(
    () => normalizedExerciseType === 'hot-take' || normalizedExerciseType === 'hottake',
    [normalizedExerciseType],
  );
  const isQuickDraw = useMemo(
    () => normalizedExerciseType === 'quick-draw' || normalizedExerciseType === 'quickdraw',
    [normalizedExerciseType],
  );
  const isHeckler = useMemo(
    () => normalizedExerciseType === 'heckler',
    [normalizedExerciseType],
  );
  const isReframe = useMemo(
    () => normalizedExerciseType === 'reframe',
    [normalizedExerciseType],
  );
  const isAutoExercise = isSpeedRounds || isHotTake || isQuickDraw || isHeckler;
  const totalRounds = useMemo(() => {
    const val = getTotalRounds(exerciseTypeParam);
    totalRoundsRef.current = val;
    return val;
  }, [exerciseTypeParam]);

  // Keep refs in sync
  useEffect(() => { speedQuestionsRef.current = speedQuestions; }, [speedQuestions]);
  useEffect(() => { allResponsesRef.current = allResponses; }, [allResponses]);
  useEffect(() => { roundRef.current = round; }, [round]);
  useEffect(() => { exerciseTypeRef.current = exerciseTypeParam; }, [exerciseTypeParam]);

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  /**
   * Estimate a generous narration timeout based on text length.
   * ~70ms per character covers ElevenLabs response time + playback, with a 6s minimum.
   */
  // 15s minimum: covers ElevenLabs latency + device TTS fallback when ElevenLabs fails.
  const estimateSpeakTimeout = (text) => Math.max(8000, (text || '').length * 80);

  /**
   * Speaks text with a hard cap. If ElevenLabs is slow, we cancel the request after maxMs
   * so it never overrides the audio session after recording has started.
   */
  const speakWithTimeout = async (text, maxMs) => {
    let timedOut = false;
    const timeoutPromise = new Promise((resolve) => setTimeout(() => {
      timedOut = true;
      resolve();
    }, maxMs));
    await Promise.race([speakText(text).catch(() => {}), timeoutPromise]);
    if (timedOut) {
      // Cancel the in-flight speakText so it doesn't call setAudioModeAsync(allowsRecordingIOS:false)
      // after we've switched to recording mode.
      stopSpeaking();
    }
  };

  // ─── Auto-recording helpers ──────────────────────────────────────────────────

  const clearTimers = () => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (silenceRef.current) { clearInterval(silenceRef.current); silenceRef.current = null; }
  };

  const autoStartRound = async (maxSec, hardCutoff) => {
    if (!isScreenActiveRef.current) return;
    roundLock.current = false;
    // Show recording UI immediately so there's no visible gap after narration ends.
    // Actual mic setup (~600ms) happens below; we revert if it fails.
    setMicPermissionDenied(false);
    setIsRecording(true);
    setAutoRecording(true);
    setRoundTimer(maxSec);
    setTranscriptPreview('');
    setSubmitError(null);

    const result = await speechStartRecording();
    if (!isScreenActiveRef.current) return;
    if (!result.success) {
      setIsRecording(false);
      setAutoRecording(false);
      setRoundTimer(0);
      if (result.error === 'MIC_PERMISSION_DENIED') setMicPermissionDenied(true);
      return;
    }

    // Countdown
    if (!isScreenActiveRef.current) return;
    timerRef.current = setInterval(() => {
      if (!isScreenActiveRef.current) return;
      setRoundTimer((t) => {
        if (t <= 1) {
          clearInterval(timerRef.current);
          timerRef.current = null;
          if (hardCutoff && isScreenActiveRef.current) autoFinishRound();
          return 0;
        }
        return t - 1;
      });
    }, 1000);

    // Silence detection: only triggers AFTER the user has started speaking.
    // - WARMUP_TICKS: skip first 1.5s to let the iOS audio-mode transition noise settle.
    // - SPEECH_DB: -28 dB threshold. Room noise peaks at ~-35 dB; speech is -25 dB or
    //   louder, so -28 cleanly separates the two.
    // - SPEECH_CONSECUTIVE: require 2 consecutive ticks above threshold (~600ms) to arm,
    //   preventing a single noise spike from arming the detector.
    // - SILENCE_TICKS: 5 ticks × 300ms = 1.5s of continuous silence to fire round end.
    let hasSpokeOnce = false;
    let silentTicks = 0;
    let warmupTicks = 0;
    let loudConsecutive = 0;
    const WARMUP_TICKS = 5;
    const SPEECH_DB = -28;
    const SPEECH_CONSECUTIVE = 2;
    const SILENCE_TICKS = 5;
    silenceRef.current = setInterval(async () => {
      if (!isScreenActiveRef.current) return;
      if (warmupTicks < WARMUP_TICKS) {
        warmupTicks++;
        return;
      }
      const db = await getRecordingMetering();
      if (db > SPEECH_DB) {
        loudConsecutive++;
        if (loudConsecutive >= SPEECH_CONSECUTIVE) {
          hasSpokeOnce = true;
        }
        silentTicks = 0;
      } else {
        loudConsecutive = 0;
        if (hasSpokeOnce) {
          silentTicks++;
          if (silentTicks >= SILENCE_TICKS) {
            clearInterval(silenceRef.current);
            silenceRef.current = null;
            if (isScreenActiveRef.current) autoFinishRound();
          }
        }
      }
    }, 300);
  };

  const autoFinishRound = async () => {
    if (roundLock.current) return;
    if (!isScreenActiveRef.current) return;
    roundLock.current = true;

    // Special two-phase flow for Heckler: initial speech then recovery.
    if (isHeckler) {
      const phase = hecklerPhaseRef.current || 'initial';

      if (phase === 'initial') {
        // End the initial response window, ignore its transcript, then play the heckle.
        clearTimers();
        setRoundTimer(0);
        setIsRecording(false);
        setAutoRecording(false);
        setIsTranscribing(true);
        try {
          await speechStopRecording();
        } catch (e) {
          console.warn('[QuickWit] autoFinishRound (Heckler initial): stopRecording failed', e);
        }
        if (!isScreenActiveRef.current) return;
        setIsTranscribing(false);

        const heckle = currentHeckleRef.current || 'Can you get to the point?';
        const voiceOn = await getVoiceEnabled();
        if (!isScreenActiveRef.current) return;
        if (voiceOn && heckle) {
          setIsSpeaking(true);
          await speakWithTimeout(heckle, estimateSpeakTimeout(heckle));
          setIsSpeaking(false);
        }

        // Start recovery recording with a soft cutoff (silence detection ends round).
        if (!isScreenActiveRef.current) return;
        hecklerPhaseRef.current = 'recovery';
        roundLock.current = false;
        await autoStartRound(30, false);
        return;
      }

      // Recovery phase finished: transcribe and either advance or evaluate.
      clearTimers();
      setRoundTimer(0);
      setIsRecording(false);
      setAutoRecording(false);
      setIsTranscribing(true);

      let transcript = '';
      try {
        const result = await speechStopRecording();
        transcript = (result?.text || '').trim();
      } catch (e) {
        console.warn('[QuickWit] autoFinishRound (Heckler recovery): stopRecording failed', e);
      }
      if (!isScreenActiveRef.current) return;
      setIsTranscribing(false);

      const currentRound = roundRef.current;
      const scenario = currentHecklerScenarioRef.current || promptText;
      const heckle = currentHeckleRef.current || '';

      const newRecord = {
        scenario,
        heckle,
        response: transcript || '(no response)',
      };
      const existing = hecklerRoundsRef.current || [];
      const updated = [...existing, newRecord];
      hecklerRoundsRef.current = updated;

      if (currentRound >= totalRoundsRef.current) {
        const combinedPrompt = updated
          .map((r, i) => `Round ${i + 1} — Scenario: ${r.scenario}\nHeckle: ${r.heckle}`)
          .join('\n\n');
        const combinedRecoveries = updated
          .map((r, i) => `${i + 1}. ${r.response}`)
          .join('\n');
        setIsSubmitting(true);
        try {
          const evaluation = await evaluateResponse(
            'heckler',
            combinedPrompt,
            combinedRecoveries,
          );
          if (!isScreenActiveRef.current) return;
          await updateProgress({ exerciseType: 'heckler', overallScore: evaluation.overallScore });
          router.replace({
            pathname: '/results',
            params: {
              exerciseType: 'heckler',
              prompt: combinedPrompt || '',
              overallScore: String(evaluation.overallScore),
              speedScore: String(evaluation.speedScore),
              creativityScore: String(evaluation.creativityScore),
              relevanceScore: String(evaluation.relevanceScore),
              coachFeedback: evaluation.coachFeedback,
              highlights: JSON.stringify(evaluation.highlights || []),
            },
          });
        } catch (err) {
          if (isScreenActiveRef.current) setSubmitError('Could not get coaching. Check your connection and try again.');
        } finally {
          if (isScreenActiveRef.current) setIsSubmitting(false);
        }
        return;
      }

      // Move to the next Heckler round.
      if (!isScreenActiveRef.current) return;
      hecklerPhaseRef.current = 'initial';
      const nextRound = currentRound + 1;
      roundRef.current = nextRound;
      setRound(nextRound);
      roundLock.current = false;
      await startNextRound(nextRound);
      return;
    }

    // Standard auto-exercise flow (Speed Rounds, Hot Take, Quick Draw).
    clearTimers();
    setRoundTimer(0);
    setIsRecording(false);
    setAutoRecording(false);
    setIsTranscribing(true);

    let transcript = '';
    try {
      const result = await speechStopRecording();
      transcript = (result?.text || '').trim();
    } catch (e) {
      console.warn('[QuickWit] autoFinishRound: stopRecording failed', e);
    }
    if (!isScreenActiveRef.current) return;
    setIsTranscribing(false);

    const currentRound = roundRef.current;
    const currentQ = isSpeedRounds
      ? (speedQuestionsRef.current[currentRound - 1] || promptText)
      : promptText;

    const updatedResponses = [
      ...allResponsesRef.current,
      { prompt: currentQ, response: transcript || '(no response)' },
    ];
    allResponsesRef.current = updatedResponses;
    if (isScreenActiveRef.current) setAllResponses(updatedResponses);

    if (currentRound >= totalRoundsRef.current) {
      // Evaluate all responses together
      const combinedPrompt = updatedResponses
        .map((r, i) => `Q${i + 1}: ${r.prompt}\nA${i + 1}: ${r.response}`)
        .join('\n\n');
      const combinedResponse = updatedResponses
        .map((r, i) => `${i + 1}. ${r.response}`)
        .join('\n');
      if (!isScreenActiveRef.current) return;
      setIsSubmitting(true);
      try {
        const evaluation = await evaluateResponse(
          exerciseTypeRef.current,
          combinedPrompt,
          combinedResponse,
        );
        if (!isScreenActiveRef.current) return;
        await updateProgress({ exerciseType: exerciseTypeRef.current, overallScore: evaluation.overallScore });
        router.replace({
          pathname: '/results',
          params: {
            exerciseType: exerciseTypeRef.current,
            prompt: combinedPrompt || '',
            overallScore: String(evaluation.overallScore),
            speedScore: String(evaluation.speedScore),
            creativityScore: String(evaluation.creativityScore),
            relevanceScore: String(evaluation.relevanceScore),
            coachFeedback: evaluation.coachFeedback,
            highlights: JSON.stringify(evaluation.highlights || []),
          },
        });
      } catch (err) {
        if (isScreenActiveRef.current) setSubmitError('Could not get coaching. Check your connection and try again.');
        if (isScreenActiveRef.current) setIsSubmitting(false);
      }
      return;
    }

    // Advance to next round
    if (!isScreenActiveRef.current) return;
    const nextRound = currentRound + 1;
    roundRef.current = nextRound;
    setRound(nextRound);
    await startNextRound(nextRound);
  };

  const startHecklerInitialPhase = async () => {
    if (!isScreenActiveRef.current) return;
    hecklerPhaseRef.current = 'initial';
    const hecklerInitialSec = 8 + Math.floor(Math.random() * 8); // 8–15 seconds
    await autoStartRound(hecklerInitialSec, true);
  };

  const startNextRound = async (newRound) => {
    if (!isScreenActiveRef.current) return;
    if (isSpeedRounds) {
      const nextQ = speedQuestionsRef.current[newRound - 1] || getPlaceholderPrompt('speed-rounds', newRound);
      setPromptText(nextQ);
      const voiceOn = await getVoiceEnabled();
      if (!isScreenActiveRef.current) return;
      if (voiceOn && nextQ) {
        setIsSpeaking(true);
        await speakWithTimeout(nextQ, estimateSpeakTimeout(nextQ));
        setIsSpeaking(false);
      }
      if (!isScreenActiveRef.current) return;
      await autoStartRound(15, true);
    } else if (isHotTake) {
      setIsPromptLoading(true);
      let topic = '';
      try {
        topic = await generatePrompt('hot-take', { usedTopics: usedHotTakeTopicsRef.current });
      } catch (e) {
        topic = getPlaceholderPrompt('hot-take', newRound);
      }
      if (!isScreenActiveRef.current) return;
      const topicText = (topic && topic.trim()) || getPlaceholderPrompt('hot-take', newRound);
      usedHotTakeTopicsRef.current = [...usedHotTakeTopicsRef.current, topicText];
      setIsPromptLoading(false);
      setPromptText(topicText);
      topic = topicText;
      const voiceOn = await getVoiceEnabled();
      if (!isScreenActiveRef.current) return;
      if (voiceOn && topic) {
        setIsSpeaking(true);
        await speakWithTimeout(topic, estimateSpeakTimeout(topic));
        setIsSpeaking(false);
      }
      if (!isScreenActiveRef.current) return;
      await autoStartRound(15, false);
    } else if (isQuickDraw) {
      setIsPromptLoading(true);
      let scenario = '';
      try {
        scenario = await generatePrompt('quick-draw', { usedSettings: usedQuickDrawSettingsRef.current });
      } catch (e) {
        scenario = getPlaceholderPrompt('quick-draw', newRound);
      }
      if (!isScreenActiveRef.current) return;
      const scenarioText = (scenario && scenario.trim()) || getPlaceholderPrompt('quick-draw', newRound);
      usedQuickDrawSettingsRef.current = [...usedQuickDrawSettingsRef.current, scenarioText];
      setIsPromptLoading(false);
      setPromptText(scenarioText);
      const voiceOn = await getVoiceEnabled();
      if (!isScreenActiveRef.current) return;
      if (voiceOn && scenarioText) {
        setIsSpeaking(true);
        await speakWithTimeout(scenarioText, estimateSpeakTimeout(scenarioText));
        setIsSpeaking(false);
      }
      if (!isScreenActiveRef.current) return;
      await autoStartRound(10, true);
    } else if (isHeckler) {
      setIsPromptLoading(true);
      try {
        const { scenario, heckle } = await generateHecklerScenario({
          usedScenarios: usedHecklerScenariosRef.current,
        });
        if (!isScreenActiveRef.current) return;
        const scenarioText = (scenario && scenario.trim()) || getPlaceholderPrompt('quick-draw', newRound);
        const heckleText = (heckle && heckle.trim()) || 'Can you get to the point?';
        usedHecklerScenariosRef.current = [...usedHecklerScenariosRef.current, scenarioText];
        currentHecklerScenarioRef.current = scenarioText;
        currentHeckleRef.current = heckleText;
        setIsPromptLoading(false);
        setPromptText(scenarioText);
        const voiceOn = await getVoiceEnabled();
        if (!isScreenActiveRef.current) return;
        if (voiceOn && scenarioText) {
          setIsSpeaking(true);
          await speakWithTimeout(scenarioText, estimateSpeakTimeout(scenarioText));
          setIsSpeaking(false);
        }
        if (!isScreenActiveRef.current) return;
        await startHecklerInitialPhase();
      } catch (e) {
        if (isScreenActiveRef.current) {
          setIsPromptLoading(false);
          const fallbackScenario = getPlaceholderPrompt('quick-draw', newRound);
          currentHecklerScenarioRef.current = fallbackScenario;
          currentHeckleRef.current = 'Can you get to the point?';
          setPromptText(fallbackScenario);
          await startHecklerInitialPhase();
        }
      }
    }
  };

  // ─── Load initial prompt ─────────────────────────────────────────────────────

  const loadPrompt = async () => {
    if (!isScreenActiveRef.current) return;
    setPromptError(null);
    setIsPromptLoading(true);
    setMicPermissionDenied(false);
    clearTimers();
    roundLock.current = false;

    try {
      if (isSpeedRounds) {
        const questions = await generateSpeedRoundsQuestions();
        if (!isScreenActiveRef.current) return;
        speedQuestionsRef.current = questions;
        setSpeedQuestions(questions);
        const firstQ = questions[0] || getPlaceholderPrompt('speed-rounds', 1);
        setPromptText(firstQ);
        lastSpokenPromptRef.current = firstQ;
        setIsPromptLoading(false);
        const voiceOn = await getVoiceEnabled();
        if (!isScreenActiveRef.current) return;
        if (voiceOn) {
          setIsSpeaking(true);
          await speakWithTimeout(firstQ, estimateSpeakTimeout(firstQ));
          setIsSpeaking(false);
        }
        if (!isScreenActiveRef.current) return;
        await autoStartRound(15, true);
        return;
      }

      if (isHotTake) {
        const topic = await generatePrompt('hot-take', { usedTopics: usedHotTakeTopicsRef.current });
        if (!isScreenActiveRef.current) return;
        const topicText = (topic && topic.trim()) || getPlaceholderPrompt('hot-take', 1);
        usedHotTakeTopicsRef.current = [...usedHotTakeTopicsRef.current, topicText];
        setPromptText(topicText);
        lastSpokenPromptRef.current = topicText;
        setIsPromptLoading(false);
        const voiceOn = await getVoiceEnabled();
        if (!isScreenActiveRef.current) return;
        if (voiceOn) {
          setIsSpeaking(true);
          await speakWithTimeout(topicText, estimateSpeakTimeout(topicText));
          setIsSpeaking(false);
        }
        if (!isScreenActiveRef.current) return;
        await autoStartRound(15, false);
        return;
      }

      if (isHeckler) {
        const { scenario, heckle } = await generateHecklerScenario({
          usedScenarios: usedHecklerScenariosRef.current,
        });
        if (!isScreenActiveRef.current) return;
        const scenarioText = (scenario && scenario.trim()) || getPlaceholderPrompt('quick-draw', 1);
        const heckleText = (heckle && heckle.trim()) || 'Can you get to the point?';
        usedHecklerScenariosRef.current = [...usedHecklerScenariosRef.current, scenarioText];
        currentHecklerScenarioRef.current = scenarioText;
        currentHeckleRef.current = heckleText;
        setPromptText(scenarioText);
        lastSpokenPromptRef.current = scenarioText;
        setIsPromptLoading(false);
        const voiceOn = await getVoiceEnabled();
        if (!isScreenActiveRef.current) return;
        if (voiceOn) {
          setIsSpeaking(true);
          await speakWithTimeout(scenarioText, estimateSpeakTimeout(scenarioText));
          setIsSpeaking(false);
        }
        if (!isScreenActiveRef.current) return;
        await startHecklerInitialPhase();
        return;
      }

      if (isQuickDraw) {
        const scenario = await generatePrompt('quick-draw', { usedSettings: usedQuickDrawSettingsRef.current });
        if (!isScreenActiveRef.current) return;
        const scenarioText = (scenario && scenario.trim()) || getPlaceholderPrompt('quick-draw', 1);
        usedQuickDrawSettingsRef.current = [...usedQuickDrawSettingsRef.current, scenarioText];
        setPromptText(scenarioText);
        lastSpokenPromptRef.current = scenarioText;
        setIsPromptLoading(false);
        const voiceOn = await getVoiceEnabled();
        if (!isScreenActiveRef.current) return;
        if (voiceOn) {
          setIsSpeaking(true);
          await speakWithTimeout(scenarioText, estimateSpeakTimeout(scenarioText));
          setIsSpeaking(false);
        }
        if (!isScreenActiveRef.current) return;
        await autoStartRound(10, true);
        return;
      }

      if (isReframe) {
        const text = await generatePrompt('reframe');
        if (!isScreenActiveRef.current) return;
        const textToShow = (text && text.trim()) ? text.trim() : getPlaceholderPrompt('reframe', 1);
        setPromptText(textToShow);
        setIsPromptLoading(false);
        return;
      }

      const text = await generatePrompt(exerciseTypeParam || 'unknown');
      if (!isScreenActiveRef.current) return;
      const textToShow = (text && text.trim()) ? text.trim() : getPlaceholderPrompt(exerciseTypeParam, round);
      setPromptText(textToShow);
      setIsPromptLoading(false);
    } catch (error) {
      if (isScreenActiveRef.current) {
        setPromptError('Could not reach your improv coach. Tap retry to load a new prompt.');
        const fallbackText = getPlaceholderPrompt(exerciseTypeParam, round);
        setPromptText(fallbackText);
        setIsPromptLoading(false);
      }
    }
  };

  // Preflight: request mic permission as soon as gate allows, before any session startup.
  useEffect(() => {
    if (gateState !== 'allowed') return;
    let cancelled = false;
    requestMicPermission().then(({ granted, canAskAgain }) => {
      if (cancelled) return;
      canAskMicAgainRef.current = canAskAgain;
      setPermissionState(granted ? 'granted' : 'denied');
    });
    return () => { cancelled = true; };
  }, [gateState]);

  useEffect(() => {
    if (gateState !== 'allowed' || permissionState !== 'granted') return;
    loadPrompt();
    return () => {
      clearTimers();
      stopSpeaking();
      speechStopRecording().catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gateState, permissionState]);

  // Clean up narration/playback when session screen loses focus or unmounts (Expo AV stopAsync + unloadAsync via stopSpeaking).
  useFocusEffect(
    useCallback(() => {
      isScreenActiveRef.current = true;
      return () => {
        isScreenActiveRef.current = false;
        clearTimers();
        stopSpeaking();
        speechStopRecording().catch(() => {});
      };
    }, []),
  );

  // TTS for manual exercises (Quick Draw, New Choice, Reframe, Daily)
  useEffect(() => {
    if (!promptText || isPromptLoading || isAutoExercise) return;
    if (lastSpokenPromptRef.current === promptText) return;
    lastSpokenPromptRef.current = promptText;
    let cancelled = false;
    getVoiceEnabled().then((enabled) => {
      if (cancelled) return;
      if (!enabled) { setIsSpeaking(false); return; }
      setIsSpeaking(true);
      speakText(promptText)
        .then(() => { if (!cancelled) setIsSpeaking(false); })
        .catch(() => { if (!cancelled) setIsSpeaking(false); });
    });
    return () => { cancelled = true; };
  }, [promptText, isPromptLoading, isAutoExercise]);

  // Backup TTS for manual exercises
  useEffect(() => {
    if (!promptText || isPromptLoading || isSpeaking || isAutoExercise) return;
    if (lastSpokenPromptRef.current === promptText) return;
    const t = setTimeout(() => {
      if (lastSpokenPromptRef.current === promptText) return;
      lastSpokenPromptRef.current = promptText;
      getVoiceEnabled().then((enabled) => {
        if (!enabled) { setIsSpeaking(false); return; }
        setIsSpeaking(true);
        speakText(promptText).then(() => setIsSpeaking(false)).catch(() => setIsSpeaking(false));
      });
    }, 300);
    return () => clearTimeout(t);
  }, [promptText, isPromptLoading, isSpeaking, isAutoExercise]);

  // Waveform animation while recording
  useEffect(() => {
    if (!isRecording) {
      waveformAnims.forEach((a) => a.setValue(0.3));
      if (waveformLoop.current) { waveformLoop.current.stop(); waveformLoop.current = null; }
      micPulseScale.setValue(1);
      return;
    }
    const pulseAnim = Animated.loop(
      Animated.sequence([
        Animated.timing(micPulseScale, { toValue: 1.12, duration: 400, useNativeDriver: true }),
        Animated.timing(micPulseScale, { toValue: 1, duration: 400, useNativeDriver: true }),
      ]),
    );
    pulseAnim.start();
    const runBar = (index) => {
      Animated.sequence([
        Animated.timing(waveformAnims[index], { toValue: 0.3 + Math.random() * 0.7, duration: 120 + Math.random() * 180, useNativeDriver: true }),
        Animated.timing(waveformAnims[index], { toValue: 0.3 + Math.random() * 0.7, duration: 120 + Math.random() * 180, useNativeDriver: true }),
      ]).start(() => { if (waveformLoop.current !== null) runBar(index); });
    };
    waveformAnims.forEach((_, i) => runBar(i));
    waveformLoop.current = { stop: () => { waveformLoop.current = null; } };
    return () => {
      pulseAnim.stop();
      waveformLoop.current = null;
    };
  }, [isRecording, micPulseScale, waveformAnims]);

  // ─── Manual mic handlers (Quick Draw, Reframe, Daily) ────────────────────────

  const handleMicPressIn = async () => {
    if (isPromptLoading || isSubmitting || isTranscribing) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    stopSpeaking();
    setIsSpeaking(false);
    const result = await speechStartRecording();
    if (result.success) {
      setMicPermissionDenied(false);
      setTranscriptPreview('');
      setIsRecording(true);
    } else {
      if (result.error === 'MIC_PERMISSION_DENIED') setMicPermissionDenied(true);
    }
  };

  const handleMicPressOut = async () => {
    if (!isRecording) return;
    setIsRecording(false);
    setIsTranscribing(true);
    setSubmitError(null);

    const STOP_TIMEOUT_MS = 20000;
    const stopWithTimeout = () =>
      Promise.race([
        speechStopRecording(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('TRANSCRIBE_TIMEOUT')), STOP_TIMEOUT_MS),
        ),
      ]);

    let result;
    try {
      result = await stopWithTimeout();
    } catch (e) {
      if (isScreenActiveRef.current) {
        setIsTranscribing(false);
        setSubmitError(
          e?.message === 'TRANSCRIBE_TIMEOUT'
            ? 'Transcription took too long. Try again or use Type instead.'
            : 'Something went wrong. Try again or use Type instead.',
        );
      }
      return;
    }

    const transcript = (result.text || '').trim();
    setIsTranscribing(false);

    if (!transcript) {
      setTranscriptPreview('');
      setSubmitError('No speech detected. Try again or use Type instead.');
      return;
    }

    setTranscriptPreview(transcript);
    const clearPreviewAfter = () => {
      setTimeout(() => setTranscriptPreview(''), TRANSCRIPT_PREVIEW_MS);
    };
    const currentPrompt = promptText || getPlaceholderPrompt(exerciseTypeParam, round);

    // Reframe: 3 rounds — accumulate then evaluate all at the end
    if (isReframe) {
      const currentRound = roundRef.current;
      const updatedResponses = [
        ...allResponsesRef.current,
        { prompt: currentPrompt, response: transcript || '(no response)' },
      ];
      allResponsesRef.current = updatedResponses;
      setAllResponses(updatedResponses);

      if (currentRound >= totalRoundsRef.current) {
        const combinedPrompt = updatedResponses
          .map((r, i) => `Q${i + 1}: ${r.prompt}\nA${i + 1}: ${r.response}`)
          .join('\n\n');
        const combinedResponse = updatedResponses
          .map((r, i) => `${i + 1}. ${r.response}`)
          .join('\n');
        setIsSubmitting(true);
        try {
          const evaluation = await evaluateResponse(
            'reframe',
            combinedPrompt,
            combinedResponse,
          );
          clearPreviewAfter();
          await updateProgress({ exerciseType: 'reframe', overallScore: evaluation.overallScore });
          router.replace({
            pathname: '/results',
            params: {
              exerciseType: 'reframe',
              prompt: combinedPrompt || '',
              overallScore: String(evaluation.overallScore),
              speedScore: String(evaluation.speedScore),
              creativityScore: String(evaluation.creativityScore),
              relevanceScore: String(evaluation.relevanceScore),
              coachFeedback: evaluation.coachFeedback,
              highlights: JSON.stringify(evaluation.highlights || []),
            },
          });
        } catch (err) {
          if (isScreenActiveRef.current) setSubmitError('Could not get coaching. Try again or use Type instead.');
        } finally {
          if (isScreenActiveRef.current) setIsSubmitting(false);
        }
        return;
      }

      const nextRound = currentRound + 1;
      roundRef.current = nextRound;
      setRound(nextRound);
      clearPreviewAfter();
      setIsPromptLoading(true);
      try {
        const nextText = await generatePrompt('reframe');
        const textToShow = (nextText && nextText.trim()) ? nextText.trim() : getPlaceholderPrompt('reframe', nextRound);
        setPromptText(textToShow);
      } catch (_e) {
        if (isScreenActiveRef.current) setPromptText(getPlaceholderPrompt('reframe', nextRound));
      } finally {
        if (isScreenActiveRef.current) setIsPromptLoading(false);
      }
      return;
    }

    // Quick Draw, Daily: single round — evaluate and go to results
    setIsSubmitting(true);
    try {
      const evaluation = await evaluateResponse(exerciseTypeParam || 'unknown', currentPrompt, transcript);
      clearPreviewAfter();
      await updateProgress({ exerciseType: exerciseTypeParam || 'unknown', overallScore: evaluation.overallScore });
      router.replace({
        pathname: '/results',
        params: {
          exerciseType: exerciseTypeParam || 'unknown',
          prompt: currentPrompt || '',
          overallScore: String(evaluation.overallScore),
          speedScore: String(evaluation.speedScore),
          creativityScore: String(evaluation.creativityScore),
          relevanceScore: String(evaluation.relevanceScore),
          coachFeedback: evaluation.coachFeedback,
          highlights: JSON.stringify(evaluation.highlights || []),
        },
      });
    } catch (err) {
      if (isScreenActiveRef.current) setSubmitError('Could not get coaching. Try again or use Type instead.');
    } finally {
      if (isScreenActiveRef.current) setIsSubmitting(false);
    }
  };

  const handleSubmit = async () => {
    if (!userInput.trim() || isSubmitting || isPromptLoading) return;

    setSubmitError(null);
    setIsSubmitting(true);
    const currentPrompt = promptText || getPlaceholderPrompt(exerciseTypeParam, round);
    const responseText = userInput.trim();

    if (isReframe) {
      const currentRound = roundRef.current;
      const updatedResponses = [
        ...allResponsesRef.current,
        { prompt: currentPrompt, response: responseText || '(no response)' },
      ];
      allResponsesRef.current = updatedResponses;
      setAllResponses(updatedResponses);

      if (currentRound >= totalRoundsRef.current) {
        const combinedPrompt = updatedResponses
          .map((r, i) => `Q${i + 1}: ${r.prompt}\nA${i + 1}: ${r.response}`)
          .join('\n\n');
        const combinedResponse = updatedResponses
          .map((r, i) => `${i + 1}. ${r.response}`)
          .join('\n');
        try {
          const evaluation = await evaluateResponse(
            'reframe',
            combinedPrompt,
            combinedResponse,
          );
          setUserInput('');
          await updateProgress({ exerciseType: 'reframe', overallScore: evaluation.overallScore });
          router.replace({
            pathname: '/results',
            params: {
              exerciseType: 'reframe',
              prompt: combinedPrompt || '',
              overallScore: String(evaluation.overallScore),
              speedScore: String(evaluation.speedScore),
              creativityScore: String(evaluation.creativityScore),
              relevanceScore: String(evaluation.relevanceScore),
              coachFeedback: evaluation.coachFeedback,
              highlights: JSON.stringify(evaluation.highlights || []),
            },
          });
        } catch (err) {
          if (isScreenActiveRef.current) setSubmitError('Your coach had trouble scoring that response. Check your connection and try again.');
        } finally {
          if (isScreenActiveRef.current) setIsSubmitting(false);
        }
        return;
      }

      const nextRound = currentRound + 1;
      roundRef.current = nextRound;
      setRound(nextRound);
      setUserInput('');
      setIsSubmitting(false);
      setIsPromptLoading(true);
      try {
        const nextText = await generatePrompt('reframe');
        const textToShow = (nextText && nextText.trim()) ? nextText.trim() : getPlaceholderPrompt('reframe', nextRound);
        setPromptText(textToShow);
      } catch (_e) {
        if (isScreenActiveRef.current) setPromptText(getPlaceholderPrompt('reframe', nextRound));
      } finally {
        if (isScreenActiveRef.current) setIsPromptLoading(false);
      }
      return;
    }

    try {
      const evaluation = await evaluateResponse(exerciseTypeParam || 'unknown', currentPrompt, responseText);
      setUserInput('');
      await updateProgress({ exerciseType: exerciseTypeParam || 'unknown', overallScore: evaluation.overallScore });
      router.replace({
        pathname: '/results',
        params: {
          exerciseType: exerciseTypeParam || 'unknown',
          prompt: currentPrompt || '',
          overallScore: String(evaluation.overallScore),
          speedScore: String(evaluation.speedScore),
          creativityScore: String(evaluation.creativityScore),
          relevanceScore: String(evaluation.relevanceScore),
          coachFeedback: evaluation.coachFeedback,
          highlights: JSON.stringify(evaluation.highlights || []),
        },
      });
    } catch (error) {
      if (isScreenActiveRef.current) setSubmitError('Your coach had trouble scoring that response. Check your connection and try again.');
    } finally {
      if (isScreenActiveRef.current) setIsSubmitting(false);
    }
  };

  useEffect(() => {
    if (gateState === 'paywall') {
      isScreenActiveRef.current = false;
      clearTimers();
      stopSpeaking();
      setIsSpeaking(false);
      setIsRecording(false);
      setAutoRecording(false);
      setIsTranscribing(false);
      speechStopRecording().catch(() => {}).then(() => {
        router.replace('/paywall');
      });
    }
  }, [gateState, router]);

  // ─── JSX ─────────────────────────────────────────────────────────────────────

  const showRoundCount = isHeckler || isSpeedRounds || isHotTake || isReframe;

  if (gateState === 'checking' || gateState === 'paywall' || (gateState === 'allowed' && permissionState === 'checking')) {
    return (
      <GradientBackground>
        <View style={styles.container}>
          <View style={styles.gateLoadingWrap}>
            <ActivityIndicator size="large" color={COLORS.accent} />
            <Text style={styles.gateLoadingText}>
              {gateState === 'paywall' ? 'Redirecting…' : 'Loading…'}
            </Text>
          </View>
        </View>
      </GradientBackground>
    );
  }

  if (gateState === 'allowed' && permissionState === 'denied') {
    return (
      <GradientBackground>
        <SafeAreaView edges={['top', 'bottom']} style={styles.safeArea}>
          <View style={styles.micBlockedWrap}>
            <Ionicons name="mic-off-outline" size={56} color={COLORS.accent} style={{ marginBottom: 20 }} />
            <Text style={styles.micBlockedTitle}>Microphone Access Required</Text>
            <Text style={styles.micBlockedBody}>
              QuickWit needs microphone access to record your responses during sessions.
            </Text>
            {canAskMicAgainRef.current ? (
              <Pressable
                onPress={() => {
                  requestMicPermission().then(({ granted, canAskAgain }) => {
                    canAskMicAgainRef.current = canAskAgain;
                    setPermissionState(granted ? 'granted' : 'denied');
                  });
                }}
                style={styles.micBlockedBtn}
              >
                <Text style={styles.micBlockedBtnText}>Enable Microphone</Text>
              </Pressable>
            ) : null}
            <Pressable
              onPress={() => Linking.openSettings()}
              style={[styles.micBlockedBtn, styles.micBlockedBtnSecondary]}
            >
              <Text style={styles.micBlockedBtnTextSecondary}>Open Settings</Text>
            </Pressable>
            <Pressable
              onPress={() => router.back()}
              style={styles.micBlockedBack}
            >
              <Text style={styles.micBlockedBackText}>Go Back</Text>
            </Pressable>
          </View>
        </SafeAreaView>
      </GradientBackground>
    );
  }

  return (
    <GradientBackground>
      <View style={styles.container}>
        <SafeAreaView edges={['top', 'bottom']} style={styles.safeArea}>
          <View style={styles.topBar}>
            <View style={styles.roundPill}>
              <Text style={styles.roundText}>
                {showRoundCount ? `Round ${round} of ${totalRounds}` : `Round ${round}`}
              </Text>
            </View>
            <View style={styles.exerciseTag}>
              <Ionicons name="sparkles-outline" size={16} color={COLORS.accent} />
              <Text style={styles.exerciseTagText}>{exerciseLabel}</Text>
            </View>
          </View>

          <KeyboardAvoidingView
            style={styles.keyboardAvoid}
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          >
            <ScrollView
              style={styles.contentScroll}
              contentContainerStyle={styles.contentScrollContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              {/* ── Prompt card ── */}
              <View style={styles.promptCard}>
                <Text style={styles.promptLabel}>
                  {isHotTake ? 'Topic' : 'Prompt'}
                </Text>
                {isPromptLoading ? (
                  <View style={styles.promptLoadingRow}>
                    <ActivityIndicator size="small" color={COLORS.accent} />
                    <Text style={styles.promptLoadingText}>
                      {isSpeedRounds ? 'Loading questions...' : 'Asking your improv coach...'}
                    </Text>
                  </View>
                ) : (
                  <Text style={[styles.promptText, isHotTake && styles.topicText]}>
                    {promptText || getPlaceholderPrompt(exerciseTypeParam, round)}
                  </Text>
                )}
                {promptError ? (
                  <View style={styles.errorRow}>
                    <Text style={styles.errorText}>{promptError}</Text>
                    <Pressable style={styles.retryButton} onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); loadPrompt(); }}>
                      <Text style={styles.retryButtonText}>Retry</Text>
                    </Pressable>
                  </View>
                ) : null}
              </View>
            </ScrollView>

            {/* ── Input area ── */}
            <View style={styles.inputWrapper}>

              {/* AUTO-RECORDING UI — Speed Rounds, Hot Take, Quick Draw, Heckler */}
              {isAutoExercise ? (
                <>
                  {/* Countdown timer */}
                  {roundTimer > 0 && (
                    <View style={styles.timerRow}>
                      <Ionicons name="timer-outline" size={18} color={roundTimer <= 3 ? COLORS.accent : COLORS.muted} />
                      <Text style={[styles.timerText, roundTimer <= 3 && styles.timerTextUrgent]}>
                        {roundTimer}s
                      </Text>
                    </View>
                  )}

                  {/* Recording / transcribing / submitting states */}
                  {isTranscribing || isSubmitting ? (
                    <View style={styles.thinkingRow}>
                      <ActivityIndicator size="small" color={COLORS.accent} />
                      <Text style={styles.thinkingText}>
                        {isSubmitting ? 'Getting your coaching...' : 'Transcribing...'}
                      </Text>
                    </View>
                  ) : isPromptLoading ? (
                    <View style={styles.thinkingRow}>
                      <ActivityIndicator size="small" color={COLORS.accent} />
                      <Text style={styles.thinkingText}>Loading next round...</Text>
                    </View>
                  ) : (
                    <View style={styles.autoRecordSection}>
                      {/* Waveform indicator */}
                      <View style={[styles.autoMicIndicator, isRecording && styles.autoMicIndicatorActive]}>
                        {isRecording ? (
                          <View style={styles.waveformContainer}>
                            {waveformAnims.map((anim, i) => (
                              <Animated.View
                                key={i}
                                style={[
                                  styles.waveformBar,
                                  { opacity: 0.9, transform: [{ scaleY: anim }] },
                                ]}
                              />
                            ))}
                          </View>
                        ) : (
                          <Ionicons name="mic" size={32} color={COLORS.muted} />
                        )}
                      </View>
                      <Text style={styles.autoRecordHint}>
                        {isSpeaking && !isRecording
                          ? 'Narrating...'
                          : isRecording
                            ? 'Listening — speak now'
                            : 'Preparing mic...'}
                      </Text>
                      {/* Tap to finish early */}
                      {isRecording && (
                        <Pressable
                          style={styles.finishEarlyButton}
                          onPress={() => {
                            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                            autoFinishRound();
                          }}
                        >
                          <Text style={styles.finishEarlyText}>Done speaking</Text>
                          <Ionicons name="checkmark" size={14} color={COLORS.accent} />
                        </Pressable>
                      )}
                    </View>
                  )}

                  {submitError ? (
                    <Text style={[styles.errorText, { textAlign: 'center', marginTop: 8 }]}>{submitError}</Text>
                  ) : null}
                </>
              ) : showTextInputFallback ? (
                /* TEXT INPUT FALLBACK — manual exercises */
                <>
                  <Text style={styles.inputLabel}>Your response (text)</Text>
                  <TextInput
                    style={styles.input}
                    value={userInput}
                    onChangeText={setUserInput}
                    placeholder="Type your quick-witted response here..."
                    placeholderTextColor={COLORS.muted}
                    multiline
                    editable={!isSubmitting && !isPromptLoading}
                  />
                  {submitError ? <Text style={styles.errorText}>{submitError}</Text> : null}
                  <Pressable
                    style={[
                      styles.submitButton,
                      (!userInput.trim() || isSubmitting || isPromptLoading) && styles.submitButtonDisabled,
                    ]}
                    onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); handleSubmit(); }}
                    disabled={!userInput.trim() || isSubmitting || isPromptLoading}
                  >
                    {isSubmitting ? (
                      <ActivityIndicator size="small" color={COLORS.text} />
                    ) : (
                      <View style={styles.submitContentRow}>
                        <Text style={styles.submitButtonText}>Submit for coaching</Text>
                        <Ionicons name="arrow-forward" size={18} color={COLORS.text} />
                      </View>
                    )}
                  </Pressable>
                  <Pressable
                    style={styles.typeInsteadLink}
                    onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setShowTextInputFallback(false); }}
                  >
                    <Text style={styles.typeInsteadText}>Use voice instead</Text>
                  </Pressable>
                </>
              ) : (
                /* HOLD-TO-RECORD MIC — manual exercises */
                <>
                  {micPermissionDenied ? (
                    <Text style={styles.errorText}>Microphone access was denied. Use Type instead.</Text>
                  ) : null}
                  {isTranscribing ? (
                    <View style={styles.thinkingRow}>
                      <ActivityIndicator size="small" color={COLORS.accent} />
                      <Text style={styles.thinkingText}>Thinking...</Text>
                    </View>
                  ) : null}
                  {transcriptPreview ? (
                    <View style={styles.transcriptPreviewBubble}>
                      <Text style={styles.transcriptPreviewLabel}>You said</Text>
                      <Text style={styles.transcriptPreviewText}>{transcriptPreview}</Text>
                    </View>
                  ) : null}
                  {!isTranscribing && !transcriptPreview ? (
                    <View style={styles.micSection}>
                      <Text style={styles.micHint}>
                        {isSpeaking
                          ? 'Narration playing — tap mic to stop and record'
                          : isRecording
                            ? 'Recording... release to send'
                            : 'Hold to speak your response'}
                      </Text>
                      <Pressable
                        onPressIn={handleMicPressIn}
                        onPressOut={handleMicPressOut}
                        style={[
                          styles.micPressable,
                          (isPromptLoading || isSubmitting || isTranscribing) && styles.micPressableDisabled,
                        ]}
                        disabled={isPromptLoading || isSubmitting || isTranscribing}
                      >
                        <Animated.View
                          style={[
                            styles.micButton,
                            {
                              transform: [{ scale: isRecording ? micPulseScale : 1 }],
                              backgroundColor: isRecording ? COLORS.accent : '#0F172A',
                              borderColor: isRecording ? 'rgba(233,69,96,0.8)' : 'rgba(255,255,255,0.14)',
                            },
                          ]}
                        >
                          {isRecording ? (
                            <View style={styles.waveformContainer}>
                              {waveformAnims.map((anim, i) => (
                                <Animated.View
                                  key={i}
                                  style={[
                                    styles.waveformBar,
                                    { opacity: 0.9, transform: [{ scaleY: anim }] },
                                  ]}
                                />
                              ))}
                            </View>
                          ) : (
                            <Ionicons name="mic" size={40} color={COLORS.accent} />
                          )}
                        </Animated.View>
                      </Pressable>
                      <Text style={styles.micSubHint}>
                        {isPromptLoading || isSubmitting || isTranscribing ? 'Wait...' : 'Press and hold'}
                      </Text>
                    </View>
                  ) : null}
                  {submitError ? <Text style={styles.errorText}>{submitError}</Text> : null}
                  <Pressable
                    style={styles.typeInsteadLink}
                    onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setShowTextInputFallback(true); }}
                  >
                    <Text style={styles.typeInsteadText}>Type instead</Text>
                  </Pressable>
                </>
              )}
            </View>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </View>
    </GradientBackground>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  gateLoadingWrap: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
  },
  gateLoadingText: {
    color: COLORS.muted,
    fontSize: 15,
  },
  micBlockedWrap: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
    gap: 0,
  },
  micBlockedTitle: {
    color: COLORS.text,
    fontSize: 22,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 12,
  },
  micBlockedBody: {
    color: COLORS.muted,
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 32,
  },
  micBlockedBtn: {
    backgroundColor: COLORS.accent,
    borderRadius: 999,
    paddingVertical: 14,
    paddingHorizontal: 32,
    alignItems: 'center',
    width: '100%',
    marginBottom: 12,
  },
  micBlockedBtnText: {
    color: COLORS.text,
    fontSize: 16,
    fontWeight: '600',
  },
  micBlockedBtnSecondary: {
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderColor: COLORS.muted,
  },
  micBlockedBtnTextSecondary: {
    color: COLORS.text,
    fontSize: 16,
    fontWeight: '500',
  },
  micBlockedBack: {
    marginTop: 8,
    paddingVertical: 12,
  },
  micBlockedBackText: {
    color: COLORS.muted,
    fontSize: 15,
  },
  safeArea: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 24,
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 18,
  },
  roundPill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#0F172A',
  },
  roundText: { color: COLORS.text, fontSize: 13 },
  exerciseTag: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#0F172A',
    borderWidth: 1,
    borderColor: 'rgba(233,69,96,0.4)',
    gap: 6,
  },
  exerciseTagText: { color: COLORS.text, fontSize: 13 },
  keyboardAvoid: { flex: 1 },
  contentScroll: { flex: 1 },
  contentScrollContent: { flexGrow: 1, paddingBottom: 16 },
  promptCard: {
    backgroundColor: COLORS.card,
    borderRadius: 18,
    padding: 16,
    marginBottom: 16,
  },
  promptLabel: { color: COLORS.muted, fontSize: 12, marginBottom: 6 },
  promptText: { color: COLORS.text, fontSize: 16, lineHeight: 22 },
  topicText: { fontSize: 22, fontWeight: '700', lineHeight: 30 },
  promptLoadingRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  promptLoadingText: { color: COLORS.muted, fontSize: 13 },
  errorRow: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  errorText: { flex: 1, color: '#F97373', fontSize: 12 },
  retryButton: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: COLORS.accent,
  },
  retryButtonText: { color: COLORS.accent, fontSize: 12, fontWeight: '500' },
  inputWrapper: { marginTop: 8 },

  // Auto-recording (Speed Rounds / Hot Take)
  timerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginBottom: 12,
  },
  timerText: { color: COLORS.muted, fontSize: 20, fontWeight: '700' },
  timerTextUrgent: { color: COLORS.accent },
  autoRecordSection: { alignItems: 'center', marginBottom: 8 },
  autoMicIndicator: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: '#0F172A',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.14)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  autoMicIndicatorActive: {
    borderColor: 'rgba(233,69,96,0.8)',
    backgroundColor: COLORS.accent,
  },
  autoRecordHint: {
    color: COLORS.muted,
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 14,
  },
  finishEarlyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(233,69,96,0.4)',
  },
  finishEarlyText: { color: COLORS.accent, fontSize: 13, fontWeight: '500' },

  // Manual mic
  thinkingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  thinkingText: { color: COLORS.muted, fontSize: 14 },
  transcriptPreviewBubble: {
    backgroundColor: 'rgba(233,69,96,0.15)',
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: 'rgba(233,69,96,0.3)',
  },
  transcriptPreviewLabel: { color: COLORS.muted, fontSize: 11, marginBottom: 4 },
  transcriptPreviewText: { color: COLORS.text, fontSize: 14 },
  micSection: { alignItems: 'center', marginBottom: 8 },
  micHint: { color: COLORS.muted, fontSize: 13, marginBottom: 10, textAlign: 'center' },
  micPressable: { marginBottom: 4 },
  micPressableDisabled: { opacity: 0.5 },
  micButton: {
    width: 96,
    height: 96,
    borderRadius: 48,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
  },
  waveformContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 40,
  },
  waveformBar: {
    width: 5,
    height: 28,
    borderRadius: 3,
    backgroundColor: COLORS.text,
  },
  micSubHint: { color: COLORS.muted, fontSize: 12 },
  typeInsteadLink: { marginTop: 12, alignSelf: 'center' },
  typeInsteadText: { color: COLORS.accent, fontSize: 13 },
  inputLabel: { color: COLORS.muted, fontSize: 12, marginBottom: 6 },
  input: {
    minHeight: 80,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: COLORS.text,
    fontSize: 14,
    backgroundColor: '#0B1220',
    textAlignVertical: 'top',
  },
  submitButton: {
    marginTop: 12,
    borderRadius: 999,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.accent,
  },
  submitButtonDisabled: { opacity: 0.5 },
  submitButtonText: { color: COLORS.text, fontSize: 14, fontWeight: '600' },
  submitContentRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});
