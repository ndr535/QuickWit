import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Modal,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { getProgress, clearPendingCelebration, STREAK_MILESTONES } from '../services/progress';
import ConfettiOverlay from '../components/ConfettiOverlay';
import GradientBackground from '../components/GradientBackground';
import { useAuth } from '../context/AuthContext';

const COLORS = {
  background: '#1A1A2E',
  card: '#16213E',
  accent: '#E94560',
  text: '#FFFFFF',
  muted: '#A5B1C2',
};

function streakFireEmoji(streak) {
  if (streak >= 30) return '🔥🔥🔥🔥';
  if (streak >= 14) return '🔥🔥🔥';
  if (streak >= 7) return '🔥🔥';
  if (streak >= 3) return '🔥';
  return '';
}

const EXERCISE_DISPLAY_NAMES = {
  'quick-draw': 'Quick Draw',
  'speed-rounds': 'Speed Rounds',
  speedrounds: 'Speed Rounds',
  'hot-take': 'Hot Take',
  hottake: 'Hot Take',
  heckler: 'Heckler',
  reframe: 'Reframe',
  daily: 'Daily',
};

const EXERCISES = [
  {
    id: 'quick-draw',
    title: 'Quick Draw',
    description: 'Hear a scenario and respond out loud with your first instinct.',
    duration: '~10 seconds per round',
    icon: 'flash-outline',
    instructions: {
      howItWorks: "The AI reads you a scenario. Respond immediately with the first thing that comes to mind — no pausing, no editing. You're scored on speed, creativity, and relevance.",
      skill: 'Trains: thinking on your feet and committing to your first instinct.',
      examplePrompt: 'Your boss asks you to present to the board in 5 minutes.',
      weakExample: '"Um, okay, I guess I\'ll just... wing it and see what happens."',
      strongExample: '"Perfect — I\'ve actually been rehearsing this one in the shower."',
    },
  },
  {
    id: 'speed-rounds',
    title: 'Speed Rounds',
    description: 'Rapid-fire questions. 8 seconds each. The mic auto-activates — no hesitation allowed.',
    duration: '5 rounds · 8 sec each',
    icon: 'timer-outline',
    instructions: {
      howItWorks: "5 rapid-fire questions in a row. The mic activates automatically after each question is read — no button to press. Answer before the 8-second timer runs out. If you go silent, the round ends and the next question starts. Non-answers count against your score.",
      skill: 'Trains: speed, wit under pressure, and variety of response.',
      examplePrompt: 'What\'s the worst superpower to have at a job interview?',
      weakExample: '"I don\'t know, maybe like, being invisible or something?"',
      strongExample: '"Uncontrollable jazz hands. Every time they ask about my strengths."',
    },
  },
  {
    id: 'hot-take',
    title: 'Hot Take',
    description: 'Get a mundane topic. Deliver a bold, specific, unapologetic opinion. No hedging.',
    duration: '5 rounds · 15 sec each',
    icon: 'flame-outline',
    instructions: {
      howItWorks: "You get a random mundane topic. Deliver a strong, confident, specific opinion — no hedging, no 'I think maybe.' A 15-second timer shows as guidance but won't cut you off. Stop speaking when you're done and the next round begins. After 5 rounds, you're scored on confidence and specificity.",
      skill: 'Trains: committing to a point of view and cutting filler language.',
      examplePrompt: 'Topic: ice in drinks.',
      weakExample: '"I mean, I kind of like ice, but I guess it depends on the drink."',
      strongExample: '"Ice is a scam. You paid for a drink, not 40% water slowly diluting your regret."',
    },
  },
  {
    id: 'heckler',
    title: 'Heckler',
    description: 'Get interrupted by a heckle mid-response, then recover with composure and wit.',
    duration: '3 rounds',
    icon: 'chatbubble-ellipses-outline',
    instructions: {
      howItWorks:
        "The AI sets up a high-stakes or awkward scenario and reads it out loud. The mic turns on and you start responding. After a random 8–15 seconds, your mic cuts and a pre-generated heckle plays — something sharp or sceptical. Then the mic turns back on and you deliver your recovery response. Only that recovery is scored. Three rounds, with a new scenario and heckle each time.",
      skill:
        'Trains: staying composed under interruption and turning a heckle into a confident, witty redirect.',
      examplePrompt:
        'Scenario: You are pitching your product to a room of sceptical executives. Heckle: "That sounds incredibly expensive — why would we ever pay for that?"',
      weakExample:
        'Recovery: "Um, well, it\'s not really that expensive, I mean, I think you\'re not seeing it right…" (flustered, defensive, and rambling).',
      strongExample:
        'Recovery: "Great question — that\'s exactly why we\'re here. Give me 30 seconds and I\'ll show you how this saves you more than it costs." (acknowledges the heckle, stays calm, and redirects).',
    },
  },
  {
    id: 'reframe',
    title: 'Reframe',
    description: 'Turn a negative situation into something funny, positive, or insightful.',
    duration: '3 rounds',
    icon: 'refresh-outline',
    instructions: {
      howItWorks: "Three rounds. You hear a negative or frustrating situation each time. Your job is to spin it — find the funny angle, the silver lining, or the unexpected upside. No wallowing allowed.",
      skill: 'Trains: optimism, recontextualisation, and finding comedy in adversity.',
      examplePrompt: 'You missed your alarm and showed up an hour late.',
      weakExample: '"I guess I should have set two alarms. I\'ll do better next time."',
      strongExample: '"I gave everyone else a head start. That\'s situational leadership."',
    },
  },
];

export default function HomeScreen() {
  const router = useRouter();
  const { initialAuthChecked, user } = useAuth();
  const [streak, setStreak] = useState(0);
  const [totalSessions, setTotalSessions] = useState(0);
  const [bestScores, setBestScores] = useState({});
  const [loadingStreak, setLoadingStreak] = useState(true);
  const [instructionExercise, setInstructionExercise] = useState(null);
  const [showConfetti, setShowConfetti] = useState(false);
  const [sessionLaunchInProgress, setSessionLaunchInProgress] = useState(false);

  // Redirect to login if not signed in
  React.useEffect(() => {
    if (!initialAuthChecked) return;
    if (!user) {
      router.replace('/login');
    }
  }, [initialAuthChecked, user, router]);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      setSessionLaunchInProgress(false);
      const load = async () => {
        try {
          const progress = await getProgress();
          if (cancelled) return;
          setStreak(progress.streak);
          setTotalSessions(progress.totalSessions);
          setBestScores(progress.bestScores || {});
          setLoadingStreak(false);
          if (progress.pendingCelebration && (progress.pendingCelebration.personalBest || progress.pendingCelebration.streakMilestone)) {
            setShowConfetti(true);
            clearPendingCelebration();
            setTimeout(() => {
              if (!cancelled) setShowConfetti(false);
            }, 2600);
          }
        } catch (e) {
          if (!cancelled) setLoadingStreak(false);
        }
      };
      load();
      return () => { cancelled = true; };
    }, []),
  );

  const handleStartSession = useCallback(async () => {
    if (sessionLaunchInProgress) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSessionLaunchInProgress(true);
    const randomIndex = Math.floor(Math.random() * EXERCISES.length);
    const exercise = EXERCISES[randomIndex];
    router.push({
      pathname: '/session',
      params: { type: exercise.id, exerciseType: exercise.id },
    });
  }, [router, sessionLaunchInProgress]);

  const handleExercisePress = useCallback((exercise) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setInstructionExercise(exercise);
  }, []);

  const handleGotItGo = useCallback(async () => {
    if (!instructionExercise || sessionLaunchInProgress) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSessionLaunchInProgress(true);
    router.push({
      pathname: '/session',
      params: { type: instructionExercise.id, exerciseType: instructionExercise.id },
    });
    setInstructionExercise(null);
  }, [instructionExercise, router, sessionLaunchInProgress]);

  const handleCloseInstruction = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setInstructionExercise(null);
  }, []);

  // Show nothing while checking auth or redirecting to login
  if (!initialAuthChecked || !user) {
    return (
      <GradientBackground>
        <View style={styles.container}>
          <View style={styles.loadingWrap}>
            <ActivityIndicator size="large" color={COLORS.accent} />
            <Text style={styles.loadingText}>Loading…</Text>
          </View>
        </View>
      </GradientBackground>
    );
  }

  return (
    <GradientBackground>
      <View style={styles.container}>
        {showConfetti ? <ConfettiOverlay /> : null}
        <SafeAreaView edges={['top', 'bottom']} style={styles.safeArea}>
          <ScrollView
            contentContainerStyle={styles.content}
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.header}>
              <View style={styles.logoCircle}>
                <Ionicons name="sparkles-outline" size={28} color={COLORS.accent} />
              </View>
              <View style={styles.logoTextWrapper}>
                <Text style={styles.appName} numberOfLines={1}>QuickWit</Text>
                <Text style={styles.tagline} numberOfLines={2}>
                  Train your brain. Sharpen your wit.
                </Text>
              </View>
              <Pressable
                onPress={() => router.push('/settings')}
                style={({ pressed }) => [styles.gearButton, pressed && styles.gearButtonPressed]}
                hitSlop={12}
                accessibilityLabel="Settings"
              >
                <Ionicons name="settings-outline" size={24} color={COLORS.text} />
              </Pressable>
            </View>

            <View style={styles.section}>
              <View style={styles.cardHeaderRow}>
                <Text style={styles.sectionLabel}>Daily Session</Text>
                <View style={styles.statsRow}>
                  {loadingStreak ? (
                    <View style={styles.streakPill}>
                      <ActivityIndicator size="small" color={COLORS.accent} />
                      <Text style={[styles.streakText, styles.loadingPlaceholder]}>Loading…</Text>
                    </View>
                  ) : (
                    <View style={styles.streakPill}>
                      {streak >= STREAK_MILESTONES[0] ? (
                        <Text style={styles.streakEmoji}>{streakFireEmoji(streak)}</Text>
                      ) : (
                        <Ionicons name="flame" size={16} color={COLORS.accent} />
                      )}
                      <Text style={styles.streakText}>
                        {`${streak} day${streak === 1 ? '' : 's'}`}
                      </Text>
                    </View>
                  )}
                  <Text style={styles.totalSessionsText}>
                    Total sessions: {loadingStreak ? '…' : totalSessions}
                  </Text>
                </View>
              </View>

            <View style={styles.dailyCard}>
              <View style={styles.dailyTextBlock}>
                <Text style={styles.dailyTitle}>Keep the streak alive</Text>
                <Text style={styles.dailySubtitle}>
                  Just a few minutes of improv each day to keep your mind sharp.
                </Text>
              </View>

              <Pressable
                onPress={sessionLaunchInProgress ? undefined : handleStartSession}
                style={({ pressed }) => [
                  styles.primaryButton,
                  pressed && !sessionLaunchInProgress && styles.primaryButtonPressed,
                  sessionLaunchInProgress && styles.primaryButtonDisabled,
                ]}
                disabled={sessionLaunchInProgress}
              >
                <Text style={styles.primaryButtonText} numberOfLines={1}>Start Session</Text>
                <Ionicons name="arrow-forward" size={18} color={COLORS.text} />
              </Pressable>
            </View>
          </View>

          {!loadingStreak && Object.keys(bestScores).length > 0 ? (
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>Personal bests</Text>
              <View style={styles.bestScoresRow}>
                {EXERCISES.map((ex) => {
                  const score = bestScores[ex.id] ?? bestScores[ex.id.replace('-', '')];
                  if (score == null) return null;
                  const label = EXERCISE_DISPLAY_NAMES[ex.id] || ex.title;
                  return (
                    <View key={ex.id} style={styles.bestScorePill}>
                      <Text style={styles.bestScoreLabel}>{label}</Text>
                      <Text style={styles.bestScoreValue}>{Math.round(score)}</Text>
                    </View>
                  );
                })}
                {bestScores.daily != null && !EXERCISES.some((ex) => ex.id === 'daily') ? (
                  <View style={styles.bestScorePill}>
                    <Text style={styles.bestScoreLabel}>Daily</Text>
                    <Text style={styles.bestScoreValue}>{Math.round(bestScores.daily)}</Text>
                  </View>
                ) : null}
              </View>
            </View>
          ) : null}

          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Exercise types</Text>
            <Text style={styles.sectionHint}>Tap for rules, then start</Text>

            <View style={styles.exerciseStack}>
              {EXERCISES.map((exercise) => (
                <Pressable
                  key={exercise.id}
                  onPress={() => handleExercisePress(exercise)}
                  style={({ pressed }) => [
                    styles.exerciseCard,
                    pressed && styles.exerciseCardPressed,
                  ]}
                >
                  <View style={styles.exerciseIconWrapper}>
                    <Ionicons
                      name={exercise.icon}
                      size={24}
                      color={COLORS.accent}
                    />
                  </View>
                  <View style={styles.exerciseContent}>
                    <Text style={styles.exerciseTitle} numberOfLines={1}>{exercise.title}</Text>
                    <Text style={styles.exerciseDescription} numberOfLines={2}>
                      {exercise.description}
                    </Text>
                    <Text style={styles.exerciseDuration} numberOfLines={1}>
                      {exercise.duration}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={20} color={COLORS.muted} />
                </Pressable>
              ))}
            </View>
          </View>
        </ScrollView>
      </SafeAreaView>

      <Modal
        visible={!!instructionExercise}
        transparent
        animationType="fade"
        onRequestClose={handleCloseInstruction}
      >
        <View style={styles.modalOverlay}>
          <Pressable style={StyleSheet.absoluteFillObject} onPress={handleCloseInstruction} />
          <View style={styles.modalCard}>
            {instructionExercise && (
              <>
                <View style={styles.modalIconRow}>
                  <View style={styles.modalIconWrapper}>
                    <Ionicons
                      name={instructionExercise.icon}
                      size={28}
                      color={COLORS.accent}
                    />
                  </View>
                  <Text style={styles.modalTitle} numberOfLines={2}>{instructionExercise.title}</Text>
                </View>
                <ScrollView style={styles.modalInstructionsScroll} showsVerticalScrollIndicator={true} indicatorStyle="white">
                  {instructionExercise.instructions && (
                    <>
                      <Text style={styles.modalSectionHeader}>How it works</Text>
                      <Text style={styles.modalInstructions}>
                        {instructionExercise.instructions.howItWorks}
                      </Text>
                      <Text style={styles.modalSectionHeader}>What it trains</Text>
                      <Text style={styles.modalSkill}>
                        {instructionExercise.instructions.skill}
                      </Text>
                      <Text style={styles.modalSectionHeader}>Example</Text>
                      <Text style={styles.modalExamplePrompt}>
                        {instructionExercise.instructions.examplePrompt}
                      </Text>
                      <View style={styles.exampleRow}>
                        <Text style={styles.weakLabel}>Weak</Text>
                        <Text style={styles.modalExampleText}>
                          {instructionExercise.instructions.weakExample}
                        </Text>
                      </View>
                      <View style={styles.exampleRow}>
                        <Text style={styles.strongLabel}>Strong</Text>
                        <Text style={styles.modalExampleText}>
                          {instructionExercise.instructions.strongExample}
                        </Text>
                      </View>
                    </>
                  )}
                </ScrollView>
                <View style={styles.modalActions}>
                  <Pressable
                    style={styles.modalSecondaryButton}
                    onPress={handleCloseInstruction}
                  >
                    <Text style={styles.modalSecondaryText}>Cancel</Text>
                  </Pressable>
                  <Pressable
                    style={({ pressed }) => [
                      styles.modalPrimaryButton,
                      pressed && !sessionLaunchInProgress && styles.primaryButtonPressed,
                      sessionLaunchInProgress && styles.primaryButtonDisabled,
                    ]}
                    onPress={sessionLaunchInProgress ? undefined : handleGotItGo}
                    disabled={sessionLaunchInProgress}
                  >
                    <Text style={styles.primaryButtonText}>Got it, let's go</Text>
                    <Ionicons name="arrow-forward" size={18} color={COLORS.text} />
                  </Pressable>
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>
    </View>
    </GradientBackground>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingWrap: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
  },
  loadingText: {
    color: COLORS.muted,
    fontSize: 15,
  },
  safeArea: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 32,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 28,
  },
  logoCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 2,
    borderColor: COLORS.accent,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#0F172A',
  },
  logoTextWrapper: {
    marginLeft: 14,
    flex: 1,
    minWidth: 0,
  },
  appName: {
    color: COLORS.text,
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  tagline: {
    color: COLORS.muted,
    fontSize: 13,
    marginTop: 4,
  },
  gearButton: {
    padding: 8,
    marginLeft: 8,
  },
  gearButtonPressed: {
    opacity: 0.7,
  },
  section: {
    marginBottom: 24,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
    flexWrap: 'wrap',
    gap: 8,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  sectionLabel: {
    color: COLORS.text,
    fontSize: 18,
    fontWeight: '600',
  },
  sectionHint: {
    color: COLORS.muted,
    fontSize: 13,
    marginBottom: 12,
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  streakPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: '#0F172A',
    borderWidth: 1,
    borderColor: 'rgba(233,69,96,0.45)',
  },
  streakText: {
    color: COLORS.text,
    fontSize: 13,
    marginLeft: 6,
  },
  streakEmoji: {
    fontSize: 16,
  },
  loadingPlaceholder: {
    marginLeft: 8,
  },
  totalSessionsText: {
    color: COLORS.muted,
    fontSize: 13,
  },
  bestScoresRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 4,
  },
  bestScorePill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.card,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(233,69,96,0.3)',
  },
  bestScoreLabel: {
    color: COLORS.muted,
    fontSize: 12,
    marginRight: 6,
  },
  bestScoreValue: {
    color: COLORS.accent,
    fontSize: 14,
    fontWeight: '700',
  },
  dailyCard: {
    backgroundColor: COLORS.card,
    borderRadius: 20,
    padding: 18,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  dailyTextBlock: {
    marginBottom: 16,
  },
  dailyTitle: {
    color: COLORS.text,
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 4,
  },
  dailySubtitle: {
    color: COLORS.muted,
    fontSize: 13,
    lineHeight: 18,
  },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.accent,
    borderRadius: 999,
    paddingVertical: 12,
    paddingHorizontal: 18,
    gap: 8,
  },
  primaryButtonPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.98 }],
  },
  primaryButtonDisabled: {
    opacity: 0.6,
  },
  primaryButtonText: {
    color: COLORS.text,
    fontSize: 16,
    fontWeight: '600',
  },
  exerciseStack: {
    gap: 12,
  },
  exerciseCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.card,
    borderRadius: 18,
    padding: 16,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  exerciseCardPressed: {
    opacity: 0.95,
    transform: [{ scale: 0.97 }],
  },
  exerciseIconWrapper: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#0F172A',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  exerciseContent: {
    flex: 1,
    minWidth: 0,
  },
  exerciseTitle: {
    color: COLORS.text,
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  exerciseDescription: {
    color: COLORS.muted,
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 4,
  },
  exerciseDuration: {
    color: COLORS.accent,
    fontSize: 12,
    fontWeight: '500',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalCard: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: COLORS.card,
    borderRadius: 20,
    padding: 24,
    borderWidth: 1,
    borderColor: 'rgba(233,69,96,0.2)',
  },
  modalIconRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  modalIconWrapper: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#0F172A',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  modalTitle: {
    color: COLORS.text,
    fontSize: 20,
    fontWeight: '700',
    flex: 1,
    minWidth: 0,
  },
  modalInstructionsScroll: {
    maxHeight: 360,
    marginBottom: 24,
  },
  modalSectionHeader: {
    color: COLORS.accent,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.1,
    textTransform: 'uppercase',
    marginTop: 14,
    marginBottom: 4,
  },
  modalInstructions: {
    color: COLORS.muted,
    fontSize: 14,
    lineHeight: 21,
  },
  modalSkill: {
    color: COLORS.text,
    fontSize: 14,
    lineHeight: 20,
    fontStyle: 'italic',
  },
  modalExamplePrompt: {
    color: COLORS.text,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '500',
    marginBottom: 8,
  },
  exampleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 6,
    gap: 8,
  },
  weakLabel: {
    color: '#FF6B6B',
    fontSize: 11,
    fontWeight: '700',
    marginTop: 2,
    width: 44,
    flexShrink: 0,
  },
  strongLabel: {
    color: '#4ECDC4',
    fontSize: 11,
    fontWeight: '700',
    marginTop: 2,
    width: 44,
    flexShrink: 0,
  },
  modalExampleText: {
    color: COLORS.muted,
    fontSize: 13,
    lineHeight: 19,
    flex: 1,
  },
  modalActions: {
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'flex-end',
  },
  modalSecondaryButton: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    justifyContent: 'center',
  },
  modalSecondaryText: {
    color: COLORS.muted,
    fontSize: 15,
  },
  modalPrimaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.accent,
    borderRadius: 999,
    paddingVertical: 12,
    paddingHorizontal: 18,
    gap: 8,
  },
});
