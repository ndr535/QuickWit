import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Animated, Pressable } from 'react-native';

class RootErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    console.error('[QuickWit] Uncaught error at root boundary:', error?.message, info?.componentStack?.slice(0, 300));
  }

  render() {
    if (this.state.hasError) {
      return (
        <View style={errStyles.wrap}>
          <Text style={errStyles.title}>Something went wrong</Text>
          <Text style={errStyles.body}>
            Please close and reopen QuickWit. If the problem persists, reinstall the app.
          </Text>
          <Pressable
            style={errStyles.btn}
            onPress={() => this.setState({ hasError: false })}
          >
            <Text style={errStyles.btnText}>Try Again</Text>
          </Pressable>
        </View>
      );
    }
    return this.props.children;
  }
}

const errStyles = StyleSheet.create({
  wrap: {
    flex: 1,
    backgroundColor: '#1A1A2E',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 12,
    textAlign: 'center',
  },
  body: {
    color: '#A5B1C2',
    fontSize: 14,
    lineHeight: 22,
    textAlign: 'center',
    marginBottom: 28,
  },
  btn: {
    backgroundColor: '#E94560',
    paddingVertical: 13,
    paddingHorizontal: 28,
    borderRadius: 999,
  },
  btnText: {
    color: '#FFFFFF',
    fontWeight: '600',
    fontSize: 15,
  },
});
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { AuthProvider } from '../context/AuthContext';

const SPLASH_DURATION_MS = 1400;

export default function RootLayout() {
  const [showSplash, setShowSplash] = useState(true);
  const logoScale = useRef(new Animated.Value(0.3)).current;
  const logoOpacity = useRef(new Animated.Value(0)).current;
  const splashOpacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!showSplash) return;

    const run = () => {
      Animated.parallel([
        Animated.timing(logoOpacity, {
          toValue: 1,
          duration: 400,
          useNativeDriver: false,
        }),
        Animated.spring(logoScale, {
          toValue: 1,
          useNativeDriver: false,
          tension: 50,
          friction: 7,
        }),
      ]).start(() => {
        setTimeout(() => {
          Animated.timing(splashOpacity, {
            toValue: 0,
            duration: 350,
            useNativeDriver: false,
          }).start(() => setShowSplash(false));
        }, SPLASH_DURATION_MS - 400 - 350);
      });
    };

    const t = setTimeout(run, 100);
    return () => clearTimeout(t);
  }, [showSplash, logoScale, logoOpacity, splashOpacity]);

  if (showSplash) {
    return (
      <>
        <StatusBar style="light" />
        <Animated.View style={[styles.splashWrap, { opacity: splashOpacity }]}>
          <LinearGradient
            colors={['#1A1A2E', '#16213E', '#0F172A']}
            style={StyleSheet.absoluteFill}
            start={{ x: 0.5, y: 0 }}
            end={{ x: 0.5, y: 1 }}
          />
          <View style={styles.splashContent}>
            <Animated.View
              style={[
                styles.logoCircle,
                {
                  opacity: logoOpacity,
                  transform: [{ scale: logoScale }],
                },
              ]}
            >
              <Ionicons name="sparkles" size={48} color="#E94560" />
            </Animated.View>
            <Animated.Text style={[styles.splashTitle, { opacity: logoOpacity }]}>
              QuickWit
            </Animated.Text>
            <Animated.Text style={[styles.splashTagline, { opacity: logoOpacity }]}>
              Train your brain. Sharpen your wit.
            </Animated.Text>
          </View>
        </Animated.View>
      </>
    );
  }

  return (
    <RootErrorBoundary>
    <AuthProvider>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: '#0F172A' },
          headerTintColor: '#ffffff',
          headerTitleStyle: { color: '#ffffff', fontWeight: '600' },
          headerShadowVisible: false,
          contentStyle: { backgroundColor: 'transparent' },
          animation: 'slide_from_right',
          gestureEnabled: true,
        }}
      >
        <Stack.Screen name="index" options={{ headerShown: false, title: 'Home' }} />
        <Stack.Screen name="login" options={{ headerShown: false, title: 'Sign In' }} />
        <Stack.Screen name="signup" options={{ headerShown: false, title: 'Create Account' }} />
        <Stack.Screen name="settings" options={{ title: 'Settings' }} />
        <Stack.Screen name="session" options={{ title: 'Session' }} />
        <Stack.Screen name="results" options={{ title: 'Results' }} />
        <Stack.Screen name="paywall" options={{ headerShown: false, title: 'Unlock Pro' }} />
      </Stack>
    </AuthProvider>
    </RootErrorBoundary>
  );
}

const styles = StyleSheet.create({
  splashWrap: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  splashContent: {
    alignItems: 'center',
  },
  logoCircle: {
    width: 96,
    height: 96,
    borderRadius: 48,
    borderWidth: 3,
    borderColor: '#E94560',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.9)',
    marginBottom: 20,
  },
  splashTitle: {
    color: '#FFFFFF',
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: 1,
    marginBottom: 6,
  },
  splashTagline: {
    color: '#A5B1C2',
    fontSize: 14,
  },
});
