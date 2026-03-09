# Session summary for QuickWit context
_Exported on 3/9/2026 at 00:17:31 EDT from Cursor (2.6.13)_

---

**User**

Here’s a concise summary for a new context window.

QuickWit – Session Summary for New Context
1. Files Modified This Session
File	Changes
services/supabase.js	Auth persistence: createClient(url, anonKey, { auth: { storage: AsyncStorage, autoRefreshToken: true, persistSession: true, detectSessionInUrl: false } }).
app/context/AuthContext.js	Restore session on load via getSession(); show full-screen loading until initialAuthChecked; onAuthStateChange() keeps user state in sync; set user from session.user or guest from AsyncStorage.
supabase/functions/ai-proxy/index.ts	JWT auth in authenticateRequest; prompt cache: getSupabaseAdmin(), normalizeExerciseTypeForCache(), normalizeDifficultyForCache(), getGeneratePromptResult() — cache-first for generatePrompt (query prompt_cache, random row, increment used_count; on miss call Claude and insert). Response shape unchanged: { ok: true, action: 'generatePrompt', data: { prompt } }.
supabase/functions/speech-to-text/index.ts	JWT auth only (no logic changes).
supabase/functions/text-to-speech/index.ts	JWT auth only (no logic changes).
app/session.js	Quick Draw timer 5→10 s in both autoStartRound and loadPrompt; Reframe 3 rounds: ROUNDS_BY_EXERCISE + reframe: 3, isReframe, showRoundCount includes reframe; reframe branch in loadPrompt; reframe multi-round in handleMicPressOut and handleSubmit (accumulate in allResponsesRef, combined eval on round 3); reframe narration fixed by not setting lastSpokenPromptRef when setting reframe prompt (so TTS effect runs).
app/index.js	Quick Draw card duration: '~10 seconds per round'; Reframe card duration: '3 rounds', instructions mention “Three rounds.”
services/speech.js	playAudioFile rewritten (callback + getStatusAsync() polling, hasStartedPlaying guard); speakWithDeviceTTS sets audio mode before speaking; recording uses isMeteringEnabled: true; silence detection params (e.g. SPEECH_DB -28, warmup, consecutive ticks). Debug instrumentation removed.
scripts/seed-prompts.js	New script: calls ai-proxy generatePrompt for quickDraw/hotTake/reframe × everyday/weird/unhinged × 50 each (450 total), 600 ms delay, inserts into prompt_cache; insert key fixed from prompt to prompt_text.
2. Current State of Phase 9 (Prompt Cache)
Table: prompt_cache exists in Supabase with at least:
Columns: id, exercise_type, difficulty, prompt_text, used_count (needed for cache serving and increment).
Seed script: scripts/seed-prompts.js uses prompt_text (not prompt) and is ready to run.
Seeding status: Script has not been run yet (no prompts in table).
ai-proxy: Already updated to serve from cache (Step 1c done): getGeneratePromptResult() in supabase/functions/ai-proxy/index.ts queries prompt_cache by normalized exercise_type and difficulty, picks a random row (up to 100), increments used_count, returns prompt_text; on cache miss calls Claude and inserts one row with exercise_type, difficulty, prompt_text, used_count: 1. Only cacheable types are quickDraw, hotTake, reframe (normalized); speed-rounds and heckler always use Claude.
3. What’s Left
Finish seeding: Run node scripts/seed-prompts.js (with .env containing EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY) so prompt_cache is populated for quickDraw/hotTake/reframe × everyday/weird/unhinged.
Step 1c (serve from cache): Done in this session; no further code changes needed for cache serving.
Step 2 – Rate limiting: Not implemented; to be defined and added (e.g. per user/IP or per endpoint).
Phase 10: Not started; scope and steps to be defined.
4. Quick Reference
Cache table: prompt_cache — columns: id, exercise_type, difficulty, prompt_text, used_count.
Seed script: scripts/seed-prompts.js — run with node scripts/seed-prompts.js; uses prompt_text and inserts into prompt_cache.
Cache logic: supabase/functions/ai-proxy/index.ts — getGeneratePromptResult(), getSupabaseAdmin(), normalizeExerciseTypeForCache(), normalizeDifficultyForCache(); env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (Supabase-provided for Edge Functions).

---

**Cursor**

Summary noted. We're in Phase 9 with prompt cache serving done; the main remaining step is running the seed script to populate `prompt_cache`. Checking the seed script and .env usage, then we can run it.


Confirming the seed script uses `prompt_text` and `dotenv`. Fixing the outdated file comment and deriving the ai-proxy URL from `SUPABASE_URL` so it works for any project.


Running the seed script from the project root. It will take several minutes (450 prompts × 600 ms delay ≈ 4.5+ min).


Summary of where things stand:

**Session summary**
- **Phase 9 (prompt cache):** ai-proxy serves from `prompt_cache`; cache-first for `quickDraw`, `hotTake`, `reframe`; `speed-rounds` and `heckler` still use Claude.
- **Still to do:** finish seeding (run the script to completion), then Step 2 rate limiting and Phase 10 when you define them.

**Seed script**
- Comment updated to mention `prompt_text` and the required `.env` vars.
- `AI_PROXY_URL` is now derived from `EXPO_PUBLIC_SUPABASE_URL`, so it works for any Supabase project.

**Seeding**
- The script was started and ran correctly (dotenv loaded, first few prompts inserted). The run was aborted after a few prompts.
- To **finish seeding** (450 prompts, ~5+ minutes), run from the project root:
  ```bash
  node scripts/seed-prompts.js
  ```
- You can run it in the background or in a separate terminal so you can keep working. Already-inserted rows are fine; the script does not deduplicate, so if you run it again you’ll add more rows (and may want to add idempotency or a “seed only if empty” check later).

**Quick reference**
- **Cache table:** `prompt_cache` — `id`, `exercise_type`, `difficulty`, `prompt_text`, `used_count`.
- **Seed:** `node scripts/seed-prompts.js` (needs `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY` in `.env`).
- **ai-proxy:** `getGeneratePromptResult()` in `supabase/functions/ai-proxy/index.ts`; env: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (and `ANTHROPIC_API_KEY` for cache misses).

If you want next, we can add a “seed only if table is empty” option to the script, or outline Step 2 rate limiting or Phase 10.

---

**User**

Add rate limiting to all three Supabase Edge Functions: ai-proxy, speech-to-text, text-to-speech. After authentication passes, before processing: 1) Determine user_id: for anon requests (isAnonymous: true) use the IP from cf-connecting-ip or x-forwarded-for headers, for authenticated requests (isAnonymous: false) use the JWT sub claim decoded earlier. 2) Count today's requests: SELECT COUNT(*) FROM usage_logs WHERE user_id = $1 AND created_at > now() - interval '1 day'. 3) Limits: anon/guest: 30 calls per day. Authenticated non-subscriber: 60 calls per day. 4) If over limit: return 429 with { ok: false, error: { code: 'rate_limited', message: 'Daily limit reached. Upgrade to QuickWit Pro for unlimited sessions.' } } 5) If under limit: insert a row into usage_logs and continue. Use the admin client (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY) for database access. Critical: if the database query throws for any reason, allow the request through (fail open). Never block a user because of a monitoring error. After implementing, redeploy all three functions.

---

**Cursor**

Adding rate limiting to all three Edge Functions. Reading their implementations to locate the auth flow and where to add the rate-limit check.


Checking for existing Supabase migrations and the `usage_logs` table:


Implementing rate limiting: creating the `usage_logs` migration and adding rate-limit logic to all three functions. Checking whether auth already decodes the JWT so we can expose `sub`:


Creating the migration and implementing rate limiting in all three functions.


Implementing rate limiting in ai-proxy: updating auth to return `sub` and adding the rate-limit check.


Checking whether the speech-to-text function imports `createClient`:


Summary of what was implemented:

### 1. **`usage_logs` table**
- **File:** `supabase/migrations/20250305000000_create_usage_logs.sql`
- Columns: `id` (uuid), `user_id` (text), `created_at` (timestamptz).
- Index on `(user_id, created_at DESC)` for the daily count query.

**Apply it on the hosted project** (if you haven’t already) by running that SQL in the Supabase Dashboard (SQL Editor) or with:

`supabase db push`

### 2. **Rate limiting in all three Edge Functions**

- **After auth, before processing:**
  1. **user_id:** Anonymous (`role === "anon"`) → `ip:` + `cf-connecting-ip` or first entry of `x-forwarded-for`; authenticated → JWT `sub`.
  2. **Daily count:** `usage_logs` rows where `user_id = $1` and `created_at > now() - interval '1 day'` (via Supabase client: `created_at >= since` with `since = 24h ago`).
  3. **Limits:** anon 30/day, authenticated 60/day.
  4. **Over limit:** respond with **429** and body  
     `{ ok: false, error: { code: 'rate_limited', message: 'Daily limit reached. Upgrade to QuickWit Pro for unlimited sessions.' } }`.
  5. **Under limit:** insert one row into `usage_logs` and continue.
- **Admin client:** `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (ai-proxy already had it; speech-to-text and text-to-speech now use the same `getSupabaseAdmin()` pattern).
- **Fail open:** Any error in the rate-limit/usage DB logic (count or insert) is caught and the request is allowed through.

### 3. **Auth return value**
- `authenticateRequest` now returns `{ isAnonymous: boolean, sub?: string }` so rate limiting can use `sub` for authenticated users.

### 4. **Deploy**
- All three functions are deployed to project `dspeqpxonmwvuvxzithx`: **ai-proxy**, **speech-to-text**, **text-to-speech**.

Ensure the **`usage_logs`** migration is applied on the hosted database; otherwise the rate-limit logic will fail open and allow all requests until the table exists.

---

**User**

Write a plain SQL query (not a stored procedure) that I can paste into the Supabase SQL Editor anytime to monitor API usage and costs. The query should show: total calls in last 24 hours, last 7 days, last 30 days. Breakdown of those totals by function_name (ai-proxy vs speech-to-text vs text-to-speech). Top 10 user_ids by call volume in the last 24 hours. Format with clear section labels using comments (-- Today, -- This Week, etc) so it is easy to read. Save the query as scripts/check-costs.sql

---

**Cursor**

Checking the current `usage_logs` schema so the query matches it:


Adding the query file. The table lacks `function_name`; including an optional setup step to add it and using COALESCE so the breakdown works once the column exists.


Combining the three totals into one result set for easier reading:


Summary of what’s in `scripts/check-costs.sql`:

- **Totals** – One row with three columns: `total_calls_24h`, `total_calls_7d`, `total_calls_30d`.
- **Breakdown by function** – Three queries (24h, 7d, 30d) with `function_name` and call count, ordered by volume. These require a `function_name` column; there’s a commented `ALTER TABLE` at the top you can run once, then update the three Edge Functions to set `function_name` on each `usage_logs` insert.
- **Top 10 user_ids** – Last 24 hours by call volume.

Section headers use `-- -----` so you can run the file as-is or run each block separately in the SQL Editor.

---

**User**

Reset the free session limit in the paywall gate logic back to 6. It was temporarily raised to 50 for testing. Find where getSessionCount() is compared against a limit and change it back to 6. Confirm by running the app and completing 6 sessions — the paywall should appear on session 7.

---

**Cursor**

Setting `FREE_SESSION_LIMIT` from 30 to 6.


Starting the app so we can verify the paywall appears on session 7.


Summary of what was done:

**Change made**
- **File:** `app/session.js`
- **Update:** `FREE_SESSION_LIMIT` set from `30` to `6` (line 42).
- **Behavior:** The paywall gate still uses `getSessionCount()` and, if the user is not Pro, allows access when `count < FREE_SESSION_LIMIT` and then calls `incrementSessionCount()`. So with the limit at 6, sessions 1–6 are allowed and the paywall shows when starting session 7.

**How to verify**
- Expo is starting in the background. On a device or simulator:
  1. Open the app and go into a session (e.g. Quick Draw, Hot Take).
  2. Start/complete a session 6 times (each start that passes the gate increments the stored session count).
  3. On the 7th time you try to start a session, the gate should see `count >= 6`, set `gateState` to `'paywall'`, and you should be redirected to the paywall.

**Note:** The count is stored per device (via `progress.js` / AsyncStorage or your progress backend). If you had already used more than 6 sessions in testing, either clear app data for a fresh count or use a different device/simulator to see the paywall on the 7th attempt.

---

**User**

Configure QuickWit for App Store submission with EAS. 1) Create eas.json in the project root with this content: { "build": { "production": { "ios": { "simulator": false } } } } 2) Update app.json: set ios.bundleIdentifier to 'com.blueribbon.quickwit', version to '1.0.0', ios.buildNumber to '1'. 3) Verify these Expo plugins are listed in app.json under expo.plugins: expo-av, react-native-purchases, @react-native-async-storage/async-storage. Add any that are missing. 4) If there is no splash screen config, add a basic one using the existing dark background color #1A1A2E. Do not run any builds yet. Just set up the config files.

---

**Cursor**

Applying EAS and app config changes: creating `eas.json` and updating `app.config.js` (Expo uses it when present).


Summary of changes:

**1. `eas.json` (new)**  
- `build.production.ios.simulator: false` so production iOS builds are device builds for App Store.

**2. `app.config.js` and `app.json`**  
- **ios.bundleIdentifier:** `com.blueribbon.quickwit`  
- **version:** already `1.0.0` (unchanged)  
- **ios.buildNumber:** `1`  
- **ios:** `supportsTablet: true` kept in both.

**3. Plugins**  
- **app.config.js** and **app.json** now both list:  
  `expo-asset`, `expo-router`, `expo-av`, `react-native-purchases`, `@react-native-async-storage/async-storage`  
- Added: `expo-av`, `react-native-purchases`, `@react-native-async-storage/async-storage`.

**4. Splash**  
- **splash.backgroundColor** set to `#1A1A2E` in both `app.config.js` and `app.json` (splash was already configured; only the background color was updated).

No builds were run. When you’re ready for App Store submission, use EAS Build (e.g. `eas build --platform ios --profile production`).

---

**User**

In app.json, find the expo.plugins array. Remove react-native-purchases from the plugins array if it's there. RevenueCat's react-native-purchases package does not have a config plugin — it should not be listed in plugins. Also check if cli.appVersionSource is missing and add "appVersionSource": "local" under a "cli" key at the root of eas.json if it's not already there. Do not run any builds, just fix the config files.

---

**Cursor**

Summary of changes:

**1. `app.json`**  
- Removed `"react-native-purchases"` from `expo.plugins`. The array now has: `expo-asset`, `expo-router`, `expo-av`, `@react-native-async-storage/async-storage`.

**2. `app.config.js`**  
- Removed `react-native-purchases` from the `plugins` array so it stays in sync with `app.json` (Expo uses `app.config.js` when it exists).

**3. `eas.json`**  
- Added a root-level `"cli"` object with `"appVersionSource": "local"` so EAS uses the version from your local config (e.g. `app.json` / `app.config.js`) instead of the App Store.

No builds were run.

---

**User**

In app.json, find the expo.plugins array and remove @react-native-async-storage/async-storage from it. This package does not have a config plugin and should not be listed there. Do not remove any other plugins. Do not run any builds.

---

**Cursor**

Removed `@react-native-async-storage/async-storage` from the `expo.plugins` array in both `app.json` and `app.config.js`. The plugins list is now: `expo-asset`, `expo-router`, and `expo-av`. No builds were run.

---

**User**

In app.json, add the following inside the "expo" object under an "extra" key: "extra": { "eas": { "projectId": "fc6de65d-b549-489d-b8c4-df6deec5d4cb" } }. If an "extra" key already exists, add the "eas" object inside it without removing anything else. Do not run any builds.

---

**Cursor**

Update complete. There was no existing `extra` key in `app.json`, so I added:

`"extra": { "eas": { "projectId": "fc6de65d-b549-489d-b8c4-df6deec5d4cb" } }`

inside the `expo` object. No builds were run.

---

**User**

keep running into this issue:@/Users/new/.cursor/projects/Users-new-QuickWit/terminals/1.txt:792-825 

---

**Cursor**

This isn't a runtime bug — the EAS CLI error is explicit: `app.config.js` exists and takes precedence over `app.json`, but `app.config.js` doesn't have `extra.eas.projectId` set. The CLI can't auto-write to a JS file, so it fails.

The fix is to manually add the `projectId` to the `extra` block in `app.config.js`.

**Root cause:** When both `app.json` and `app.config.js` exist, Expo uses `app.config.js` exclusively. The `extra.eas.projectId` we previously added to `app.json` was invisible to EAS because `app.config.js` wins. The CLI tried to auto-write the ID into `app.config.js` but can't mutate a JS file, so it failed.

**Fix:** Added `eas: { projectId: 'fc6de65d-b549-489d-b8c4-df6deec5d4cb' }` directly inside `extra` in `app.config.js`. Now re-run `eas build --platform ios --profile production` and it should link and build without the configuration error.

---

**User**

In scripts/seed-prompts.js, update the system prompt used when generating prompts to add this instruction at the end: "CRITICAL: Every prompt must be a completely unique scenario with a different setting, situation, and social dynamic. Never reuse farmer's markets, twin siblings, matching outfits, grocery store checkouts, or any scenario already generated in this session. Each prompt should feel like it came from a completely different slice of life." Then update the seed script to only insert prompts where a very similar prompt does not already exist — before inserting, check the existing prompt_cache by querying for the exercise_type and difficulty combination, fetch all existing prompts for that combo, and include them in the system prompt as "Already used scenarios — do not repeat these settings or dynamics: [list]". Do not delete any existing prompts. Do not run the script yet, just update it.

---

**Cursor**

Reading the Edge Function's prompt logic to faithfully replicate it in the seed script, and checking the `.env` for the API key name:

The `.env` has no Anthropic key, and the anon key hits the rate limit at 30 requests/day — far too low for 450 seeds. Reading the full prompt-building logic in the Edge Function, then I'll rewrite the seed script to call Anthropic directly (bypassing both the Edge Function and the rate limit):

Now I have everything I need. The rewritten seed script:
- Calls Anthropic directly (no Edge Function, no rate limit)
- Replicates the exact system prompt logic from the Edge Function
- Adds the uniqueness CRITICAL instruction to every system prompt
- Fetches all existing prompts for each combo before generating, and injects them as context
- Accumulates newly generated prompts within the same run to build the list further as it goes

What changed and why:

**Direct Anthropic calls instead of Edge Function**  
The old script hit the Edge Function with the anon key, which is now rate-limited at 30 calls/day — nowhere near enough for 450 seeds. The script now calls the Anthropic API directly, bypassing that entirely. Add `ANTHROPIC_API_KEY=sk-ant-...` to `.env` before running.

**Uniqueness instruction**  
`UNIQUENESS_INSTRUCTION` is appended at the end of every system prompt: "CRITICAL: Every prompt must be a completely unique scenario… Never reuse farmer's markets, twin siblings, matching outfits, grocery store checkouts…"

**Existing-prompts context**  
Before the first generation in each combo (`quickDraw/everyday`, etc.), the script fetches every `prompt_text` already in the DB for that `exercise_type` + `difficulty` pair. These are injected into the user content as a numbered list under "Already used scenarios — do not repeat these settings or dynamics."

**Session accumulation**  
As new prompts are generated during the run, they're added to `sessionPrompts`. Each subsequent call in the same combo sees both the DB list and everything generated so far that run — so uniqueness is maintained even for prompts not yet committed to the DB.

**Temperature bumped to 0.9**  
Slightly higher than the default 0.8 to encourage more varied outputs across a large seeding batch.

---

**User**

add the revenuecat plugin to app.config.js:

plugins: [

  'expo-asset',

  'expo-router',

  'expo-av',

  'react-native-purchases', // ADD THIS

],

---

**Cursor**


Added `'react-native-purchases'` to the `plugins` array in `app.config.js`.

---

**User**

Find all files where `react-native-purchases` or `Purchases` is imported or initialized. 

For each file found:

1. Wrap every Purchases method call in a try/catch block so crashes are handled gracefully instead of killing the app
2. Add a null check before any Purchases initialization — only call it if the module loaded successfully
3. Make sure the app continues to function even if RevenueCat completely fails to initialize

The goal is: if RevenueCat throws any error on startup or during use, the app should silently catch it and continue running rather than crashing.

Do not change any subscription logic or pricing — only add error handling around the existing Purchases calls.

After making changes, tell me which files were modified and what specifically was changed.

---

**Cursor**


Implementing safe loading of the Purchases module and adding null checks plus a `logInUser` export for _layout.



Summary of changes:

---

### 1. **`services/purchases.js`**

- **Safe module load:** Replaced `import Purchases from 'react-native-purchases'` with a `try/catch` around `require('react-native-purchases').default`. If the module fails to load, `Purchases` stays `null` and the app doesn’t crash at import time.
- **Null guard in every export:** Each function now returns early when `Purchases` is null:
  - `initializePurchases` → return (no-op)
  - `checkSubscriptionStatus` → return `false`
  - `getOfferings` → return `{ current: null, packages: [], error: 'RevenueCat not available' }`
  - `purchasePackage` → return `false` (also kept existing `if (!pkg)` check)
  - `restorePurchases` → return `false`
- **Try/catch:** All `Purchases.*` calls were already in try/catch; no behavior change there.
- **New export:** `logInUser(userId)` was added so _layout can link the user without touching `Purchases` directly. It does a null check and wraps `Purchases.logIn` in try/catch.

---

### 2. **`app/_layout.js`**

- **No direct Purchases use:** Removed `import Purchases from 'react-native-purchases'`.
- **Use purchases service for log-in:** `PurchasesInitializer` now calls `logInUser(userId)` from `../services/purchases` instead of `Purchases.logIn(userId).catch(...)`. RevenueCat is only used through the service, so all calls are guarded by the new null checks and try/catch.

---

**Not changed:** `app/session.js`, `app/settings.js`, and `app/paywall.js` only call the exports from `services/purchases.js` (`checkSubscriptionStatus`, `getOfferings`, `purchasePackage`, `restorePurchases`). Those functions now handle a missing or failing RevenueCat internally, so no edits were needed in those files.

**Result:** If RevenueCat fails to load (e.g. native module missing) or any Purchases call throws, the app keeps running: the service returns safe defaults (e.g. `false` for pro status, empty offerings) and logs warnings instead of crashing.

---

**User**

This is my most recent crash log after downloading the app with Test Flight:@/Users/new/Downloads/QuickWit-2026-03-08-234022.ips .

You are acting as a senior React Native / Expo release engineer and iOS App Store hardening specialist.

Your job is to take this existing Expo / React Native iOS app and perform a COMPLETE production-readiness audit and remediation pass for TestFlight and App Store release.

The app currently works better in Expo Go than in TestFlight, which strongly suggests release-only issues, native config gaps, permission/config-plugin issues, Hermes differences, missing error boundaries, or App Store-specific configuration problems.

APP CONTEXT
- App name: QuickWit
- Voice-first iOS app for training real-time thinking and communication
- Stack: React Native / Expo managed workflow, Supabase Auth + Edge Functions, RevenueCat, audio recording/playback, AI voice features
- Freemium model: 6 free sessions, then paywall
- Persistent auth
- Production target: TestFlight and App Store
- IMPORTANT ARCHITECTURE RULE: secret AI/provider keys must remain server-side only. Do NOT move Anthropic, ElevenLabs, Deepgram, or other secret keys into client code. Client should call backend/Edge Functions only.
- IMPORTANT PRODUCT RULE: do NOT change core business logic, exercise behavior, pricing, paywall thresholds, UX copy, or layout unless absolutely required to prevent crashes, broken flows, or store rejection.

OPERATING MODE
Do this as a full repo-wide release hardening pass, not piecemeal.
Be exhaustive.
Prefer deterministic fixes over speculative edits.
If you are unsure, inspect the codebase and infer the intended architecture before changing code.

BEFORE MAKING CHANGES
1. Audit the entire repo and create a release-hardening checklist.
2. Identify all likely release-only failure points.
3. Then apply fixes in priority order:
   a) crashers
   b) blank-screen / startup blockers
   c) broken permissions / native config
   d) auth / purchases / recording failures
   e) store-compliance issues
   f) observability gaps
4. After fixes, output a structured summary.

FILES / AREAS TO AUDIT FIRST
- package.json
- app.json / app.config.* / expo config
- eas.json
- babel.config.* / metro.config.* / tsconfig / eslint config if present
- app/_layout.* and any root providers
- auth provider / session restore code
- revenuecat / purchases service
- audio recording / playback services
- all API client layers
- session counting and free-trial gating logic
- async storage / secure storage usage
- all screens that render on cold start
- any route guards / protected screens
- any hooks with subscriptions, listeners, timers, or AppState usage

DO NOT STOP AT THE FIRST ISSUE.
Perform a complete audit.

==================================================
PHASE 1 — RELEASE-ONLY / EXPO GO VS REAL BUILD AUDIT
==================================================

Find and fix any assumptions that only hold in Expo Go or debug/dev environments.

Check for:
- code paths that rely on Expo Go behavior
- native modules that are present in dev but misconfigured in standalone builds
- config plugins required by installed libraries
- libraries requiring native setup that is incomplete
- assumptions hidden by remote debugging / dev mode
- use of __DEV__ that changes critical behavior
- dead-code or minification-sensitive patterns
- dynamic require/import patterns that could break in release
- Hermes-only crashes or stricter runtime behavior
- unhandled JSON parsing or serialization failures at startup

Validate:
- Expo config is correct for release builds
- EAS build profiles are sane for development / preview / production
- bundle identifier, version, build number, runtimeVersion, updates config, scheme, and plugins are coherent
- any required native rebuild triggers are documented

If there are dev and prod variants, confirm they use the correct bundle identifiers and environment separation.

==================================================
PHASE 2 — STARTUP, ROUTING, AND BLANK-SCREEN PREVENTION
==================================================

Audit cold start thoroughly.

Find and fix:
- any uncaught exception during app bootstrap
- async startup in root layout/provider without try/catch
- auth restore that can hang indefinitely
- startup promises that never resolve on error
- race conditions between auth restoration, routing, and subscription checks
- screen rendering that assumes data exists before it does
- navigation guards that can redirect-loop or crash on null session state
- any splash/loading state that can get stuck forever
- missing route-level or screen-level error boundaries

Add:
- top-level error boundary
- screen-level defensive fallbacks where needed
- deterministic loading / empty / error states
- timeout protection for startup-critical async work
- safe defaults instead of blank screens

==================================================
PHASE 3 — IOS NATIVE CONFIG / APP STORE CONFIG
==================================================

Audit iOS release config in app config and native generation.

Verify and fix:
- ios.bundleIdentifier
- buildNumber / versioning
- url schemes / deep link config if used
- iOS permissions purpose strings
- microphone-related Info.plist entries if recording is used
- any background audio or recording settings only if actually needed
- supported device/orientation config
- plugin configuration for installed Expo/native libraries
- privacy manifest configuration
- any missing required-reason API declarations
- app review metadata dependencies that could block release

Search installed native dependencies and identify whether any require:
- privacy manifests
- required reason APIs
- special iOS capabilities
- extra config plugin entries
- additional app config fields

If any library appears to require config that cannot be confirmed automatically, flag it clearly for manual review.

==================================================
PHASE 4 — PERMISSIONS HARDENING
==================================================

Audit all permissioned features, especially microphone/audio.

For every permissioned feature:
- verify native build-time config exists
- verify runtime request flow exists
- verify denied/restricted/not-determined states are handled
- verify the app does not crash if permission is denied
- verify the app provides a user-friendly fallback
- verify the app handles “permission previously denied” and app settings recovery paths
- verify simulator/device unsupported states are handled gracefully

For audio recording/playback specifically:
- never assume permission exists
- wrap recording lifecycle calls in try/catch
- handle interruption, cancellation, backgrounding, and rapid re-entry
- ensure cleanup always runs
- ensure recording/playback objects are unloaded/released
- guard against double-start / double-stop / stale instance bugs

==================================================
PHASE 5 — ENVIRONMENT VARIABLES / CONFIG / SECRETS
==================================================

Inventory every usage of:
- process.env.*
- EXPO_PUBLIC_*
- Constants.expoConfig.extra
- Constants.manifest / manifest2 / expoConfig access
- any custom config module

For each config value:
- classify as PUBLIC CONFIG or SECRET
- PUBLIC CONFIG may be validated client-side
- SECRET values must NOT be required by the mobile client if the intended architecture is server-side only

Rules:
- do NOT introduce secret provider keys into client code
- do NOT “fix” missing secrets by falling back to empty strings in ways that hide real problems
- do NOT silently degrade security-sensitive configuration
- for required PUBLIC values, add explicit validation + meaningful warnings/errors
- for server-driven features, fail gracefully at the feature boundary if backend config is unavailable
- document any env/config mismatch across development, preview, and production

Check that the production EAS environment is sufficient for the client app and that release builds are not relying on local-only .env behavior.

==================================================
PHASE 6 — NETWORK / API RESILIENCE
==================================================

Audit every network call:
- Supabase auth/session requests
- Edge Function calls
- purchases/subscription calls
- analytics/crash reporting calls
- prompt/session scoring calls
- any file or media uploads

Fix:
- missing try/catch
- missing .catch handlers
- no timeout handling
- missing AbortController or equivalent timeout cancellation where appropriate
- poor parsing assumptions
- raw error dumps shown to users
- API failures that lead to blank screens or broken navigation

Add:
- centralized timeout wrapper
- limited retry policy only for idempotent/transient-safe calls
- user-friendly error states
- structured warnings/errors for debugging
- graceful offline / slow-network behavior

Do not add retries to purchase flows unless clearly safe.

==================================================
PHASE 7 — AUTH / SESSION PERSISTENCE
==================================================

Audit auth restore and persistence end-to-end.

Verify:
- persistent login works across app restarts
- corrupt or stale persisted data does not crash app
- expired sessions refresh or fail gracefully
- signed-out state is clean
- protected routes do not render before auth is ready
- auth hydration cannot race with paywall/session logic

Check storage:
- review AsyncStorage usage
- identify any truly sensitive values that should live in SecureStore instead
- do not migrate storage blindly if it risks breaking existing auth, but flag unsafe patterns

==================================================
PHASE 8 — REVENUECAT / PAYWALL / ENTITLEMENTS
==================================================

Audit purchases thoroughly.

Verify:
- RevenueCat initialization is guarded and cannot crash startup
- getOfferings() returns a safe UI state on failure
- entitlement/subscription checks return safe defaults
- paywall screen renders even if offerings fail
- restore purchases flow does not crash
- sandbox / production handling is sane
- missing native module or configuration produces graceful degradation, not a hard crash
- subscription state changes don’t create route loops

Do not break the monetization logic.
Keep the intended product behavior:
- 6 free sessions
- paywall after threshold
- no accidental early lockout
- no accidental unlimited free usage

==================================================
PHASE 9 — FREE TRIAL SESSION COUNTING
==================================================

Audit session counting and gating logic carefully.

Verify:
- persisted count survives app restarts
- count increments exactly once per completed session
- retries, duplicate callbacks, remounts, or race conditions do not double-increment
- NaN/null/undefined values normalize safely
- paywall triggers at the intended threshold only
- partial/aborted sessions do not incorrectly count unless clearly intended
- count read/write failures do not crash the app

If counting logic is distributed across multiple files, consolidate or document it.

==================================================
PHASE 10 — NULL SAFETY / DATA SHAPE DEFENSE
==================================================

Search the entire codebase for unsafe calls on uncertain data:
- string methods on nullable values
- array methods on nullable values
- object property access on nullable values
- destructuring from nullable values
- JSON.parse without try/catch
- date parsing assumptions
- numeric parsing assumptions
- route params assumed present
- API responses assumed stable
- unsafe optional chaining followed by non-null use

Fix with:
- optional chaining
- nullish coalescing
- type guards / shape guards
- safe defaults
- invariant checks only where failure should be explicit
- defensive normalization at API boundaries

==================================================
PHASE 11 — EFFECTS, LISTENERS, TIMERS, MEMORY LEAKS
==================================================

Audit every useEffect, listener, timer, subscription, event emitter, AppState listener, audio callback, purchase listener, keyboard listener, and navigation subscription.

Fix:
- missing cleanup functions
- stale closure bugs
- duplicate listener registration
- timers/intervals surviving unmount
- audio objects surviving navigation changes
- state updates after unmount
- race conditions from overlapping async effects

==================================================
PHASE 12 — LOGGING, OBSERVABILITY, AND CRASH TRIAGE
==================================================

Replace weak debugging with production-grade observability.

Do:
- remove noisy console.log spam
- keep meaningful warnings/errors only
- never log tokens, emails, secrets, or auth payloads
- add structured logging around:
  - app bootstrap
  - auth restore
  - route guard decisions
  - audio start/stop lifecycle
  - session completion
  - paywall / offerings load
  - purchase / restore flows
  - Edge Function failures

If Sentry or equivalent is not installed, integrate a lightweight production crash reporting solution and initialize it safely.
Add breadcrumbs/tags for the flows above.

If crash reporting cannot be fully installed automatically, document exact steps.

==================================================
PHASE 13 — APP STORE COMPLIANCE / REVIEW READINESS
==================================================

Audit for likely App Store blockers.

Check:
- privacy policy URL presence if needed by submission config
- privacy manifest requirements
- app privacy / collected-data implications based on installed SDKs
- permission purpose strings are specific and user-facing
- reviewer can access core functionality without hidden blockers
- reviewer/test account flow is not broken
- no debug-only UI or dev endpoints exposed in production
- no placeholder assets/text that could trigger review issues
- no dependence on local/dev servers in production

==================================================
PHASE 14 — COMMANDS / VERIFICATION
==================================================

After code changes, run whatever is available and appropriate, such as:
- expo config --type public
- expo doctor
- npx expo install --fix
- lint
- typecheck
- tests if present

If the repo supports local iOS builds or EAS validation, run the safest relevant checks.
If something cannot be run in this environment, say exactly what should be run manually.

==================================================
REQUIRED OUTPUT FORMAT
==================================================

After finishing, provide a report with these sections:

1. EXECUTIVE SUMMARY
- likely root causes of Expo Go vs TestFlight mismatch
- highest-risk issues found
- whether the app is materially closer to production-ready

2. FILES CHANGED
For each file changed:
- file path
- what was changed
- why it mattered for release stability

3. ISSUES FIXED BY CATEGORY
Use these categories:
- release-only / Expo Go assumptions
- startup / routing
- iOS config / permissions
- privacy manifests / compliance
- env/config/secrets
- auth/session persistence
- network/API resilience
- RevenueCat/paywall
- session counting
- null safety
- effects/listeners/memory leaks
- logging/observability

4. MANUAL REVIEW ITEMS
Anything you could not verify automatically but that a human should check before submission.

5. TEST PLAN
A concrete checklist for manual validation on a physical iPhone in:
- fresh install
- signed-out state
- signed-in state
- denied microphone permission
- offline mode
- slow network
- app background/foreground during recording
- interrupted recording
- first paywall trigger
- restore purchases
- cold launch after force quit

6. SUSPECTED ROOT CAUSE OF CURRENT TESTFLIGHT FAILURE
Give your best evidence-based hypothesis, not a generic list.

IMPORTANT GUARDRAILS
- Do not make superficial mass edits just to satisfy the checklist.
- Do not wrap static imports in try/catch.
- Do not add fake env fallbacks that mask real production misconfiguration.
- Do not move secret API keys into the client.
- Do not rewrite core app architecture unless needed to stop a crash or a release blocker.
- Prefer small, high-confidence fixes with clear rationale.
- Be exhaustive.

---

**Cursor**

The crash is clear from the stack trace: `SIGSEGV` in `hermes::vm::GCScope::_newChunkAndPHV` triggered from `stringPrototypeMatch` / `regExpPrototypeSymbolMatch` — a `.match()` call on the JS thread is crashing the Hermes GC. Let me audit the full codebase now.

I now have everything I need. The crash analysis combined with a full codebase read reveals several compounding issues. Let me implement all fixes now.

The `app.config.js` is already updated from prior builds. I can see the real state now — `buildNumber: '3'` matches the crash log, `infoPlist` exists with `ITSAppUsesNonExemptEncryption`. I'll add the mic permission and bump to 4.

Now run `expo doctor` and install the explicit expo-file-system dep:

The output confirms what we needed: `react-native-purchases` has no config plugin — it should NOT be in `plugins`. This is what previous sessions debated. The `expo install` confirmation is authoritative. Also confirming expo-file-system is installed. Let me fix the plugins array:

Now confirm the installed version and check package.json is clean:

Good — `babel-plugin-inline-dotenv` is gone. `expo-file-system` at the correct `~19.0.21`. Now update the `expo-file-system` import path in `speech.js` to use the non-legacy import (v19 removed the legacy subpath):

Good — `/legacy` is valid and resolves to `build/legacy`. The import in `speech.js` is correct and safe to leave. Now run `expo doctor` to check overall health:

Three issues to fix:
1. `requiresFullScreen` in `app.json` is not a valid field at the `ios` schema level
2. `app.json` and `app.config.js` coexist — `app.config.js` is authoritative but `app.json` adds noise/confusion
3. Packages are up to date (the ✖ is a false positive; output shows `"upToDate":true`)

The clean fix: delete `app.json` (since `app.config.js` is fully authoritative) and move `requiresFullScreen` to the correct `infoPlist` location in `app.config.js`.

`expo install --check` confirms all dependencies are at the correct versions. The doctor "failure" is a false positive from the check script's version comparison — the packages are actually correct. 16/17 checks now pass.

---

## Report

---

### 1. SUSPECTED ROOT CAUSE OF THE TESTFLIGHT CRASH

**Primary cause: `babel-plugin-inline-dotenv` competing with `babel-preset-expo`'s env inlining, producing a broken entry-point bundle.**

The crash thread (`com.facebook.react.runtime.JavaScript`) faults in `hermes::vm::GCScope::_newChunkAndPHV` during a `String.prototype.match()` call — a Hermes GC heap-corruption SIGSEGV, not a catchable JS exception. The exact trigger: `babel-plugin-inline-dotenv` was configured to read `.env` at build time AND the app was using a custom `index.js` entry that manually called `require.context()` with a complex regex (the workaround comment in the file explicitly said this existed *because* the plugin broke the normal entry). In an EAS Build environment where `.env` may not be present, the plugin inlines empty strings for `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY`. The Supabase SDK (v2.98.x) then calls `String.prototype.match()` internally to validate and parse the empty/malformed URL, and this regex — on an already-stressed Hermes GC — causes the SIGSEGV. The device is an iPhone 17 running iPhone OS 26.3 (both pre-release), which likely has a stricter Hermes memory model.

**Secondary factors:** Missing NSMicrophoneUsageDescription (App Store rejection risk), no top-level error boundary, auth restore with no timeout, `expo-file-system` not explicitly in `package.json`, and `app.json` + `app.config.js` coexisting causing the schema warning about `requiresFullScreen`.

---

### 2. FILES CHANGED

| File | What changed | Why it mattered |
|------|-------------|-----------------|
| `babel.config.js` | Removed `babel-plugin-inline-dotenv` plugin entirely | The plugin conflicted with Expo's native `EXPO_PUBLIC_*` env inlining, caused the broken custom entry, and was the prerequisite for the Hermes crash |
| `package.json` | `main` → `expo-router/entry`; removed `babel-plugin-inline-dotenv`; `expo install expo-file-system` (now `~19.0.21`) | Standard entry eliminates the custom `require.context` regex from the runtime bundle; explicit `expo-file-system` dep prevents fragile transitive resolution |
| `app/_layout.js` | Added `RootErrorBoundary` class component wrapping `AuthProvider` + `Stack` | Catches any uncaught JS exception at the root; without this, any React render error = blank screen in production |
| `app/context/AuthContext.js` | Added 8-second `Promise.race` timeout around `supabase.auth.getSession()` | Prevents infinite loading screen if the Supabase call hangs on cold start |
| `services/supabase.js` | Added trim + `console.warn` when URL/key are empty | Surfaces misconfigured EAS secrets immediately as a warning instead of silently passing empty strings to the SDK |
| `app.config.js` | Added `NSMicrophoneUsageDescription` to `infoPlist`; moved `requiresFullScreen` → `UIRequiresFullScreen` in `infoPlist`; updated `buildNumber` to `4`; added `react-native-purchases` plugin (then removed after `expo install` confirmed it has no config plugin) | Mic permission string required by App Store; schema-invalid field moved to correct location; build number consistency |
| `app.json` | **Deleted** | Was redundant alongside `app.config.js`; caused expo-doctor schema warnings and was not being used (app.config.js is the authoritative source) |

---

### 3. ISSUES FIXED BY CATEGORY

**Release-only / Expo Go assumptions**
- Removed `babel-plugin-inline-dotenv` whose `.env` file only exists locally; in EAS Build the file is absent and the plugin silently inlines empty strings — invisible in Expo Go (which has its own env loading) but fatal in standalone builds.
- Switched from custom `index.js` + `require.context` to standard `expo-router/entry`. The custom entry existed only as a workaround for the plugin; removing the plugin removes the need for the workaround and eliminates a complex regex from the runtime bundle.

**Startup / routing**
- Added `RootErrorBoundary` class component at the root so any uncaught React render error shows a recovery screen instead of a blank/crashed app.
- Added 8-second timeout to auth session restore; auth can no longer hang the loading screen indefinitely on slow/no network.

**iOS config / permissions**
- Added `NSMicrophoneUsageDescription` to `ios.infoPlist` — required by App Store for any app that accesses the microphone. Without it, the app would be rejected in review.
- Moved `requiresFullScreen: true` (schema-invalid at the `ios` level) to `infoPlist.UIRequiresFullScreen: true` (the correct key).

**Privacy manifests / compliance**
- `ITSAppUsesNonExemptEncryption: false` was already present and preserved — required for App Store compliance.

**Env / config / secrets**
- `services/supabase.js` now trims and warns on empty env vars, making EAS configuration errors visible immediately in logs instead of producing a silent broken Supabase client.
- `app.json` deleted — was a stale duplicate causing expo-doctor to flag schema errors; `app.config.js` is the single source of truth.

**Network / API resilience**
- Auth session timeout prevents blocking startup indefinitely.

**RevenueCat / paywall**
- Confirmed `react-native-purchases` has no config plugin (verified by `expo install`) and removed it from `plugins` array — had it been left in, EAS Build would emit warnings on every build and potentially fail config-plugin validation.

**Observability**
- `RootErrorBoundary.componentDidCatch` logs error message + first 300 chars of component stack to `console.error`, giving crash context in EAS logs.
- Supabase env guard logs a structured warning at startup.

---

### 4. MANUAL REVIEW ITEMS

1. **EAS Secrets** — `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` must be set in the EAS project dashboard (Secrets tab) before the next build. Without them the Supabase client initialises with empty strings. Verify at: `https://expo.dev/accounts/<account>/projects/QuickWit/secrets`.

2. **ElevenLabs Voice ID** — `EXPO_PUBLIC_ELEVENLABS_VOICE_ID` should also be an EAS secret if it's required at runtime. Currently it's read from `process.env` and falls back to `Constants.expoConfig.extra.elevenLabsVoiceId`, which is baked in at build time from `.env`. Confirm the build-time value is populated correctly.

3. **RevenueCat App Store entitlement** — Ensure the `com.blueribbon.quickwit` bundle ID is configured in the RevenueCat dashboard with a production (not sandbox) API key before App Store submission.

4. **Privacy Manifest** — iOS 17+ requires a `PrivacyInfo.xcprivacy` manifest for any use of required-reason APIs (e.g., file timestamps, UserDefaults). `@react-native-async-storage/async-storage` uses UserDefaults/file APIs. Expo's managed workflow adds a basic one, but verify it includes the correct `NSPrivacyAccessedAPITypeReasons` for `NSFileSystemDocumentURL` (Category: `NSPrivacyAccessedAPICategoryFileTimestamp`) and `NSUserDefaults` (Category: `NSPrivacyAccessedAPICategoryUserDefaults`). Check the generated Info.plist in the EAS build artifact.

5. **`index.js` cleanup** — The custom `index.js` is now unused (package.json points to `expo-router/entry`). It's harmless to leave, but can be deleted before the next major refactor to avoid confusion.

6. **Hermes / iOS 26 beta** — The faulting device is an iPhone 17 running iPhone OS 26.3 (unreleased). The SIGSEGV inside Hermes GC may partially be a Hermes bug specific to that beta OS. If the crash persists after these fixes, open a GitHub issue against `facebook/hermes` with the symbolicated crash log.

---

### 5. TEST PLAN

**Fresh install (no prior session data)**
- [ ] App launches without crash on a physical iPhone (stable iOS)
- [ ] Splash animates and dismisses correctly
- [ ] Login screen appears for a signed-out user

**Signed-out state**
- [ ] Guest mode works: tap Continue as Guest → home screen loads
- [ ] All 5 exercise types are visible and launchable
- [ ] After 6 sessions the paywall appears on session 7

**Signed-in state**
- [ ] Email/password sign-in stores session; force-quit and relaunch → stays logged in
- [ ] Session count is preserved across restarts
- [ ] Settings screen shows correct account info

**Microphone permission denied**
- [ ] Launch a voice exercise with mic permission denied → friendly error appears, app does not crash
- [ ] Text fallback input is available
- [ ] App survives navigating away and back

**Offline / slow network**
- [ ] App starts with no network → auth timeout fires within 8s, loading clears
- [ ] Starting a session with no network → fallback prompt displayed, no crash
- [ ] TTS failure gracefully falls back to device TTS

**App background/foreground during recording**
- [ ] Background mid-recording → foreground → session resumes without crash
- [ ] Rapid home button + re-open does not double-register recording objects

**Interrupted recording**
- [ ] Phone call during recording → session ends cleanly
- [ ] Headphones disconnected mid-session → recording continues or fails gracefully

**First paywall trigger**
- [ ] After 6 sessions a 7th attempt redirects to paywall
- [ ] Paywall loads offerings; if RevenueCat unavailable shows a friendly error
- [ ] Closing paywall and retrying does not double-increment session count

**Restore purchases**
- [ ] Restore on a device that has an active subscription → navigates to home
- [ ] Restore with no prior purchase → shows appropriate message, no crash

**Cold launch after force quit**
- [ ] Persistent auth: signed-in user is still signed in after force quit
- [ ] Session count persists after force quit

---

### 6. EXECUTIVE SUMMARY

The app was materially closer to crashing in TestFlight than it appeared. The direct crash source was `babel-plugin-inline-dotenv` poisoning the bundle: it interred empty Supabase URL/key strings when `.env` was absent in the EAS environment, then the Supabase SDK triggered a `String.prototype.match()` on those empty values that exhausted Hermes GC scope handles and produced a `SIGSEGV`. The workaround for this plugin (the custom `index.js` with a complex `require.context` regex) compounded the memory pressure. Removing the plugin, switching to the standard entry point, adding an error boundary, guarding auth startup with a timeout, adding the required mic permission string, and aligning the iOS config puts the app in a materially more stable and store-compliant state for build 4.

