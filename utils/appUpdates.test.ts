import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./buildInfo', () => ({
  APP_VERSION: 'test',
  BUILD_LABEL: 'test@0000000',
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    getPlatform: () => 'web',
    isNativePlatform: () => false,
    isPluginAvailable: () => false,
  },
  CapacitorHttp: {
    get: vi.fn(),
    request: vi.fn(),
  },
  registerPlugin: vi.fn(() => ({})),
}));

const latestRelease = {
  tag_name: 'v1.0.3',
  name: 'Moro v1.0.3',
  body: 'Moro 1.0.3 正式版',
  published_at: '2026-06-30T13:57:57Z',
  assets: [
    {
      name: 'moro-update.json',
      browser_download_url: 'https://github.com/SAWA-25/moro/releases/download/v1.0.3/moro-update.json',
    },
    {
      name: 'moro.apk',
      browser_download_url: 'https://github.com/SAWA-25/moro/releases/download/v1.0.3/moro.apk',
      size: 208374501,
      digest: 'sha256:59ab60cc521a50fa2913e7bf80d6b3724a3ab7567071d1add20d5ec864446c6f',
    },
  ],
};

describe('app update manifest', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('falls back to latest release metadata when the manifest asset is stale', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.startsWith('https://api.github.com/repos/SAWA-25/moro/releases/latest')) {
        return Response.json(latestRelease);
      }
      if (url.startsWith('https://github.com/SAWA-25/moro/releases/download/v1.0.3/moro-update.json')) {
        return Response.json({
          versionCode: 3,
          versionName: '1.0.2',
          apkUrl: 'https://github.com/SAWA-25/moro/releases/latest/download/moro.apk',
          releaseNotes: '旧清单',
        });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const { fetchConfiguredAppUpdateManifest } = await import('./appUpdates');
    const manifest = await fetchConfiguredAppUpdateManifest();

    expect(manifest.versionCode).toBe(4);
    expect(manifest.versionName).toBe('1.0.3');
    expect(manifest.apkUrl).toBe('https://github.com/SAWA-25/moro/releases/download/v1.0.3/moro.apk');
    expect(manifest.sha256).toBe('59ab60cc521a50fa2913e7bf80d6b3724a3ab7567071d1add20d5ec864446c6f');
  });

  it('uses the manifest asset when it matches the latest release', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.startsWith('https://api.github.com/repos/SAWA-25/moro/releases/latest')) {
        return Response.json(latestRelease);
      }
      if (url.startsWith('https://github.com/SAWA-25/moro/releases/download/v1.0.3/moro-update.json')) {
        return Response.json({
          versionCode: 4,
          versionName: '1.0.3',
          apkUrl: 'https://github.com/SAWA-25/moro/releases/latest/download/moro.apk',
          releaseNotes: '新清单',
        });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const { fetchConfiguredAppUpdateManifest } = await import('./appUpdates');
    const manifest = await fetchConfiguredAppUpdateManifest();

    expect(manifest.versionCode).toBe(4);
    expect(manifest.versionName).toBe('1.0.3');
    expect(manifest.releaseNotes).toBe('新清单');
  });

  it('uses the POST GitHub proxy when the direct GitHub API request fails', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith('https://api.github.com/repos/SAWA-25/moro/releases/latest')) {
        return new Response('blocked', { status: 503 });
      }
      if (url.startsWith('https://sullymeow.ccwu.cc/github?url=')) {
        expect(init?.method).toBe('POST');
        expect((init?.headers as Record<string, string>)['X-GitHub-Method']).toBe('GET');
        return Response.json(latestRelease);
      }
      if (url.startsWith('https://github.com/SAWA-25/moro/releases/download/v1.0.3/moro-update.json')) {
        return Response.json({
          versionCode: 4,
          versionName: '1.0.3',
          apkUrl: 'https://github.com/SAWA-25/moro/releases/latest/download/moro.apk',
        });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const { fetchConfiguredAppUpdateManifest } = await import('./appUpdates');
    const manifest = await fetchConfiguredAppUpdateManifest();

    expect(manifest.versionCode).toBe(4);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/^https:\/\/sullymeow\.ccwu\.cc\/github\?url=/),
      expect.objectContaining({
        method: 'POST',
      }),
    );
  });
});
