package com.aistock.twa;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.net.http.SslError;
import android.os.Bundle;
import android.util.Log;
import android.view.View;
import android.view.Window;
import android.webkit.CookieManager;
import android.webkit.SslErrorHandler;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.ByteArrayInputStream;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;

// import androidx.browser.customtabs.CustomTabsIntent; // OAuth をWebView内で完結するため不要

public class MainActivity extends Activity {

    private static final String TAG = "AIStock";
    private static final String APP_URL =
        "https://stock-prediction-opal-two.vercel.app";

    private WebView webView;
    private LinearLayout errorView;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        Window window = getWindow();
        window.setStatusBarColor(Color.parseColor("#3b82f6"));

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.parseColor("#f9fafb"));

        final ProgressBar progressBar = new ProgressBar(this, null,
            android.R.attr.progressBarStyleHorizontal);
        progressBar.setMax(100);
        progressBar.setLayoutParams(new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT, 8));

        webView = new WebView(this);
        webView.setLayoutParams(new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT,
            FrameLayout.LayoutParams.MATCH_PARENT));

        // エラー画面 (リトライボタン付き)
        errorView = new LinearLayout(this);
        errorView.setOrientation(LinearLayout.VERTICAL);
        errorView.setGravity(android.view.Gravity.CENTER);
        errorView.setLayoutParams(new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT,
            FrameLayout.LayoutParams.MATCH_PARENT));
        errorView.setVisibility(View.GONE);

        TextView errorText = new TextView(this);
        errorText.setText("接続できませんでした\nネットワークを確認してください");
        errorText.setTextSize(18);
        errorText.setTextColor(Color.DKGRAY);
        errorText.setGravity(android.view.Gravity.CENTER);
        errorText.setPadding(48, 0, 48, 24);

        Button retryButton = new Button(this);
        retryButton.setText("再試行");
        retryButton.setOnClickListener(v -> {
            errorView.setVisibility(View.GONE);
            webView.setVisibility(View.VISIBLE);
            webView.loadUrl(APP_URL);
        });

        errorView.addView(errorText);
        errorView.addView(retryButton);

        root.addView(webView);
        root.addView(errorView);
        root.addView(progressBar);
        setContentView(root);

        // WebView 設定
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);
        settings.setSupportZoom(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);

        // User-Agent から WebView 識別子を除去 (Google OAuth の disallowed_useragent 回避)
        // 新Android: "...; wv) ..." → "...) ..."
        // 旧Android: "... Version/4.0 Chrome/..." → "... Chrome/..."
        String ua = settings.getUserAgentString();
        ua = ua.replace("; wv)", ")");
        ua = ua.replaceAll("\\s*Version/\\d+\\.\\d+\\s*", " ");
        settings.setUserAgentString(ua);
        Log.d(TAG, "User-Agent: " + ua);

        // Cookie 有効化
        CookieManager cookieManager = CookieManager.getInstance();
        cookieManager.setAcceptCookie(true);
        cookieManager.setAcceptThirdPartyCookies(webView, true);

        // WebView デバッグ有効化
        WebView.setWebContentsDebuggingEnabled(true);

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view,
                                                               WebResourceRequest request) {
                String url = request.getUrl().toString();
                // sw.js リクエストを横取り → no-op SW を返す (SW起因のリダイレクトエラー防止)
                if (url.endsWith("/sw.js") || url.contains("/sw.js?")) {
                    Log.d(TAG, "Intercepting SW request, returning no-op: " + url);
                    String noopSw = "// No-op Service Worker for Android WebView\n" +
                        "self.addEventListener('install', () => self.skipWaiting());\n" +
                        "self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));\n";
                    return new WebResourceResponse("application/javascript", "UTF-8",
                        new ByteArrayInputStream(noopSw.getBytes()));
                }
                return null;
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                String url = request.getUrl().toString();
                Log.d(TAG, "Loading URL: " + url);
                return false;
            }

            @Override
            public void onPageStarted(WebView view, String url, Bitmap favicon) {
                Log.d(TAG, "Page started: " + url);
                progressBar.setVisibility(View.VISIBLE);
                errorView.setVisibility(View.GONE);
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                Log.d(TAG, "Page finished: " + url);
                progressBar.setVisibility(View.GONE);
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request,
                                        WebResourceError error) {
                Log.e(TAG, "WebView error: code=" + error.getErrorCode() +
                    " desc=" + error.getDescription() +
                    " url=" + request.getUrl());

                // メインフレームのエラーのみ表示
                if (request.isForMainFrame()) {
                    webView.setVisibility(View.GONE);
                    errorView.setVisibility(View.VISIBLE);
                    // エラーテキスト更新
                    TextView tv = (TextView) errorView.getChildAt(0);
                    tv.setText("接続エラー\n" + error.getDescription() +
                        "\n\nURL: " + request.getUrl().getHost());
                }
            }

            @Override
            public void onReceivedSslError(WebView view, SslErrorHandler handler,
                                           SslError error) {
                Log.e(TAG, "SSL error: " + error.toString());
                // デバッグビルドではSSLエラーを無視して続行
                handler.proceed();
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onProgressChanged(WebView view, int newProgress) {
                progressBar.setProgress(newProgress);
            }
        });

        // 毎回 clear-sw.html 経由で起動 (古いSW除去 → リダイレクト → アプリ読込)
        // 再登録される sw.js は shouldInterceptRequest で no-op に差替済
        String startUrl = APP_URL + "/clear-sw.html";
        Log.d(TAG, "Loading via SW clear: " + startUrl);
        webView.loadUrl(startUrl);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        if (intent != null && intent.getData() != null) {
            String url = intent.getData().toString();
            Log.d(TAG, "onNewIntent URL: " + url);
            if (url.contains("vercel.app")) {
                webView.loadUrl(url);
            }
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        // OAuth完了後にアプリに戻ったらリロード
        Log.d(TAG, "onResume");
    }

    @Override
    public void onBackPressed() {
        if (errorView.getVisibility() == View.VISIBLE) {
            errorView.setVisibility(View.GONE);
            webView.setVisibility(View.VISIBLE);
            webView.loadUrl(APP_URL);
        } else if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

}
