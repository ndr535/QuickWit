const ENTITLEMENT_ID = 'pro';

let configured = false;

/**
 * Lazily get the Purchases module. Does not load at file scope.
 * - Returns null if EXPO_PUBLIC_REVENUECAT_API_KEY is missing.
 * - Then tries require('react-native-purchases'); returns null on failure.
 * Never throws.
 * @returns {object | null} Purchases module or null
 */
function getPurchasesModule() {
  const apiKey = (process.env.EXPO_PUBLIC_REVENUECAT_API_KEY || '').trim();
  if (!apiKey) return null;
  try {
    return require('react-native-purchases').default;
  } catch (e) {
    console.warn('[QuickWit Purchases] Module load: failed', e?.message);
    return null;
  }
}

/**
 * Initialize RevenueCat. Call only when paywall is opened (deferred from cold launch).
 * If userId is provided (Supabase user), links the subscription to that account via Purchases.logIn().
 * Idempotent: configure runs at most once per process.
 * @param {string} [userId] - Optional Supabase user id from supabase.auth.getUser()
 */
export async function initializePurchases(userId) {
  console.warn('[QuickWit Purchases] RevenueCat init attempted');
  const apiKey = (process.env.EXPO_PUBLIC_REVENUECAT_API_KEY || '').trim();
  console.warn('[QuickWit Purchases] API key present:', apiKey ? 'yes' : 'no');
  if (!apiKey) return;

  const Purchases = getPurchasesModule();
  if (!Purchases) {
    console.warn('[QuickWit Purchases] Module load: failed (skipping configure)');
    return;
  }
  console.warn('[QuickWit Purchases] Module load: success');

  if (!configured) {
    try {
      Purchases.configure({ apiKey });
      configured = true;
      console.warn('[QuickWit Purchases] Configure: success');
    } catch (e) {
      console.warn('[QuickWit Purchases] Configure: failed', e?.message);
      return;
    }
  }

  if (userId && typeof userId === 'string' && userId.trim()) {
    try {
      await Purchases.logIn(userId.trim());
    } catch (e) {
      console.warn('[QuickWit Purchases] logIn failed:', e?.message);
    }
  }
}

/**
 * Link RevenueCat to the given user id. Call when user logs in after initial app load.
 * No-op if RevenueCat failed to load or is not configured.
 * @param {string} userId - Supabase user id
 */
export async function logInUser(userId) {
  if (!userId || typeof userId !== 'string' || !userId.trim()) return;
  if (!configured) return;
  const Purchases = getPurchasesModule();
  if (!Purchases) return;
  try {
    await Purchases.logIn(userId.trim());
  } catch (e) {
    console.warn('[QuickWit Purchases] logIn failed:', e?.message);
  }
}

/**
 * Returns true if the user has an active 'pro' entitlement.
 * On RevenueCat/network error, returns false (fail closed for entitlement check; gate will use session count or fail open).
 */
export async function checkSubscriptionStatus() {
  if (!configured) return false;
  const Purchases = getPurchasesModule();
  if (!Purchases) return false;
  try {
    const customerInfo = await Purchases.getCustomerInfo();
    const pro = customerInfo?.entitlements?.active?.[ENTITLEMENT_ID];
    return !!(pro && pro.isActive);
  } catch (e) {
    console.warn('[QuickWit Purchases] checkSubscriptionStatus failed:', e?.message);
    return false;
  }
}

/**
 * Fetches available offerings and packages from RevenueCat.
 * @returns {Promise<{ current: object | null, packages: object[], error: string | null }>}
 */
export async function getOfferings() {
  const Purchases = getPurchasesModule();
  if (!Purchases) return { current: null, packages: [], error: 'RevenueCat not available' };
  if (!configured) return { current: null, packages: [], error: 'RevenueCat not initialized' };
  try {
    const offerings = await Purchases.getOfferings();
    const current = offerings?.current ?? null;
    const packages = current?.availablePackages ?? [];
    return { current, packages, error: null };
  } catch (e) {
    const message = e?.message || 'Failed to load offerings';
    console.warn('[QuickWit Purchases] getOfferings failed:', message);
    return { current: null, packages: [], error: message };
  }
}

/**
 * Purchase a package. Returns true if purchase succeeded.
 * @param {object} pkg - RevenueCat package from getOfferings().packages
 * @returns {Promise<boolean>}
 */
export async function purchasePackage(pkg) {
  if (!pkg) return false;
  if (!configured) return false;
  const Purchases = getPurchasesModule();
  if (!Purchases) return false;
  try {
    const result = await Purchases.purchasePackage(pkg);
    const customerInfo = result?.customerInfo;
    const pro = customerInfo?.entitlements?.active?.[ENTITLEMENT_ID];
    return !!(pro && pro.isActive);
  } catch (e) {
    if (e?.userCancelled) return false;
    console.warn('[QuickWit Purchases] purchasePackage failed:', e?.message);
    return false;
  }
}

/**
 * Restore previous purchases. Returns true if user has pro entitlement after restore.
 */
export async function restorePurchases() {
  if (!configured) return false;
  const Purchases = getPurchasesModule();
  if (!Purchases) return false;
  try {
    const customerInfo = await Purchases.restorePurchases();
    const pro = customerInfo?.entitlements?.active?.[ENTITLEMENT_ID];
    return !!(pro && pro.isActive);
  } catch (e) {
    console.warn('[QuickWit Purchases] restorePurchases failed:', e?.message);
    return false;
  }
}
