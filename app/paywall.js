import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import {
  getOfferings,
  purchasePackage,
  restorePurchases,
  initializePurchases,
} from '../services/purchases';
import GradientBackground from '../components/GradientBackground';
import { useAuth } from '../context/AuthContext';

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

const PRIVACY_POLICY_URL =
  'https://www.notion.so/QuickWit-Privacy-Policy-31b0db36ac9a819fb0c8c2f7d622f181';
const TERMS_OF_USE_URL =
  'https://www.apple.com/legal/internet-services/itunes/dev/stdeula/';

function getPackagePeriodLabel(pkg) {
  const id = (pkg?.identifier ?? '').toLowerCase();
  const type = (pkg?.packageType ?? '').toUpperCase();

  if (id.includes('annual') || id.includes('year') || type === 'ANNUAL') {
    return 'Yearly';
  }

  return 'Monthly';
}

function isMonthlyPackage(pkg) {
  return getPackagePeriodLabel(pkg) === 'Monthly';
}

function getPriceString(pkg) {
  return pkg?.product?.priceString ?? null;
}

function getBillingSuffix(pkg) {
  return isMonthlyPackage(pkg) ? 'month' : 'year';
}

function getPackageKey(pkg, fallbackIndex) {
  return pkg?.identifier ?? `pkg-${fallbackIndex}`;
}

export default function PaywallScreen() {
  const router = useRouter();
  const { user } = useAuth();

  const [loading, setLoading] = useState(true);
  const [offeringsError, setOfferingsError] = useState(null);
  const [packages, setPackages] = useState([]);
  const [defaultPackage, setDefaultPackage] = useState(null);
  const [selectedPackage, setSelectedPackage] = useState(null);
  const [purchasing, setPurchasing] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [message, setMessage] = useState('');

  const loadOfferings = useCallback(async () => {
    setLoading(true);
    setOfferingsError(null);
    setMessage('');

    try {
      await initializePurchases(user?.id ?? null);

      const { packages: pkgs, error } = await getOfferings();
      const safePackages = pkgs || [];

      setPackages(safePackages);

      if (error) {
        setOfferingsError(error);
        setDefaultPackage(null);
        setSelectedPackage(null);
        return;
      }

      const firstPackage = safePackages.length > 0 ? safePackages[0] : null;
      setDefaultPackage(firstPackage);

      const sortedPackages =
        safePackages.length > 1
          ? [...safePackages].sort((a, b) => {
              if (isMonthlyPackage(a) && !isMonthlyPackage(b)) return -1;
              if (!isMonthlyPackage(a) && isMonthlyPackage(b)) return 1;
              return 0;
            })
          : safePackages;

      const defaultSelection =
        sortedPackages.length > 0 ? sortedPackages[0] : firstPackage;

      setSelectedPackage(defaultSelection);

      if (!firstPackage) {
        setOfferingsError('No subscription options available.');
      }
    } catch (e) {
      setOfferingsError(e?.message || 'Unable to load subscription options.');
      setDefaultPackage(null);
      setPackages([]);
      setSelectedPackage(null);
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    loadOfferings();
  }, [loadOfferings]);

  const handlePurchaseSelected = async () => {
    const pkg = selectedPackage;

    if (!pkg) {
      setMessage('Unable to load subscription. Please try again.');
      return;
    }

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setPurchasing(true);
    setMessage('');

    try {
      const success = await purchasePackage(pkg);

      if (success) {
        router.replace('/');
      } else {
        setMessage(
          'Purchase could not be completed. Try Restore if you already subscribed.'
        );
      }
    } catch (e) {
      setMessage(
        e?.message || 'Purchase could not be completed. Please try again.'
      );
    } finally {
      setPurchasing(false);
    }
  };

  const handleRestore = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setRestoring(true);
    setMessage('');

    try {
      const hasPro = await restorePurchases();

      if (hasPro) {
        router.replace('/');
      } else {
        setMessage('No previous purchase found.');
      }
    } catch (e) {
      setMessage(e?.message || 'Restore failed. Please try again.');
    } finally {
      setRestoring(false);
    }
  };

  const handleDismiss = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.back();
  };

  const handleOpenLink = async (url) => {
    try {
      await Linking.openURL(url);
    } catch (e) {
      setMessage('Unable to open link right now.');
    }
  };

  const displayPackages =
    packages.length > 1
      ? [...packages].sort((a, b) => {
          if (isMonthlyPackage(a) && !isMonthlyPackage(b)) return -1;
          if (!isMonthlyPackage(a) && isMonthlyPackage(b)) return 1;
          return 0;
        })
      : packages;

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
          ) : offeringsError || !defaultPackage ? (
            <View style={styles.errorBlock}>
              <Text style={styles.errorText}>
                {offeringsError || 'Subscription options unavailable.'} You can still try
                again or continue with limited sessions.
              </Text>

              <Pressable onPress={loadOfferings} style={styles.retryButton}>
                <Text style={styles.retryText}>Retry</Text>
              </Pressable>
            </View>
          ) : (
            <>
              <View style={styles.packageOptions}>
                {displayPackages.map((pkg, index) => {
                  const isSelected =
                    selectedPackage?.identifier === pkg?.identifier ||
                    selectedPackage === pkg;

                  const priceStr = getPriceString(pkg);
                  const periodLabel = getPackagePeriodLabel(pkg);
                  const billingSuffix = getBillingSuffix(pkg);

                  return (
                    <Pressable
                      key={getPackageKey(pkg, index)}
                      onPress={() => {
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        setSelectedPackage(pkg);
                      }}
                      style={[
                        styles.packageOption,
                        isSelected && styles.packageOptionSelected,
                      ]}
                    >
                      <View style={styles.packageOptionContent}>
                        <Text
                          style={[
                            styles.packageOptionLabel,
                            isSelected && styles.packageOptionLabelSelected,
                          ]}
                        >
                          {periodLabel}
                        </Text>

                        {priceStr ? (
                          <Text
                            style={[
                              styles.packageOptionPrice,
                              isSelected && styles.packageOptionPriceSelected,
                            ]}
                          >
                            {priceStr} per {billingSuffix}
                          </Text>
                        ) : (
                          <Text
                            style={[
                              styles.packageOptionPrice,
                              isSelected && styles.packageOptionPriceSelected,
                            ]}
                          >
                            Price at checkout
                          </Text>
                        )}
                      </View>

                      {isSelected ? (
                        <Ionicons
                          name="checkmark-circle"
                          size={24}
                          color={COLORS.accent}
                        />
                      ) : null}
                    </Pressable>
                  );
                })}
              </View>

              <Text style={styles.subscriptionNote}>
                Auto-renewing subscription. Cancel anytime in Apple ID settings.
              </Text>

              <Pressable
                onPress={handlePurchaseSelected}
                disabled={purchasing || !selectedPackage}
                style={({ pressed }) => [
                  styles.primaryButton,
                  (pressed || purchasing || !selectedPackage) &&
                    styles.primaryButtonPressed,
                ]}
              >
                {purchasing ? (
                  <ActivityIndicator color={COLORS.text} size="small" />
                ) : (
                  <Text style={styles.primaryButtonText}>Unlock Unlimited Practice</Text>
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

          <View style={styles.footerLinks}>
            <Pressable
              onPress={() => handleOpenLink(PRIVACY_POLICY_URL)}
              style={styles.footerLink}
            >
              <Text style={styles.footerLinkText}>Privacy Policy</Text>
            </Pressable>

            <Text style={styles.footerLinkSeparator}>·</Text>

            <Pressable
              onPress={() => handleOpenLink(TERMS_OF_USE_URL)}
              style={styles.footerLink}
            >
              <Text style={styles.footerLinkText}>Terms of Use</Text>
            </Pressable>
          </View>
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

  closeButton: {
    padding: 4,
  },

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

  packageOptions: {
    marginBottom: 16,
    gap: 12,
  },

  packageOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: COLORS.card,
    borderRadius: 12,
    padding: 16,
    borderWidth: 2,
    borderColor: 'transparent',
  },

  packageOptionSelected: {
    borderColor: COLORS.accent,
  },

  packageOptionContent: {
    flex: 1,
  },

  packageOptionLabel: {
    color: COLORS.muted,
    fontSize: 15,
    fontWeight: '600',
  },

  packageOptionLabelSelected: {
    color: COLORS.text,
  },

  packageOptionPrice: {
    color: COLORS.muted,
    fontSize: 14,
    marginTop: 2,
  },

  packageOptionPriceSelected: {
    color: COLORS.text,
  },

  subscriptionNote: {
    color: COLORS.muted,
    fontSize: 12,
    textAlign: 'center',
    marginBottom: 18,
    lineHeight: 18,
  },

  primaryButton: {
    backgroundColor: COLORS.accent,
    borderRadius: 999,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 56,
  },

  primaryButtonPressed: {
    opacity: 0.88,
  },

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

  restorePressed: {
    opacity: 0.8,
  },

  restoreText: {
    color: COLORS.accent,
    fontSize: 16,
    fontWeight: '500',
  },

  laterButton: {
    paddingVertical: 12,
    alignItems: 'center',
  },

  laterPressed: {
    opacity: 0.8,
  },

  laterText: {
    color: COLORS.muted,
    fontSize: 15,
  },

  footerLinks: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 24,
    gap: 8,
  },

  footerLink: {
    paddingVertical: 8,
    paddingHorizontal: 4,
  },

  footerLinkText: {
    color: COLORS.muted,
    fontSize: 14,
    textDecorationLine: 'underline',
  },

  footerLinkSeparator: {
    color: COLORS.muted,
    fontSize: 14,
  },
});