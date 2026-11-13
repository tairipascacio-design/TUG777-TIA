import JSZip from 'jszip';

export async function downloadAndroidApkKit(appUrl: string) {
  const zip = new JSZip();
  const cleanHost = appUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');

  zip.file(
    'capacitor.config.ts',
    `import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.tug777.hypertrade',
  appName: 'TUG777 HyperTrade',
  webDir: 'dist',
  server: {
    url: '${appUrl}',
    cleartext: false
  },
  android: {
    allowMixedContent: false,
    backgroundColor: '#090B0E'
  }
};

export default config;
`
  );

  zip.file(
    'twa-manifest.json',
    JSON.stringify(
      {
        packageId: 'com.tug777.hypertrade',
        host: cleanHost,
        name: 'TUG777 HyperTrade',
        launcherName: 'TUG777',
        display: 'standalone',
        themeColor: '#090B0E',
        navigationColor: '#090B0E',
        backgroundColor: '#090B0E',
        startUrl: '/',
        iconUrl: `${appUrl}/icon.svg`,
        fallbackType: 'customtabs',
        enableNotifications: true,
        appVersionName: '1.0.0',
        appVersionCode: 1,
      },
      null,
      2
    )
  );

  zip.file(
    'package.json',
    JSON.stringify(
      {
        name: 'tug777-hypertrade-android',
        version: '1.0.0',
        scripts: {
          'init:android': 'npx cap add android && npx cap sync android',
          'build:apk': 'cd android && ./gradlew assembleRelease',
          'twa:build': 'npx @bubblewrap/cli build',
        },
        dependencies: {
          '@capacitor/android': '^7.0.0',
          '@capacitor/core': '^7.0.0',
        },
        devDependencies: {
          '@capacitor/cli': '^7.0.0',
        },
      },
      null,
      2
    )
  );

  zip.file(
    'BUILD_APK.sh',
    `#!/usr/bin/env bash
set -e
echo "=== TUG777 HyperTrade Android APK Builder ==="
npm install
npx cap add android || true
npx cap sync android
cd android
./gradlew assembleDebug
echo "APK generado en: android/app/build/outputs/apk/debug/app-debug.apk"
`
  );

  zip.file(
    'README.md',
    `# TUG777 HyperTrade — Android APK Wrapper Kit

## Opción 1 (Inmediata en Android):
Abre ${appUrl} en Google Chrome en tu teléfono y presiona "Instalar App / Añadir a pantalla de inicio" (PWA Standalone nativa).

## Opción 2 (Compilar archivo .apk firmado con Android Studio / Gradle):
1. Descomprime este paquete.
2. Ejecuta: \`bash BUILD_APK.sh\` (requiere Node.js 20+ y Android SDK / Java 17).
3. El APK compilado aparecerá en \`android/app/build/outputs/apk/debug/app-debug.apk\`.
`
  );

  const blob = await zip.generateAsync({ type: 'blob' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'TUG777-HyperTrade-Android-APK-Kit.zip';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
