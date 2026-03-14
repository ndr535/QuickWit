module.exports = {
  expo: {
    name: 'QuickWit',
    slug: 'QuickWit',
    scheme: 'quickwit',
    version: '1.0.0',
    orientation: 'portrait',
    icon: './assets/icon.png',
    userInterfaceStyle: 'light',
    newArchEnabled: false,
    splash: {
      image: './assets/splash-icon.png',
      resizeMode: 'contain',
      backgroundColor: '#1A1A2E',
    },
    ios: {
      supportsTablet: false,
      bundleIdentifier: 'com.blueribbon.quickwit',
      buildNumber: '11',
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
    ],
    
    extra: {
      eas: {
        projectId: 'fc6de65d-b549-489d-b8c4-df6deec5d4cb',
      },
      elevenLabsVoiceId: process.env.EXPO_PUBLIC_ELEVENLABS_VOICE_ID || process.env.ELEVENLABS_VOICE_ID || '',
    },
  },
};
