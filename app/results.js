import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  Pressable,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { generateExampleResponse } from '../services/ai';
import GradientBackground from '../components/GradientBackground';

const COLORS = {
  background: '#1A1A2E',
  card: '#16213E',
  accent: '#E94560',
  text: '#FFFFFF',
  muted: '#A5B1C2',
};

const STREAK_KEY = 'quickwit_streak';
const BEST_STREAK_KEY = 'quickwit_best_streak';
const LAST_SESSION_DATE_KEY = 'quickwit_last_session_date';

function getTodayDateString() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function getYesterdayDateString() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const EXERCISE_DISPLAY_NAMES = {
  'quick-draw': 'Quick Draw',
  'speed-rounds': 'Speed Rounds',
  speedrounds: 'Speed Rounds',
  'hot-take': 'Hot Take',
  hottake: 'Hot Take',
  heckler: 'Heckler',
  reframe: 'Reframe',
  daily: 'Daily Session',
};

export default function ResultsScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const exerciseTypeParam =
    (params.exerciseType && String(params.exerciseType)) || 'session';

  const coachFeedback = React.useMemo(() => {
    if (params.coachFeedback) {
      return String(params.coachFeedback);
    }
    return '';
  }, [params.coachFeedback]);

  const promptForExample = React.useMemo(() => {
    if (params.prompt) return String(params.prompt).trim();
    return '';
  }, [params.prompt]);

  const highlights = React.useMemo(() => {
    if (!params.highlights) {
      return [];
    }
    try {
      const parsed = JSON.parse(String(params.highlights));
      if (Array.isArray(parsed)) {
        return parsed.map((item) => String(item)).filter((item) => item.length > 0);
      }
    } catch (e) {
      // ignore parse errors and fall back below
    }
    return [];
  }, [params.highlights]);

  const parsedScores = React.useMemo(() => {
    const overall = params.overallScore ? parseInt(String(params.overallScore), 10) : 0;
    const speed = params.speedScore ? parseInt(String(params.speedScore), 10) : 0;
    const creativity = params.creativityScore
      ? parseInt(String(params.creativityScore), 10)
      : 0;
    const relevance = params.relevanceScore
      ? parseInt(String(params.relevanceScore), 10)
      : 0;

    const safeOverall = Number.isNaN(overall) ? 0 : overall;
    const safeSpeed = Number.isNaN(speed) ? 0 : speed;
    const safeCreativity = Number.isNaN(creativity) ? 0 : creativity;
    const safeRelevance = Number.isNaN(relevance) ? 0 : relevance;

    if (
      safeOverall === 0 &&
      safeSpeed === 0 &&
      safeCreativity === 0 &&
      safeRelevance === 0
    ) {
      return {
        overall: 70,
        speed: 70,
        creativity: 70,
        relevance: 70,
      };
    }

    return {
      overall: safeOverall,
      speed: safeSpeed,
      creativity: safeCreativity,
      relevance: safeRelevance,
    };
  }, [
    params.overallScore,
    params.speedScore,
    params.creativityScore,
    params.relevanceScore,
  ]);

  const [scores] = useState(parsedScores);
  const [streak, setStreak] = useState(0);
  const [bestStreak, setBestStreak] = useState(0);
  const [isPersonalBest, setIsPersonalBest] = useState(false);
  const [exampleResponse, setExampleResponse] = useState('');
  const [exampleLoading, setExampleLoading] = useState(false);
  const [displayOverall, setDisplayOverall] = useState(0);
  const [displaySpeed, setDisplaySpeed] = useState(0);
  const [displayCreativity, setDisplayCreativity] = useState(0);
  const [displayRelevance, setDisplayRelevance] = useState(0);

  const overallAnim = useRef(new Animated.Value(0)).current;
  const speedAnim = useRef(new Animated.Value(0)).current;
  const creativityAnim = useRef(new Animated.Value(0)).current;
  const relevanceAnim = useRef(new Animated.Value(0)).current;
  const celebrationScale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    let isMounted = true;

    const loadStreaks = async () => {
      try {
        const today = getTodayDateString();
        const yesterday = getYesterdayDateString();

        const [currentRaw, bestRaw, lastDateRaw] = await Promise.all([
          AsyncStorage.getItem(STREAK_KEY),
          AsyncStorage.getItem(BEST_STREAK_KEY),
          AsyncStorage.getItem(LAST_SESSION_DATE_KEY),
        ]);

        const current = currentRaw ? parseInt(currentRaw, 10) : 0;
        const best = bestRaw ? parseInt(bestRaw, 10) : 0;
        const lastSessionDate = lastDateRaw || '';

        if (!isMounted) return;

        const safeCurrent = Number.isNaN(current) ? 0 : current;
        const safeBest = Number.isNaN(best) ? 0 : best;

        let newStreak = safeCurrent;
        if (lastSessionDate === today) {
          // Already completed a session today – don't change streak
          newStreak = safeCurrent;
        } else if (lastSessionDate === yesterday) {
          // Last session was yesterday – increment streak
          newStreak = safeCurrent + 1;
        } else {
          // Missed a day or first time – reset to 1
          newStreak = 1;
        }

        setStreak(newStreak);
        setBestStreak(safeBest);
        await AsyncStorage.setItem(LAST_SESSION_DATE_KEY, today);
        await AsyncStorage.setItem(STREAK_KEY, String(newStreak));

        if (newStreak > safeBest) {
          setBestStreak(newStreak);
          setIsPersonalBest(true);
          await AsyncStorage.setItem(BEST_STREAK_KEY, String(newStreak));
        }
      } catch (e) {
        // ignore read/write errors
      }
    };

    loadStreaks();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!promptForExample) return;
    let cancelled = false;
    setExampleLoading(true);
    generateExampleResponse(exerciseTypeParam, promptForExample)
      .then((text) => {
        if (!cancelled) setExampleResponse(text || '');
      })
      .catch(() => {
        if (!cancelled) setExampleResponse('');
      })
      .finally(() => {
        if (!cancelled) setExampleLoading(false);
      });
    return () => { cancelled = true; };
  }, [exerciseTypeParam, promptForExample]);

  useEffect(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const listenerId = overallAnim.addListener(({ value }) => {
      setDisplayOverall(Math.round(value));
    });
    const sid = speedAnim.addListener(({ value }) => setDisplaySpeed(Math.round(value)));
    const cid = creativityAnim.addListener(({ value }) => setDisplayCreativity(Math.round(value)));
    const rid = relevanceAnim.addListener(({ value }) => setDisplayRelevance(Math.round(value)));

    Animated.parallel([
      Animated.timing(overallAnim, {
        toValue: scores.overall,
        duration: 1000,
        useNativeDriver: false,
      }),
      Animated.timing(speedAnim, {
        toValue: scores.speed,
        duration: 1000,
        useNativeDriver: false,
      }),
      Animated.timing(creativityAnim, {
        toValue: scores.creativity,
        duration: 1000,
        useNativeDriver: false,
      }),
      Animated.timing(relevanceAnim, {
        toValue: scores.relevance,
        duration: 1000,
        useNativeDriver: false,
      }),
    ]).start();

    return () => {
      overallAnim.removeListener(listenerId);
      speedAnim.removeListener(sid);
      creativityAnim.removeListener(cid);
      relevanceAnim.removeListener(rid);
    };
  }, [overallAnim, speedAnim, creativityAnim, relevanceAnim, scores]);

  useEffect(() => {
    if (!isPersonalBest) return;

    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(celebrationScale, {
          toValue: 1.15,
          duration: 280,
          useNativeDriver: true,
        }),
        Animated.timing(celebrationScale, {
          toValue: 1,
          duration: 260,
          useNativeDriver: true,
        }),
      ]),
    );
    anim.start();

    return () => {
      anim.stop();
    };
  }, [celebrationScale, isPersonalBest]);

  const overallCircleScale = useMemo(
    () =>
      overallAnim.interpolate({
        inputRange: [0, 100],
        outputRange: [0.5, 1],
        extrapolate: 'clamp',
      }),
    [overallAnim],
  );

  const speedWidth = speedAnim.interpolate({
    inputRange: [0, 100],
    outputRange: ['0%', '100%'],
    extrapolate: 'clamp',
  });
  const creativityWidth = creativityAnim.interpolate({
    inputRange: [0, 100],
    outputRange: ['0%', '100%'],
    extrapolate: 'clamp',
  });
  const relevanceWidth = relevanceAnim.interpolate({
    inputRange: [0, 100],
    outputRange: ['0%', '100%'],
    extrapolate: 'clamp',
  });

  const handlePlayAgain = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.replace({
      pathname: '/session',
      params: { type: exerciseTypeParam },
    });
  };

  const handleHome = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.replace('/');
  };

  return (
    <GradientBackground>
      <View style={styles.container}>
      <SafeAreaView edges={['top', 'bottom']} style={styles.safeArea}>
        <View style={styles.headerRow}>
          <Text style={styles.headerTitle}>Session Summary</Text>
          <View style={styles.headerTag}>
            <Ionicons name="sparkles-outline" size={16} color={COLORS.accent} />
            <Text style={styles.headerTagText} numberOfLines={1}>
              {EXERCISE_DISPLAY_NAMES[exerciseTypeParam] || exerciseTypeParam}
            </Text>
          </View>
        </View>

        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.mainContent}>
            <View style={styles.scoreSection}>
            <View style={styles.scoreCircleOuter}>
              <Animated.View
                style={[
                  styles.scoreCircleInner,
                  { transform: [{ scale: overallCircleScale }] },
                ]}
              />
              <View style={styles.scoreCenter}>
                <Text style={styles.scoreLabel}>Score</Text>
                <Text style={styles.scoreValue}>{displayOverall}</Text>
                <Text style={styles.scoreOutOf}>out of 100</Text>
            </View>
          </View>
          </View>

          <View style={styles.subscoresSection}>
            <Text style={styles.subscoresTitle}>Breakdown</Text>

            <View style={styles.subscoreRow}>
              <Text style={styles.subscoreLabel}>Speed</Text>
              <Text style={styles.subscoreNumber}>{displaySpeed}</Text>
            </View>
            <View style={styles.progressTrack}>
              <Animated.View
                style={[styles.progressFill, { width: speedWidth }]}
              />
            </View>

            <View style={styles.subscoreRow}>
              <Text style={styles.subscoreLabel}>Creativity</Text>
              <Text style={styles.subscoreNumber}>{displayCreativity}</Text>
            </View>
            <View style={styles.progressTrack}>
              <Animated.View
                style={[styles.progressFill, { width: creativityWidth }]}
              />
            </View>

            <View style={styles.subscoreRow}>
              <Text style={styles.subscoreLabel}>Relevance</Text>
              <Text style={styles.subscoreNumber}>{displayRelevance}</Text>
            </View>
            <View style={styles.progressTrack}>
              <Animated.View
                style={[styles.progressFill, { width: relevanceWidth }]}
              />
            </View>
          </View>

          <View style={styles.notesSection}>
            <Text style={styles.notesTitle}>Coach&apos;s Notes</Text>
            <Text style={styles.notesText}>
              {coachFeedback && coachFeedback.length
                ? coachFeedback
                : 'This is where your AI improv coach will highlight what you did well, where you hesitated, and how to make your next scene even sharper.'}
            </Text>
            {highlights.length > 0 ? (
              <View style={styles.highlightsSection}>
                <Text style={styles.highlightsTitle}>Highlights</Text>
                {highlights.map((item, index) => (
                  <View key={`${item}-${index}`} style={styles.highlightBubble}>
                    <Text style={styles.highlightQuoteMark}>“</Text>
                    <Text style={styles.highlightText}>{item}</Text>
                  </View>
                ))}
              </View>
            ) : null}
          </View>

          {(exampleLoading || exampleResponse) ? (
            <View style={styles.exampleSection}>
              <Text style={styles.exampleTitle}>Example Response</Text>
              <Text style={styles.exampleLabel}>
                Here’s what a strong answer could look like — for inspiration only, not your response.
              </Text>
              {exampleLoading ? (
                <View style={styles.exampleLoadingRow}>
                  <ActivityIndicator size="small" color={COLORS.accent} />
                  <Text style={styles.exampleLoadingText}>Generating example…</Text>
                </View>
              ) : exampleResponse ? (
                <View style={styles.exampleBubble}>
                  <Text style={styles.exampleText}>{exampleResponse}</Text>
                </View>
              ) : null}
            </View>
          ) : null}

          <View style={styles.streakSection}>
            <Animated.View
              style={[
                styles.streakPill,
                isPersonalBest && { transform: [{ scale: celebrationScale }] },
              ]}
            >
              <Text style={styles.streakEmoji}>🔥</Text>
              <Text style={styles.streakText}>
                {streak} day{streak === 1 ? '' : 's'} streak
              </Text>
            </Animated.View>
            <Text style={styles.streakSubtle}>
              {isPersonalBest
                ? 'New personal best! Keep the momentum going.'
                : `Best streak: ${bestStreak} day${bestStreak === 1 ? '' : 's'}.`}
            </Text>
          </View>
        </View>
        </ScrollView>

        <View style={styles.buttonRow}>
          <Pressable
            onPress={handlePlayAgain}
            style={({ pressed }) => [
              styles.primaryButton,
              pressed && styles.primaryButtonPressed,
            ]}
          >
            <Text style={styles.primaryButtonText}>Play Again</Text>
          </Pressable>

          <Pressable
            onPress={handleHome}
            style={({ pressed }) => [
              styles.secondaryButton,
              pressed && styles.secondaryButtonPressed,
            ]}
          >
            <Text style={styles.secondaryButtonText}>Home</Text>
          </Pressable>
        </View>
      </SafeAreaView>
      </View>
    </GradientBackground>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 24,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  headerTitle: {
    color: COLORS.text,
    fontSize: 22,
    fontWeight: '700',
  },
  headerTag: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#0F172A',
    borderWidth: 1,
    borderColor: 'rgba(233,69,96,0.45)',
    gap: 6,
  },
  headerTagText: {
    color: COLORS.text,
    fontSize: 13,
    textTransform: 'capitalize',
  },
  mainContent: {
    flexGrow: 1,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 24,
  },
  scoreSection: {
    alignItems: 'center',
    marginBottom: 28,
  },
  scoreCircleOuter: {
    width: 160,
    height: 160,
    borderRadius: 80,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 4,
    borderColor: 'rgba(233,69,96,0.3)',
    backgroundColor: '#101827',
  },
  scoreCircleInner: {
    position: 'absolute',
    width: 130,
    height: 130,
    borderRadius: 65,
    borderWidth: 4,
    borderColor: COLORS.accent,
    opacity: 0.9,
  },
  scoreCenter: {
    alignItems: 'center',
  },
  scoreLabel: {
    color: COLORS.muted,
    fontSize: 13,
    marginBottom: 4,
  },
  scoreValue: {
    color: COLORS.text,
    fontSize: 40,
    fontWeight: '800',
  },
  scoreOutOf: {
    color: COLORS.muted,
    fontSize: 12,
    marginTop: 2,
  },
  subscoresSection: {
    marginBottom: 28,
  },
  subscoresTitle: {
    color: COLORS.text,
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 14,
  },
  subscoreRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 6,
  },
  subscoreLabel: {
    color: COLORS.text,
    fontSize: 14,
  },
  subscoreNumber: {
    color: COLORS.muted,
    fontSize: 13,
  },
  progressTrack: {
    height: 6,
    borderRadius: 999,
    backgroundColor: '#111827',
    overflow: 'hidden',
    marginTop: 6,
    marginBottom: 12,
  },
  progressFill: {
    height: '100%',
    backgroundColor: COLORS.accent,
  },
  notesSection: {
    backgroundColor: COLORS.card,
    borderRadius: 18,
    padding: 18,
    marginBottom: 24,
  },
  notesTitle: {
    color: COLORS.text,
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 10,
  },
  notesText: {
    color: COLORS.muted,
    fontSize: 13,
    lineHeight: 20,
  },
  highlightsSection: {
    marginTop: 14,
    gap: 8,
  },
  highlightsTitle: {
    color: COLORS.muted,
    fontSize: 12,
    marginBottom: 6,
  },
  highlightBubble: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: 'rgba(233,69,96,0.12)',
    marginBottom: 8,
  },
  highlightQuoteMark: {
    color: COLORS.accent,
    fontSize: 16,
    marginRight: 4,
    marginTop: -2,
  },
  highlightText: {
    flex: 1,
    color: COLORS.text,
    fontSize: 13,
  },
  exampleSection: {
    backgroundColor: COLORS.card,
    borderRadius: 18,
    padding: 18,
    marginBottom: 24,
  },
  exampleTitle: {
    color: COLORS.text,
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 6,
  },
  exampleLabel: {
    color: COLORS.muted,
    fontSize: 12,
    lineHeight: 18,
    marginBottom: 10,
  },
  exampleLoadingText: {
    color: COLORS.muted,
    fontSize: 13,
    fontStyle: 'italic',
  },
  exampleLoadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  exampleBubble: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: 'rgba(78, 205, 196, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(78, 205, 196, 0.35)',
  },
  exampleText: {
    color: COLORS.text,
    fontSize: 13,
    lineHeight: 20,
  },
  streakSection: {
    alignItems: 'center',
    marginTop: 8,
    marginBottom: 20,
  },
  streakPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#0F172A',
    borderWidth: 1,
    borderColor: 'rgba(233,69,96,0.5)',
    marginBottom: 4,
  },
  streakEmoji: {
    fontSize: 16,
    marginRight: 6,
  },
  streakText: {
    color: COLORS.text,
    fontSize: 14,
  },
  streakSubtle: {
    color: COLORS.muted,
    fontSize: 12,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 12,
    paddingBottom: 8,
  },
  primaryButton: {
    flex: 1,
    backgroundColor: COLORS.accent,
    borderRadius: 999,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.98 }],
  },
  primaryButtonText: {
    color: COLORS.text,
    fontSize: 16,
    fontWeight: '600',
  },
  secondaryButton: {
    flex: 1,
    borderRadius: 999,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
  },
  secondaryButtonPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.98 }],
  },
  secondaryButtonText: {
    color: COLORS.text,
    fontSize: 16,
    fontWeight: '500',
  },
});


