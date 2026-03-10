// RevenueCat is loaded lazily (never at module scope) to prevent cold-launch crashes.
// All exported functions return safe defaults if the native module is unavailable
// or if initializePurchases() has not been called yet.

let configured = false;

function getPurchasesModule() {
  const apiKey = process.env.EXPO_PUBLIC_REVENUECAT_API_KEY;
  if (!apiKey) return null;
  try {
    const mod = require('react-native-purchases');
    return mod.default || mod;
  } catch (e) {
    console.warn('[QuickWit Purchases] Module load: failed', e?.message);
    return null;
  }
}

/**
 * Must be called (from paywall screen) before any other purchases function.
 * Safe to call multiple times — idempotent after first successful configure.
 */
export async function initializePurchases(userId) {
  console.warn('[QuickWit Purchases] RevenueCat init attempted');
  const apiKey = process.env.EXPO_PUBLIC_REVENUECAT_API_KEY;
  console.warn('[QuickWit Purchases] API key present:', apiKey ? 'yes' : 'no');
  if (!apiKey) return false;

  const Purchases = getPurchasesModule();
  if (!Purchases) {
    console.warn('[QuickWit Purchases] Module load: failed (skipping configure)');
    return false;
  }
  console.warn('[QuickWit Purchases] Module load: success');

  if (configured) {
    if (userId) {
      try { await Purchases.logIn(String(userId)); } catch (_e) {}
    }
    return true;
  }

  try {
    Purchases.configure({ apiKey, appUserID: userId ? String(userId) : undefined });
    configured = true;
    console.warn('[QuickWit Purchases] Configure: success');
    if (userId) {
      try { await Purchases.logIn(String(userId)); } catch (_e) {}
    }
    return true;
  } catch (e) {
    console.warn('[QuickWit Purchases] Configure: failed', e?.message);
    return false;
  }
}

export async function checkSubscriptionStatus() {
  if (!configured) return false;
  const Purchases = getPurchasesModule();
  if (!Purchases) return false;
  try {
    const info = await Purchases.getCustomerInfo();
    return info?.entitlements?.active?.['pro'] != null;
  } catch (_e) {
    return false;
  }
}

export async function getOfferings() {
  if (!configured) {
    return { current: null, packages: [], error: 'RevenueCat not initialized' };
  }
  const Purchases = getPurchasesModule();
  if (!Purchases) {
    return { current: null, packages: [], error: 'RevenueCat not available' };
  }
  try {
    const offerings = await Purchases.getOfferings();
    const current = offerings?.current ?? null;
    const packages = current?.availablePackages ?? [];
    return { current, packages, error: null };
  } catch (e) {
    return { current: null, packages: [], error: e?.message || 'Failed to load offerings' };
  }
}

export async function purchasePackage(pkg) {
  if (!configured) return false;
  const Purchases = getPurchasesModule();
  if (!Purchases) return false;
  try {
    const result = await Purchases.purchasePackage(pkg);
    return result?.customerInfo?.entitlements?.active?.['pro'] != null;
  } catch (e) {
    if (e?.code === 'USER_CANCELLED' || e?.userCancelled) return false;
    console.warn('[QuickWit Purchases] purchasePackage failed:', e?.message);
    return false;
  }
}

export async function restorePurchases() {
  if (!configured) return false;
  const Purchases = getPurchasesModule();
  if (!Purchases) return false;
  try {
    const info = await Purchases.restorePurchases();
    return info?.entitlements?.active?.['pro'] != null;
  } catch (e) {
    console.warn('[QuickWit Purchases] restorePurchases failed:', e?.message);
    return false;
  }
}

export async function logInUser(userId) {
  if (!configured) return false;
  const Purchases = getPurchasesModule();
  if (!Purchases) return false;
  try {
    await Purchases.logIn(String(userId));
    return true;
  } catch (_e) {
    return false;
  }
}

export async function logOutUser() {
  if (!configured) return false;
  const Purchases = getPurchasesModule();
  if (!Purchases) return false;
  try {
    await Purchases.logOut();
    return true;
  } catch (_e) {
    return false;
  }
}
