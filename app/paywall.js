import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { getOfferings, purchasePackage, restorePurchases, initializePurchases } from '../services/purchases';
import GradientBackground from '../components/GradientBackground';
import { useAuth } from './context/AuthContext';

const COLORS = {
  background: '#1A1A2E',
  card: '#16213E',
  accent: '#E94560',
  text: '#FFFFFF',
  muted: '#A5B1C2',
};

const BENEFITS = [
  'Unlimited daily sessions',
  'All 5 exercise types',
  'Personalized AI coaching',
  'Track your improvement',
];

export default function PaywallScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [offeringsError, setOfferingsError] = useState(null);
  const [packages, setPackages] = useState([]);
  const [defaultPackage, setDefaultPackage] = useState(null);
  const [purchasing, setPurchasing] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [message, setMessage] = useState('');

  const loadOfferings = useCallback(async () => {
    setLoading(true);
    setOfferingsError(null);
    setMessage('');
    await initializePurchases(user?.id ?? null);
    const { packages: pkgs, error } = await getOfferings();
    setPackages(pkgs || []);
    if (error) {
      setOfferingsError(error);
      setDefaultPackage(null);
    } else {
      const pkg = (pkgs && pkgs[0]) || null;
      setDefaultPackage(pkg);
    }
    setLoading(false);
  }, [user?.id]);

  React.useEffect(() => {
    loadOfferings();
  }, [loadOfferings]);

  const handleStartTrial = async () => {
    const pkg = defaultPackage;
    if (!pkg) {
      setMessage('Unable to load subscription. Please try again.');
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setPurchasing(true);
    setMessage('');
    const success = await purchasePackage(pkg);
    setPurchasing(false);
    if (success) {
      router.replace('/');
    } else {
      setMessage('Purchase could not be completed. Try Restore if you already subscribed.');
    }
  };

  const handleRestore = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setRestoring(true);
    setMessage('');
    const hasPro = await restorePurchases();
    setRestoring(false);
    if (hasPro) {
      router.replace('/');
    } else {
      setMessage('No previous purchase found.');
    }
  };

  const handleDismiss = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.back();
  };

  const priceString = defaultPackage?.product?.priceString ?? null;

  return (
    <GradientBackground>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <Pressable onPress={handleDismiss} style={styles.closeButton} hitSlop={12}>
            <Ionicons name="close" size={28} color={COLORS.text} />
          </Pressable>
        </View>

        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.logoRow}>
            <View style={styles.logoCircle}>
              <Ionicons name="sparkles" size={40} color={COLORS.accent} />
            </View>
            <Text style={styles.title}>QuickWit</Text>
          </View>

          <Text style={styles.headline}>Unlock Unlimited Practice</Text>

          <View style={styles.benefitsCard}>
            {BENEFITS.map((benefit, i) => (
              <View key={i} style={styles.benefitRow}>
                <Ionicons name="checkmark-circle" size={22} color={COLORS.accent} />
                <Text style={styles.benefitText}>{benefit}</Text>
              </View>
            ))}
          </View>

          {loading ? (
            <View style={styles.loadingBlock}>
              <ActivityIndicator size="large" color={COLORS.accent} />
              <Text style={styles.loadingText}>Loading…</Text>
            </View>
          ) : offeringsError ? (
            <View style={styles.errorBlock}>
              <Text style={styles.errorText}>Subscription options unavailable. You can still try again or continue with limited sessions.</Text>
              <Pressable onPress={loadOfferings} style={styles.retryButton}>
                <Text style={styles.retryText}>Retry</Text>
              </Pressable>
            </View>
          ) : (
            <>
              {priceString ? (
                <Text style={styles.priceText}>{priceString}/week after 7-day free trial</Text>
              ) : (
                <Text style={styles.pricePlaceholder}>7-day free trial, then weekly</Text>
              )}

              <Pressable
                onPress={handleStartTrial}
                disabled={purchasing || !defaultPackage}
                style={({ pressed }) => [
                  styles.primaryButton,
                  (pressed || purchasing) && styles.primaryButtonPressed,
                ]}
              >
                {purchasing ? (
                  <ActivityIndicator color={COLORS.text} size="small" />
                ) : (
                  <Text style={styles.primaryButtonText}>Start 7-Day Free Trial</Text>
                )}
              </Pressable>
            </>
          )}

          {(message || restoring) && (
            <View style={styles.messageBlock}>
              {restoring ? (
                <ActivityIndicator size="small" color={COLORS.accent} />
              ) : (
                <Text style={styles.messageText}>{message}</Text>
              )}
            </View>
          )}

          <Pressable
            onPress={handleRestore}
            disabled={restoring || loading}
            style={({ pressed }) => [styles.restoreButton, pressed && styles.restorePressed]}
          >
            <Text style={styles.restoreText}>Restore Purchases</Text>
          </Pressable>

          <Pressable
            onPress={handleDismiss}
            style={({ pressed }) => [styles.laterButton, pressed && styles.laterPressed]}
          >
            <Text style={styles.laterText}>Maybe Later</Text>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    </GradientBackground>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 8,
  },
  closeButton: { padding: 4 },
  scrollContent: {
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 40,
  },
  logoRow: {
    alignItems: 'center',
    marginBottom: 24,
  },
  logoCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 2,
    borderColor: COLORS.accent,
    backgroundColor: COLORS.card,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  title: {
    color: COLORS.text,
    fontSize: 24,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  headline: {
    color: COLORS.text,
    fontSize: 22,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 24,
  },
  benefitsCard: {
    backgroundColor: COLORS.card,
    borderRadius: 16,
    padding: 20,
    marginBottom: 28,
    borderWidth: 1,
    borderColor: 'rgba(233,69,96,0.2)',
  },
  benefitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  benefitText: {
    color: COLORS.text,
    fontSize: 16,
    marginLeft: 12,
  },
  loadingBlock: {
    alignItems: 'center',
    paddingVertical: 24,
    gap: 12,
  },
  loadingText: {
    color: COLORS.muted,
    fontSize: 15,
  },
  errorBlock: {
    marginBottom: 20,
  },
  errorText: {
    color: COLORS.muted,
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 12,
  },
  retryButton: {
    alignSelf: 'center',
    paddingVertical: 10,
    paddingHorizontal: 20,
  },
  retryText: {
    color: COLORS.accent,
    fontSize: 16,
    fontWeight: '600',
  },
  priceText: {
    color: COLORS.text,
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 16,
  },
  pricePlaceholder: {
    color: COLORS.muted,
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 16,
  },
  primaryButton: {
    backgroundColor: COLORS.accent,
    borderRadius: 999,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 56,
  },
  primaryButtonPressed: { opacity: 0.88 },
  primaryButtonText: {
    color: COLORS.text,
    fontSize: 18,
    fontWeight: '700',
  },
  messageBlock: {
    alignItems: 'center',
    paddingVertical: 12,
    minHeight: 40,
  },
  messageText: {
    color: COLORS.muted,
    fontSize: 14,
    textAlign: 'center',
  },
  restoreButton: {
    paddingVertical: 14,
    alignItems: 'center',
  },
  restorePressed: { opacity: 0.8 },
  restoreText: {
    color: COLORS.accent,
    fontSize: 16,
    fontWeight: '500',
  },
  laterButton: {
    paddingVertical: 12,
    alignItems: 'center',
  },
  laterPressed: { opacity: 0.8 },
  laterText: {
    color: COLORS.muted,
    fontSize: 15,
  },
});
