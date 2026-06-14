/**
 * 「一起听歌」AI 对话 + 音乐控制。
 * 音乐 App 的一起听界面里，角色和用户讨论正在放的歌；角色还能主动换歌 / 暂停 / 继续 / 下一首。
 * 纯一次性调用（不走主聊天管线），返回角色的话 + 一个可执行的音乐动作。
 */

import { APIConfig, CharacterProfile, UserProfile } from '../types';
import { ContextBuilder } from './context';
import { safeResponseJson, extractContent } from './safeApi';

export type ListenAction =
    | { kind: 'none' }
    | { kind: 'change_song'; query: string }
    | { kind: 'pause' }
    | { kind: 'resume' }
    | { kind: 'next' };

export interface ListenMsg { role: 'user' | 'char'; text: string; action?: ListenAction; at: number; }

export interface DiscussInput {
    char: CharacterProfile;
    user: UserProfile;
    api: APIConfig;
    song: { name: string; artists: string } | null;
    playing: boolean;
    lyricSnippet?: string;
    history: ListenMsg[];
    userMsg?: string;
    trigger: 'enter' | 'song_changed' | 'take_over' | 'user';
}

const TRIGGER_TASK: Record<DiscussInput['trigger'], string> = {
    enter: '你和对方刚点开「一起听」，开始一起听歌。自然地打个招呼，聊聊正在放的这首歌；如果此刻没在放歌，可以挑一首你想一起听的（change_song）。',
    song_changed: '刚刚换了一首歌 / 新歌开始放了。说说你对这首的第一感觉、它让你想到什么，像真的在一起听歌那样随口聊。',
    take_over: '对方把选歌权交给你了——由你来安排：可以换成一首你此刻特别想和对方一起听的歌（change_song，给真实歌名+艺人），或者先暂停下来说点想说的话（pause），按你的心情和你们的关系来。',
    user: '回应对方刚说的话，自然地接着聊音乐。如果聊着想换歌 / 暂停 / 继续 / 下一首，就顺手做。',
};

/** 让角色就当前音乐说一句话，并可附带一个音乐控制动作。 */
export async function discussMusic(input: DiscussInput): Promise<{ reply: string; action: ListenAction }> {
    const { char, user, api, song, playing, lyricSnippet, history, userMsg, trigger } = input;
    const fallback = { reply: song ? `这首《${song.name}》还挺合现在的氛围的。` : '想听点什么？我来放。', action: { kind: 'none' } as ListenAction };
    if (!api.baseUrl || !api.apiKey || !api.model) return fallback;
    try {
        const context = ContextBuilder.buildCoreContext(char, user, true);
        const musicTaste = char.musicProfile
            ? `\n你的音乐口味：${(char.musicProfile.genreTags || []).join(' / ')}；常听 ${(char.musicProfile.signatureArtists || []).map(a => a.name).join('、')}。`
            : '';
        const nowPlaying = song
            ? `正在播放：《${song.name}》— ${song.artists}（${playing ? '播放中' : '已暂停'}）。${lyricSnippet ? `\n此刻歌词：${lyricSnippet}` : ''}`
            : '现在没有在放歌。';
        const hist = history.slice(-10).map(m => `${m.role === 'user' ? (user.name || '对方') : char.name}：${m.text}`).join('\n');
        const prompt = `${context}${musicTaste}

### [一起听歌]
${nowPlaying}
${hist ? `\n你们刚才聊到：\n${hist}` : ''}
${userMsg ? `\n${user.name || '对方'} 刚说：${userMsg}` : ''}

### [Task]
${TRIGGER_TASK[trigger]}
以「${char.name}」第一人称，用口语、贴合你的人设和你们的关系，说 1~3 句（像一起听歌时随口聊天，别太长）。
你还可以顺手控制播放（按心情来，别每次都换歌）：
- 想换歌：action = {"kind":"change_song","query":"歌名 艺人"}（必须真实存在、网易云能搜到）
- 想暂停：{"kind":"pause"}；想继续：{"kind":"resume"}；想跳过这首：{"kind":"next"}；只说话：{"kind":"none"}

只输出一个 JSON（不要 markdown、不要解释）：
{"reply":"你要说的话","action":{"kind":"none"}}`;
        const res = await fetch(`${api.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${api.apiKey}` },
            body: JSON.stringify({ model: api.model, messages: [{ role: 'user', content: prompt }], temperature: 0.9 }),
        });
        if (!res.ok) throw new Error(`API ${res.status}`);
        const data = await safeResponseJson(res);
        const content = (extractContent(data) || '').trim();
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            const reply = typeof parsed.reply === 'string' && parsed.reply.trim() ? parsed.reply.trim() : fallback.reply;
            let action: ListenAction = { kind: 'none' };
            const a = parsed.action;
            if (a && typeof a === 'object') {
                if (a.kind === 'change_song' && typeof a.query === 'string' && a.query.trim()) action = { kind: 'change_song', query: a.query.trim().slice(0, 60) };
                else if (a.kind === 'pause' || a.kind === 'resume' || a.kind === 'next') action = { kind: a.kind };
            }
            return { reply, action };
        }
        return { reply: content || fallback.reply, action: { kind: 'none' } };
    } catch {
        return fallback;
    }
}
