let Purchases = null;
try {
  Purchases = require('react-native-purchases').default;
} catch (e) {
  console.warn('[QuickWit Purchases] react-native-purchases failed to load:', e?.message);
}

const ENTITLEMENT_ID = 'pro';

/**
 * Initialize RevenueCat. Call after Supabase auth check on app load.
 * If userId is provided (Supabase user), links the subscription to that account via Purchases.logIn().
 * @param {string} [userId] - Optional Supabase user id from supabase.auth.getUser()
 */
export async function initializePurchases(userId) {
  if (!Purchases) return;
  const apiKey = (process.env.EXPO_PUBLIC_REVENUECAT_API_KEY || '').trim();
  if (!apiKey) {
    console.warn('[QuickWit Purchases] EXPO_PUBLIC_REVENUECAT_API_KEY not set');
    return;
  }
  try {
    Purchases.configure({ apiKey });
    if (userId && typeof userId === 'string' && userId.trim()) {
      await Purchases.logIn(userId.trim());
    }
  } catch (e) {
    console.warn('[QuickWit Purchases] initializePurchases failed:', e?.message);
  }
}

/**
 * Link RevenueCat to the given user id. Call when user logs in after initial app load.
 * No-op if RevenueCat failed to load or is not configured.
 * @param {string} userId - Supabase user id
 */
export async function logInUser(userId) {
  if (!Purchases || !userId || typeof userId !== 'string' || !userId.trim()) return;
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
  if (!Purchases) return { current: null, packages: [], error: 'RevenueCat not available' };
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
  if (!pkg || !Purchases) return false;
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
