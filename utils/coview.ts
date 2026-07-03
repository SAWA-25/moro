import JSZip from 'jszip';
import { APIConfig, CharacterProfile, CoViewAction, CoViewBook, CoViewBookChapter, CoViewMessage, UserProfile } from '../types';
import { callChatCompletion } from './llmClient';
import { makeApiUsageMeta } from './apiUsageCatalog';
import { extractContent } from './safeApi';
import { ContextBuilder } from './context';

export const COVIEW_DEFAULT_CHARS_PER_PAGE = 900;

export interface CoViewSearchResult {
  title: string;
  year?: string;
  description?: string;
  url?: string;
  sourceLabel?: string;
}

export interface CoViewVideoEmbed {
  provider: 'yinghua' | 'bilibili' | 'vimeo' | 'generic';
  embedUrl: string;
  sourceUrl: string;
}

export const COVIEW_BUILTIN_VIDEO_SITE_URL = 'https://www.yinghuaanime.com/index.php';

export function buildCoViewBuiltinVideoSiteUrl(): string {
  return COVIEW_BUILTIN_VIDEO_SITE_URL;
}

export interface CoViewDiscussInput {
  mode: 'cinema' | 'reading';
  char: CharacterProfile;
  user: UserProfile;
  api: APIConfig;
  targetTitle: string;
  contextText: string;
  history: CoViewMessage[];
  userMessage?: string;
  progressLabel?: string;
  playing?: boolean;
  visionFrameImageDataUrl?: string;
  visionFrameLabel?: string;
}

const uid = (prefix: string) => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const isVisionUnsupported = (message: string): boolean =>
  /vision|image|图片|图像|多模态|multimodal|unsupported|不支持|invalid.*content/i.test(message || '');

export function getCoViewVideoEmbed(url: string): CoViewVideoEmbed | null {
  const raw = url.trim();
  if (!raw) return null;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;

  const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
  const path = parsed.pathname;

  if (host.endsWith('yinghuaanime.com')) {
    return { provider: 'yinghua', embedUrl: raw, sourceUrl: raw };
  }

  if (host === 'player.bilibili.com') {
    return { provider: 'bilibili', embedUrl: raw, sourceUrl: raw };
  }
  if (host.endsWith('bilibili.com') || host === 'b23.tv') {
    const bvid = raw.match(/\/video\/(BV[\w]+)/i)?.[1] || raw.match(/\b(BV[\w]{8,})\b/i)?.[1];
    const aid = raw.match(/\/video\/av(\d+)/i)?.[1] || parsed.searchParams.get('aid');
    const page = parsed.searchParams.get('p') || parsed.searchParams.get('page') || '1';
    if (bvid || aid) {
      const embed = new URL('https://player.bilibili.com/player.html');
      if (bvid) embed.searchParams.set('bvid', bvid);
      if (aid) embed.searchParams.set('aid', aid);
      embed.searchParams.set('page', page);
      embed.searchParams.set('high_quality', '1');
      embed.searchParams.set('autoplay', '0');
      return { provider: 'bilibili', embedUrl: embed.toString(), sourceUrl: raw };
    }
  }

  if (host === 'player.vimeo.com' && path.startsWith('/video/')) {
    return { provider: 'vimeo', embedUrl: raw, sourceUrl: raw };
  }
  if (host === 'vimeo.com') {
    const id = path.split('/').filter(Boolean).find(segment => /^\d+$/.test(segment));
    if (id) return { provider: 'vimeo', embedUrl: `https://player.vimeo.com/video/${id}`, sourceUrl: raw };
  }

  return { provider: 'generic', embedUrl: raw, sourceUrl: raw };
}

export const normalizeCoViewText = (text: string): string =>
  (text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();

const decodeEntities = (text: string): string =>
  text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_m, n) => String.fromCharCode(Number(n) || 0));

const htmlToText = (html: string): { title?: string; text: string } => {
  const title = decodeEntities((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').replace(/<[^>]+>/g, '').trim());
  const body = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<\/(h[1-6]|p|div|section|article|li|blockquote)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/[ \t]{2,}/g, ' ');
  return { title: title || undefined, text: normalizeCoViewText(decodeEntities(body)) };
};

const chapterHeadingPattern = /^(#{1,6}\s+.+|第[一二三四五六七八九十百千万零〇\d]+[章节回卷部篇].*|Chapter\s+\d+.*)$/gim;

export function splitTextIntoChapters(text: string, fallbackTitle: string): CoViewBookChapter[] {
  const clean = normalizeCoViewText(text);
  if (!clean) return [{ id: uid('cvc'), title: fallbackTitle || '未命名章节', text: '', index: 0 }];

  const matches = [...clean.matchAll(chapterHeadingPattern)].filter(m => typeof m.index === 'number');
  if (matches.length === 0) {
    return [{ id: uid('cvc'), title: fallbackTitle || '正文', text: clean, index: 0 }];
  }

  const chapters: CoViewBookChapter[] = [];
  matches.forEach((match, index) => {
    const start = match.index || 0;
    const next = matches[index + 1]?.index ?? clean.length;
    const rawHeading = match[0].replace(/^#{1,6}\s+/, '').trim();
    const block = clean.slice(start + match[0].length, next).trim();
    chapters.push({
      id: uid('cvc'),
      title: rawHeading || `第 ${index + 1} 章`,
      text: block || rawHeading,
      index,
    });
  });
  return chapters.length ? chapters : [{ id: uid('cvc'), title: fallbackTitle || '正文', text: clean, index: 0 }];
}

export function paginateText(text: string, charsPerPage = COVIEW_DEFAULT_CHARS_PER_PAGE): string[] {
  const clean = normalizeCoViewText(text);
  if (!clean) return [''];
  const paragraphs = clean.split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
  const pages: string[] = [];
  let page = '';

  const flush = () => {
    if (page.trim()) pages.push(page.trim());
    page = '';
  };

  for (const para of paragraphs) {
    if (para.length > charsPerPage) {
      flush();
      for (let i = 0; i < para.length; i += charsPerPage) pages.push(para.slice(i, i + charsPerPage).trim());
      continue;
    }
    const next = page ? `${page}\n\n${para}` : para;
    if (next.length > charsPerPage) {
      flush();
      page = para;
    } else {
      page = next;
    }
  }
  flush();
  return pages.length ? pages : [clean];
}

export function createCoViewBookFromText(args: {
  title: string;
  text: string;
  sourceType: CoViewBook['sourceType'];
  sourceName?: string;
  author?: string;
  charsPerPage?: number;
}): CoViewBook {
  const now = Date.now();
  return {
    id: uid('cvb'),
    title: args.title.trim() || args.sourceName || '未命名读本',
    author: args.author?.trim() || undefined,
    sourceName: args.sourceName,
    sourceType: args.sourceType,
    chapters: splitTextIntoChapters(args.text, args.title),
    currentChapterIndex: 0,
    currentPage: 0,
    charsPerPage: args.charsPerPage || COVIEW_DEFAULT_CHARS_PER_PAGE,
    createdAt: now,
    updatedAt: now,
  };
}

const trimExt = (name: string) => name.replace(/\.[^.]+$/, '').trim();

export async function parseTxtOrMarkdownBook(file: File): Promise<CoViewBook> {
  const text = await file.text();
  const ext = file.name.toLowerCase().endsWith('.md') || file.name.toLowerCase().endsWith('.markdown') ? 'md' : 'txt';
  return createCoViewBookFromText({
    title: trimExt(file.name) || '未命名读本',
    sourceName: file.name,
    sourceType: ext,
    text,
  });
}

const joinZipPath = (base: string, href: string): string => {
  if (!base) return href;
  const prefix = base.split('/').slice(0, -1).join('/');
  return prefix ? `${prefix}/${href}`.replace(/\/+/g, '/') : href;
};

export async function parseEpubBook(file: File): Promise<CoViewBook> {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const container = await zip.file('META-INF/container.xml')?.async('string');
  const rootPath = container?.match(/full-path=["']([^"']+)["']/i)?.[1];
  if (!rootPath) throw new Error('EPUB 缺少 OPF 目录');
  const opf = await zip.file(rootPath)?.async('string');
  if (!opf) throw new Error('EPUB 缺少 OPF 文件');

  const title = decodeEntities(opf.match(/<dc:title[^>]*>([\s\S]*?)<\/dc:title>/i)?.[1]?.trim() || trimExt(file.name));
  const author = decodeEntities(opf.match(/<dc:creator[^>]*>([\s\S]*?)<\/dc:creator>/i)?.[1]?.replace(/<[^>]+>/g, '').trim() || '');
  const manifest = new Map<string, string>();
  for (const item of opf.matchAll(/<item\b[^>]*>/gi)) {
    const tag = item[0];
    const id = tag.match(/\bid=["']([^"']+)["']/i)?.[1];
    const href = tag.match(/\bhref=["']([^"']+)["']/i)?.[1];
    const media = tag.match(/\bmedia-type=["']([^"']+)["']/i)?.[1] || '';
    if (id && href && /x?html/i.test(media)) manifest.set(id, joinZipPath(rootPath, href));
  }

  const spineIds = [...opf.matchAll(/<itemref\b[^>]*idref=["']([^"']+)["'][^>]*>/gi)].map(m => m[1]);
  const paths = spineIds.map(id => manifest.get(id)).filter((v): v is string => !!v);
  const fallbackPaths = !paths.length
    ? Object.keys(zip.files).filter(name => /\.(xhtml|html)$/i.test(name)).sort()
    : [];

  const chapters: CoViewBookChapter[] = [];
  for (const path of (paths.length ? paths : fallbackPaths)) {
    const html = await zip.file(path)?.async('string');
    if (!html) continue;
    const parsed = htmlToText(html);
    if (!parsed.text) continue;
    chapters.push({
      id: uid('cvc'),
      title: parsed.title || path.split('/').pop()?.replace(/\.[^.]+$/, '') || `第 ${chapters.length + 1} 章`,
      text: parsed.text,
      index: chapters.length,
    });
  }
  if (!chapters.length) throw new Error('EPUB 没有可阅读章节');

  const now = Date.now();
  return {
    id: uid('cvb'),
    title: title || trimExt(file.name) || '未命名 EPUB',
    author: author || undefined,
    sourceName: file.name,
    sourceType: 'epub',
    chapters,
    currentChapterIndex: 0,
    currentPage: 0,
    charsPerPage: COVIEW_DEFAULT_CHARS_PER_PAGE,
    createdAt: now,
    updatedAt: now,
  };
}

export async function parseCoViewBookFile(file: File): Promise<CoViewBook> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.epub')) return parseEpubBook(file);
  if (name.endsWith('.txt') || name.endsWith('.md') || name.endsWith('.markdown')) return parseTxtOrMarkdownBook(file);
  throw new Error('仅支持 TXT、MD、EPUB 文件');
}

export function parseCoViewDiscussResponse(text: string, mode: 'cinema' | 'reading'): { reply: string; action: CoViewAction } {
  const fallback = { reply: text.trim() || '我在看。', action: { kind: 'none' } as CoViewAction };
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return fallback;
  try {
    const parsed = JSON.parse(match[0]);
    const reply = typeof parsed.reply === 'string' && parsed.reply.trim() ? parsed.reply.trim().slice(0, 1200) : fallback.reply;
    const kind = parsed.action?.kind;
    if (kind === 'none') return { reply, action: { kind: 'none' } };
    if (mode === 'cinema' && (kind === 'pause' || kind === 'resume')) return { reply, action: { kind } };
    if (mode === 'reading' && (kind === 'next_page' || kind === 'prev_page')) return { reply, action: { kind } };
    return { reply, action: { kind: 'none' } };
  } catch {
    return fallback;
  }
}

export async function discussCoView(input: CoViewDiscussInput): Promise<{ reply: string; action: CoViewAction }> {
  const fallback = { reply: input.mode === 'cinema' ? '我先跟着你看，等会儿再说我的感觉。' : '这一页我读到了，先慢慢往下看。', action: { kind: 'none' } as CoViewAction };
  if (!input.api.baseUrl || !input.api.model) return fallback;

  const context = ContextBuilder.buildCoreContext(input.char, input.user, true);
  const history = input.history.slice(-10).map(m => `${m.role === 'user' ? input.user.name || '用户' : input.char.name}: ${m.text}`).join('\n');
  const controls = input.mode === 'cinema'
    ? '可选动作仅限 pause / resume / none。'
    : '可选动作仅限 next_page / prev_page / none。';
  const hasVisionFrame = input.mode === 'cinema' && !!input.visionFrameImageDataUrl;
  const visionRule = hasVisionFrame
    ? `这次请求附带一张影院当前画面截图（${input.visionFrameLabel || '当前帧'}）。你可以基于截图里的角色、动作、字幕、构图、色彩和情绪来评价；看不清时直接说看不清，不要编造截图外的具体剧情。`
    : input.mode === 'cinema'
      ? '这次没有当前画面截图；不要声称你真实看到了视频画面，只能基于标题、简介、进度、字幕/备注和用户的话判断。'
      : '请基于当前页正文和用户的话判断，不要编造正文外的内容。';
  const prompt = `${context}

### 共览
模式：${input.mode === 'cinema' ? '影院' : '阅读'}
正在共览：${input.targetTitle}
进度：${input.progressLabel || '未知'}
当前素材：
${input.contextText.slice(0, 2400)}
${history ? `\n刚才聊到：\n${history}` : ''}
${input.userMessage ? `\n用户刚说：${input.userMessage}` : ''}

请以 ${input.char.name} 第一人称自然回应 1~3 句，像正在和用户一起看/一起读。
${visionRule}
${controls}
只输出 JSON：{"reply":"要说的话","action":{"kind":"none"}}`;

  const call = async (withVision: boolean) => callChatCompletion(input.api, {
    model: input.api.model,
    messages: [{
      role: 'user',
      content: withVision
        ? [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: input.visionFrameImageDataUrl } },
          ]
        : prompt,
    }],
    temperature: 0.85,
    stream: false,
  }, {
    meta: makeApiUsageMeta('coview.discuss', {
      apiRole: (input.api as any).apiRole || 'aux',
      charId: input.char.id,
      charName: input.char.name,
    }),
  });

  try {
    const data = await call(hasVisionFrame);
    return parseCoViewDiscussResponse(extractContent(data) || '', input.mode);
  } catch (err: any) {
    if (hasVisionFrame && isVisionUnsupported(err?.message || String(err))) {
      try {
        const data = await call(false);
        return parseCoViewDiscussResponse(extractContent(data) || '', input.mode);
      } catch {
        return fallback;
      }
    }
    return fallback;
  }
}

export async function searchCoViewMovie(api: APIConfig, query: string): Promise<CoViewSearchResult[]> {
  const q = query.trim();
  if (!q) return [];
  if (!api.baseUrl || !api.model) {
    return [{ title: q, description: '未配置 API；影院仍可直接使用樱花动漫内嵌站点。', sourceLabel: '本地占位' }];
  }
  try {
    const data = await callChatCompletion(api, {
      model: api.model,
      messages: [{
        role: 'user',
        content: `为共览影院搜索电影/视频资料：“${q}”。返回 3-5 个 JSON 数组元素，每个包含 title, year, description, sourceLabel。不要编造播放链接。只输出 JSON。`,
      }],
      temperature: 0.5,
      stream: false,
    }, {
      meta: makeApiUsageMeta('coview.search', { apiRole: (api as any).apiRole || 'aux' }),
    });
    const raw = extractContent(data) || '';
    const match = raw.match(/\[[\s\S]*\]/);
    const parsed = match ? JSON.parse(match[0]) : [];
    return Array.isArray(parsed)
      ? parsed.slice(0, 6).map((item: any) => ({
          title: String(item?.title || q).slice(0, 120),
          year: item?.year ? String(item.year).slice(0, 20) : undefined,
          description: item?.description ? String(item.description).slice(0, 500) : undefined,
          url: item?.url ? String(item.url).slice(0, 500) : undefined,
          sourceLabel: item?.sourceLabel ? String(item.sourceLabel).slice(0, 80) : undefined,
        }))
      : [];
  } catch {
    return [{ title: q, description: '搜索暂时没接上；影院仍可直接使用樱花动漫内嵌站点。', sourceLabel: '搜索失败' }];
  }
}
