import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CharacterProfile, DailySchedule, RoomGeneratedState, RoomNote, RoomTodo, UserProfile } from '../../types';
import type { MemoryRoom } from '../../utils/memoryPalace/types';
import { ContextBuilder } from '../../utils/context';
import { injectMemoryPalace } from '../../utils/memoryPalace/pipeline';
import { extractContent } from '../../utils/safeApi';
import { callChatCompletion } from '../../utils/llmClient';
import { makeApiUsageMeta } from '../../utils/apiUsageCatalog';
import { DB } from '../../utils/db';
import type { PixelAsset, PixelHomeState, PlacedFurniture } from './types';
import { ROOM_META, ROOM_SLOTS } from './roomTemplates';

interface LifeApiConfig {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  apiRole?: string;
  apiBinding?: string;
}

interface UsePixelHomeLifeArgs {
  char?: CharacterProfile;
  userProfile?: UserProfile;
  auxApi: LifeApiConfig;
  homeState: PixelHomeState | null;
  assets: PixelAsset[];
  updateCharacter: (id: string, updates: Partial<CharacterProfile>) => void;
  addToast?: (message: string, type?: 'success' | 'error' | 'info') => void;
}

export interface FurnitureInspectTarget {
  roomId: MemoryRoom;
  furniture: PlacedFurniture;
}

export interface PixelInspection {
  title: string;
  description: string;
  reaction: string;
}

const todayKey = () => {
  const now = new Date();
  if (now.getHours() < 6) now.setDate(now.getDate() - 1);
  return now.toISOString().split('T')[0];
};

const cleanJson = (raw: string) => {
  let content = raw.replace(/```json/g, '').replace(/```/g, '').trim();
  const first = content.indexOf('{');
  const last = content.lastIndexOf('}');
  if (first >= 0 && last >= first) content = content.slice(first, last + 1);
  return content;
};

const timeGapHint = (lastMsgTimestamp?: number) => {
  if (!lastMsgTimestamp) return '这是第一次进入今天的像素家园。';
  const diffMins = Math.floor((Date.now() - lastMsgTimestamp) / 60000);
  if (diffMins < 5) return '你们刚刚还在聊天。';
  if (diffMins < 60) return `距离上次互动约 ${diffMins} 分钟。`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `距离上次互动约 ${diffHours} 小时。`;
  return `距离上次互动约 ${Math.floor(diffHours / 24)} 天。`;
};

export const furnitureKey = (roomId: MemoryRoom, slotId: string) => `${roomId}:${slotId}`;

const furnitureName = (roomId: MemoryRoom, furniture: PlacedFurniture, assets: PixelAsset[]) => {
  const asset = furniture.assetId ? assets.find(a => a.id === furniture.assetId) : undefined;
  const slot = ROOM_SLOTS[roomId]?.find(s => s.id === furniture.slotId);
  return asset?.name || slot?.name || furniture.slotId;
};

const buildFurnitureList = (homeState: PixelHomeState | null, assets: PixelAsset[]) => {
  if (!homeState) return [];
  return homeState.rooms.flatMap(room =>
    room.furniture.map(f => ({
      id: furnitureKey(room.roomId, f.slotId),
      room: ROOM_META[room.roomId]?.name || room.roomId,
      name: furnitureName(room.roomId, f, assets),
      context: (f.interactionPrompt || '').slice(0, 220),
      placedBy: f.placedBy,
    })),
  ).slice(0, 80);
};

export function usePixelHomeLife({
  char,
  userProfile,
  auxApi,
  homeState,
  assets,
  updateCharacter,
  addToast,
}: UsePixelHomeLifeArgs) {
  const [todo, setTodo] = useState<RoomTodo | null>(null);
  const [notes, setNotes] = useState<RoomNote[]>([]);
  const [schedule, setSchedule] = useState<DailySchedule | null>(null);
  const [roomState, setRoomState] = useState<RoomGeneratedState | null>(null);
  const [inspection, setInspection] = useState<PixelInspection | null>(null);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const generatingRef = useRef(false);

  const today = useMemo(todayKey, [char?.id]);

  const loadLife = useCallback(async () => {
    if (!char) return;
    setLoading(true);
    try {
      const [existingTodo, existingNotes, existingSchedule] = await Promise.all([
        DB.getRoomTodo(char.id, today),
        DB.getRoomNotes(char.id),
        DB.getDailySchedule(char.id, today),
      ]);
      setTodo(existingTodo);
      setNotes(existingNotes.sort((a, b) => b.timestamp - a.timestamp));
      setSchedule(existingSchedule);
      setRoomState(char.lastRoomDate === today ? char.savedRoomState || null : null);
    } finally {
      setLoading(false);
    }
  }, [char, today]);

  const generateLife = useCallback(async (force = false) => {
    if (!char) return;
    if (generatingRef.current) return;

    generatingRef.current = true;
    setGenerating(true);
    try {
      await loadLife();
      if (!force && char.lastRoomDate === today && char.savedRoomState) {
        setRoomState(char.savedRoomState);
        return;
      }
      if (!auxApi.baseUrl || !auxApi.model) {
        addToast?.('文具盒里还没有可用 API，先展示本地生活记录', 'info');
        return;
      }

      const now = new Date();
      const recentMsgs = await DB.getMessagesByCharId(char.id);
      const lastMsg = recentMsgs[recentMsgs.length - 1];
      await injectMemoryPalace(char, recentMsgs);

      const baseContext = ContextBuilder.buildCoreContext(char, userProfile, true);
      const chatContext = recentMsgs.slice(-50).map(m => {
        const role = m.role === 'user' ? (userProfile?.name || '用户') : char.name;
        return `${role}: ${String(m.content || '').slice(0, 80)}`;
      }).join('\n');
      const interactables = buildFurnitureList(homeState, assets);
      const existingTodo = await DB.getRoomTodo(char.id, today);
      const shouldGenerateTodo = !existingTodo;

      const prompt = `${baseContext}

### 像素家园今日生活刷新
现在时间：${now.toLocaleDateString()} ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
互动间隔：${timeGapHint(lastMsg?.timestamp)}
最近聊天：
${chatContext || '暂无最近聊天。'}

角色正在自己的像素家园里生活。请生成今天进入栖居志时看到的生活状态、欢迎语、可点击家具的观察文本和反应，并在需要时生成今日待办和一条私房随笔。

可点击家具：
${JSON.stringify(interactables)}

要求：
- 反应要像角色自然说话，不要像系统说明。
- 家具反应要围绕房间、物品和角色当前生活状态。
- 今日待办是角色自己的生活计划，3 到 5 条。
- 私房随笔可以是心情、短诗、购物清单、歌词草稿或一段很短的日记。

严格返回 JSON：
{
  "actorStatus": "...",
  "welcomeMessage": "...",
  "items": {
    "roomId:slotId": { "description": "...", "reaction": "..." }
  },
  ${shouldGenerateTodo ? '"todoList": ["..."],' : ''}
  "notebookEntry": { "content": "...", "type": "thought" }
}`;

      const data = await callChatCompletion({
        baseUrl: auxApi.baseUrl,
        apiKey: auxApi.apiKey || '',
        model: auxApi.model,
      }, {
        model: auxApi.model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.55,
        max_tokens: 5000,
      }, {
        meta: makeApiUsageMeta('room.generate', {
          charId: char.id,
          charName: char.name,
          apiRole: auxApi.apiRole || 'aux',
          apiBinding: auxApi.apiBinding || 'Room',
        }),
      });

      const content = extractContent(data);
      if (!content) throw new Error('empty response');
      const parsed = JSON.parse(cleanJson(content));
      const nextRoomState: RoomGeneratedState = {
        actorStatus: parsed.actorStatus || '正在像素家园里慢慢醒来',
        welcomeMessage: parsed.welcomeMessage || '你来啦。',
        items: parsed.items || {},
        actorAction: 'idle',
      };
      updateCharacter(char.id, { lastRoomDate: today, savedRoomState: nextRoomState });
      setRoomState(nextRoomState);

      if (shouldGenerateTodo && Array.isArray(parsed.todoList)) {
        const newTodo: RoomTodo = {
          id: `${char.id}_${today}`,
          charId: char.id,
          date: today,
          items: parsed.todoList.slice(0, 6).map((text: string) => ({ text, done: false })),
          generatedAt: Date.now(),
        };
        await DB.saveRoomTodo(newTodo);
        setTodo(newTodo);
      }

      if (parsed.notebookEntry?.content) {
        const msgId = await DB.saveMessage({
          charId: char.id,
          role: 'system',
          type: 'text',
          content: `[系统: ${char.name}在栖居志像素家园写下了一条私房随笔：\n"${parsed.notebookEntry.content}"]`,
        });
        const note: RoomNote = {
          id: `note-${Date.now()}`,
          charId: char.id,
          timestamp: Date.now(),
          content: parsed.notebookEntry.content,
          type: parsed.notebookEntry.type || 'thought',
          relatedMessageId: msgId,
        };
        await DB.saveRoomNote(note);
        setNotes(prev => [note, ...prev]);
      }

      addToast?.('像素家园的今天刷新好了', 'success');
    } catch (err) {
      console.warn('[pixelHomeLife] generate failed', err);
      const fallback: RoomGeneratedState = {
        actorStatus: '在像素家园里整理今天',
        welcomeMessage: '你来啦，我刚刚还在发呆。',
        items: {},
        actorAction: 'idle',
      };
      updateCharacter(char.id, { lastRoomDate: today, savedRoomState: fallback });
      setRoomState(fallback);
      addToast?.('刷新失败，先保留一个本地状态', 'info');
    } finally {
      generatingRef.current = false;
      setGenerating(false);
    }
  }, [addToast, assets, auxApi, char, homeState, loadLife, today, updateCharacter, userProfile]);

  useEffect(() => {
    loadLife();
  }, [loadLife]);

  const addTodo = useCallback(async (text: string) => {
    if (!char || !text.trim()) return;
    const base: RoomTodo = todo || { id: `${char.id}_${today}`, charId: char.id, date: today, items: [], generatedAt: Date.now() };
    const next: RoomTodo = { ...base, items: [...base.items, { text: text.trim(), done: false, byUser: true }] };
    setTodo(next);
    await DB.saveRoomTodo(next);
    await DB.saveMessage({
      charId: char.id,
      role: 'system',
      type: 'text',
      content: `[系统: ${userProfile?.name || '用户'}给${char.name}的今日清单添了一条：「${text.trim()}」]`,
    });
  }, [char, today, todo, userProfile?.name]);

  const toggleTodo = useCallback(async (index: number) => {
    if (!char || !todo) return;
    const items = todo.items.map((item, i) => i === index ? { ...item, done: !item.done } : item);
    const next = { ...todo, items };
    setTodo(next);
    await DB.saveRoomTodo(next);
    if (items[index]?.done) {
      await DB.saveMessage({
        charId: char.id,
        role: 'system',
        type: 'text',
        content: `[系统: ${userProfile?.name || '用户'}帮${char.name}划掉了今日清单里的「${items[index].text}」]`,
      });
    }
  }, [char, todo, userProfile?.name]);

  const deleteTodo = useCallback(async (index: number) => {
    if (!todo) return;
    const next = { ...todo, items: todo.items.filter((_, i) => i !== index) };
    setTodo(next);
    await DB.saveRoomTodo(next);
  }, [todo]);

  const deleteNote = useCallback(async (id: string) => {
    const note = notes.find(n => n.id === id);
    if (note?.relatedMessageId) await DB.deleteMessage(note.relatedMessageId);
    await DB.deleteRoomNote(id);
    setNotes(prev => prev.filter(n => n.id !== id));
  }, [notes]);

  const addNote = useCallback(async (content: string) => {
    const value = content.trim();
    if (!char || !value) return;
    const msgId = await DB.saveMessage({
      charId: char.id,
      role: 'system',
      type: 'text',
      content: `[系统: ${userProfile?.name || '用户'}在${char.name}的栖居志像素家园里补了一条私房随笔：\n"${value}"]`,
    });
    const note: RoomNote = {
      id: `note-${Date.now()}`,
      charId: char.id,
      timestamp: Date.now(),
      content: value,
      type: 'thought',
      relatedMessageId: msgId,
    };
    await DB.saveRoomNote(note);
    setNotes(prev => [note, ...prev]);
  }, [char, userProfile?.name]);

  const inspectFurniture = useCallback(async ({ roomId, furniture }: FurnitureInspectTarget) => {
    if (!char) return;
    const key = furnitureKey(roomId, furniture.slotId);
    const name = furnitureName(roomId, furniture, assets);
    const cached = roomState?.items?.[key] || roomState?.items?.[furniture.slotId];
    const fallbackDescription = furniture.interactionPrompt || `${ROOM_META[roomId]?.name || '房间'}里的${name}安静地待在原处。`;
    const nextInspection: PixelInspection = {
      title: name,
      description: cached?.description || fallbackDescription,
      reaction: cached?.reaction || '嗯？你注意到这个了。它最近一直在这里陪着我。',
    };
    setInspection(nextInspection);
    const content = `[系统: ${userProfile?.name || '用户'}在${char.name}的像素家园里查看了「${name}」：${nextInspection.description}。${char.name}的反应：${nextInspection.reaction}]`;
    const recentMsgs = await DB.getMessagesByCharId(char.id);
    const duplicate = recentMsgs.slice(-50).some(m => m.role === 'system' && m.content === content);
    if (!duplicate) {
      await DB.saveMessage({ charId: char.id, role: 'system', type: 'text', content });
    }
  }, [assets, char, roomState, userProfile?.name]);

  return {
    today,
    todo,
    notes,
    schedule,
    roomState,
    inspection,
    loading,
    generating,
    loadLife,
    generateLife,
    addTodo,
    toggleTodo,
    deleteTodo,
    addNote,
    deleteNote,
    inspectFurniture,
    clearInspection: () => setInspection(null),
  };
}
