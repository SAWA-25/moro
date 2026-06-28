/**
 * 离线主动消息 · 主线程侧快照镜像
 * ================================
 * 把「开了主动消息的角色」的紧凑生成上下文写进 MoroProactiveSW（见
 * utils/swProactiveBridge.ts），供 Service Worker 在关站/后台被 Web Push 唤醒后
 * 自己调副 API 生成主动消息。
 *
 * 本文件只在主线程跑（import 了 DB / 角色状态），不会被打进 SW bundle。
 */

import type { CharacterProfile, AuxApiConfig } from '../types';
import { DB } from './db';
import { resolveLifeApi } from './autonomousLife';
import { ProactiveChat } from './proactiveChat';
import { swPutSnapshot, swKeepOnly, swReadAll, type SwProactiveSnapshot } from './swProactiveBridge';

interface MainApiLike { baseUrl?: string; apiKey?: string; model?: string }

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

function describeNow(d: Date): string {
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${d.getMonth() + 1}月${d.getDate()}日 ${WEEKDAYS[d.getDay()]} ${hh}:${mm}`;
}

function personaBrief(char: CharacterProfile): string {
  const parts: string[] = [];
  const desc = (char.systemPrompt || '').trim();
  if (desc) parts.push(`人设：${desc.slice(0, 1000)}`);
  const wv = (char.worldview || '').trim();
  if (wv) parts.push(`世界观：${wv.slice(0, 300)}`);
  return parts.join('\n');
}

/** 取角色今天日程里「此刻大概在做的事」（关联 ta 的日常），取不到就空。 */
async function currentActivity(charId: string): Promise<string> {
  try {
    const today = new Date().toISOString().split('T')[0];
    const sched: any = await DB.getDailySchedule(charId, today);
    const slots: any[] = sched?.slots || [];
    if (slots.length === 0) return '';
    const now = new Date();
    const cur = now.getHours() * 60 + now.getMinutes();
    const toMin = (t: string) => {
      const [h, m] = String(t || '').split(':').map(n => parseInt(n, 10));
      return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
    };
    let pick: any = null;
    for (const s of slots) {
      if (toMin(s.startTime) <= cur) pick = s; else break;
    }
    pick = pick || slots[0];
    if (!pick) return '';
    return `${pick.activity || ''}${pick.mood ? `（${pick.mood}）` : ''}`.trim();
  } catch {
    return '';
  }
}

async function buildSnapshot(
  char: CharacterProfile,
  auxApiConfig: AuxApiConfig | null | undefined,
  mainApi: MainApiLike,
): Promise<SwProactiveSnapshot | null> {
  const api = resolveLifeApi(
    char,
    auxApiConfig,
    { baseUrl: mainApi.baseUrl || '', apiKey: mainApi.apiKey || '', model: mainApi.model || '' },
  );
  if (!api.baseUrl || !api.model) return null; // 没有可用线路就不镜像

  // 最近对话（只取文本，截断）
  let recentMessages: { role: string; content: string }[] = [];
  try {
    const msgs: any[] = await DB.getRecentMessagesByCharId(char.id, 8);
    recentMessages = (msgs || [])
      .filter(m => m && typeof m.content === 'string' && m.content.trim() && (!m.type || m.type === 'text'))
      .slice(-8)
      .map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content).slice(0, 500) }));
  } catch { /* ignore */ }

  const activity = await currentActivity(char.id);
  const systemPrompt = [
    `你是「${char.name}」。请严格保持人设，不要出戏。`,
    personaBrief(char),
    activity ? `你现在大概在：${activity}` : '',
    `现在是${describeNow(new Date())}。你主动拿起手机给对方发一条消息——不是回复，是你自己想起 TA、或想分享此刻的心情/正在做的事。`,
    `要求：完全用「${char.name}」的口吻；自然、口语、简短（1~3 句，像真的在发微信）；可以聊你此刻在做的事；不要加引号、旁白、动作描写或任何方括号标记，只输出要发出去的消息正文本身。`,
  ].filter(Boolean).join('\n');

  return {
    charId: char.id,
    name: char.name,
    avatar: char.avatar,
    enabled: true,
    api: { baseUrl: api.baseUrl, apiKey: api.apiKey || '', model: api.model },
    systemPrompt,
    instruction: '（轮到你主动发消息了，直接写消息正文）',
    recentMessages,
    updatedAt: Date.now(),
  };
}

/**
 * 把当前所有开了主动消息的角色快照写进 MoroProactiveSW；并清掉已关闭的角色。
 * 失败全吞——这只是离线增强，绝不能影响主流程。
 */
export async function mirrorProactiveSnapshots(
  characters: CharacterProfile[],
  mainApi: MainApiLike,
  auxApiConfig: AuxApiConfig | null | undefined,
): Promise<void> {
  try {
    const activeIds = ProactiveChat.getSchedules().map(s => s.charId);
    if (activeIds.length === 0) { await swKeepOnly([]); return; }
    const byId = new Map(characters.map(c => [c.id, c]));
    const written: string[] = [];
    for (const id of activeIds) {
      const char = byId.get(id);
      if (!char) continue;
      const snap = await buildSnapshot(char, auxApiConfig, mainApi);
      if (snap) { await swPutSnapshot(snap); written.push(id); }
    }
    await swKeepOnly(written);
  } catch (e) {
    console.warn('[mirrorProactive] failed', e);
  }
}

/**
 * 回前台时对账：把 SW 在离线期间已经生成过主动消息的时间，回填到主线程的
 * lastFire，避免回前台后本地定时器看到「逾期」又重复触发一次。
 */
export async function reconcileProactiveFires(): Promise<void> {
  try {
    const all = await swReadAll();
    for (const s of all) {
      if (s.lastGenAt) ProactiveChat.noteExternalFire(s.charId, s.lastGenAt);
    }
  } catch { /* ignore */ }
}
