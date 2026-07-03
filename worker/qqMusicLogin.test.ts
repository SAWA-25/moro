import { Buffer } from 'node:buffer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from './index.js';

const pngBytes = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41,
  0x54, 0x78, 0x9c, 0x63, 0x60, 0x00, 0x00, 0x00,
  0x02, 0x00, 0x01, 0xe2, 0x21, 0xbc, 0x33, 0x00,
  0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82,
]);

const responseWithCookies = (
  body: BodyInit,
  init: ResponseInit,
  cookies: string[],
): Response => {
  const headers = new Headers(init.headers);
  for (const cookie of cookies) headers.append('Set-Cookie', cookie);
  return new Response(body, { ...init, headers });
};

const postQrCreate = () => worker.fetch(
  new Request('https://moro.test/qqmusic/login/qr/create', { method: 'POST' }),
  {},
  {},
);

const postQQSongUrl = (body: Record<string, unknown>) => worker.fetch(
  new Request('https://moro.test/qqmusic/song/url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }),
  {},
  {},
);

const decodeTicket = (ticket: string): any => {
  const b64 = ticket.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - b64.length % 4) % 4);
  return JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
};

describe('QQ Music login worker', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates a ticket and data-image QR code', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.startsWith('https://xui.ptlogin2.qq.com/cgi-bin/xlogin')) {
        return responseWithCookies(
          '<script>ptui_version:encodeURIComponent("30000000")</script>',
          { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
          [
            'pt_login_sig=login-sig; Path=/; HttpOnly',
            'ptui_loginuin=10001; Path=/; HttpOnly',
          ],
        );
      }
      if (url.startsWith('https://ssl.ptlogin2.qq.com/ptqrshow')) {
        return responseWithCookies(
          pngBytes,
          { status: 200, headers: { 'Content-Type': 'image/png' } },
          [
            'qrsig=qr-sig; Path=/; HttpOnly',
            'ptdrvs=driver; Path=/; HttpOnly',
          ],
        );
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const res = await postQrCreate();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe('waiting');
    expect(body.ticket).toBeTruthy();
    expect(body.qrImg).toMatch(/^data:image\/png;base64,/);

    const state = decodeTicket(body.ticket);
    expect(state.jar.qrsig).toBe('qr-sig');
    expect(state.jar.pt_login_sig).toBe('login-sig');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not turn a non-image QQ response into a fake QR code', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.startsWith('https://xui.ptlogin2.qq.com/cgi-bin/xlogin')) {
        return responseWithCookies(
          '<html>login</html>',
          { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
          ['pt_login_sig=login-sig; Path=/; HttpOnly'],
        );
      }
      if (url.startsWith('https://ssl.ptlogin2.qq.com/ptqrshow')) {
        return responseWithCookies(
          '<html>blocked</html>',
          { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
          ['qrsig=qr-sig; Path=/; HttpOnly'],
        );
      }
      throw new Error(`unexpected fetch ${url}`);
    }));

    const res = await postQrCreate();
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.status).toBe('error');
    expect(body.message).toContain('非图片内容');
    expect(body.qrImg).toBeUndefined();
  });

  it('requests QQ Music vkey with media_mid filename for logged-in members', async () => {
    const filenames: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.startsWith('https://u.y.qq.com/cgi-bin/musicu.fcg')) {
        const parsed = new URL(url);
        const payload = JSON.parse(String(parsed.searchParams.get('data') || '{}'));
        const filename = String(payload?.req_0?.param?.filename?.[0] || '');
        filenames.push(filename);
        return new Response(JSON.stringify({
          req_0: {
            data: {
              sip: ['https://dl.stream.qqmusic.qq.com/'],
              midurlinfo: [{ purl: filename === 'M800MEDIA999.mp3' ? 'M800MEDIA999.mp3?vkey=ok' : '' }],
            },
          },
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      throw new Error(`unexpected fetch ${url}`);
    }));

    const res = await postQQSongUrl({
      cookie: 'uin=10001; qm_keyst=member-token',
      uin: '10001',
      songmid: 'SONG123',
      mediaMid: 'MEDIA999',
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe('success');
    expect(body.data.url).toBe('https://dl.stream.qqmusic.qq.com/M800MEDIA999.mp3?vkey=ok');
    expect(filenames).toEqual(['M800MEDIA999.mp3']);
  });
});
