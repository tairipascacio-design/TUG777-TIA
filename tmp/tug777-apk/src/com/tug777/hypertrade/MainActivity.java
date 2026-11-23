package com.tug777.hypertrade;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.app.Dialog;
import android.content.DialogInterface;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.res.AssetManager;
import android.graphics.Color;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.Message;
import android.speech.tts.TextToSpeech;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.DownloadListener;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.TextView;

import java.io.BufferedInputStream;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.URLDecoder;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

public class MainActivity extends Activity {
    private static final String PREFS_NAME = "tug777_prefs";
    private static final String KEY_SERVER_URL = "server_url";
    private static final String MODE_LOCAL = "local://apk";
    private static final String AUTH_ORIGIN_HOST = "gen-lang-client-0561395731.web.app";
    private static final String APK_BASE_URL = "https://" + AUTH_ORIGIN_HOST + "/";
    private static final String CHROME_UA =
            "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36";
    private static final int REQ_AUDIO = 777;

    private WebView webView;
    private TextView loadingOverlay;
    private PermissionRequest pendingPermissionRequest;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private Runnable loadWatchdog;
    private boolean pageFinishedOnce = false;

    private TextToSpeech tts;
    private volatile boolean ttsReady = false;
    private final List<PendingSpeech> pendingTtsQueue = new ArrayList<PendingSpeech>();

    private static final class PendingSpeech {
        final String text;
        final boolean priority;

        PendingSpeech(String text, boolean priority) {
            this.text = text;
            this.priority = priority;
        }
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        setVolumeControlStream(AudioManager.STREAM_MUSIC);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            getWindow().setStatusBarColor(Color.parseColor("#090B0E"));
            getWindow().setNavigationBarColor(Color.parseColor("#090B0E"));
        }

        initNativeTts();

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.parseColor("#090B0E"));

        webView = new WebView(this);
        webView.setBackgroundColor(Color.parseColor("#090B0E"));
        configureWebView(webView);
        root.addView(webView, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
        ));

        loadingOverlay = new TextView(this);
        loadingOverlay.setBackgroundColor(Color.parseColor("#090B0E"));
        loadingOverlay.setTextColor(Color.parseColor("#F59E0B"));
        loadingOverlay.setTextSize(15f);
        loadingOverlay.setGravity(Gravity.CENTER);
        loadingOverlay.setText("Cargando TUG777 Terminal...");
        root.addView(loadingOverlay, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
        ));

        setContentView(root);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
                requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, REQ_AUDIO);
            }
        }

        loadTargetUrl();
    }

    private void initNativeTts() {
        try {
            tts = new TextToSpeech(getApplicationContext(), new TextToSpeech.OnInitListener() {
                @Override
                public void onInit(int status) {
                    if (status == TextToSpeech.SUCCESS && tts != null) {
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                            tts.setAudioAttributes(new AudioAttributes.Builder()
                                    .setUsage(AudioAttributes.USAGE_MEDIA)
                                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                                    .build());
                        }
                        int langRes = tts.setLanguage(new Locale("es", "MX"));
                        if (langRes == TextToSpeech.LANG_MISSING_DATA || langRes == TextToSpeech.LANG_NOT_SUPPORTED) {
                            langRes = tts.setLanguage(new Locale("es", "US"));
                        }
                        if (langRes == TextToSpeech.LANG_MISSING_DATA || langRes == TextToSpeech.LANG_NOT_SUPPORTED) {
                            langRes = tts.setLanguage(new Locale("es", "ES"));
                        }
                        if (langRes == TextToSpeech.LANG_MISSING_DATA || langRes == TextToSpeech.LANG_NOT_SUPPORTED) {
                            tts.setLanguage(Locale.getDefault());
                        }
                        tts.setSpeechRate(1.04f);
                        tts.setPitch(0.95f);
                        ttsReady = true;
                        flushPendingTts();
                    }
                }
            });
        } catch (Exception ignored) {
            ttsReady = false;
        }
    }

    private void flushPendingTts() {
        mainHandler.post(new Runnable() {
            @Override
            public void run() {
                if (!ttsReady || tts == null) return;
                synchronized (pendingTtsQueue) {
                    for (PendingSpeech item : pendingTtsQueue) {
                        speakNativeInternal(item.text, item.priority);
                    }
                    pendingTtsQueue.clear();
                }
            }
        });
    }

    @SuppressWarnings("deprecation")
    private void speakNativeInternal(String text, boolean priority) {
        if (!ttsReady || tts == null || text == null || text.trim().isEmpty()) return;
        int queueMode = priority ? TextToSpeech.QUEUE_FLUSH : TextToSpeech.QUEUE_ADD;
        String utteranceId = "tug777_" + System.currentTimeMillis();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            tts.speak(text, queueMode, null, utteranceId);
        } else {
            HashMap<String, String> params = new HashMap<String, String>();
            params.put(TextToSpeech.Engine.KEY_PARAM_STREAM, String.valueOf(AudioManager.STREAM_MUSIC));
            params.put(TextToSpeech.Engine.KEY_PARAM_UTTERANCE_ID, utteranceId);
            tts.speak(text, queueMode, params);
        }
    }

    private final class AndroidTTSBridge {
        @JavascriptInterface
        public boolean isAvailable() {
            return true;
        }

        @JavascriptInterface
        public void speak(final String text, final boolean priority) {
            if (text == null || text.trim().isEmpty()) return;
            if (!ttsReady || tts == null) {
                synchronized (pendingTtsQueue) {
                    if (priority) pendingTtsQueue.clear();
                    if (pendingTtsQueue.size() < 6) {
                        pendingTtsQueue.add(new PendingSpeech(text, priority));
                    }
                }
                return;
            }
            mainHandler.post(new Runnable() {
                @Override
                public void run() {
                    speakNativeInternal(text, priority);
                }
            });
        }

        @JavascriptInterface
        public void stop() {
            synchronized (pendingTtsQueue) {
                pendingTtsQueue.clear();
            }
            mainHandler.post(new Runnable() {
                @Override
                public void run() {
                    if (tts != null) {
                        try {
                            tts.stop();
                        } catch (Exception ignored) {}
                    }
                }
            });
        }
    }

    private String getSavedMode() {
        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
        String saved = prefs.getString(KEY_SERVER_URL, MODE_LOCAL);
        if (saved == null || saved.trim().isEmpty()) {
            return MODE_LOCAL;
        }
        if (saved.contains("ais-pre-") || saved.contains("ais-dev-") || saved.contains("localhost:")) {
            prefs.edit().putString(KEY_SERVER_URL, MODE_LOCAL).apply();
            return MODE_LOCAL;
        }
        return saved.trim();
    }

    private void saveMode(String modeOrUrl) {
        getSharedPreferences(PREFS_NAME, MODE_PRIVATE).edit().putString(KEY_SERVER_URL, modeOrUrl).apply();
        loadTargetUrl();
    }

    private String getTargetBasePrefix() {
        String mode = getSavedMode();
        return MODE_LOCAL.equals(mode) ? APK_BASE_URL : mode;
    }

    private void loadTargetUrl() {
        pageFinishedOnce = false;
        if (loadingOverlay != null) {
            loadingOverlay.setVisibility(View.VISIBLE);
        }
        String mode = getSavedMode();
        String url = MODE_LOCAL.equals(mode) ? APK_BASE_URL : mode;
        scheduleLoadWatchdog(url);
        webView.loadUrl(url);
    }

    private void scheduleLoadWatchdog(final String url) {
        cancelLoadWatchdog();
        if (APK_BASE_URL.equals(url)) return;
        loadWatchdog = new Runnable() {
            @Override
            public void run() {
                if (!pageFinishedOnce) {
                    showConnectionFallbackPage(url, "Tiempo de espera agotado conectando con el servidor HTTPS.");
                }
            }
        };
        mainHandler.postDelayed(loadWatchdog, 15000);
    }

    private void cancelLoadWatchdog() {
        if (loadWatchdog != null) {
            mainHandler.removeCallbacks(loadWatchdog);
            loadWatchdog = null;
        }
    }

    private void applyStandardSettings(WebSettings s) {
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(true);
        s.setAllowContentAccess(true);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.JELLY_BEAN_MR1) {
            s.setMediaPlaybackRequiresUserGesture(false);
        }
        s.setJavaScriptCanOpenWindowsAutomatically(true);
        s.setSupportMultipleWindows(true);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setBuiltInZoomControls(false);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            s.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        }
        s.setUserAgentString(CHROME_UA);
    }

    private void configureWebView(WebView wv) {
        applyStandardSettings(wv.getSettings());
        wv.addJavascriptInterface(new AndroidTTSBridge(), "AndroidTTS");

        CookieManager cm = CookieManager.getInstance();
        cm.setAcceptCookie(true);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            cm.setAcceptThirdPartyCookies(wv, true);
        }

        wv.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                    WebResourceResponse localResp = interceptLocalApkAsset(request);
                    if (localResp != null) {
                        return localResp;
                    }
                }
                return super.shouldInterceptRequest(view, request);
            }

            @Override
            @SuppressWarnings("deprecation")
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                if (url == null) return false;
                Uri uri = Uri.parse(url);
                String host = uri.getHost() != null ? uri.getHost().toLowerCase(Locale.US) : "";

                if (AUTH_ORIGIN_HOST.equals(host)
                        || host.endsWith(".firebaseapp.com")
                        || host.contains("google.com")
                        || host.contains("googleapis.com")
                        || host.contains("gstatic.com")
                        || url.startsWith(getTargetBasePrefix())) {
                    return false;
                }
                if (url.startsWith("https://") || url.startsWith("http://")) {
                    try {
                        startActivity(new Intent(Intent.ACTION_VIEW, uri));
                    } catch (Exception ignored) {}
                    return true;
                }
                return false;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                pageFinishedOnce = true;
                cancelLoadWatchdog();
                if (loadingOverlay != null) {
                    loadingOverlay.setVisibility(View.GONE);
                }
                super.onPageFinished(view, url);
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && request.isForMainFrame()) {
                    cancelLoadWatchdog();
                    String desc = error != null && error.getDescription() != null
                            ? error.getDescription().toString()
                            : "Error de red";
                    showConnectionFallbackPage(request.getUrl().toString(), desc);
                }
            }
        });

        wv.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M
                                && checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
                            pendingPermissionRequest = request;
                            requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, REQ_AUDIO);
                        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                            request.grant(request.getResources());
                        }
                    }
                });
            }

            @Override
            public boolean onCreateWindow(WebView view, boolean isDialog, boolean isUserGesture, Message resultMsg) {
                WebView popup = new WebView(MainActivity.this);
                applyStandardSettings(popup.getSettings());
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                    CookieManager.getInstance().setAcceptThirdPartyCookies(popup, true);
                }

                final Dialog dialog = new Dialog(MainActivity.this, android.R.style.Theme_DeviceDefault_NoActionBar);
                dialog.setContentView(popup);
                popup.setWebViewClient(new WebViewClient() {
                    @Override
                    public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest req) {
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                            WebResourceResponse localResp = interceptLocalApkAsset(req);
                            if (localResp != null) {
                                return localResp;
                            }
                        }
                        return super.shouldInterceptRequest(v, req);
                    }

                    @Override
                    @SuppressWarnings("deprecation")
                    public boolean shouldOverrideUrlLoading(WebView v, String url) {
                        return false;
                    }
                });
                popup.setWebChromeClient(new WebChromeClient() {
                    @Override
                    public void onCloseWindow(WebView window) {
                        dialog.dismiss();
                    }
                });
                dialog.show();
                WebView.WebViewTransport transport = (WebView.WebViewTransport) resultMsg.obj;
                transport.setWebView(popup);
                resultMsg.sendToTarget();
                return true;
            }
        });

        wv.setDownloadListener(new DownloadListener() {
            @Override
            public void onDownloadStart(String url, String userAgent, String contentDisposition, String mimetype, long contentLength) {
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
                } catch (Exception ignored) {}
            }
        });
    }

    private WebResourceResponse interceptLocalApkAsset(WebResourceRequest request) {
        if (request == null || request.getUrl() == null) return null;
        Uri uri = request.getUrl();
        String host = uri.getHost();
        if (host == null || !AUTH_ORIGIN_HOST.equalsIgnoreCase(host)) {
            return null;
        }
        String method = request.getMethod();
        if (method != null && !"GET".equalsIgnoreCase(method) && !"HEAD".equalsIgnoreCase(method)) {
            return null;
        }
        String rawPath = uri.getPath();
        if (rawPath == null || rawPath.isEmpty() || "/".equals(rawPath)) {
            rawPath = "/index.html";
        }
        if (rawPath.startsWith("/__/auth") || rawPath.startsWith("/__/firebase")) {
            return null;
        }

        String decodedPath = rawPath;
        try {
            decodedPath = URLDecoder.decode(rawPath, "UTF-8");
        } catch (Exception ignored) {}
        if (decodedPath.contains("..")) {
            decodedPath = "/index.html";
        }

        String assetPath = "www" + (decodedPath.startsWith("/") ? decodedPath : "/" + decodedPath);
        byte[] bytes = readApkAsset(assetPath);
        String mime = detectMime(assetPath);

        if (bytes == null) {
            assetPath = "www/index.html";
            bytes = readApkAsset(assetPath);
            mime = "text/html";
        }
        if (bytes == null) return null;

        Map<String, String> headers = new HashMap<String, String>();
        headers.put("Access-Control-Allow-Origin", "*");
        headers.put("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        headers.put("Access-Control-Allow-Headers", "*");
        headers.put("Cache-Control", "no-cache");

        String charset = (mime.startsWith("text/") || mime.contains("javascript") || mime.contains("json"))
                ? "UTF-8"
                : null;
        return new WebResourceResponse(
                mime,
                charset,
                200,
                "OK",
                headers,
                new ByteArrayInputStream(bytes)
        );
    }

    private byte[] readApkAsset(String assetPath) {
        AssetManager assets = getAssets();
        try (InputStream is = new BufferedInputStream(assets.open(assetPath));
             ByteArrayOutputStream bos = new ByteArrayOutputStream()) {
            byte[] buf = new byte[16384];
            int n;
            while ((n = is.read(buf)) != -1) {
                bos.write(buf, 0, n);
            }
            return bos.toByteArray();
        } catch (Exception e) {
            return null;
        }
    }

    private String detectMime(String path) {
        String lower = path.toLowerCase(Locale.US);
        if (lower.endsWith(".html")) return "text/html";
        if (lower.endsWith(".js") || lower.endsWith(".mjs")) return "application/javascript";
        if (lower.endsWith(".css")) return "text/css";
        if (lower.endsWith(".svg")) return "image/svg+xml";
        if (lower.endsWith(".png")) return "image/png";
        if (lower.endsWith(".json")) return "application/json";
        if (lower.endsWith(".webmanifest")) return "application/manifest+json";
        if (lower.endsWith(".woff2")) return "font/woff2";
        if (lower.endsWith(".woff")) return "font/woff";
        return "application/octet-stream";
    }

    private void showConnectionFallbackPage(String failedUrl, String errorDetail) {
        if (loadingOverlay != null) {
            loadingOverlay.setVisibility(View.GONE);
        }
        String html = "<html><body style='background:#090B0E;color:#e2e8f0;font-family:sans-serif;padding:32px;text-align:center'>"
                + "<h2 style='color:#f59e0b;margin-top:40px'>TUG777 HyperTrade</h2>"
                + "<p style='font-size:13px;color:#94a3b8;line-height:1.5'>No se pudo cargar:<br/><code style='color:#e2e8f0'>" + failedUrl + "</code><br/><br/>" + errorDetail + "</p>"
                + "<button onclick='location.href=\"" + APK_BASE_URL + "\"' style='margin-top:16px;padding:13px 22px;background:#f59e0b;color:#090b0e;border:none;border-radius:8px;font-weight:bold;width:100%;max-width:280px'>Abrir Modo Local Integrado</button><br/>"
                + "<button onclick='location.reload()' style='margin-top:10px;padding:11px 22px;background:#1e293b;color:#e2e8f0;border:none;border-radius:8px;font-weight:bold;width:100%;max-width:280px'>Reintentar</button>"
                + "<p style='margin-top:20px;font-size:12px;color:#64748b'>Presiona el botón Atrás para cambiar el servidor.</p>"
                + "</body></html>";
        webView.loadDataWithBaseURL(APK_BASE_URL, html, "text/html", "utf-8", null);
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == REQ_AUDIO && pendingPermissionRequest != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
                pendingPermissionRequest.grant(pendingPermissionRequest.getResources());
            } else {
                pendingPermissionRequest.deny();
            }
            pendingPermissionRequest = null;
        }
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            showServerSwitcherDialog();
        }
    }

    private void showServerSwitcherDialog() {
        String[] options = {
                "Modo Local Integrado (Carga Rápida + OAuth Autorizado)",
                "Conectar a Servidor / Droplet HTTPS Personalizado",
                "Recargar TUG777"
        };
        new AlertDialog.Builder(this)
                .setTitle("TUG777 HyperTrade · Servidor")
                .setItems(options, new DialogInterface.OnClickListener() {
                    @Override
                    public void onClick(DialogInterface dialog, int which) {
                        if (which == 0) {
                            saveMode(MODE_LOCAL);
                        } else if (which == 1) {
                            promptCustomUrl();
                        } else if (which == 2) {
                            webView.reload();
                        }
                    }
                })
                .setNegativeButton("Salir de la App", new DialogInterface.OnClickListener() {
                    @Override
                    public void onClick(DialogInterface d, int w) {
                        finish();
                    }
                })
                .show();
    }

    private void promptCustomUrl() {
        final EditText input = new EditText(this);
        String current = getSavedMode();
        input.setText(MODE_LOCAL.equals(current) ? "https://tu-droplet-o-servidor.com" : current);
        new AlertDialog.Builder(this)
                .setTitle("URL del Servidor HTTPS")
                .setMessage("Ingresa la URL HTTPS de tu servidor TUG777 24/7:")
                .setView(input)
                .setPositiveButton("Conectar", new DialogInterface.OnClickListener() {
                    @Override
                    public void onClick(DialogInterface d, int w) {
                        String val = input.getText().toString().trim();
                        if (!val.isEmpty()) {
                            saveMode(val);
                        }
                    }
                })
                .setNegativeButton("Cancelar", null)
                .show();
    }

    @Override
    protected void onDestroy() {
        cancelLoadWatchdog();
        if (tts != null) {
            try {
                tts.stop();
                tts.shutdown();
            } catch (Exception ignored) {}
            tts = null;
        }
        if (webView != null) {
            webView.destroy();
        }
        super.onDestroy();
    }
}
