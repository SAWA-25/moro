import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import type { DesktopPetAutoBehavior, DesktopPetReminder, DesktopPetState, DesktopPetTalkMessage } from '../types';
import { useOS } from './OSContext';
import { DB } from '../utils/db';
import {
  DESKTOP_PET_DEFAULT_ROLE,
  DESKTOP_PET_FALL_SPEED_MAX,
  DESKTOP_PET_FALL_SPEED_MIN,
  DESKTOP_PET_MANIFEST_URL,
  applyDesktopPetCareTick,
  appendDesktopPetDialogue,
  buildDesktopPetReminderSpeech,
  buildDesktopPetFallbackSpeech,
  clearDesktopPetDialogue,
  createDefaultDesktopPetState,
  createDesktopPetTalkMessage,
  ensureDesktopPetState,
  feedDesktopPet,
  getDesktopPetItemMultiplier,
  getDesktopPetRoleState,
  markDesktopPetTalked,
  markDueDesktopPetRemindersFired,
  normalizeDesktopPetAutoBehavior,
  patDesktopPet,
  selectDesktopPetRandomAction,
  setDesktopPetAutoBehavior,
  setDesktopPetRolePrompt,
  type DesktopPetItemManifest,
  type DesktopPetManifest,
} from '../utils/desktopPet';
import { getNotifyPermission, requestNotifyPermission, showLocalNotification } from '../utils/browserNotify';
import { resolveAuxApi } from '../utils/auxApi';
import { llmComplete } from '../utils/llmComplete';
import { sanitizeAssistantVisibleText } from '../utils/promptPrivacy';

interface DesktopPetContextValue {
  manifest: DesktopPetManifest | null;
  state: DesktopPetState;
  activeRoleId: string;
  currentActionId: string;
  isReady: boolean;
  loadError: string | null;
  foods: DesktopPetItemManifest[];
  setActiveRole: (roleId: string) => Promise<void>;
  playAction: (actionId: string) => void;
  playRandomAction: () => void;
  patActivePet: () => Promise<void>;
  feedActivePet: (itemId: string) => Promise<{ message: string; actionId: string; speech?: DesktopPetTalkMessage }>;
  talkToActivePet: (text: string) => Promise<DesktopPetTalkMessage>;
  clearPetDialogue: () => Promise<void>;
  speakAsPet: (input: { text: string; source?: DesktopPetTalkMessage['source']; itemId?: string }) => Promise<void>;
  setRolePrompt: (roleId: string, prompt: string) => Promise<void>;
  setAiEnabled: (enabled: boolean) => Promise<void>;
  setAutoBehavior: (autoBehavior: DesktopPetAutoBehavior) => Promise<void>;
  updateOverlay: (overlay: Partial<DesktopPetState['overlay']>) => Promise<void>;
  setFallSpeed: (speed: number) => Promise<void>;
  setFloatingEnabled: (enabled: boolean) => Promise<void>;
  setNotificationsEnabled: (enabled: boolean) => Promise<boolean>;
  triggerTestReminder: () => Promise<{ notified: boolean }>;
  addReminder: (input: { title: string; note?: string; dueAt: number; repeat: DesktopPetReminder['repeat'] }) => Promise<void>;
  updateReminder: (id: string, patch: Partial<DesktopPetReminder>) => Promise<void>;
  deleteReminder: (id: string) => Promise<void>;
}

const DesktopPetContext = createContext<DesktopPetContextValue | null>(null);

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const cleanPetSpeech = (text: string) => sanitizeAssistantVisibleText(text)
  .replace(/^["“”'「」]+|["“”'「」]+$/g, '')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, 180);

const buildPetSystemPrompt = (roleName: string, customPrompt?: string) => [
  `你是 Moro 的独立桌宠「${roleName}」。`,
  '你只代表桌宠本身，不要冒充来往聊天角色，也不要提到系统提示、API、记忆或聊天记录。',
  '回应要像桌宠气泡，中文，1-2 句，短、具体、有一点角色感。',
  '可以回应食物味道、被摸摸、陪伴和提醒，但不要承诺后台常驻能力。',
  customPrompt?.trim()
    ? `在不违反以上边界的前提下，采用当前桌宠的自定义设定：\n${customPrompt.trim()}`
    : '',
].join('\n');

export const DesktopPetProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { apiConfig, auxApiConfig, userProfile } = useOS();
  const [manifest, setManifest] = useState<DesktopPetManifest | null>(null);
  const [state, setState] = useState<DesktopPetState>(() => createDefaultDesktopPetState());
  const [currentActionId, setCurrentActionId] = useState(DESKTOP_PET_DEFAULT_ROLE);
  const [isReady, setIsReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const stateRef = useRef(state);
  const manifestRef = useRef<DesktopPetManifest | null>(null);
  const persistTimerRef = useRef<number | null>(null);

  useEffect(() => { stateRef.current = state; }, [state]);
  useEffect(() => { manifestRef.current = manifest; }, [manifest]);

  const persist = useCallback((next: DesktopPetState) => {
    stateRef.current = next;
    setState(next);
    if (persistTimerRef.current) window.clearTimeout(persistTimerRef.current);
    persistTimerRef.current = window.setTimeout(() => {
      void DB.saveDesktopPetState(stateRef.current).catch(err => console.warn('[DesktopPet] save failed', err));
    }, 120);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [manifestRes, stored] = await Promise.all([
          fetch(DESKTOP_PET_MANIFEST_URL, { cache: 'no-cache' }),
          DB.getDesktopPetState(),
        ]);
        if (!manifestRes.ok) throw new Error('桌宠资源清单不存在，请先运行资源导入脚本。');
        const nextManifest = await manifestRes.json() as DesktopPetManifest;
        if (cancelled) return;
        const nextState = applyDesktopPetCareTick(ensureDesktopPetState(stored));
        const activeRoleId = nextManifest.roles[nextState.activeRoleId] ? nextState.activeRoleId : Object.keys(nextManifest.roles)[0] || DESKTOP_PET_DEFAULT_ROLE;
        const normalized = { ...nextState, activeRoleId };
        setManifest(nextManifest);
        stateRef.current = normalized;
        setState(normalized);
        setCurrentActionId(nextManifest.roles[activeRoleId]?.defaultAction || 'default');
        setLoadError(null);
        setIsReady(true);
        await DB.saveDesktopPetState(normalized);
      } catch (err: any) {
        if (cancelled) return;
        setLoadError(err?.message || '桌宠加载失败');
        setIsReady(true);
      }
    };
    void load();
    return () => {
      cancelled = true;
      if (persistTimerRef.current) window.clearTimeout(persistTimerRef.current);
    };
  }, []);

  const activeRoleId = state.activeRoleId;

  const foods = useMemo(() => {
    if (!manifest) return [];
    return Object.values(manifest.items)
      .filter(item => item.type === 'consumable' && (!item.petLimit || item.petLimit.includes(activeRoleId)))
      .sort((a, b) => (a.fvLock - b.fvLock) || a.name.localeCompare(b.name, 'zh-Hans-CN'));
  }, [activeRoleId, manifest]);

  const setActiveRole = useCallback(async (roleId: string) => {
    const role = manifestRef.current?.roles[roleId];
    if (!role) return;
    const next = { ...stateRef.current, activeRoleId: roleId, updatedAt: Date.now() };
    persist(next);
    setCurrentActionId(role.defaultAction);
  }, [persist]);

  const playAction = useCallback((actionId: string) => {
    const role = manifestRef.current?.roles[stateRef.current.activeRoleId];
    if (!role) return;
    setCurrentActionId(role.actions[actionId] ? actionId : role.defaultAction);
  }, []);

  const playRandomAction = useCallback(() => {
    const role = manifestRef.current?.roles[stateRef.current.activeRoleId];
    setCurrentActionId(selectDesktopPetRandomAction(role));
  }, []);

  const addPetMessage = useCallback((message: DesktopPetTalkMessage) => {
    persist(appendDesktopPetDialogue(stateRef.current, message));
    return message;
  }, [persist]);

  const generatePetSpeech = useCallback(async (input: {
    source: DesktopPetTalkMessage['source'];
    userText?: string;
    itemId?: string;
    itemName?: string;
    itemDescription?: string;
    hpDelta?: number;
    fvDelta?: number;
    multiplier?: number;
  }): Promise<string> => {
    const curManifest = manifestRef.current;
    const roleId = stateRef.current.activeRoleId;
    const role = curManifest?.roles[roleId];
    const roleName = role?.name || roleId || '桌宠';
    const customPrompt = stateRef.current.rolePrompts?.[roleId];
    const fallback = buildDesktopPetFallbackSpeech(roleName, input.source, {
      userText: input.userText,
      itemName: input.itemName,
      multiplier: input.multiplier,
      hpDelta: input.hpDelta,
      fvDelta: input.fvDelta,
    });
    if (stateRef.current.aiEnabled === false) return fallback;
    const api = resolveAuxApi(auxApiConfig, apiConfig);
    if (!api.baseUrl?.trim() || !api.model?.trim()) return fallback;
    const roleState = getDesktopPetRoleState(stateRef.current, roleId);
    const recent = (stateRef.current.dialogueLog || []).slice(-8)
      .map(message => `${message.role === 'user' ? '用户' : '桌宠'}：${message.text}`)
      .join('\n') || '暂无';
    const eventText = input.source === 'feed'
      ? [
        `用户喂了食物：${input.itemName || input.itemId || '未知食物'}`,
        input.itemDescription ? `食物描述：${input.itemDescription}` : '',
        `喜恶倍率：${input.multiplier ?? 1}`,
        `饱腹变化：${input.hpDelta ?? 0}`,
        `好感变化：${input.fvDelta ?? 0}`,
      ].filter(Boolean).join('\n')
      : input.source === 'pat'
        ? '用户摸了摸桌宠。'
        : `用户说：${input.userText || ''}`;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 12000);
    try {
      const raw = await llmComplete(api, [
        { role: 'system', content: buildPetSystemPrompt(roleName, customPrompt) },
        {
          role: 'user',
          content: [
            `用户称呼：${userProfile?.name || '用户'}`,
            `当前桌宠：${roleName}`,
            `饱腹度：${roleState.hp}/200，好感：${roleState.fv}/999`,
            `最近桌宠对话：\n${recent}`,
            `当前事件：\n${eventText}`,
            '请直接给桌宠要说的话，不要加引号、旁白或标签。',
          ].join('\n\n'),
        },
      ], { temperature: 0.82, maxTokens: 180, signal: controller.signal });
      return cleanPetSpeech(raw) || fallback;
    } catch (err) {
      console.warn('[DesktopPet] AI speech failed', err);
      return fallback;
    } finally {
      window.clearTimeout(timeout);
    }
  }, [apiConfig, auxApiConfig, userProfile?.name]);

  const speakAsPet = useCallback(async (input: { text: string; source?: DesktopPetTalkMessage['source']; itemId?: string }) => {
    const text = cleanPetSpeech(input.text);
    if (!text) return;
    addPetMessage(createDesktopPetTalkMessage({
      role: 'pet',
      text,
      source: input.source || 'chat',
      itemId: input.itemId,
    }));
  }, [addPetMessage]);

  const talkToActivePet = useCallback(async (text: string): Promise<DesktopPetTalkMessage> => {
    const cleanText = text.trim();
    if (!cleanText) {
      return stateRef.current.lastSpeech || createDesktopPetTalkMessage({ role: 'pet', text: '我在。', source: 'chat' });
    }
    const now = Date.now();
    const roleId = stateRef.current.activeRoleId;
    const userMessage = createDesktopPetTalkMessage({ role: 'user', text: cleanText, source: 'chat' }, now);
    persist(markDesktopPetTalked(appendDesktopPetDialogue(stateRef.current, userMessage, now), roleId, now));
    const replyText = await generatePetSpeech({ source: 'chat', userText: cleanText });
    const petMessage = createDesktopPetTalkMessage({ role: 'pet', text: replyText, source: 'chat' });
    addPetMessage(petMessage);
    return petMessage;
  }, [addPetMessage, generatePetSpeech, persist]);

  const clearPetDialogue = useCallback(async () => {
    persist(clearDesktopPetDialogue(stateRef.current));
  }, [persist]);

  const patActivePet = useCallback(async () => {
    const roleId = stateRef.current.activeRoleId;
    const role = manifestRef.current?.roles[roleId];
    persist(patDesktopPet(stateRef.current, roleId));
    setCurrentActionId(role?.actions[role.patAction] ? role.patAction : role?.defaultAction || 'default');
    addPetMessage(createDesktopPetTalkMessage({
      role: 'pet',
      text: buildDesktopPetFallbackSpeech(role?.name || roleId, 'pat'),
      source: 'pat',
    }));
  }, [addPetMessage, persist]);

  const feedActivePet = useCallback(async (itemId: string) => {
    const curManifest = manifestRef.current;
    if (!curManifest) return { message: '桌宠资源还没加载完成。', actionId: 'default' };
    const feedStartedAt = Date.now();
    const roleId = stateRef.current.activeRoleId;
    const role = curManifest.roles[roleId];
    const item = curManifest.items[itemId];
    const multiplier = getDesktopPetItemMultiplier(role, item?.name || '');
    const result = feedDesktopPet(stateRef.current, curManifest, roleId, itemId);
    persist(result.state);
    setCurrentActionId(result.actionId);
    void generatePetSpeech({
      source: 'feed',
      itemId,
      itemName: item?.name,
      itemDescription: item?.description,
      hpDelta: result.hpDelta,
      fvDelta: result.fvDelta,
      multiplier,
    }).then(text => {
      if (stateRef.current.activeRoleId !== roleId) return;
      addPetMessage(createDesktopPetTalkMessage({ role: 'pet', text, source: 'feed', itemId }, feedStartedAt));
    });
    return { message: result.message, actionId: result.actionId };
  }, [addPetMessage, generatePetSpeech, persist]);

  const updateOverlay = useCallback(async (overlay: Partial<DesktopPetState['overlay']>) => {
    const nextOverlay = {
      ...stateRef.current.overlay,
      ...overlay,
      scale: clamp(overlay.scale ?? stateRef.current.overlay.scale, 0.45, 1.35),
    };
    persist({ ...stateRef.current, overlay: nextOverlay, updatedAt: Date.now() });
  }, [persist]);

  const setRolePrompt = useCallback(async (roleId: string, prompt: string) => {
    persist(setDesktopPetRolePrompt(stateRef.current, roleId, prompt));
  }, [persist]);

  const setAiEnabled = useCallback(async (enabled: boolean) => {
    persist({ ...stateRef.current, aiEnabled: enabled, updatedAt: Date.now() });
  }, [persist]);

  const setAutoBehavior = useCallback(async (autoBehavior: DesktopPetAutoBehavior) => {
    persist(setDesktopPetAutoBehavior(stateRef.current, normalizeDesktopPetAutoBehavior(autoBehavior)));
  }, [persist]);

  const setFallSpeed = useCallback(async (speed: number) => {
    persist({
      ...stateRef.current,
      fallSpeed: clamp(speed, DESKTOP_PET_FALL_SPEED_MIN, DESKTOP_PET_FALL_SPEED_MAX),
      updatedAt: Date.now(),
    });
  }, [persist]);

  const setFloatingEnabled = useCallback(async (enabled: boolean) => {
    persist({ ...stateRef.current, floatingEnabled: enabled, updatedAt: Date.now() });
  }, [persist]);

  const setNotificationsEnabled = useCallback(async (enabled: boolean): Promise<boolean> => {
    if (!enabled) {
      persist({ ...stateRef.current, notificationsEnabled: false, updatedAt: Date.now() });
      return true;
    }
    const perm = getNotifyPermission() === 'granted' ? 'granted' : await requestNotifyPermission();
    const ok = perm === 'granted' || Capacitor.isNativePlatform();
    if (Capacitor.isNativePlatform()) {
      try {
        const status = await LocalNotifications.requestPermissions();
        if (status.display !== 'granted') return false;
      } catch {
        return false;
      }
    }
    if (ok) persist({ ...stateRef.current, notificationsEnabled: true, updatedAt: Date.now() });
    return ok;
  }, [persist]);

  const triggerTestReminder = useCallback(async (): Promise<{ notified: boolean }> => {
    const cur = stateRef.current;
    const roleName = manifestRef.current?.roles[cur.activeRoleId]?.name || cur.activeRoleId || '桌宠';
    const reminder = { title: '测试提醒', note: '如果你看见这条，桌宠提醒可以正常显示。' };
    const body = buildDesktopPetReminderSpeech(roleName, reminder);
    addPetMessage(createDesktopPetTalkMessage({ role: 'pet', text: body, source: 'reminder' }));
    if (!cur.notificationsEnabled) return { notified: false };
    const title = `桌宠提醒：${reminder.title}`;
    if (Capacitor.isNativePlatform()) {
      try {
        await LocalNotifications.schedule({
          notifications: [{
            id: Math.floor(Date.now() % 2147483647),
            title,
            body: reminder.note,
            schedule: { at: new Date(Date.now() + 250) },
          }],
        });
      } catch {
        /* fall through to browser notification */
      }
    }
    await showLocalNotification(title, { body: reminder.note, tag: 'desktop-pet-test' });
    return { notified: true };
  }, [addPetMessage]);

  const addReminder = useCallback(async (input: { title: string; note?: string; dueAt: number; repeat: DesktopPetReminder['repeat'] }) => {
    const reminder: DesktopPetReminder = {
      id: `dpet_rem_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      title: input.title.trim() || '桌宠提醒',
      note: input.note?.trim() || undefined,
      dueAt: input.dueAt,
      repeat: input.repeat,
      enabled: true,
      createdAt: Date.now(),
    };
    persist({ ...stateRef.current, reminders: [reminder, ...stateRef.current.reminders], updatedAt: Date.now() });
  }, [persist]);

  const updateReminder = useCallback(async (id: string, patch: Partial<DesktopPetReminder>) => {
    persist({
      ...stateRef.current,
      reminders: stateRef.current.reminders.map(reminder => reminder.id === id ? { ...reminder, ...patch } : reminder),
      updatedAt: Date.now(),
    });
  }, [persist]);

  const deleteReminder = useCallback(async (id: string) => {
    persist({
      ...stateRef.current,
      reminders: stateRef.current.reminders.filter(reminder => reminder.id !== id),
      updatedAt: Date.now(),
    });
  }, [persist]);

  useEffect(() => {
    const notifyDue = async () => {
      const cur = stateRef.current;
      const { state: next, due } = markDueDesktopPetRemindersFired(cur);
      if (due.length === 0) return;
      persist(next);
      const roleName = manifestRef.current?.roles[next.activeRoleId]?.name || next.activeRoleId || '桌宠';
      for (const reminder of due) {
        const title = `桌宠提醒：${reminder.title}`;
        const body = reminder.note || `${roleName} 在敲屏幕。`;
        addPetMessage(createDesktopPetTalkMessage({
          role: 'pet',
          text: buildDesktopPetReminderSpeech(roleName, reminder),
          source: 'reminder',
        }));
        if (!cur.notificationsEnabled) continue;
        if (Capacitor.isNativePlatform()) {
          try {
            await LocalNotifications.schedule({
              notifications: [{
                id: Math.floor(Date.now() % 2147483647),
                title,
                body,
                schedule: { at: new Date(Date.now() + 250) },
              }],
            });
          } catch {
            /* fall through to browser notification */
          }
        }
        await showLocalNotification(title, { body, tag: `desktop-pet-${reminder.id}` });
      }
    };
    const timer = window.setInterval(() => { void notifyDue(); }, 15000);
    void notifyDue();
    return () => window.clearInterval(timer);
  }, [addPetMessage, persist]);

  useEffect(() => {
    const tickCare = () => {
      const cur = stateRef.current;
      const next = applyDesktopPetCareTick(cur);
      if (next.updatedAt !== cur.updatedAt || next.lastCareTickAt !== cur.lastCareTickAt) {
        persist(next);
      }
    };
    const timer = window.setInterval(tickCare, 5 * 60 * 1000);
    tickCare();
    return () => window.clearInterval(timer);
  }, [persist]);

  const value = useMemo<DesktopPetContextValue>(() => ({
    manifest,
    state,
    activeRoleId,
    currentActionId,
    isReady,
    loadError,
    foods,
    setActiveRole,
    playAction,
    playRandomAction,
    patActivePet,
    feedActivePet,
    talkToActivePet,
    clearPetDialogue,
    speakAsPet,
    setRolePrompt,
    setAiEnabled,
    setAutoBehavior,
    updateOverlay,
    setFallSpeed,
    setFloatingEnabled,
    setNotificationsEnabled,
    triggerTestReminder,
    addReminder,
    updateReminder,
    deleteReminder,
  }), [activeRoleId, addReminder, clearPetDialogue, currentActionId, deleteReminder, feedActivePet, foods, isReady, loadError, manifest, patActivePet, playAction, playRandomAction, setActiveRole, setAiEnabled, setAutoBehavior, setFallSpeed, setFloatingEnabled, setNotificationsEnabled, setRolePrompt, speakAsPet, state, talkToActivePet, triggerTestReminder, updateOverlay, updateReminder]);

  return <DesktopPetContext.Provider value={value}>{children}</DesktopPetContext.Provider>;
};

export const useDesktopPet = (): DesktopPetContextValue => {
  const ctx = useContext(DesktopPetContext);
  if (!ctx) throw new Error('useDesktopPet must be used inside DesktopPetProvider');
  return ctx;
};
