# 应用更新（GitHub Releases + Appflow）

Moro 的更新入口在「文具盒 -> 基础与安全 -> 应用更新」。普通用户只会看到当前版本、检查更新、下载新版 APK、安装权限和更新说明；GitHub Release、更新清单 URL、Appflow App ID、channel 等开发配置都不出现在 App UI 里。

## APK 更新发布流程

推荐把 Android APK 和 `moro-update.json` 一起放到 GitHub Releases。当前安装包默认检查 [SAWA-25/moro](https://github.com/SAWA-25/moro) 的 latest release，不需要在 App 里配置。

为了让清单里的下载地址长期稳定，发布 Release 时建议把 APK asset 命名为 `moro.apk`。如果你想带版本号命名也可以，把下面清单里的 `apkUrl` / `cnApkUrl` 改成对应文件名即可。

如果后续要临时覆盖默认仓库，可以在打包 APK 前写入：

```dotenv
VITE_MORO_RELEASE_OWNER=SAWA-25
VITE_MORO_RELEASE_REPO=moro
```

也可以直接指定完整的 GitHub Latest Release API 地址，适合走自己的代理或镜像：

```dotenv
VITE_MORO_RELEASE_API_URL=https://api.github.com/repos/SAWA-25/moro/releases/latest
```

如果不想走 GitHub Release API，也可以指定固定更新清单：

```dotenv
VITE_MORO_UPDATE_MANIFEST_URL=https://example.com/moro-update.json
```

国内 GitHub 代理默认是 `https://sullymeow.ccwu.cc/github?url=`。如果你换成自己的代理，可在打包前覆盖：

```dotenv
VITE_MORO_GITHUB_PROXY_URL=https://your-worker.example.com/github?url=
```

PowerShell 临时打包示例：

```powershell
$env:VITE_MORO_RELEASE_OWNER="SAWA-25"
$env:VITE_MORO_RELEASE_REPO="moro"
pnpm build
pnpm cap:sync
```

发新版 APK 时要同步提高 [android/app/build.gradle](../android/app/build.gradle) 里的 `versionCode`，并用同一个签名证书签 APK。Android 只会把 `versionCode` 更大的同包名 APK 识别成升级包。

## moro-update.json

仓库根目录已经放了一份可直接改的 [moro-update.json](../moro-update.json)。发布时把它作为 GitHub Release asset 上传。推荐格式：

```json
{
  "versionCode": 2,
  "versionName": "1.0.1",
  "apkUrl": "https://github.com/SAWA-25/moro/releases/latest/download/moro.apk",
  "cnApkUrl": "https://sullymeow.ccwu.cc/github?url=https%3A%2F%2Fgithub.com%2FSAWA-25%2Fmoro%2Freleases%2Flatest%2Fdownload%2Fmoro.apk",
  "sha256": "把 APK 的 SHA-256 写在这里，推荐填写",
  "sizeBytes": 123456789,
  "releaseNotes": "修复若干问题\n新增若干功能",
  "mandatory": false,
  "publishedAt": "2026-06-30T12:00:00+08:00"
}
```

`apkUrl` 可以写完整 HTTPS 地址，也可以写同一个 Release 里的 APK 文件名。若 `moro-update.json` 放在 GitHub Release 且该 Release 里只有一个 APK，`apkUrl` 可以省略，App 会自动选中 APK asset。

`cnApkUrl` 是给国内用户的下载线路，建议放你自己的国内 CDN、对象存储或网盘直链。字段也兼容 `domesticApkUrl`、`apkUrlCn`、`mirrorApkUrl`。如果不填且 APK asset 在 GitHub Releases 上，App 会自动生成一条 `https://sullymeow.ccwu.cc/github?url=...` 国内代理线路；显式填写 `cnApkUrl` 时优先用你自己的地址。

`releaseNotes` 是普通用户会看到的更新内容，别写开发维护步骤或密钥信息。`sha256` 可选但推荐填，填了以后 App 会在打开系统安装器前校验 APK。

没有 `moro-update.json` 时，App 会尝试从 Release 标题、tag、正文或 APK 文件名里解析 `versionCode`，但这只是兜底；正式发布请始终附带 `moro-update.json`。

Android 不允许普通 App 静默安装 APK。Moro 会下载 APK、校验可选的 SHA-256，然后打开系统安装器；用户仍需手动确认安装，并按系统提示允许 Moro 安装未知来源应用。

## Ionic Appflow Live Updates

项目已经接入 `@capacitor/live-updates@0.3.1`，这是当前 Capacitor 6 工程使用的兼容版本。Appflow 配置只在构建时写入 Capacitor 配置，不在 App 里提供用户可编辑入口。

打包前可设置：

```dotenv
VITE_MORO_APPFLOW_APP_ID=your-appflow-app-id
VITE_MORO_APPFLOW_CHANNEL=Production
VITE_MORO_APPFLOW_AUTO_UPDATE_METHOD=background
VITE_MORO_APPFLOW_MAX_VERSIONS=2
```

`VITE_MORO_APPFLOW_APP_ID` 为空时，Live Updates 会保持关闭。配置完成后运行：

```powershell
pnpm build
pnpm cap:sync
```

Live Updates 只适合更新 WebView 里的网页资源，也就是 Vite 打出来的 JS/CSS/图片。以下变化仍然必须重新发 APK：

- 新增或修改 Android 权限
- 新增、升级或删除 Capacitor 原生插件
- 修改 `MainActivity`、Gradle、AndroidManifest、原生资源
- 改动需要 Android 系统识别的安装包版本号
