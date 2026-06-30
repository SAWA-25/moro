package com.moro.app;

import android.graphics.Color;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.content.pm.SigningInfo;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.Window;
import android.webkit.WebSettings;
import android.webkit.WebView;

import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;

import java.security.MessageDigest;
import java.util.Locale;

public class MainActivity extends BridgeActivity {
    private static final String RELEASE_CERT_SHA256 = "c82f83def82b48108aad6bfe80e1243ae15fdd4c7d29481d6a5e17d57fb2e238";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        if (!isDebuggable() && !hasExpectedReleaseSignature()) {
            finish();
            return;
        }

        registerPlugin(MoroUpdaterPlugin.class);
        super.onCreate(savedInstanceState);

        Window window = getWindow();
        WindowCompat.setDecorFitsSystemWindows(window, true);
        window.setStatusBarColor(Color.rgb(244, 242, 237));
        window.setNavigationBarColor(Color.BLACK);

        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(window, window.getDecorView());
        controller.setAppearanceLightStatusBars(true);
        controller.setAppearanceLightNavigationBars(false);

        if (bridge != null && bridge.getWebView() != null) {
            WebView webView = bridge.getWebView();
            webView.setOverScrollMode(View.OVER_SCROLL_NEVER);
            webView.setScrollBarStyle(View.SCROLLBARS_INSIDE_OVERLAY);
            webView.setLayerType(View.LAYER_TYPE_HARDWARE, null);
            webView.setBackgroundColor(Color.rgb(244, 242, 237));

            WebSettings settings = webView.getSettings();
            settings.setTextZoom(100);
            settings.setLoadWithOverviewMode(false);
            settings.setUseWideViewPort(false);
        }
    }

    private boolean hasExpectedReleaseSignature() {
        try {
            PackageManager packageManager = getPackageManager();
            PackageInfo info;
            Signature[] signatures;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                info = packageManager.getPackageInfo(getPackageName(), PackageManager.GET_SIGNING_CERTIFICATES);
                SigningInfo signingInfo = info.signingInfo;
                signatures = signingInfo != null && signingInfo.hasMultipleSigners()
                    ? signingInfo.getApkContentsSigners()
                    : signingInfo != null ? signingInfo.getSigningCertificateHistory() : new Signature[0];
            } else {
                info = packageManager.getPackageInfo(getPackageName(), PackageManager.GET_SIGNATURES);
                signatures = info.signatures;
            }

            if (signatures == null) return false;
            for (Signature signature : signatures) {
                if (RELEASE_CERT_SHA256.equals(sha256(signature.toByteArray()))) {
                    return true;
                }
            }
        } catch (Exception ignored) {
            return false;
        }
        return false;
    }

    private boolean isDebuggable() {
        return (getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
    }

    private String sha256(byte[] data) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        byte[] hash = digest.digest(data);
        StringBuilder out = new StringBuilder(hash.length * 2);
        for (byte b : hash) {
            out.append(String.format(Locale.US, "%02x", b));
        }
        return out.toString();
    }
}
