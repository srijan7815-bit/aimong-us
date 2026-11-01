import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Native Android shell.
 *
 * The whole UI is bundled inside the APK (assets under www/) so the app opens
 * instantly with no network — the same service worker offline shell as the
 * browser, minus the latency. All game traffic (HTTP + WebSocket) goes to the
 * Render deployment, compiled into the bundle as VITE_SERVER_URL.
 */
const config: CapacitorConfig = {
  appId: 'us.aimong.app',
  appName: 'AImong Us',
  webDir: 'www',
  bundledWebRuntime: false,
  android: {
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: false,
    backgroundColor: '#070b14',
  },
  server: {
    androidScheme: 'https',
    // No `url`: the app runs its bundled assets, and the client code points API
    // calls at Render explicitly (apps/client/src/net/endpoint.ts).
    cleartext: false,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 600,
      backgroundColor: '#070b14',
      showSpinner: false,
      androidScaleType: 'CENTER_CROP',
    },
  },
};

export default config;
