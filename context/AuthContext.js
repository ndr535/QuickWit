import React, { createContext, useContext, useEffect, useState } from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { supabase } from '../services/supabase';

const AuthContext = createContext({
  initialAuthChecked: false,
  user: null,
  sessionTokenReady: false,
  setUser: () => {},
  signOut: () => {},
});

export function AuthProvider({ children }) {
  const [initialAuthChecked, setInitialAuthChecked] = useState(false);
  const [user, setUserState] = useState(null);
  const [sessionTokenReady, setSessionTokenReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function restoreSession() {
      try {
        // Cap the session restore at 8 seconds; fail open so a slow/hanging
        // network call never leaves the user stuck on the loading screen.
        const SESSION_TIMEOUT_MS = 8000;
        const timeoutResult = { data: { session: null } };
        const sessionPromise = supabase.auth.getSession();
        const timeoutPromise = new Promise((resolve) =>
          setTimeout(() => resolve(timeoutResult), SESSION_TIMEOUT_MS),
        );
        const { data } = await Promise.race([sessionPromise, timeoutPromise]);
        if (cancelled) return;
        const session = data?.session;
        if (session?.user && session?.access_token) {
          setUserState(session.user);
          setSessionTokenReady(true);
        } else {
          setUserState(null);
          setSessionTokenReady(false);
        }
      } catch (e) {
        if (!cancelled) {
          setUserState(null);
          setSessionTokenReady(false);
        }
      } finally {
        if (!cancelled) setInitialAuthChecked(true);
      }
    }

    restoreSession();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (cancelled) return;
      if (session?.user && session?.access_token) {
        setUserState(session.user);
        setSessionTokenReady(true);
      } else {
        setUserState(null);
        setSessionTokenReady(false);
      }
    });

    return () => {
      cancelled = true;
      subscription?.unsubscribe?.();
    };
  }, []);

  const setUser = (u) => {
    setUserState(u);
    // Do not set sessionTokenReady here. It is only set when we have a confirmed
    // session with access_token (restoreSession or onAuthStateChange). After
    // signIn/signUp, onAuthStateChange will fire and set sessionTokenReady(true).
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setUserState(null);
    setSessionTokenReady(false);
  };

  const value = {
    initialAuthChecked,
    user,
    sessionTokenReady,
    setUser,
    signOut,
  };

  if (!initialAuthChecked) {
    return (
      <AuthContext.Provider value={value}>
        <View style={styles.authLoading}>
          <ActivityIndicator size="large" color="#E94560" />
          <Text style={styles.authLoadingText}>Loading…</Text>
        </View>
      </AuthContext.Provider>
    );
  }

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return ctx;
}

const styles = StyleSheet.create({
  authLoading: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#1A1A2E',
    gap: 12,
  },
  authLoadingText: {
    color: '#A5B1C2',
    fontSize: 15,
  },
});
