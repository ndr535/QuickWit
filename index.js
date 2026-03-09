// Custom entry to avoid loading expo-router/_ctx.ios.js (which needs EXPO_ROUTER_APP_ROOT
// inlined by Babel; when using babel-plugin-inline-dotenv that can break). We provide the
// context ourselves so the app root is always correct.
import '@expo/metro-runtime';

import React from 'react';
import { ExpoRoot } from 'expo-router/build/ExpoRoot';
import { Head } from 'expo-router/build/head';
import { renderRootComponent } from 'expo-router/build/renderRootComponent';
import 'expo-router/build/fast-refresh';

// Same require.context as expo-router _ctx: app dir, recursive, route files only, sync.
const ctx = require.context(
  './app',
  true,
  /^(?:\.\/)(?!(?:(?:(?:.*\+api)|(?:\+html)|(?:\+middleware)))\.[tj]sx?$).*(?:\.android|\.web)?\.[tj]sx?$/,
  'sync'
);

function App() {
  return (
    <Head.Provider>
      <ExpoRoot context={ctx} />
    </Head.Provider>
  );
}

renderRootComponent(App);
