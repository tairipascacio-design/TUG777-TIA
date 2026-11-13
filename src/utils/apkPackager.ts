export async function downloadAndroidApkKit(_appUrl?: string) {
  const apkUrl = '/TUG777-HyperTrade.apk';
  const a = document.createElement('a');
  a.href = apkUrl;
  a.download = 'TUG777-HyperTrade.apk';
  document.body.appendChild(a);
  a.click();
  a.remove();
}
