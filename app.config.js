// Load .env so process.env has EXPO_PUBLIC_* when this file is evaluated
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

module.exports = {
  expo: {
    name: 'QuickWit',
    slug: 'QuickWit',
    version: '1.0.0',
    orientation: 'portrait',
    icon: './assets/icon.png',
    userInterfaceStyle: 'light',
    splash: {
      image: './assets/splash-icon.png',
      resizeMode: 'contain',
      backgroundColor: '#1A1A2E',
    },
    ios: {
      supportsTablet: false,
      bundleIdentifier: 'com.blueribbon.quickwit',
      buildNumber: '4',
      infoPlist: {
        ITSAppUsesNonExemptEncryption: false,
        // Prevents iPad split-screen / slide-over (same effect as requiresFullScreen).
        UIRequiresFullScreen: true,
        NSMicrophoneUsageDescription:
          'QuickWit uses your microphone to record your voice responses during improv practice sessions.',
      },
    },
    android: {
      adaptiveIcon: {
        backgroundColor: '#E6F4FE',
        foregroundImage: './assets/android-icon-foreground.png',
        backgroundImage: './assets/android-icon-background.png',
        monochromeImage: './assets/android-icon-monochrome.png',
      },
    },
    web: { favicon: './assets/favicon.png' },
    plugins: [
      'expo-asset',
      'expo-router',
      'expo-av',
      // react-native-purchases has no config plugin; do not list it here.
    ],
    
    extra: {
      eas: {
        projectId: 'fc6de65d-b549-489d-b8c4-df6deec5d4cb',
      },
      elevenLabsApiKey: process.env.EXPO_PUBLIC_ELEVENLABS_API_KEY || '',
      elevenLabsVoiceId: process.env.EXPO_PUBLIC_ELEVENLABS_VOICE_ID || process.env.ELEVENLABS_VOICE_ID || '',
      anthropicApiKey: process.env.EXPO_PUBLIC_ANTHROPIC_API_KEY || '',
    },
  },
};
