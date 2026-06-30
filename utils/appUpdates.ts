import { Capacitor, CapacitorHttp, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { APP_VERSION } from './buildInfo';

const GITHUB_RELEASE_MANIFEST_ASSET = 'moro-update.json';
const DEFAULT_RELEASE_OWNER = 'SAWA-25';
const DEFAULT_RELEASE_REPO = 'moro';
const DEFAULT_GITHUB_PROXY_URL = 'https://sullymeow.ccwu.cc/github?url=';

export interface NativeAppInfo {
  native: boolean;
  platform: string;
  packageName: string;
  versionName: string;
  versionCode: number | string;
  canRequestPackageInstalls: boolean;
}

export interface AppUpdateManifest {
  versionCode: number;
  versionName: string;
  apkUrl: string;
  domesticApkUrl?: string;
  sha256?: string;
  sizeBytes?: number;
  releaseNotes?: string;
  mandatory?: boolean;
  publishedAt?: string;
}

export interface AppUpdateCheckResult {
  current: NativeAppInfo;
  latest: AppUpdateManifest;
  updateAvailable: boolean;
}

export interface ApkDownloadProgress {
  status: 'start' | 'downloading' | 'verifying' | 'installing' | 'done';
  receivedBytes: number;
  totalBytes: number;
  progress: number;
}

interface MoroUpdaterPlugin {
  getInfo(): Promise<NativeAppInfo>;
  openInstallSettings(): Promise<void>;
  downloadAndInstall(options: { url: string; fileName?: string; sha256?: string }): Promise<{ fileName: string; bytes: number }>;
  addListener(eventName: 'downloadProgress', listenerFunc: (event: ApkDownloadProgress) => void): Promise<PluginListenerHandle>;
}

const MoroUpdater = registerPlugin<MoroUpdaterPlugin>('MoroUpdater');

const envManifestUrl = () => (import.meta.env.VITE_MORO_UPDATE_MANIFEST_URL || '').trim();
const envReleaseOwner = () => (import.meta.env.VITE_MORO_RELEASE_OWNER || DEFAULT_RELEASE_OWNER).trim();
const envReleaseRepo = () => (import.meta.env.VITE_MORO_RELEASE_REPO || DEFAULT_RELEASE_REPO).trim();
const envReleaseApiUrl = () => (import.meta.env.VITE_MORO_RELEASE_API_URL || '').trim();
const envGithubProxyUrl = () => (import.meta.env.VITE_MORO_GITHUB_PROXY_URL || DEFAULT_GITHUB_PROXY_URL).trim();

export function hasConfiguredAppUpdateSource(): boolean {
  return !!envManifestUrl() || !!envReleaseApiUrl() || (!!envReleaseOwner() && !!envReleaseRepo());
}

export async function getNativeAppInfo(): Promise<NativeAppInfo> {
  const platform = Capacitor.getPlatform();
  const fallback: NativeAppInfo = {
    native: Capacitor.isNativePlatform(),
    platform,
    packageName: '',
    versionName: APP_VERSION,
    versionCode: 0,
    canRequestPackageInstalls: false,
  };

  if (!Capacitor.isNativePlatform() || !Capacitor.isPluginAvailable('MoroUpdater')) return fallback;
  try {
    return await MoroUpdater.getInfo();
  } catch {
    return fallback;
  }
}

const pickString = (...values: unknown[]): string => {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
};

const pickNumber = (...values: unknown[]): number => {
  for (const value of values) {
    const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
    if (Number.isFinite(n)) return n;
  }
  return NaN;
};

const normalizeNotes = (value: unknown): string | undefined => {
  if (Array.isArray(value)) return value.map(v => String(v).trim()).filter(Boolean).join('\n');
  if (typeof value === 'string' && value.trim()) return value.trim();
  return undefined;
};

const isGithubUrl = (url: string): boolean => {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === 'github.com' || host === 'api.github.com' || host === 'uploads.github.com' || host.endsWith('.githubusercontent.com');
  } catch {
    return false;
  }
};

const proxifyGithubUrl = (url: string): string | undefined => {
  const proxy = envGithubProxyUrl();
  if (!proxy || !isGithubUrl(url)) return undefined;
  if (proxy.includes('{url}')) return proxy.replace('{url}', encodeURIComponent(url));
  const glue = proxy.endsWith('=') || proxy.endsWith('/') ? '' : proxy.includes('?') ? '&url=' : '?url=';
  return `${proxy}${glue}${encodeURIComponent(url)}`;
};

const addCacheBust = (url: string): string => {
  const bust = url.includes('?') ? '&' : '?';
  return `${url}${bust}_=${Date.now()}`;
};

const fetchJsonNoStore = async (url: string, headers: Record<string, string> = {}): Promise<any> => {
  const requestUrl = addCacheBust(url);
  if (Capacitor.isNativePlatform()) {
    const res = await CapacitorHttp.get({ url: requestUrl, headers });
    if (res.status < 200 || res.status >= 300) throw new Error(`HTTP ${res.status}`);
    if (typeof res.data === 'string') return JSON.parse(res.data);
    return res.data;
  }

  const res = await fetch(requestUrl, { cache: 'no-store', headers });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
};

const fetchGithubJsonNoStore = async (url: string, headers: Record<string, string> = {}): Promise<any> => {
  try {
    return await fetchJsonNoStore(url, headers);
  } catch (directError) {
    const proxiedUrl = proxifyGithubUrl(url);
    if (!proxiedUrl) throw directError;
    try {
      return await fetchJsonNoStore(proxiedUrl, headers);
    } catch {
      throw directError;
    }
  }
};

const parseAppUpdateManifest = (data: any, baseUrl: string, fallbackApkUrl?: string): AppUpdateManifest => {
  const android = data?.android || {};
  const versionCode = pickNumber(data?.versionCode, data?.version_code, android.versionCode, android.version_code);
  const versionName = pickString(data?.versionName, data?.version_name, android.versionName, android.version_name, `v${versionCode}`);
  const rawApkUrl = pickString(
    data?.apkUrl,
    data?.apk_url,
    data?.downloadUrl,
    data?.download_url,
    android.apkUrl,
    android.apk_url,
    android.downloadUrl,
    fallbackApkUrl,
  );
  const rawDomesticApkUrl = pickString(
    data?.domesticApkUrl,
    data?.domestic_apk_url,
    data?.cnApkUrl,
    data?.cn_apk_url,
    data?.apkUrlCn,
    data?.apk_url_cn,
    data?.mirrorApkUrl,
    data?.mirror_apk_url,
    android.domesticApkUrl,
    android.domestic_apk_url,
    android.cnApkUrl,
    android.cn_apk_url,
    android.apkUrlCn,
    android.apk_url_cn,
    android.mirrorApkUrl,
    android.mirror_apk_url,
  );

  if (!Number.isFinite(versionCode) || versionCode <= 0) throw new Error('更新信息缺少有效版本号');
  if (!rawApkUrl) throw new Error('更新包暂不可用');

  const apkUrl = new URL(rawApkUrl, baseUrl).href;
  const explicitDomesticApkUrl = rawDomesticApkUrl ? new URL(rawDomesticApkUrl, baseUrl).href : '';
  const domesticApkUrl = explicitDomesticApkUrl || proxifyGithubUrl(apkUrl);
  const sizeBytes = pickNumber(data?.sizeBytes, data?.size_bytes, android.sizeBytes, android.size_bytes);
  const sha256 = pickString(data?.sha256, data?.sha256sum, android.sha256, android.sha256sum).replace(/\s+/g, '').toLowerCase();

  return {
    versionCode: Math.floor(versionCode),
    versionName,
    apkUrl,
    domesticApkUrl,
    sha256: sha256 || undefined,
    sizeBytes: Number.isFinite(sizeBytes) && sizeBytes > 0 ? Math.floor(sizeBytes) : undefined,
    releaseNotes: normalizeNotes(data?.releaseNotes ?? data?.release_notes ?? data?.notes ?? android.releaseNotes ?? android.notes),
    mandatory: Boolean(data?.mandatory ?? android.mandatory),
    publishedAt: pickString(data?.publishedAt, data?.published_at, android.publishedAt, android.published_at) || undefined,
  };
};

export async function fetchAppUpdateManifest(manifestUrl: string, fallbackApkUrl?: string): Promise<AppUpdateManifest> {
  const url = manifestUrl.trim();
  if (!url) throw new Error('更新通道暂未接入');
  const data = isGithubUrl(url) ? await fetchGithubJsonNoStore(url) : await fetchJsonNoStore(url);
  return parseAppUpdateManifest(data, url, fallbackApkUrl);
}

interface GitHubReleaseAsset {
  name?: string;
  url?: string;
  browser_download_url?: string;
  size?: number;
  digest?: string;
}

interface GitHubRelease {
  tag_name?: string;
  name?: string;
  body?: string;
  published_at?: string;
  assets?: GitHubReleaseAsset[];
}

const parseSha256Digest = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const digest = value.trim().toLowerCase();
  const stripped = digest.startsWith('sha256:') ? digest.slice('sha256:'.length) : digest;
  return /^[a-f0-9]{64}$/.test(stripped) ? stripped : undefined;
};

const findApkAsset = (assets: GitHubReleaseAsset[], preferredName?: string): GitHubReleaseAsset | undefined => {
  if (preferredName) {
    const exact = assets.find(asset => asset.name === preferredName);
    if (exact?.browser_download_url) return exact;
  }
  return assets.find(asset => /\.apk$/i.test(asset.name || '') && /moro/i.test(asset.name || '') && !!asset.browser_download_url)
    || assets.find(asset => /\.apk$/i.test(asset.name || '') && !!asset.browser_download_url);
};

const parseVersionCodeFromText = (...values: unknown[]): number => {
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const match = value.match(/(?:versionCode|version_code|vc|code)[\s:=_-]*(\d+)/i);
    if (match) {
      const n = Number(match[1]);
      if (Number.isFinite(n) && n > 0) return Math.floor(n);
    }
  }
  return NaN;
};

async function fetchGithubLatestRelease(): Promise<GitHubRelease> {
  const explicitApi = envReleaseApiUrl();
  const apiUrl = explicitApi || `https://api.github.com/repos/${encodeURIComponent(envReleaseOwner())}/${encodeURIComponent(envReleaseRepo())}/releases/latest`;
  if (!explicitApi && (!envReleaseOwner() || !envReleaseRepo())) {
    throw new Error('更新通道暂未接入');
  }

  try {
    return await fetchGithubJsonNoStore(apiUrl, {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    });
  } catch {
    throw new Error('更新信息读取失败，请稍后再试');
  }
}

async function fetchGithubReleaseUpdateManifest(): Promise<AppUpdateManifest> {
  const release = await fetchGithubLatestRelease();
  const assets = Array.isArray(release.assets) ? release.assets : [];
  const manifestAsset = assets.find(asset => (asset.name || '').toLowerCase() === GITHUB_RELEASE_MANIFEST_ASSET && !!asset.browser_download_url);
  const apk = findApkAsset(assets);

  if (manifestAsset?.browser_download_url) {
    const data = await fetchGithubJsonNoStore(manifestAsset.browser_download_url);
    return parseAppUpdateManifest(data, manifestAsset.browser_download_url, apk?.browser_download_url);
  }

  if (!apk?.browser_download_url) throw new Error('更新包暂不可用');

  const versionCode = parseVersionCodeFromText(release.body, release.name, release.tag_name, apk.name);
  if (!Number.isFinite(versionCode) || versionCode <= 0) {
    throw new Error('更新信息暂不可用');
  }

  return {
    versionCode,
    versionName: pickString(release.name, release.tag_name, `v${versionCode}`),
    apkUrl: apk.browser_download_url,
    domesticApkUrl: proxifyGithubUrl(apk.browser_download_url),
    sha256: parseSha256Digest(apk.digest),
    sizeBytes: typeof apk.size === 'number' && apk.size > 0 ? apk.size : undefined,
    releaseNotes: normalizeNotes(release.body),
    publishedAt: release.published_at,
  };
}

export async function fetchConfiguredAppUpdateManifest(): Promise<AppUpdateManifest> {
  const manifestUrl = envManifestUrl();
  if (manifestUrl) return fetchAppUpdateManifest(manifestUrl);
  return fetchGithubReleaseUpdateManifest();
}

export async function checkConfiguredAppUpdate(): Promise<AppUpdateCheckResult> {
  const [current, latest] = await Promise.all([
    getNativeAppInfo(),
    fetchConfiguredAppUpdateManifest(),
  ]);
  const currentVersionCode = typeof current.versionCode === 'number' ? current.versionCode : Number(current.versionCode);
  return {
    current,
    latest,
    updateAvailable: latest.versionCode > (Number.isFinite(currentVersionCode) ? currentVersionCode : 0),
  };
}

export async function openInstallerPermissionSettings(): Promise<void> {
  if (!Capacitor.isNativePlatform() || !Capacitor.isPluginAvailable('MoroUpdater')) return;
  await MoroUpdater.openInstallSettings();
}

export async function downloadAndInstallApk(
  manifest: AppUpdateManifest,
  onProgress?: (progress: ApkDownloadProgress) => void,
): Promise<void> {
  if (!Capacitor.isNativePlatform() || !Capacitor.isPluginAvailable('MoroUpdater')) {
    window.open(manifest.apkUrl, '_blank', 'noopener,noreferrer');
    return;
  }

  const fileName = `moro-${manifest.versionName.replace(/[^\w.-]+/g, '-')}-${manifest.versionCode}.apk`;
  const handle = onProgress ? await MoroUpdater.addListener('downloadProgress', onProgress) : null;
  try {
    await MoroUpdater.downloadAndInstall({ url: manifest.apkUrl, fileName, sha256: manifest.sha256 });
  } finally {
    await handle?.remove();
  }
}
