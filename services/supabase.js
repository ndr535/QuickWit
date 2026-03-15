import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';

const supabaseUrl = (process.env.EXPO_PUBLIC_SUPABASE_URL ?? '').trim();
const supabaseAnonKey = (process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '').trim();

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    '[QuickWit] EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY is not set. ' +
    'Auth and backend features will not work. Ensure these are configured as EAS secrets ' +
    'or in your .env file before building.',
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

/**
 * Call a protected Supabase Edge Function with the current session's access token.
 * Use for functions that require auth (ai-proxy, text-to-speech, speech-to-text).
 * @param {string} functionName - e.g. 'ai-proxy', 'text-to-speech', 'speech-to-text'
 * @param {{ body?: object, method?: string }} options - request body (JSON) and optional method (default POST)
 * @returns {Promise<object>} - Parsed JSON response body
 * @throws {Error} - When not authenticated or when response is not ok
 */
export async function invokeEdgeFunctionWithAuth(functionName, options = {}) {
  const { data: sessionData } = await supabase.auth.getSession();
  const session = sessionData?.session;
  const token = session?.access_token;
  const hasSession = !!session;
  const hasToken = !!token;
  // DEBUG hotfix: remove after verifying
  console.log('[EdgeCall] fn=' + functionName + ' session=' + (hasSession ? 'yes' : 'no') + ' access_token=' + (hasToken ? 'yes' : 'no'));
  if (!token) {
    console.log('[EdgeCallError] fn=' + functionName + ' no_session');
    throw new Error('Not authenticated');
  }
  const { body, method = 'POST' } = options;
  const url = `${supabaseUrl}/functions/v1/${functionName}`;
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
  };
  const res = await fetch(url, {
    method,
    headers,
    body: body != null ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.log('[EdgeCallError] fn=' + functionName + ' status=' + res.status);
    const err = new Error(data?.error?.message || data?.message || `Edge function ${functionName} failed`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  console.log('[EdgeCall] fn=' + functionName + ' status=' + res.status);
  return data;
}
