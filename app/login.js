import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  Pressable,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { supabase } from '../services/supabase';
import { useAuth } from '../context/AuthContext';
import GradientBackground from '../components/GradientBackground';

const COLORS = {
  background: '#1A1A2E',
  card: '#16213E',
  accent: '#E94560',
  text: '#FFFFFF',
  muted: '#A5B1C2',
};

function friendlyAuthError(err) {
  const msg = err?.message || String(err);
  if (msg.includes('Invalid login credentials') || msg.includes('invalid_credentials')) {
    return 'Invalid email or password. Please try again.';
  }
  if (msg.includes('Email not confirmed')) return 'Please check your email to confirm your account.';
  if (msg.includes('network') || msg.includes('fetch')) return 'Connection error. Check your network and try again.';
  return msg || 'Something went wrong. Please try again.';
}

export default function LoginScreen() {
  const router = useRouter();
  const { setUser } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSignIn = async () => {
    const trimmedEmail = (email || '').trim();
    const trimmedPassword = (password || '').trim();
    if (!trimmedEmail || !trimmedPassword) {
      setError('Please enter your email and password.');
      return;
    }
    setError('');
    setLoading(true);
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email: trimmedEmail,
        password: trimmedPassword,
      });
      if (signInError) throw signInError;
      if (data?.user) {
        setUser(data.user);
        router.replace('/');
      }
    } catch (err) {
      setError(friendlyAuthError(err));
    } finally {
      setLoading(false);
    }
  };

  const handleGoToSignUp = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setError('');
    router.push('/signup');
  };

  return (
    <GradientBackground>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <KeyboardAvoidingView
          style={styles.keyboard}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 40 : 0}
        >
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.logoRow}>
              <View style={styles.logoCircle}>
                <Ionicons name="sparkles" size={36} color={COLORS.accent} />
              </View>
              <Text style={styles.title}>QuickWit</Text>
              <Text style={styles.subtitle}>Sign in to continue</Text>
            </View>

            <View style={styles.form}>
              <TextInput
                style={styles.input}
                placeholder="Email"
                placeholderTextColor={COLORS.muted}
                value={email}
                onChangeText={(t) => { setEmail(t); setError(''); }}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                textContentType="emailAddress"
                autoComplete={Platform.OS === 'android' ? 'email' : 'off'}
                editable={!loading}
              />
              <TextInput
                style={styles.input}
                placeholder="Password"
                placeholderTextColor={COLORS.muted}
                value={password}
                onChangeText={(t) => { setPassword(t); setError(''); }}
                secureTextEntry
                textContentType="password"
                autoComplete={Platform.OS === 'android' ? 'password' : 'off'}
                autoCapitalize="none"
                autoCorrect={false}
                editable={!loading}
              />

              {error ? <Text style={styles.errorText}>{error}</Text> : null}

              <Pressable
                onPress={handleSignIn}
                disabled={loading}
                style={({ pressed }) => [
                  styles.primaryButton,
                  (pressed || loading) && styles.primaryButtonPressed,
                ]}
              >
                {loading ? (
                  <ActivityIndicator color={COLORS.text} size="small" />
                ) : (
                  <Text style={styles.primaryButtonText}>Sign In</Text>
                )}
              </Pressable>

              <Pressable
                onPress={handleGoToSignUp}
                disabled={loading}
                style={({ pressed }) => [styles.linkButton, pressed && styles.linkPressed]}
              >
                <Text style={styles.linkText}>Create Account</Text>
                <Ionicons name="arrow-forward" size={16} color={COLORS.accent} />
              </Pressable>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </GradientBackground>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  keyboard: { flex: 1 },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 48,
    paddingBottom: 32,
  },
  logoRow: {
    alignItems: 'center',
    marginBottom: 40,
  },
  logoCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 2,
    borderColor: COLORS.accent,
    backgroundColor: COLORS.card,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  title: {
    color: COLORS.text,
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: 0.8,
    marginBottom: 6,
  },
  subtitle: {
    color: COLORS.muted,
    fontSize: 15,
  },
  form: {
    gap: 14,
  },
  input: {
    backgroundColor: COLORS.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(233,69,96,0.25)',
    paddingVertical: 14,
    paddingHorizontal: 18,
    color: COLORS.text,
    fontSize: 16,
  },
  errorText: {
    color: '#FF6B6B',
    fontSize: 14,
    marginTop: 2,
  },
  primaryButton: {
    backgroundColor: COLORS.accent,
    borderRadius: 999,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
    minHeight: 52,
  },
  primaryButtonPressed: {
    opacity: 0.88,
  },
  primaryButtonText: {
    color: COLORS.text,
    fontSize: 17,
    fontWeight: '600',
  },
  linkButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
  },
  linkPressed: { opacity: 0.8 },
  linkText: {
    color: COLORS.accent,
    fontSize: 16,
    fontWeight: '500',
  },
});
