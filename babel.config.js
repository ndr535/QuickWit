module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    // babel-plugin-inline-dotenv was removed: it conflicts with expo-router's
    // EXPO_ROUTER_APP_ROOT inlining (which babel-preset-expo handles) and with
    // Expo's own EXPO_PUBLIC_* env handling. Removing it also lets us use the
    // standard expo-router/entry point, eliminating a complex runtime regex.
  };
};

