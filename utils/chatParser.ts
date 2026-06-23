
import { DB } from './db';
import { LocalNotifications } from '@capacitor/local-notifications';
import { CharacterProfile, CharPlaylistSong } from '../types';
import { sanitizeForBubble } from './sanitize';

export interface MusicActionSnapshot {
    songId: number;
    name: string;
    artists: string;
    album: string;
    albumPic: string;
    duration: number;
    fee: number;
}

/**
 * 把 user 的歌加到 char 的歌单时，char 可以指定目标：
 * - 不传 target → 默认放进第一个歌单（兼容老 [[MUSIC_ACTION:add]]）
 * - target.kind === 'existing' → 按标题模糊匹配现有歌单；匹配不到回落到第一个
 * - target.kind === 'new' → 现场新建一个歌单，把这首作为第一首
 *
 * 不论哪种，存入 char 歌单时都会打上 source: 'user' 标签，让 char 之后"听"
 * 这首歌时知道是从 user 那里收来的（prompt 注入会用到）。
 */
export type AddSongTarget =
    | { kind: 'existing'; title: string }
    | { kind: 'new'; title: string; description?: string };

export interface MusicActionHooks {
    /** 返回 user 此刻正在听的歌快照（chatParser 自己不去碰 MusicContext） */
    getListeningSnapshot: () => MusicActionSnapshot | null;
    /** 将 charId 加入"一起听"名单（chatParser 不维护状态，只通知） */
    joinListeningTogether: (charId: string) => void;
    /**
     * 把 song 加到 char 的歌单。
     * 返回 { playlistTitle, created } —— created=true 表示这次是新建了歌单。
     */
    addSongToCharPlaylist: (
        charId: string,
        song: CharPlaylistSong,
        target?: AddSongTarget,
    ) => Promise<{ playlistTitle: string; created: boolean } | null>;
    /** char 主动分享歌曲：按关键词真实搜索（网易云），返回可播放的歌曲快照；找不到返回 null。 */
    searchSong?: (keyword: string) => Promise<MusicActionSnapshot | null>;
}

/**
 * 文字→表情识别：把文本里「明确指向某个表情名」的片段转成 emoji part。
 * 只认强信号，避免把「开心」「色」这类既是表情名又是常用词的裸词误转：
 *   1. 括号包裹且内文恰好是已知表情名：【name】/「name」/[name]/［name］/〔name〕
 *   2. 表情前缀：（表情：name）/（贴纸: name）/(emoji name) 等
 *   3. 整段 trim 后正好就是一个已知表情名
 * `names` 为已知表情名集合（调用方用当前角色可见表情构造）。
 */
const EMOJI_NAME_TOKEN_RE = /[【［\[「〔]\s*([^【［\[「〔】］\]」〕\n]{1,24}?)\s*[】］\]」〕]|[（(]\s*(?:表情|贴纸|emoji|sticker)\s*[:：]?\s*([^（()）\n]{1,24}?)\s*[）)]/gi;

const expandTextEmojiNames = (
    text: string,
    names: Set<string>,
): { type: 'text' | 'emoji'; content: string }[] => {
    const whole = text.trim();
    if (names.has(whole)) return [{ type: 'emoji', content: whole }];

    const parts: { type: 'text' | 'emoji'; content: string }[] = [];
    let last = 0;
    let m: RegExpExecArray | null;
    EMOJI_NAME_TOKEN_RE.lastIndex = 0;
    while ((m = EMOJI_NAME_TOKEN_RE.exec(text)) !== null) {
        const name = (m[1] ?? m[2] ?? '').trim();
        if (!name || !names.has(name)) continue; // 非已知表情名 → 原样留作文本
        const before = text.slice(last, m.index).trim();
        if (before) parts.push({ type: 'text', content: before });
        parts.push({ type: 'emoji', content: name });
        last = m.index + m[0].length;
    }
    if (parts.length === 0) return [{ type: 'text', content: text }];
    const tail = text.slice(last).trim();
    if (tail) parts.push({ type: 'text', content: tail });
    return parts;
};

export const ChatParser = {
    // Return cleaned content and perform side effects
    parseAndExecuteActions: async (
        aiContent: string,
        charId: string,
        charName: string,
        addToast: (msg: string, type: 'info'|'success'|'error') => void,
        musicHooks?: MusicActionHooks,
    ) => {
        let content = aiContent;

        // POKE
        if (content.includes('[[ACTION:POKE]]')) {
            await DB.saveMessage({ charId, role: 'assistant', type: 'interaction', content: '[戳一戳]' });
            content = content.replace('[[ACTION:POKE]]', '').trim();
        }

        // TRANSFER / REDPACKET —— 角色给用户转账 / 发红包。
        // 落库即标记 status:'pending' + 24h expiresAt：UI 上用户需点开「收款」弹窗才进余额；
        // 超 24h 未领由聊天页判定为 expired，并让角色对此有反应（见 Chat.tsx 过期检测）。
        const CLAIM_WINDOW_MS = 24 * 60 * 60 * 1000;
        const transferMatch = content.match(/\[\[ACTION:TRANSFER:(\d+)\]\]/);
        if (transferMatch) {
            await DB.saveMessage({
                charId, role: 'assistant', type: 'transfer', content: '[转账]',
                metadata: { amount: transferMatch[1], status: 'pending', expiresAt: Date.now() + CLAIM_WINDOW_MS },
            });
            content = content.replace(transferMatch[0], '').trim();
        }
        // 红包：[[ACTION:REDPACKET:100]] 或带祝福语 [[ACTION:REDPACKET:100|新年快乐]]
        const redpacketMatch = content.match(/\[\[ACTION:REDPACKET:(\d+)(?:\|([^\]]*))?\]\]/);
        if (redpacketMatch) {
            const rpNote = (redpacketMatch[2] || '').trim();
            await DB.saveMessage({
                charId, role: 'assistant', type: 'transfer', content: '[红包]',
                metadata: { amount: redpacketMatch[1], kind: 'redpacket', ...(rpNote ? { note: rpNote } : {}), status: 'pending', expiresAt: Date.now() + CLAIM_WINDOW_MS },
            });
            content = content.replace(redpacketMatch[0], '').trim();
        }
        // 口令红包：[[ACTION:REDPACKET_PW:100|口令|祝福语]] —— 用户要先答对口令才能拆开
        const rpPwMatch = content.match(/\[\[ACTION:REDPACKET_PW:(\d+)\|([^|\]]+)(?:\|([^\]]*))?\]\]/);
        if (rpPwMatch) {
            const pw = (rpPwMatch[2] || '').trim();
            const pwNote = (rpPwMatch[3] || '').trim();
            await DB.saveMessage({
                charId, role: 'assistant', type: 'transfer', content: '[口令红包]',
                metadata: { amount: rpPwMatch[1], kind: 'redpacket', rpType: 'password', password: pw, ...(pwNote ? { note: pwNote } : {}), status: 'pending', expiresAt: Date.now() + CLAIM_WINDOW_MS },
            });
            content = content.replace(rpPwMatch[0], '').trim();
        }

        // MUSIC_ACTION — char 对 user 正在听的歌表态（只处理第一次出现，每条消息最多一次插卡）
        // 支持的格式（后两种是为了让 char 自己挑歌单 / 新建歌单）：
        //   [[MUSIC_ACTION:join]]
        //   [[MUSIC_ACTION:add]]                              → 默认放第一个歌单
        //   [[MUSIC_ACTION:add|歌单标题]]                      → 放进现有歌单（标题匹配）
        //   [[MUSIC_ACTION:add_new|新歌单标题|可选描述]]        → 新建歌单
        //   [[MUSIC_ACTION:join_and_add(|...)]]              → 同 add 一套
        //   [[MUSIC_ACTION:join_and_add_new|新歌单标题|描述]]  → 同 add_new
        // 用 | 分隔参数，避免和 : 冲突（标题里很容易出现 :)
        const MUSIC_TAG_RE = /\[\[MUSIC_ACTION:(join|add|add_new|join_and_add|join_and_add_new)(?:\|([^\]]*))?\]\]/;
        const MUSIC_TAG_GLOBAL_RE = /\[\[MUSIC_ACTION:(?:join|add|add_new|join_and_add|join_and_add_new)(?:\|[^\]]*)?\]\]/g;
        const musicMatch = content.match(MUSIC_TAG_RE);
        if (musicMatch && musicHooks) {
            const verb = musicMatch[1] as 'join' | 'add' | 'add_new' | 'join_and_add' | 'join_and_add_new';
            const argsRaw = (musicMatch[2] || '').trim();
            const args = argsRaw ? argsRaw.split('|').map(s => s.trim()).filter(Boolean) : [];
            // 卡片元数据里只用 join / add / join_and_add 三种意图，把 _new 折叠回 add 系
            const intent: 'join' | 'add' | 'join_and_add' =
                verb === 'join' ? 'join'
                : (verb === 'add' || verb === 'add_new') ? 'add'
                : 'join_and_add';
            const wantsJoin = verb === 'join' || verb === 'join_and_add' || verb === 'join_and_add_new';
            const wantsAdd = verb !== 'join';

            let target: AddSongTarget | undefined;
            if (wantsAdd) {
                if (verb === 'add_new' || verb === 'join_and_add_new') {
                    // 至少要有标题；没标题就退化成默认 add
                    if (args[0]) target = { kind: 'new', title: args[0], description: args[1] };
                } else if (args[0]) {
                    target = { kind: 'existing', title: args[0] };
                }
            }

            const snap = musicHooks.getListeningSnapshot();
            if (snap) {
                let addedToPlaylistTitle: string | undefined;
                let playlistCreated = false;
                if (wantsJoin) {
                    musicHooks.joinListeningTogether(charId);
                }
                if (wantsAdd) {
                    try {
                        const playlistSong: CharPlaylistSong = {
                            id: snap.songId,
                            name: snap.name,
                            artists: snap.artists,
                            album: snap.album,
                            albumPic: snap.albumPic,
                            duration: snap.duration,
                            fee: snap.fee,
                            source: 'user',
                            addedAt: Date.now(),
                        };
                        const added = await musicHooks.addSongToCharPlaylist(charId, playlistSong, target);
                        if (added) {
                            addedToPlaylistTitle = added.playlistTitle;
                            playlistCreated = added.created;
                        }
                    } catch { /* 忽略 */ }
                }
                await DB.saveMessage({
                    charId,
                    role: 'assistant',
                    type: 'music_card',
                    content: '[音乐卡片]',
                    metadata: {
                        intent,
                        song: snap,
                        addedToPlaylistTitle,
                        playlistCreated,
                    },
                });
                const playlistSuffix = addedToPlaylistTitle
                    ? (playlistCreated ? `（新建《${addedToPlaylistTitle}》）` : `《${addedToPlaylistTitle}》`)
                    : '';
                addToast(
                    intent === 'join' ? `${charName} 和你一起听` :
                    intent === 'add' ? `${charName} 把这首加到了${playlistSuffix || '自己歌单'}` :
                    `${charName} 和你一起听，也加到了${playlistSuffix || '歌单'}`,
                    'info'
                );
            }
            content = content.replace(musicMatch[0], '').trim();
            // 同类 tag 全清，防止 LLM 一条消息里插多次
            content = content.replace(MUSIC_TAG_GLOBAL_RE, '').trim();
        } else if (musicMatch) {
            // 没有 hooks（无音乐上下文）— 静默丢弃
            content = content.replace(MUSIC_TAG_GLOBAL_RE, '').trim();
        }

        // SHARE_SONG — char 主动分享一首真实歌曲（按关键词真实搜索网易云，做成可播放卡片）
        //   [[SHARE_SONG: 歌名 - 歌手]] / [[SHARE_SONG: 歌名|歌手]] / [[SHARE_SONG: 歌名]]
        const SHARE_SONG_RE = /\[\[SHARE_SONG:\s*([^\]]*?)\s*\]\]/;
        const SHARE_SONG_GLOBAL_RE = /\[\[SHARE_SONG:[^\]]*\]\]/g;
        const shareMatch = content.match(SHARE_SONG_RE);
        if (shareMatch) {
            const query = (shareMatch[1] || '').replace(/[|｜]/g, ' ').replace(/\s*-\s*/g, ' ').trim();
            if (query && musicHooks?.searchSong) {
                try {
                    const song = await musicHooks.searchSong(query);
                    if (song) {
                        await DB.saveMessage({
                            charId,
                            role: 'assistant',
                            type: 'music_card',
                            content: '[音乐卡片]',
                            metadata: { intent: 'share', song },
                        });
                        addToast(`${charName} 分享了《${song.name}》`, 'info');
                    } else {
                        addToast(`${charName} 想分享一首歌，但没找到《${query}》`, 'info');
                    }
                } catch { /* 搜索失败静默 */ }
            }
            content = content.replace(SHARE_SONG_GLOBAL_RE, '').trim();
        }

        // NEWS_CARD — char 主动把某条热点当作新闻卡片分享（来源 + 标题）
        //   [[NEWS_CARD: 来源|标题]]    （来源可省略 → [[NEWS_CARD: 标题]]）
        const NEWS_CARD_RE = /\[\[NEWS_CARD:\s*([^\]]*?)\s*\]\]/;
        const NEWS_CARD_GLOBAL_RE = /\[\[NEWS_CARD:[^\]]*\]\]/g;
        const newsCardMatch = content.match(NEWS_CARD_RE);
        if (newsCardMatch) {
            const raw = (newsCardMatch[1] || '').trim();
            if (raw) {
                const segs = raw.split('|').map(s => s.trim());
                let source = '';
                let title = raw;
                if (segs.length >= 2) {
                    source = segs[0];
                    title = segs.slice(1).join('|').trim();
                }
                // char 不知道链接，尝试从最近一次热点快照里按标题补 url / 来源 / 简介
                let url: string | undefined;
                let desc: string | undefined;
                try {
                    const snap = await DB.getLatestHotNewsSnapshot();
                    const hit = snap?.items?.find(it => it.title === title)
                        || snap?.items?.find(it => !!title && (it.title.includes(title) || title.includes(it.title)));
                    if (hit) {
                        url = hit.url;
                        desc = hit.desc;
                        if (!source && hit.source) source = hit.source;
                    }
                } catch { /* 补不到就算了 */ }
                if (title) {
                    await DB.saveMessage({
                        charId,
                        role: 'assistant',
                        type: 'news_card',
                        content: `[你分享了一个热点：「${title}」${source ? `（来源：${source}）` : ''}${desc ? `——${desc}` : ''}]`,
                        metadata: { source, title, url, desc },
                    });
                    addToast(`${charName} 分享了一条热点`, 'info');
                }
            }
            content = content.replace(NEWS_CARD_GLOBAL_RE, '').trim();
        }

        // ADD_EVENT
        const eventMatch = content.match(/\[\[ACTION:ADD_EVENT\s*\|\s*(.*?)\s*\|\s*(.*?)\]\]/);
        if (eventMatch) {
            const title = eventMatch[1].trim();
            const date = eventMatch[2].trim();
            if (title && date) {
                const anni: any = { id: `anni-${Date.now()}`, title: title, date: date, charId };
                await DB.saveAnniversary(anni);
                addToast(`${charName} 添加了新日程: ${title}`, 'success');
                await DB.saveMessage({ charId, role: 'system', type: 'text', content: `[系统: ${charName} 新增了日程 "${title}" (${date})]` });
            }
            content = content.replace(eventMatch[0], '').trim();
        }

        // SCHEDULE
        const scheduleRegex = /\[schedule_message \| (.*?) \| fixed \| (.*?)\]/g;
        let match;
        while ((match = scheduleRegex.exec(content)) !== null) {
            const timeStr = match[1].trim();
            const msgContent = match[2].trim();
            const dueTime = new Date(timeStr).getTime();
            if (!isNaN(dueTime) && dueTime > Date.now()) {
                await DB.saveScheduledMessage({ id: `sched-${Date.now()}-${Math.random()}`, charId, content: msgContent, dueAt: dueTime, createdAt: Date.now() });
                try {
                    const hasPerm = await LocalNotifications.checkPermissions();
                    if (hasPerm.display === 'granted') {
                        await LocalNotifications.schedule({ notifications: [{ title: charName, body: msgContent, id: Math.floor(Math.random() * 100000), schedule: { at: new Date(dueTime) }, smallIcon: 'ic_stat_icon_config_sample' }] });
                    }
                } catch (e) { console.log("Notification schedule skipped (web mode)"); }
                addToast(`${charName} 似乎打算一会儿找你...`, 'info');
            }
        }
        content = content.replace(scheduleRegex, '').trim();

        // RECALL tag removal (handling done in main loop logic, but cleaning here just in case)
        content = content.replace(/\[\[RECALL:.*?\]\]/g, '').trim();

        return content;
    },

    /**
     * Comprehensive sanitizer for AI output before saving to DB.
     * Removes AI-specific artifacts that should never appear in chat bubbles.
     * Safe to call multiple times (idempotent). Preserves %%BILINGUAL%% markers.
     * Pass { keepCitations: true } to preserve [QUOTE:..]/[引用:..]/[回复 ".."] tags
     * (used when downstream chunking needs to detect per-bubble citation targets).
     */
    sanitize: (text: string, options?: { keepCitations?: boolean }): string => sanitizeForBubble(text, options),

    /**
     * Check if text has meaningful display content after stripping all markers/junk.
     * Used to decide whether a chunk is worth saving as a message.
     */
    hasDisplayContent: (text: string): boolean => {
        const stripped = text
            .replace(/%%BILINGUAL%%/gi, '')
            .replace(/%%TRANS%%[\s\S]*/gi, '')
            .replace(/<\/?翻译>|<\/?原文>|<\/?译文>/g, '')
            .replace(/^\s*---\s*$/gm, '')
            .replace(/``+/g, '')
            .replace(/(^|\s)`(\s|$)/gm, '$1$2')
            .replace(/\[\[[\s\S]*?\]\]/g, '')
            .replace(/\[(?:QU[OA]TE|引用)[：:][^\]]*\]/g, '')
            .replace(/\[回复\s*[""\u201C][^""\u201D]*?[""\u201D](?:\.{0,3})\]\s*[：:]?\s*/g, '')
            .replace(/^#{1,6}\s+/gm, '')
            .replace(/^\s*[-*+]\s*$/gm, '')
            .trim();
        return stripped.length > 0;
    },

    // Split text into bubbles (text and emojis).
    // knownNames（可选）：已知表情名集合。传入后，文本里「明确指向表情名」的片段
    // （括号包裹 / 表情：前缀 / 整段就是表情名）也会被识别成 emoji 气泡弹出。
    splitResponse: (content: string, knownNames?: Set<string> | string[]): { type: 'text' | 'emoji', content: string }[] => {
        const emojiPattern = /\[\[SEND_EMOJI:\s*(.*?)\]\]/g;
        const parts: {type: 'text' | 'emoji', content: string}[] = [];
        let lastIndex = 0;
        let emojiMatch;

        while ((emojiMatch = emojiPattern.exec(content)) !== null) {
            if (emojiMatch.index > lastIndex) {
                const textBefore = content.slice(lastIndex, emojiMatch.index).trim();
                if (textBefore) parts.push({ type: 'text', content: textBefore });
            }
            parts.push({ type: 'emoji', content: emojiMatch[1].trim() });
            lastIndex = emojiMatch.index + emojiMatch[0].length;
        }

        if (lastIndex < content.length) {
            const remaining = content.slice(lastIndex).trim();
            if (remaining) parts.push({ type: 'text', content: remaining });
        }

        if (parts.length === 0 && content.trim()) parts.push({ type: 'text', content: content.trim() });

        // 文字→表情识别（仅在提供了已知表情名时启用，保持旧调用行为不变）
        const names = knownNames instanceof Set ? knownNames : (knownNames ? new Set(knownNames) : null);
        if (!names || names.size === 0) return parts;
        const expanded: { type: 'text' | 'emoji', content: string }[] = [];
        for (const p of parts) {
            if (p.type === 'text') expanded.push(...expandTextEmojiNames(p.content, names));
            else expanded.push(p);
        }
        return expanded;
    },

    // Chunking text for typing effect - splits into separate chat bubbles
    // Primary: split on line breaks (AI decides where to break)
    // Fallback: if no line breaks and text is long, split on spaces between CJK characters
    //   (Chinese text normally has no spaces, so "汉字 汉字" means the AI intended a line break)
    chunkText: (text: string): string[] => {
        // CJK character + punctuation ranges (Chinese text normally has no spaces between these)
        const CJK = '\\u4e00-\\u9fff\\u3400-\\u4dbf\\u3000-\\u303f\\uff00-\\uffef\\u2000-\\u206f\\u2e80-\\u2eff\\u3001-\\u3003\\u2018-\\u201f\\u300a-\\u300f\\uff01-\\uff0f\\uff1a-\\uff20';
        // 在两个 CJK 之间的空格处断行. 不用后行断言 (?<=…): iOS Safari <16.4 的 JSC 不支持,
        // 旧设备上 new RegExp 会直接抛 "invalid group specifier name". 改成「捕获左侧 CJK + 零宽
        // 前瞻右侧」, 用 $1 补回左字符, 行为与原 (?<=[CJK])\s+(?=[CJK]) 字节一致 (见 lookbehindFree.test.ts).
        const cjkSplitRe = new RegExp(`([${CJK}])\\s+(?=[${CJK}])`, 'g');
        const SPLIT = String.fromCharCode(1);  // CJK 切点标记

        // 1. Split on line breaks (AI decides where to break)
        const lineChunks = text.split(/(?:\r\n|\r|\n|\u2028|\u2029)+/)
            .map(c => c.trim())
            .filter(c => c.length > 0);

        // 2. For each chunk, also split on spaces between CJK chars/punctuation
        //    (中文里不该有空格, so "汉字 汉字" means the AI intended a bubble break)
        //    括号内的空格要保护: 否则裸括号表情包 / 标签 (如 "[你 交给我吧]" 或
        //    "[[SEND_EMOJI: a b]]") 会被这条规则劈成 "[你" + "交给我吧]" 掉格式.
        //    做法: 先把 [...] / [[...]] 内空格换成占位符, split 后再换回.
        const SENTINEL = String.fromCharCode(0);
        const result: string[] = [];
        for (const chunk of lineChunks) {
            const guarded = chunk.replace(/\[{1,2}[^\[\]]*\]{1,2}/g, m => m.replace(/\s/g, SENTINEL));
            const sub = guarded.replace(cjkSplitRe, `$1${SPLIT}`).split(SPLIT)
                .map(c => c.split(SENTINEL).join(' ').trim())
                .filter(c => c.length > 0);
            result.push(...sub);
        }

        return result;
    }
}
