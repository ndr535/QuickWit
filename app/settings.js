import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Switch,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { getVoiceEnabled, setVoiceEnabled, getDifficulty, setDifficulty, DIFFICULTY_VALUES } from '../services/settings';
import { checkSubscriptionStatus, restorePurchases, initializePurchases } from '../services/purchases';
import { supabase } from '../services/supabase';
import { useAuth } from './context/AuthContext';
import GradientBackground from '../components/GradientBackground';

const COLORS = {
  background: '#1A1A2E',
  card: '#16213E',
  accent: '#E94560',
  text: '#FFFFFF',
  muted: '#A5B1C2',
};

const DIFFICULTY_LABELS = {
  everyday: 'Everyday',
  weird: 'Weird',
  unhinged: 'Unhinged',
};

const DIFFICULTY_DESCRIPTIONS = {
  everyday: 'Realistic, relatable — workplace situations, social awkwardness, everyday conversations.',
  weird: 'Mildly absurd — unexpected twists on normal situations.',
  unhinged: 'Fully outlandish — surreal, nothing makes sense. Rubber duck territory.',
};

export default function SettingsScreen() {
  const router = useRouter();
  const { signOut, user } = useAuth();
  const [voiceOn, setVoiceOn] = useState(true);
  const [difficulty, setDifficultyState] = useState('everyday');
  const [subStatus, setSubStatus] = useState('loading'); // 'loading' | 'pro' | 'free' | 'error'
  const [restoring, setRestoring] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      const load = async () => {
        try {
          const [v, d] = await Promise.all([getVoiceEnabled(), getDifficulty()]);
          if (!cancelled) {
            setVoiceOn(v);
            setDifficultyState(d);
          }
        } catch (e) {
          if (!cancelled) setVoiceOn(true);
        }
      };
      load();
      return () => { cancelled = true; };
    }, []),
  );

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      const load = async () => {
        try {
          const isPro = await checkSubscriptionStatus();
          if (!cancelled) setSubStatus(isPro ? 'pro' : 'free');
        } catch (e) {
          if (!cancelled) setSubStatus('error');
        }
      };
      load();
      return () => { cancelled = true; };
    }, []),
  );

  const handleVoiceChange = useCallback(async (value) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setVoiceOn(value);
    await setVoiceEnabled(value);
  }, []);

  const handleDifficultySelect = useCallback(async (value) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setDifficultyState(value);
    await setDifficulty(value);
  }, []);

  const handleRestore = useCallback(async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setRestoring(true);
    try {
      await initializePurchases(user?.id);
      const hasPro = await restorePurchases();
      setSubStatus(hasPro ? 'pro' : 'free');
      if (hasPro) router.back();
    } catch (_e) {
      setSubStatus('error');
    } finally {
      setRestoring(false);
    }
  }, [router, user]);

  const handleLogout = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Alert.alert(
      'Log Out',
      'Are you sure you want to log out?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Log Out',
          style: 'destructive',
          onPress: async () => {
            setLoggingOut(true);
            try {
              await signOut();
              router.replace('/login');
            } catch (_e) {
              setLoggingOut(false);
            }
          },
        },
      ],
    );
  }, [signOut, router]);

  const handleDeleteAccount = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Alert.alert(
      'Delete Account',
      'This will permanently delete your account and all data. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete My Account',
          style: 'destructive',
          onPress: async () => {
            setDeletingAccount(true);
            try {
              const { data: sessionData } = await supabase.auth.getSession();
              const token = sessionData?.session?.access_token;
              if (!token) throw new Error('Not authenticated');
              const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
              const res = await fetch(`${supabaseUrl}/functions/v1/delete-account`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${token}`,
                },
              });
              if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                throw new Error(body?.error?.message || 'Deletion failed');
              }
              await signOut();
              router.replace('/login');
            } catch (err) {
              setDeletingAccount(false);
              Alert.alert('Error', err?.message || 'Could not delete account. Please try again or contact support.');
            }
          },
        },
      ],
    );
  }, [signOut, router]);

  return (
    <GradientBackground>
      <SafeAreaView edges={['top', 'bottom']} style={styles.safeArea}>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Audio</Text>
            <View style={styles.card}>
              <View style={styles.row}>
                <View style={styles.rowIcon}>
                  <Ionicons name="volume-high-outline" size={22} color={COLORS.accent} />
                </View>
                <View style={styles.rowContent}>
                  <Text style={styles.rowTitle}>Voice</Text>
                  <Text style={styles.rowSubtitle}>Hear prompts and AI lines read out loud</Text>
                </View>
                <Switch
                  value={voiceOn}
                  onValueChange={handleVoiceChange}
                  trackColor={{ false: '#374151', true: 'rgba(233,69,96,0.5)' }}
                  thumbColor={voiceOn ? COLORS.accent : '#9CA3AF'}
                />
              </View>
            </View>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Difficulty</Text>
            <Text style={styles.sectionHint}>How wild should scenarios get?</Text>
            <View style={styles.card}>
              {DIFFICULTY_VALUES.map((value) => (
                <Pressable
                  key={value}
                  onPress={() => handleDifficultySelect(value)}
                  style={({ pressed }) => [
                    styles.difficultyRow,
                    value !== DIFFICULTY_VALUES[DIFFICULTY_VALUES.length - 1] && styles.difficultyRowBorder,
                    pressed && styles.pressed,
                  ]}
                >
                  <View style={styles.difficultyContent}>
                    <Text style={styles.difficultyLabel}>{DIFFICULTY_LABELS[value]}</Text>
                    <Text style={styles.difficultyDesc}>{DIFFICULTY_DESCRIPTIONS[value]}</Text>
                  </View>
                  {difficulty === value ? (
                    <Ionicons name="checkmark-circle" size={24} color={COLORS.accent} />
                  ) : (
                    <View style={styles.radioEmpty} />
                  )}
                </Pressable>
              ))}
            </View>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Manage Subscription</Text>
            <View style={styles.card}>
              <View style={styles.row}>
                <View style={styles.rowIcon}>
                  <Ionicons name="card-outline" size={22} color={COLORS.accent} />
                </View>
                <View style={styles.rowContent}>
                  <Text style={styles.rowTitle}>Status</Text>
                  <Text style={styles.rowSubtitle}>
                    {subStatus === 'loading' && 'Checking…'}
                    {subStatus === 'pro' && 'Pro — unlimited access'}
                    {subStatus === 'free' && 'Free — limited to 6 sessions'}
                    {subStatus === 'error' && 'Unable to check status'}
                  </Text>
                </View>
              </View>
              <Pressable
                onPress={handleRestore}
                disabled={restoring || subStatus === 'loading'}
                style={({ pressed }) => [
                  styles.difficultyRow,
                  styles.difficultyRowBorder,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={styles.restoreLabel}>
                  {restoring ? 'Restoring…' : 'Restore Purchases'}
                </Text>
                <Ionicons name="refresh-outline" size={20} color={COLORS.accent} />
              </Pressable>
            </View>
          </View>
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Account</Text>
            <View style={styles.card}>
              <Pressable
                onPress={handleLogout}
                disabled={loggingOut || deletingAccount}
                style={({ pressed }) => [
                  styles.difficultyRow,
                  styles.difficultyRowBorder,
                  pressed && styles.pressed,
                ]}
              >
                <View style={styles.rowIcon}>
                  <Ionicons name="log-out-outline" size={22} color={COLORS.accent} />
                </View>
                <Text style={styles.accountActionLabel}>
                  {loggingOut ? 'Logging out…' : 'Log Out'}
                </Text>
                {loggingOut ? (
                  <ActivityIndicator size="small" color={COLORS.accent} />
                ) : (
                  <Ionicons name="chevron-forward" size={18} color={COLORS.muted} />
                )}
              </Pressable>
              <Pressable
                onPress={handleDeleteAccount}
                disabled={loggingOut || deletingAccount}
                style={({ pressed }) => [
                  styles.difficultyRow,
                  pressed && styles.pressed,
                ]}
              >
                <View style={styles.rowIcon}>
                  <Ionicons name="trash-outline" size={22} color="#FF6B6B" />
                </View>
                <Text style={[styles.accountActionLabel, styles.deleteLabel]}>
                  {deletingAccount ? 'Deleting account…' : 'Delete Account'}
                </Text>
                {deletingAccount ? (
                  <ActivityIndicator size="small" color="#FF6B6B" />
                ) : (
                  <Ionicons name="chevron-forward" size={18} color={COLORS.muted} />
                )}
              </Pressable>
            </View>
          </View>
        </ScrollView>
      </SafeAreaView>
    </GradientBackground>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 32,
  },
  section: {
    marginBottom: 28,
  },
  sectionLabel: {
    color: COLORS.text,
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 10,
  },
  sectionHint: {
    color: COLORS.muted,
    fontSize: 13,
    marginBottom: 12,
  },
  card: {
    backgroundColor: COLORS.card,
    borderRadius: 18,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
  },
  rowIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#0F172A',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  rowContent: {
    flex: 1,
    minWidth: 0,
  },
  rowTitle: {
    color: COLORS.text,
    fontSize: 16,
    fontWeight: '600',
  },
  rowSubtitle: {
    color: COLORS.muted,
    fontSize: 13,
    marginTop: 2,
  },
  difficultyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  difficultyRowBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  pressed: {
    opacity: 0.85,
  },
  difficultyContent: {
    flex: 1,
    minWidth: 0,
  },
  difficultyLabel: {
    color: COLORS.text,
    fontSize: 16,
    fontWeight: '600',
  },
  difficultyDesc: {
    color: COLORS.muted,
    fontSize: 12,
    marginTop: 4,
    lineHeight: 18,
  },
  radioEmpty: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: COLORS.muted,
    marginLeft: 12,
  },
  restoreLabel: {
    color: COLORS.accent,
    fontSize: 15,
    fontWeight: '500',
    flex: 1,
  },
  accountActionLabel: {
    color: COLORS.text,
    fontSize: 16,
    fontWeight: '500',
    flex: 1,
    marginLeft: 14,
  },
  deleteLabel: {
    color: '#FF6B6B',
  },
});
