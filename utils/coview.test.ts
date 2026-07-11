import { afterEach, describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';
import {
  buildCoViewBuiltinVideoSiteUrl,
  createCoViewBookFromText,
  discussCoView,
  getCoViewVideoEmbed,
  paginateText,
  parseCoViewDiscussResponse,
  parseEpubBook,
} from './coview';
import { DB } from './db';
import type { CoViewBook, CoViewMedia, CoViewMessage, CoViewSession } from '../types';

const makeFile = (parts: BlobPart[], name: string, type: string): File => {
  if (typeof File !== 'undefined') return new File(parts, name, { type });
  const blob: any = new Blob(parts, { type });
  blob.name = name;
  return blob as File;
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('coview parsing', () => {
  it('uses Yinghua Anime as the built-in cinema site', () => {
    const url = buildCoViewBuiltinVideoSiteUrl();
    expect(url).toContain('/yinghua?');
    expect(new URL(url).searchParams.get('url')).toBe('https://www.yinghuaanime.com/index.php');
    expect(getCoViewVideoEmbed(url)).toMatchObject({
      provider: 'yinghua',
      embedUrl: url,
      sourceUrl: 'https://www.yinghuaanime.com/index.php',
    });
  });

  it('splits TXT/MD style headings into chapters', () => {
    const book = createCoViewBookFromText({
      title: '夜读',
      sourceType: 'md',
      text: '# 第一章 雨\n\n她推开窗。\n\n## 第二章 灯\n\n灯还亮着。',
    });

    expect(book.chapters).toHaveLength(2);
    expect(book.chapters[0].title).toContain('第一章');
    expect(book.chapters[1].text).toContain('灯还亮着');
  });

  it('paginates without dropping text', () => {
    const pages = paginateText('甲'.repeat(20) + '\n\n' + '乙'.repeat(20), 25);
    expect(pages.length).toBeGreaterThan(1);
    expect(pages.join('')).toContain('甲'.repeat(20));
    expect(pages.join('')).toContain('乙'.repeat(20));
  });

  it('parses a minimal EPUB spine', async () => {
    const zip = new JSZip();
    zip.file('META-INF/container.xml', '<container><rootfiles><rootfile full-path="OPS/content.opf"/></rootfiles></container>');
    zip.file('OPS/content.opf', `
      <package>
        <metadata><dc:title>小书</dc:title><dc:creator>某人</dc:creator></metadata>
        <manifest><item id="c1" href="chapter1.xhtml" media-type="application/xhtml+xml"/></manifest>
        <spine><itemref idref="c1"/></spine>
      </package>
    `);
    zip.file('OPS/chapter1.xhtml', '<html><head><title>开场</title></head><body><h1>开场</h1><p>第一句话。</p></body></html>');
    const blob = await zip.generateAsync({ type: 'blob' });
    const book = await parseEpubBook(makeFile([blob], 'book.epub', 'application/epub+zip'));

    expect(book.title).toBe('小书');
    expect(book.author).toBe('某人');
    expect(book.chapters[0].title).toBe('开场');
    expect(book.chapters[0].text).toContain('第一句话');
  });

  it('downgrades invalid AI actions by mode', () => {
    expect(parseCoViewDiscussResponse('{"reply":"好","action":{"kind":"next_page"}}', 'cinema').action.kind).toBe('none');
    expect(parseCoViewDiscussResponse('{"reply":"好","action":{"kind":"pause"}}', 'reading').action.kind).toBe('none');
    expect(parseCoViewDiscussResponse('{"reply":"翻页吧","action":{"kind":"next_page"}}', 'reading').action.kind).toBe('next_page');
  });

  it('sends a cinema vision frame as image_url when discussing', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: '{"reply":"这一帧的表情很紧。","action":{"kind":"none"}}' } }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await discussCoView({
      mode: 'cinema',
      char: { id: 'c1', modelId: 'char-c1', name: '阿迟', description: '会认真吐槽。' } as any,
      user: { name: '我' } as any,
      api: { baseUrl: 'https://api.example.com/v1', apiKey: 'k', model: 'vision-model' } as any,
      targetTitle: '内嵌视频站：樱花动漫',
      contextText: '影院视觉：屏幕共享抽帧已开启',
      history: [],
      progressLabel: '内嵌视频站 · 视觉共览中',
      visionFrameImageDataUrl: 'data:image/jpeg;base64,abc',
      visionFrameLabel: '屏幕共享当前帧',
    });

    expect(result.reply).toContain('表情');
    const request = (fetchMock.mock.calls as any)[0]?.[1] as RequestInit | undefined;
    const body = JSON.parse(request?.body as string);
    expect(body.messages[0].content).toEqual([
      expect.objectContaining({ type: 'text', text: expect.stringContaining('附带一张影院当前画面截图') }),
      { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,abc' } },
    ]);
  });
});

describe('coview db', () => {
  it('saves media, books, sessions, and messages', async () => {
    const suffix = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const media: CoViewMedia = {
      id: `m_${suffix}`,
      kind: 'direct_url',
      title: '片段',
      url: 'https://example.com/movie.mp4',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const book: CoViewBook = createCoViewBookFromText({
      title: `书_${suffix}`,
      sourceType: 'txt',
      text: '第1章\n正文',
    });
    const session: CoViewSession = {
      id: `s_${suffix}`,
      mode: 'reading',
      charId: 'char-test',
      targetId: book.id,
      targetTitle: book.title,
      status: 'active',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const message: CoViewMessage = {
      id: `msg_${suffix}`,
      sessionId: session.id,
      mode: 'reading',
      role: 'user',
      text: '看到这里',
      createdAt: Date.now(),
    };

    await DB.saveCoViewMedia(media);
    await DB.saveCoViewBook(book);
    await DB.saveCoViewSession(session);
    await DB.saveCoViewMessage(message);

    expect((await DB.getCoViewMedia()).some(item => item.id === media.id)).toBe(true);
    expect((await DB.getCoViewBooks()).some(item => item.id === book.id)).toBe(true);
    expect((await DB.getCoViewSessions()).some(item => item.id === session.id)).toBe(true);
    expect(await DB.getCoViewMessages(session.id)).toMatchObject([{ id: message.id, text: '看到这里' }]);
  });
});
