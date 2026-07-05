/**
 * 离线主动消息 · 主线程侧快照镜像
 * ================================
 * 把「开了主动消息的角色」的紧凑生成上下文写进 MoroProactiveSW（见
 * utils/swProactiveBridge.ts），供 Service Worker 在关站/后台被 Web Push 唤醒后
 * 自己调副 API 生成主动消息。
 *
 * 本文件只在主线程跑（import 了 DB / 角色状态），不会被打进 SW bundle。
 */

import type { CharacterProfile, AuxApiConfig, Message } from '../types';
import { DB } from './db';
import { formatMaterialSources, getMaterialSources, getMessageFlavor, getProactiveIntensity, resolveLifeApi, sanitizeLifeText } from './autonomousLife';
import { ProactiveChat } from './proactiveChat';
import { findPendingProactiveReplyMessages, makeQueuedReplyTarget } from './proactivePendingReply';
import { swPutSnapshot, swKeepOnly, swReadAll, type SwProactiveSnapshot } from './swProactiveBridge';
import { swOfflineProactiveSystemPrompt } from './laiwangPrompts';
import { isAmbientSocialCharacterForUser, shouldHideAmbientSocialRecordForUser } from './ambientSocial';
import { isOfflineSessionActive } from './offlineMode';
import { buildFullActiveUserSetting, buildFullCharacterSetting } from './characterPromptProfile';
import { buildChatProactivePresetResult, normalizePresetGenParamsForOpenAi } from './proactivePresetPayload';
import { substituteMacros } from './macros';

interface MainApiLike { baseUrl?: string; apiKey?: string; model?: string }

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

function describeNow(d: Date): string {
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${d.getMonth() + 1}月${d.getDate()}日 ${WEEKDAYS[d.getDay()]} ${hh}:${mm}`;
}

function personaBrief(char: CharacterProfile): string {
  return buildFullCharacterSetting(char, { includeMemos: true, fallback: '' });
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

async function recentLifeEvents(char: CharacterProfile): Promise<NonNullable<SwProactiveSnapshot['lifeEvents']>> {
  try {
    const events = await DB.getLifeEvents(char.id, 8);
    return events
      .map(e => {
        const activity = sanitizeLifeText(e.activity) || sanitizeLifeText(e.summary || '');
        if (!activity) return null;
        return {
          timestamp: e.timestamp,
          activity,
          mood: e.mood ? sanitizeLifeText(e.mood) : undefined,
          location: e.location ? sanitizeLifeText(e.location) : undefined,
          summary: e.summary ? sanitizeLifeText(e.summary) : undefined,
          surfacedAsMsg: !!e.surfacedAsMsg,
          eventKind: e.eventKind,
          energy: e.energy,
          intensity: e.intensity,
          shareWillingness: e.shareWillingness,
          thread: e.thread ? sanitizeLifeText(e.thread) : undefined,
          proactiveAngle: e.proactiveAngle,
        };
      })
      .filter((e): e is NonNullable<typeof e> => !!e);
  } catch {
    return [];
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

  const userProfile = await DB.getUserProfile().catch(() => null);
  if (shouldHideAmbientSocialRecordForUser(userProfile || undefined) && isAmbientSocialCharacterForUser(char, userProfile || undefined)) return null;
  const userName = userProfile?.name || '我';

  // 最近对话（只取文本，截断）
  let recentMessages: { role: string; content: string }[] = [];
  let recentMsgs: Message[] = [];
  try {
    recentMsgs = await DB.getRecentMessagesByCharId(char.id, 60);
    recentMessages = (recentMsgs || [])
      .filter(m => m && typeof m.content === 'string' && m.content.trim() && (!m.type || m.type === 'text'))
      .slice(-8)
      .map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content).slice(0, 500) }));
  } catch { /* ignore */ }
  const pendingUserMessages = findPendingProactiveReplyMessages(recentMsgs);
  const queuedReplyTarget = makeQueuedReplyTarget(pendingUserMessages[0], userName);

  const activity = await currentActivity(char.id);
  const lifeEvents = await recentLifeEvents(char);
  const materialSources = getMaterialSources(char);
  const fullUserSetting = substituteMacros(
    await buildFullActiveUserSetting(userProfile, { fallback: `用户名：${userName}` }),
    {
      charName: char.name || '角色',
      userName,
      personaDescription: userProfile?.bio || '',
    },
  );
  const systemPrompt = [
    swOfflineProactiveSystemPrompt({
      charName: char.name,
      personaText: personaBrief(char),
      fullUserSetting,
      activity,
      nowText: describeNow(new Date()),
      userName,
      pendingReply: pendingUserMessages.length > 0,
      forceReplyAllowed: !!char.convoSettings?.forceReplyEnabled,
    }),
    lifeEvents.length ? `你最近的生活不是空白的，下面快照会给你若干切片。主动消息要从这些切片里长出来，不要像总结。` : '',
    `主动消息 v2：主动强度 ${getProactiveIntensity(char)}，来信口味 ${getMessageFlavor(char)}，允许取材 ${formatMaterialSources(char)}。`,
  ].filter(Boolean).join('\n');
  const presetResult = await buildChatProactivePresetResult([
    { role: 'system', content: systemPrompt },
    ...recentMessages,
  ], {
    charName: char.name || '角色',
    userName,
  });
  const generation = normalizePresetGenParamsForOpenAi(presetResult.genParams);

  return {
    charId: char.id,
    name: char.name,
    avatar: char.avatar,
    enabled: true,
    api: { baseUrl: api.baseUrl, apiKey: api.apiKey || '', model: api.model },
    systemPrompt,
    presetMessages: presetResult.messages || undefined,
    generation,
    instruction: '（轮到你主动发消息了，直接写消息正文）',
    recentMessages,
    pendingUserMessages,
    queuedReplyTarget,
    lifeEvents,
    proactiveV2: {
      intensity: char.proactiveConfig?.intensity || 'balanced',
      messageFlavor: char.proactiveConfig?.messageFlavor || 'natural',
      materialSources,
      quietHours: char.proactiveConfig?.quietHours,
    },
    activeOfflineSession: isOfflineSessionActive(char.id),
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
