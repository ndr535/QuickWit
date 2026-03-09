# Build 5 cold-launch crash audit

## Crash summary (QuickWit-2026-03-09-180923.ips)

- **Build:** 5 (1.0.0)
- **Signal:** SIGABRT
- **Faulting thread:** `com.meta.react.turbomodulemanager.queue`
- **Stack (faulting thread):**  
  `abort` → `__abort_message` → `demangling_terminate_handler` → `_objc_terminate` → `std::__terminate` → `__cxa_rethrow` → `objc_exception_rethrow` → **`facebook::react::ObjCTurboModule::performVoidMethodInvocation(...)`** → dispatch block
- **Timing:** `procLaunch` 18:09:22.4823 → `captureTime` 18:09:22.8791 → **~0.4s** from process launch to crash

So: an ObjC exception is rethrown inside a **TurboModule void method invocation** on the React Native TurboModule queue. The crash is a startup-time native module call, not Hermes regex and not necessarily RevenueCat.

---

## 1. Cold-launch code paths audited

- **app/_layout.js** – root layout, splash, providers, Stack
- **app/index.js** – home screen (not mounted until after splash)
- **app/context/AuthContext.js** – auth provider (not mounted until after splash)
- **Root providers:** `RootErrorBoundary`, `AuthProvider` (from _layout)
- **Services imported by those files:**  
  _layout imports only `./context/AuthContext`.  
  AuthContext imports `@react-native-async-storage/async-storage` and `../../services/supabase`.  
  supabase.js imports AsyncStorage and creates the client (storage reference only; no AsyncStorage call until `getSession()`).

---

## 2. Startup-time native / Expo module call inventory

| # | File | Function / method / API | When invoked | Returns | Likely TurboModule / native? |
|---|------|-------------------------|--------------|----------|------------------------------|
| 1 | **_layout.js** | `Animated.timing(..., { useNativeDriver: true })` / `Animated.spring(..., { useNativeDriver: true })` → `.start()` | **Startup useEffect** (after first paint): `setTimeout(run, 100)` then `Animated.parallel([...]).start()` | void (callback when done) | **Yes** – native driver runs on TurboModule/bridge queue |
| 2 | **_layout.js** | `<StatusBar style="light" />` (expo-status-bar) | **First render** (splash branch) | N/A (component) | Possible – status bar native API |
| 3 | **_layout.js** | `<LinearGradient colors={...} />` (expo-linear-gradient) | **First render** (splash branch) | N/A (native view) | **Yes** – native view manager |
| 4 | **_layout.js** | `<Ionicons name="sparkles" ... />` (@expo/vector-icons) | **First render** (splash branch) | N/A (component) | Possible – fonts / asset loading |
| 5 | **_layout.js** | `<Animated.View>`, `<Animated.Text>` (react-native Animated) | **First render** (splash branch) | N/A | Yes when driven by native driver (after .start()) |
| 6 | **_layout.js** | `Stack`, `Stack.Screen` (expo-router) | **First render** when `showSplash === false` only | N/A | Yes – navigation native layer |
| 7 | **AuthContext.js** | `AsyncStorage.getItem` / `AsyncStorage.removeItem` | **Not at 0.4s** – only inside AuthProvider's useEffect (`restoreSession`), and **AuthProvider is not mounted during splash** (only mounts when `showSplash` becomes false after ~1.4s) | Promise | Yes – TurboModule |
| 8 | **AuthContext.js** | `supabase.auth.getSession()` | Same as above – only in `restoreSession()` after AuthProvider mounts | Promise | Network + possibly native/crypto |
| 9 | **AuthContext.js** | `supabase.auth.onAuthStateChange(...)` | Same as above – in AuthProvider's useEffect | Subscription | Yes (listener registration) |

**Conclusion:** Within the first ~0.4s, the only code that runs is:

- **Module load:** _layout and its direct dependencies (expo-router, expo-status-bar, expo-linear-gradient, @expo/vector-icons, AuthContext → AsyncStorage, supabase). No RevenueCat; purchases.js is not imported by _layout, index, or AuthContext.
- **First render:** StatusBar, LinearGradient, Ionicons, Animated.View/Text (no animation started yet).
- **Startup useEffect:** After first paint, `setTimeout(run, 100)`; at ~100ms `Animated.parallel([Animated.timing(...), Animated.spring(...)]).start()` runs and invokes the **native animation driver** (void call to native). By 400ms the TurboModule queue can be processing that call; an exception there matches **performVoidMethodInvocation** and the crash queue.

---

## 3. RevenueCat on cold launch – confirmed not touched

| Term | Where used | Cold launch? |
|------|------------|--------------|
| react-native-purchases | services/purchases.js only (inside `getPurchasesModule()` on first call to init/getOfferings/check/etc.) | **No** – purchases.js is not imported by _layout.js, index.js, or AuthContext.js |
| initializePurchases | app/paywall.js only (inside `loadOfferings` when paywall opens) | **No** |
| logInUser | services/purchases.js export; no caller in _layout (removed in Build 5) | **No** |
| checkSubscriptionStatus | app/session.js, app/settings.js – only when user is on session or settings | **No** |
| getOfferings | app/paywall.js only | **No** |
| restorePurchases | app/paywall.js, app/settings.js – on user action | **No** |
| purchasePackage | app/paywall.js – on user action | **No** |

**No RevenueCat path runs on cold launch.** Build 5 deferral is effective for RevenueCat.

---

## 4. Top 3 crash suspects

1. **Animated native driver (_layout splash)**  
   - **What:** `Animated.parallel([Animated.timing(..., useNativeDriver: true), Animated.spring(..., useNativeDriver: true)]).start()` in the splash `useEffect` (~100ms after first paint).  
   - **Why:** Crash is in `ObjCTurboModule::performVoidMethodInvocation`; the native driver uses exactly that for starting animations. Timing (crash at ~400ms) fits the TurboModule queue handling this call.  
   - **Likelihood:** **Highest.**

2. **expo-linear-gradient (first native view on splash)**  
   - **What:** `<LinearGradient colors={...} style={...} />` mounts on first paint.  
   - **Why:** Native view manager can go through TurboModule; a bug or misconfiguration in the gradient module could throw on the native queue.  
   - **Likelihood:** **Medium.**

3. **expo-status-bar**  
   - **What:** `<StatusBar style="light" />` on first render.  
   - **Why:** Style or setup might trigger a void native call that throws.  
   - **Likelihood:** **Lower** (StatusBar is usually lightweight).

---

## 5. Smallest isolation patch for Build 6

**Single change:** In **app/_layout.js**, switch the splash animations from the native driver to the JS driver so that **no TurboModule void call is made for the splash**:

- In the splash `useEffect`, set **`useNativeDriver: false`** for:
  - both `Animated.timing` calls (logoOpacity, splashOpacity)
  - the `Animated.spring` call (logoScale)

**Rationale:**

- Removes the only TurboModule void invocation that is certain to run in the first ~400ms (the Animated.start() path).
- No new UI, no new screens, no change to RevenueCat or auth.
- Splash may run on the JS thread (slightly less smooth); acceptable for a one-time isolation test.
- If Build 6 still crashes at the same place, the cause is likely LinearGradient or StatusBar; the next step would be to defer or replace those on the first frame.

**Exact edit:**

- File: `app/_layout.js`
- In the `useEffect` that runs the splash animation (the one that calls `Animated.parallel([...]).start(...)`), change every `useNativeDriver: true` to `useNativeDriver: false` for the three animation configs (the two `Animated.timing` and the one `Animated.spring`).

---

## 6. Files changed (for Build 6 patch)

- **app/_layout.js** – splash animation configs: `useNativeDriver: true` → `useNativeDriver: false` (3 places).

No other files need to change for this minimal patch.
