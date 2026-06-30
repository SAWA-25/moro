package com.moro.app;

import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.atomic.AtomicReference;
import java.util.Locale;

@CapacitorPlugin(name = "MoroUpdater")
public class MoroUpdaterPlugin extends Plugin {
    @PluginMethod
    public void getInfo(PluginCall call) {
        JSObject ret = new JSObject();
        Context context = getContext();
        String packageName = context.getPackageName();
        ret.put("native", true);
        ret.put("platform", "android");
        ret.put("packageName", packageName);

        try {
            PackageInfo info = context.getPackageManager().getPackageInfo(packageName, 0);
            ret.put("versionName", info.versionName != null ? info.versionName : "");
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                ret.put("versionCode", info.getLongVersionCode());
            } else {
                ret.put("versionCode", info.versionCode);
            }
        } catch (PackageManager.NameNotFoundException e) {
            ret.put("versionName", "");
            ret.put("versionCode", 0);
        }

        ret.put("canRequestPackageInstalls", canRequestPackageInstalls());
        call.resolve(ret);
    }

    @PluginMethod
    public void openInstallSettings(PluginCall call) {
        try {
            Intent intent;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                intent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES);
                intent.setData(Uri.parse("package:" + getContext().getPackageName()));
            } else {
                intent = new Intent(Settings.ACTION_SECURITY_SETTINGS);
            }
            getActivity().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("无法打开安装权限设置", e);
        }
    }

    @PluginMethod
    public void downloadAndInstall(PluginCall call) {
        String rawUrl = call.getString("url", "");
        String fileName = call.getString("fileName", "moro-update.apk");
        String sha256 = call.getString("sha256", "");

        if (rawUrl == null || rawUrl.trim().isEmpty()) {
            call.reject("缺少 APK 下载地址");
            return;
        }

        if (!canRequestPackageInstalls()) {
            call.reject("系统尚未允许 Moro 安装未知来源应用，请先开启安装权限", "INSTALL_PERMISSION_REQUIRED");
            return;
        }

        execute(() -> {
            try {
                File apk = downloadApk(rawUrl.trim(), safeApkFileName(fileName));
                if (sha256 != null && !sha256.trim().isEmpty()) {
                    notifyProgress("verifying", apk.length(), apk.length(), 1d);
                    String actual = sha256(apk);
                    String expected = sha256.trim().replaceAll("\\s+", "").toLowerCase(Locale.US);
                    if (!actual.equals(expected)) {
                        apk.delete();
                        call.reject("APK 校验失败：SHA-256 不一致");
                        return;
                    }
                }
                notifyProgress("installing", apk.length(), apk.length(), 1d);
                AtomicReference<RuntimeException> installError = new AtomicReference<>(null);
                CountDownLatch installStarted = new CountDownLatch(1);
                getActivity().runOnUiThread(() -> {
                    try {
                        installApk(apk);
                    } catch (RuntimeException e) {
                        installError.set(e);
                    } finally {
                        installStarted.countDown();
                    }
                });
                installStarted.await();
                if (installError.get() != null) {
                    throw installError.get();
                }

                JSObject ret = new JSObject();
                ret.put("fileName", apk.getName());
                ret.put("bytes", apk.length());
                notifyProgress("done", apk.length(), apk.length(), 1d);
                call.resolve(ret);
            } catch (Exception e) {
                call.reject(e.getMessage() != null ? e.getMessage() : "APK 下载或安装失败", e);
            }
        });
    }

    private boolean canRequestPackageInstalls() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return true;
        return getContext().getPackageManager().canRequestPackageInstalls();
    }

    private File downloadApk(String rawUrl, String fileName) throws Exception {
        notifyProgress("start", 0, 0, 0d);

        URL url = new URL(rawUrl);
        HttpURLConnection connection = (HttpURLConnection) url.openConnection();
        connection.setConnectTimeout(15000);
        connection.setReadTimeout(30000);
        connection.setInstanceFollowRedirects(true);
        connection.setRequestProperty("User-Agent", "MoroUpdater/1.0");
        connection.connect();

        int status = connection.getResponseCode();
        if (status < 200 || status >= 300) {
            connection.disconnect();
            throw new IllegalStateException("APK 下载失败：HTTP " + status);
        }

        long total = connection.getContentLengthLong();
        File dir = new File(getContext().getCacheDir(), "updates");
        if (!dir.exists() && !dir.mkdirs()) {
            connection.disconnect();
            throw new IllegalStateException("无法创建更新缓存目录");
        }

        File apk = new File(dir, fileName);
        byte[] buffer = new byte[64 * 1024];
        long received = 0;

        try (InputStream input = connection.getInputStream(); FileOutputStream output = new FileOutputStream(apk)) {
            int read;
            while ((read = input.read(buffer)) != -1) {
                output.write(buffer, 0, read);
                received += read;
                double progress = total > 0 ? Math.min(0.99d, (double) received / (double) total) : 0d;
                notifyProgress("downloading", received, Math.max(total, 0), progress);
            }
        } finally {
            connection.disconnect();
        }

        if (apk.length() <= 0) {
            apk.delete();
            throw new IllegalStateException("下载到的 APK 为空");
        }
        return apk;
    }

    private String safeApkFileName(String fileName) {
        String safe = fileName == null ? "" : fileName.replaceAll("[^A-Za-z0-9._-]", "-");
        if (safe.isEmpty()) safe = "moro-update.apk";
        if (!safe.toLowerCase(Locale.US).endsWith(".apk")) safe += ".apk";
        return safe;
    }

    private String sha256(File file) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        byte[] buffer = new byte[64 * 1024];
        try (FileInputStream input = new FileInputStream(file)) {
            int read;
            while ((read = input.read(buffer)) != -1) {
                digest.update(buffer, 0, read);
            }
        }
        StringBuilder out = new StringBuilder();
        for (byte b : digest.digest()) {
            out.append(String.format(Locale.US, "%02x", b));
        }
        return out.toString();
    }

    private void installApk(File apk) {
        Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", apk);
        Intent intent = new Intent(Intent.ACTION_VIEW);
        intent.setDataAndType(uri, "application/vnd.android.package-archive");
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);

        try {
            getActivity().startActivity(intent);
        } catch (ActivityNotFoundException e) {
            Intent fallback = new Intent(Intent.ACTION_VIEW, uri);
            fallback.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            fallback.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(Intent.createChooser(fallback, "安装 Moro 更新"));
        }
    }

    private void notifyProgress(String status, long receivedBytes, long totalBytes, double progress) {
        JSObject data = new JSObject();
        data.put("status", status);
        data.put("receivedBytes", receivedBytes);
        data.put("totalBytes", totalBytes);
        data.put("progress", progress);
        notifyListeners("downloadProgress", data);
    }
}
