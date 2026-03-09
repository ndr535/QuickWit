# RevenueCat crash isolation for Build 5
_Exported on 3/9/2026 at 10:58:40 EDT from Cursor (2.6.14)_

---

**User**

Treat this as a targeted RevenueCat startup-crash isolation fix for Build 5.

Known context:
- Build 4 crashed on TestFlight with SIGABRT on the TurboModule queue.
- RevenueCat was previously loaded at module scope in services/purchases.js via top-level require.
- EXPO_PUBLIC_REVENUECAT_API_KEY was previously missing from the EAS production environment, but is now present.
- RevenueCat has now been configured correctly in the RevenueCat dashboard with the proper iOS app, products, offering, entitlement, and Apple public SDK key.
- Goal for Build 5: make sure RevenueCat cannot crash cold launch. Defer all RevenueCat loading and initialization until the paywall is opened.

Tasks:
1. In services/purchases.js:
   - Remove the top-level require('react-native-purchases') entirely.
   - Remove any module-scoped Purchases variable that is initialized during file load.
   - Create a helper like getPurchasesModule() that:
     - first checks EXPO_PUBLIC_REVENUECAT_API_KEY
     - returns null immediately if the key is missing
     - only then tries require('react-native-purchases')
     - wraps require in try/catch and logs a warning if loading fails
   - Make initializePurchases() use that helper.
   - Make checkSubscriptionStatus(), getOfferings(), purchasePackage(), restorePurchases(), and logInUser() also use that helper lazily inside each function.
   - If the module cannot be loaded, return safe defaults and never throw.

2. Remove any cold-launch RevenueCat initialization:
   - Find every place initializePurchases() is called during app startup, root layout, auth restoration, or initial screen mount.
   - Remove startup initialization so RevenueCat is not touched on cold launch.

3. Defer initialization to paywall only:
   - In the paywall screen flow, initialize RevenueCat only when the paywall screen is opened or just before offerings are requested.
   - Ensure initialization happens once and is idempotent.
   - If initialization fails, the paywall screen must still render with a graceful fallback state.

4. Add targeted logging:
   - log when RevenueCat init is attempted
   - log whether API key is present
   - log whether module load succeeded or failed
   - log whether configure succeeded or failed
   - do not log the full API key value

5. Do not change:
   - pricing
   - entitlement names
   - product IDs
   - paywall thresholds
   - subscription business logic
   - unrelated files unless needed to remove startup init or trigger paywall init

6. Output:
   - exact files changed
   - exact startup init paths removed
   - exact paywall init path added
   - any remaining manual-review risks

---

**Cursor**


Implementing the RevenueCat startup-crash isolation fix. Exploring the codebase to locate the current setup.



Implementing the fix: creating the task list and applying changes.



Moving targeted logging into `initializePurchases` only and removing logs from `getPurchasesModule` so we don't log on every call.



Confirming purchases.js and removing the duplicate block. Reading the file:



Deferring init to the paywall: call `initializePurchases` before loading offerings.



Checking whether `useAuth` is still used in _layout after removing PurchasesInitializer:



Summary of the Build 5 RevenueCat startup-crash isolation changes:

---

## 1. Exact files changed

| File | Changes |
|------|--------|
| **services/purchases.js** | Removed top-level `require('react-native-purchases')` and module-scoped `Purchases`. Added `getPurchasesModule()` (API key check → lazy require in try/catch). All exported functions use it lazily and return safe defaults when the module is unavailable. Added `configured` flag for idempotent configure. Added targeted logging in `initializePurchases` only. |
| **app/_layout.js** | Removed `initializePurchases` and `logInUser` imports. Removed `<PurchasesInitializer />` and the entire `PurchasesInitializer` component (and its `useEffect` that called `initializePurchases(userId)` / `logInUser(userId)`). Removed unused `useAuth` import. |
| **app/paywall.js** | Imported `initializePurchases` and `useAuth`. In `loadOfferings`, call `await initializePurchases(user?.id ?? null)` before `getOfferings()`. Added `user?.id` to `loadOfferings` dependency array. |

---

## 2. Startup init paths removed

- **app/_layout.js**
  - **Path:** After splash, inside `AuthProvider`, the `PurchasesInitializer` component’s `useEffect` ran when `initialAuthChecked` became true.
  - **Removed:** The whole component and the effect that did:
    - First run: `initializePurchases(userId)` (cold-launch init).
    - Later runs when `user?.id` changed: `logInUser(userId)`.
  - **Result:** No RevenueCat code runs on cold launch; the native module is not required until the paywall is used.

---

## 3. Paywall init path added

- **app/paywall.js**
  - **Path:** When the paywall screen mounts, `useEffect` runs `loadOfferings()`.
  - **New behavior inside `loadOfferings()`:**
    1. `await initializePurchases(user?.id ?? null)` (first time: loads native module, configures, optionally logs in; idempotent via `configured`).
    2. `getOfferings()` (if init failed, this still runs and returns `{ packages: [], error: 'RevenueCat not available' }`).
  - **Fallback:** Existing paywall UI already handles `offeringsError` (message + Retry). No changes to pricing, product IDs, or entitlement logic.

---

## 4. Targeted logging (no API key value)

In **services/purchases.js**, only `initializePurchases()` logs (when the paywall triggers it):

- `[QuickWit Purchases] RevenueCat init attempted`
- `[QuickWit Purchases] API key present: yes` or `no`
- `[QuickWit Purchases] Module load: success` or `Module load: failed (skipping configure)`
- On first configure: `[QuickWit Purchases] Configure: success` or `Configure: failed <message>`

`getPurchasesModule()` logs only when `require('react-native-purchases')` throws: `Module load: failed <message>`.

---

## 5. Manual-review / risks

- **`logInUser` no longer called from root:** RevenueCat is only initialized (and `logIn` called with `user?.id`) when the user opens the paywall. If a user never opens the paywall, their RevenueCat identity is never linked to Supabase `user.id` until they do. Acceptable if you only need linking at paywall time.
- **Settings / Restore:** Restore in Settings uses `restorePurchases()` only; it does not call `initializePurchases()`. If the user has never opened the paywall, the native module is loaded on first Restore in Settings (lazy in `getPurchasesModule()`). That’s deferred and safe; configure still won’t have run, so `getPurchasesModule()` will load the module but `restorePurchases()` will call `Purchases.restorePurchases()` on an unconfigured SDK. RevenueCat may require configure before restore. **Recommendation:** If you want Restore in Settings to work without having opened the paywall first, call `initializePurchases(user?.id)` once at the start of the restore flow in Settings (same pattern as paywall). Right now we didn’t change Settings per “do not change unrelated files unless needed.”
- **session.js / subscription gate:** Uses `checkSubscriptionStatus()` only. No init there; first use of RevenueCat for that user may be in session gate. That call will lazy-load the module but not configure; `checkSubscriptionStatus()` will get `getPurchasesModule()` → null (no API key at require time is already handled) or, if key is set, load and call `getCustomerInfo()` before any configure. So the first RevenueCat touch could be in session gate, not paywall, if the user never opens paywall. To be strict: only paywall triggers configure. So the first configure is in paywall; before that, `checkSubscriptionStatus()` might get the module (if key is set) and call getCustomerInfo on an unconfigured SDK, which could throw or return nothing. **Current behavior:** We check API key and only then require; we don’t configure in `checkSubscriptionStatus()`. So if the user has never opened the paywall, `configured` is false and we never call `Purchases.configure()`. So the first place we call `Purchases.configure()` is in the paywall. But `checkSubscriptionStatus()` can still call `getPurchasesModule()`, get the module (key is set), and then call `Purchases.getCustomerInfo()` without configure having run. That might be undefined behavior or throw. **Fix:** In `checkSubscriptionStatus()` (and similarly `getOfferings`, `purchasePackage`, `restorePurchases`), we could require that `configured` is true before using the module; if not configured, return false / safe default. That way RevenueCat is only used after at least one init (paywall). Let me add that guard so that any use of Purchases that needs a configured SDK only runs when we’ve already configured (from paywall).
`</think>`
Adding a safeguard: require RevenueCat to be configured before using it (e.g. `checkSubscriptionStatus` or Restore in Settings could run before the user opens the paywall). Checking and adding a `configured` guard so we don't call the SDK before init.



Summary is updated below with the extra safeguard.

---

## 6. **Safeguard added**

RevenueCat is only used **after** it has been configured from the paywall. In **services/purchases.js**:

- `checkSubscriptionStatus()` returns `false` if `!configured`.
- `getOfferings()` returns `{ current: null, packages: [], error: 'RevenueCat not initialized' }` if `!configured`.
- `purchasePackage()` and `restorePurchases()` return `false` if `!configured`.
- `logInUser()` no-ops if `!configured`.

So the native SDK is never used before the first successful `initializePurchases()` (which only runs when the paywall is opened).

---

## 7. **Remaining manual-review risks**

- **Restore in Settings:** If the user taps “Restore purchases” in Settings without ever opening the paywall, `configured` is still false, so `restorePurchases()` returns `false` and they see “No previous purchase found.” To allow Restore in Settings without opening the paywall first, you’d need to call `initializePurchases(user?.id)` once at the start of the restore flow in **app/settings.js** (same pattern as paywall). Optional follow-up.
- **Subscription gate (session.js):** Until the user has opened the paywall at least once, `checkSubscriptionStatus()` always returns `false` (because `!configured`). So the app will rely on session-count / other gates. That’s consistent with “defer all RevenueCat until paywall.”
- **Logging:** Uses `console.warn` for all QuickWit Purchases logs. You can later route these to your analytics or crash reporter if you want.

No other files were changed. Pricing, entitlement names, product IDs, paywall thresholds, and subscription logic are unchanged.

