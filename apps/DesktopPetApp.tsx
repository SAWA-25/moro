import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alarm,
  ArrowLeft,
  ArrowsOut,
  Bell,
  BowlFood,
  HandPalm,
  PawPrint,
  PaperPlaneTilt,
  Plus,
  Sparkle,
  Broom,
  Trash,
} from '@phosphor-icons/react';
import { useOS } from '../context/OSContext';
import { useDesktopPet } from '../context/DesktopPetContext';
import { AppID, type DesktopPetAutoBehavior } from '../types';
import { scrollToManualAnchor, useManualDeepLink } from '../utils/manualDeepLink';
import DesktopPetSprite from '../components/desktopPet/DesktopPetSprite';
import DesktopPetFoodEffect from '../components/desktopPet/DesktopPetFoodEffect';
import {
  DESKTOP_PET_FALL_SPEED_MAX,
  DESKTOP_PET_FALL_SPEED_MIN,
  DESKTOP_PET_FV_MAX,
  DESKTOP_PET_HP_MAX,
  DESKTOP_PET_PROMPT_LIMIT,
  clampDesktopPetOverlay,
  getDesktopPetActionHoldLoops,
  getDesktopPetMood,
  getDesktopPetMoodMeta,
  getDesktopPetRoleState,
  listDesktopPetManualActions,
} from '../utils/desktopPet';

const pad = (n: number) => String(n).padStart(2, '0');
const FOOD_GRID_LIMIT = 24;
const AUTO_BEHAVIOR_OPTIONS: Array<{ id: DesktopPetAutoBehavior; label: string; description: string }> = [
  { id: 'gentle', label: '温和活跃', description: '偶尔走动和换动作，尽量不打扰操作。' },
  { id: 'quiet', label: '安静驻留', description: '少自动行动，主要等你摸摸或喂食。' },
  { id: 'lively', label: '明显活泼', description: '更常走动和换动作，陪伴感更强。' },
];
const MOOD_BADGE_CLASS: Record<string, string> = {
  hungry: 'bg-emerald-50 text-emerald-700 border-emerald-100',
  lonely: 'bg-sky-50 text-sky-700 border-sky-100',
  happy: 'bg-pink-50 text-pink-700 border-pink-100',
  sleepy: 'bg-violet-50 text-violet-700 border-violet-100',
  calm: 'bg-slate-50 text-slate-700 border-slate-100',
};

const toInputDateTime = (ts: number) => {
  const date = new Date(ts);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const fromInputDateTime = (value: string) => {
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : Date.now() + 60 * 60 * 1000;
};

const DesktopPetApp: React.FC = () => {
  const { closeApp, addToast } = useOS();
  const {
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
    setRolePrompt,
    setAiEnabled,
    setAutoBehavior,
    setFloatingEnabled,
    updateOverlay,
    setFallSpeed,
    setNotificationsEnabled,
    triggerTestReminder,
    addReminder,
    updateReminder,
    deleteReminder,
  } = useDesktopPet();
  const [selectedFood, setSelectedFood] = useState('');
  const [reminderTitle, setReminderTitle] = useState('');
  const [reminderNote, setReminderNote] = useState('');
  const [reminderTime, setReminderTime] = useState(() => toInputDateTime(Date.now() + 60 * 60 * 1000));
  const [reminderRepeat, setReminderRepeat] = useState<'none' | 'daily'>('none');
  const [talkInput, setTalkInput] = useState('');
  const [talkBusy, setTalkBusy] = useState(false);
  const [promptDraft, setPromptDraft] = useState('');
  const [feedingEffect, setFeedingEffect] = useState<{ id: number; image: string; name: string } | null>(null);
  const [lastFeedRequestedAt, setLastFeedRequestedAt] = useState<number | null>(null);
  const previewActionLoopRef = useRef(0);

  const roleIds = useMemo(() => Object.keys(manifest?.roles || {}), [manifest]);
  const role = manifest?.roles[activeRoleId];
  const roleState = getDesktopPetRoleState(state, activeRoleId);
  const mood = getDesktopPetMood(state, activeRoleId);
  const moodMeta = getDesktopPetMoodMeta(mood);
  const hpPercent = Math.round((roleState.hp / DESKTOP_PET_HP_MAX) * 100);
  const fvPercent = Math.round((roleState.fv / DESKTOP_PET_FV_MAX) * 100);
  const dialogue = state.dialogueLog || [];
  const lastFeedSpeech = lastFeedRequestedAt
    ? [...dialogue].reverse().find(message => message.source === 'feed' && message.role === 'pet' && message.createdAt >= lastFeedRequestedAt)
    : undefined;
  const activeRolePrompt = state.rolePrompts?.[activeRoleId] || '';
  const selectedFoodItem = foods.find(food => food.id === selectedFood) || foods[0];
  const manualActions = useMemo(() => listDesktopPetManualActions(role), [role]);
  const selectedAutoBehavior = AUTO_BEHAVIOR_OPTIONS.find(option => option.id === state.autoBehavior) || AUTO_BEHAVIOR_OPTIONS[0];
  const handlePreviewLoop = useCallback(() => {
    if (!role || currentActionId === role.defaultAction) return;
    previewActionLoopRef.current += 1;
    if (previewActionLoopRef.current < getDesktopPetActionHoldLoops(currentActionId)) return;
    previewActionLoopRef.current = 0;
    playAction(role.defaultAction);
  }, [currentActionId, playAction, role]);

  useEffect(() => {
    previewActionLoopRef.current = 0;
  }, [activeRoleId, currentActionId]);

  useEffect(() => {
    setPromptDraft(activeRolePrompt);
  }, [activeRoleId, activeRolePrompt]);

  useManualDeepLink(AppID.DesktopPet, useCallback((target) => {
    window.setTimeout(() => {
      if (!scrollToManualAnchor(target.anchorId)) scrollToManualAnchor('manual-pet-root');
    }, 120);
  }, []));

  useEffect(() => {
    if (!foods.length) {
      if (selectedFood) setSelectedFood('');
      return;
    }
    if (!foods.some(food => food.id === selectedFood)) {
      setSelectedFood(foods[0].id);
    }
  }, [foods, selectedFood]);

  const handleFeed = async (foodId = selectedFood) => {
    if (!foodId) return;
    const food = foods.find(item => item.id === foodId);
    setLastFeedRequestedAt(Date.now());
    if (food?.image) {
      const effect = { id: Date.now(), image: food.image, name: food.name };
      setFeedingEffect(effect);
      window.setTimeout(() => {
        setFeedingEffect(current => current?.id === effect.id ? null : current);
      }, 950);
    }
    const result = await feedActivePet(foodId);
    addToast(result.message, 'success');
  };

  const sendTalk = async (text = talkInput) => {
    const value = text.trim();
    if (!value || talkBusy) return;
    setTalkInput('');
    setTalkBusy(true);
    try {
      await talkToActivePet(value);
    } catch (err: any) {
      addToast(err?.message || '桌宠暂时没回应', 'error');
    } finally {
      setTalkBusy(false);
    }
  };

  const handleReminderAdd = async () => {
    if (!reminderTitle.trim()) {
      addToast('先写提醒标题', 'error');
      return;
    }
    await addReminder({
      title: reminderTitle,
      note: reminderNote,
      dueAt: fromInputDateTime(reminderTime),
      repeat: reminderRepeat,
    });
    setReminderTitle('');
    setReminderNote('');
    setReminderTime(toInputDateTime(Date.now() + 60 * 60 * 1000));
    setReminderRepeat('none');
    addToast('提醒已添加', 'success');
  };

  const handlePromptSave = async () => {
    await setRolePrompt(activeRoleId, promptDraft);
    addToast(promptDraft.trim() ? '桌宠设定已保存' : '桌宠设定已清空', 'success');
  };

  const handlePromptClear = async () => {
    setPromptDraft('');
    await setRolePrompt(activeRoleId, '');
    addToast('桌宠设定已清空', 'success');
  };

  if (!isReady) {
    return (
      <div data-manual-anchor="manual-pet-root" className="w-full h-full bg-[#f8fafc] grid place-items-center text-slate-500 text-sm font-bold">
        正在唤醒桌宠...
      </div>
    );
  }

  if (loadError || !manifest || !role) {
    return (
      <div data-manual-anchor="manual-pet-root" className="w-full h-full bg-[#f8fafc] flex flex-col">
        <div className="h-14 px-4 flex items-center gap-3 border-b border-slate-200 bg-white">
          <button onClick={closeApp} className="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center active:scale-95">
            <ArrowLeft size={20} weight="bold" />
          </button>
          <div className="font-black">桌宠</div>
        </div>
        <div className="flex-1 grid place-items-center px-8 text-center">
          <div>
            <PawPrint size={42} weight="fill" className="mx-auto text-slate-300 mb-3" />
            <div className="font-black text-slate-800 mb-2">还没有找到桌宠资源</div>
            <div className="text-xs leading-relaxed text-slate-500">
              {loadError || '请先运行 pnpm 脚本导入 DyberPet 资源。'}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div data-manual-anchor="manual-pet-root" className="w-full h-full bg-[#eef2f7] text-slate-900 flex flex-col overflow-hidden">
      <div className="shrink-0 h-14 px-4 flex items-center justify-between border-b border-slate-200 bg-white/92 backdrop-blur">
        <div className="flex items-center gap-3 min-w-0">
          <button onClick={closeApp} className="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center active:scale-95">
            <ArrowLeft size={20} weight="bold" />
          </button>
          <div>
            <div className="text-[11px] font-black tracking-[0.18em] text-slate-400 uppercase">Desktop Pet</div>
            <div className="font-black text-[17px] leading-none">桌宠</div>
          </div>
        </div>
        <button
          onClick={async () => {
            await setFloatingEnabled(!state.floatingEnabled);
            addToast(state.floatingEnabled ? '已收起悬浮桌宠' : '已放到桌面悬浮', 'success');
          }}
          className={`h-9 px-3 rounded-full flex items-center gap-1.5 text-xs font-black active:scale-95 transition ${state.floatingEnabled ? 'bg-slate-900 text-white' : 'bg-white border border-slate-200 text-slate-700'}`}
        >
          <ArrowsOut size={15} weight="bold" />
          {state.floatingEnabled ? '悬浮中' : '放到桌面'}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        <section data-manual-anchor="manual-pet-profile" className="relative min-h-[380px] px-4 pt-5 pb-4 bg-gradient-to-b from-[#dfe8f8] via-[#eef4fb] to-[#eef2f7] overflow-hidden">
          <div className="max-w-md mx-auto">
            <div className="flex items-center justify-between gap-2 mb-4">
              <div className="flex gap-2 overflow-x-auto no-scrollbar">
                {roleIds.map(id => (
                  <button
                    key={id}
                    onClick={() => { void setActiveRole(id); }}
                    className={`px-3 py-2 rounded-full text-xs font-black border active:scale-95 transition whitespace-nowrap ${id === activeRoleId ? 'bg-slate-950 text-white border-slate-950' : 'bg-white/80 text-slate-600 border-white'}`}
                  >
                    {manifest.roles[id].name}
                  </button>
                ))}
              </div>
              <button onClick={playRandomAction} className="w-10 h-10 rounded-full bg-white shadow-sm flex items-center justify-center active:scale-95" title="随机动作">
                <Sparkle size={18} weight="fill" />
              </button>
            </div>

            <div className={`mb-3 rounded-lg border px-3 py-2 flex items-center justify-between gap-3 ${MOOD_BADGE_CLASS[mood] || MOOD_BADGE_CLASS.calm}`}>
              <div className="min-w-0">
                <div className="text-[10px] font-black opacity-70">当前心情</div>
                <div className="text-sm font-black truncate">{moodMeta.label}</div>
              </div>
              <div className="text-right text-[10px] leading-snug font-bold opacity-80 max-w-[190px]">
                {moodMeta.description}
              </div>
            </div>

            <div className="relative flex justify-center pt-1 pb-2">
              {feedingEffect && (
                <DesktopPetFoodEffect
                  key={feedingEffect.id}
                  src={feedingEffect.image}
                  name={feedingEffect.name}
                  className="absolute left-1/2 top-1/2 z-20"
                  style={{ marginLeft: -18, marginTop: -22 }}
                />
              )}
              <DesktopPetSprite
                role={role}
                actionId={currentActionId}
                scale={0.9}
                onLoop={handlePreviewLoop}
              />
            </div>

            <div className="grid grid-cols-2 gap-3 mt-2">
              <div className="rounded-lg bg-white/90 border border-white p-3 shadow-sm">
                <div className="text-[11px] font-black text-slate-400 mb-2">饱腹</div>
                <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                  <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${hpPercent}%` }} />
                </div>
                <div className="text-[12px] font-black mt-2">{roleState.hp}/{DESKTOP_PET_HP_MAX}</div>
              </div>
              <div className="rounded-lg bg-white/90 border border-white p-3 shadow-sm">
                <div className="text-[11px] font-black text-slate-400 mb-2">好感</div>
                <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                  <div className="h-full bg-pink-500 rounded-full" style={{ width: `${fvPercent}%` }} />
                </div>
                <div className="text-[12px] font-black mt-2">{roleState.fv}/{DESKTOP_PET_FV_MAX}</div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 mt-3">
              <button
                onClick={() => { void patActivePet(); }}
                className="h-12 rounded-lg bg-white border border-slate-200 shadow-sm flex items-center justify-center gap-2 text-sm font-black active:scale-[0.98]"
              >
                <HandPalm size={18} weight="bold" />
                摸摸
              </button>
              <button
                onClick={async () => {
                  const ok = await setNotificationsEnabled(!state.notificationsEnabled);
                  addToast(ok ? (state.notificationsEnabled ? '提醒通知已关闭' : '提醒通知已开启') : '通知权限未开启', ok ? 'success' : 'error');
                }}
                className={`h-12 rounded-lg border shadow-sm flex items-center justify-center gap-2 text-sm font-black active:scale-[0.98] ${state.notificationsEnabled ? 'bg-slate-950 text-white border-slate-950' : 'bg-white border-slate-200'}`}
              >
                <Bell size={18} weight="bold" />
                {state.notificationsEnabled ? '通知开' : '通知关'}
              </button>
            </div>
          </div>
        </section>

        <section className="px-4 pb-5 -mt-1">
          <div className="max-w-md mx-auto space-y-4">
            <div className="rounded-lg bg-white border border-slate-200 shadow-sm p-4">
              <div className="flex items-center justify-between gap-2 mb-3">
                <div className="flex items-center gap-2">
                  <PawPrint size={20} weight="fill" />
                  <div className="font-black">对话</div>
                </div>
                <button
                  onClick={() => { void clearPetDialogue(); }}
                  className="w-8 h-8 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center active:scale-95"
                  title="清空桌宠对话"
                >
                  <Broom size={15} weight="bold" />
                </button>
              </div>

              <div className="min-h-[132px] max-h-56 overflow-y-auto no-scrollbar rounded-lg bg-slate-50 border border-slate-100 p-3 space-y-2">
                {dialogue.length === 0 && (
                  <div className="h-24 grid place-items-center text-xs text-slate-400 font-bold">
                    跟 {role.name} 说句话，或喂点吃的。
                  </div>
                )}
                {dialogue.slice(-16).map(message => (
                  <div key={message.id} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[78%] rounded-lg px-3 py-2 text-[12px] leading-relaxed ${message.role === 'user' ? 'bg-slate-950 text-white' : 'bg-white border border-slate-200 text-slate-700 shadow-sm'}`}>
                      {message.text}
                    </div>
                  </div>
                ))}
                {talkBusy && (
                  <div className="flex justify-start">
                    <div className="rounded-lg px-3 py-2 text-[12px] bg-white border border-slate-200 text-slate-400 shadow-sm">
                      {role.name} 正在想...
                    </div>
                  </div>
                )}
              </div>

              <div className="flex gap-2 overflow-x-auto no-scrollbar mt-3 pb-1">
                {['今天想做什么？', '想吃什么？', '陪我待一会儿', '提醒我休息一下'].map(chip => (
                  <button
                    key={chip}
                    onClick={() => { void sendTalk(chip); }}
                    disabled={talkBusy}
                    className="px-3 h-8 rounded-full bg-slate-100 text-slate-600 text-[11px] font-black whitespace-nowrap active:scale-95 disabled:opacity-50"
                  >
                    {chip}
                  </button>
                ))}
              </div>

              <div className="mt-2 grid grid-cols-[1fr_40px] gap-2">
                <textarea
                  value={talkInput}
                  onChange={(event) => setTalkInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault();
                      void sendTalk();
                    }
                  }}
                  placeholder="和桌宠说点什么..."
                  rows={1}
                  disabled={talkBusy}
                  className="min-w-0 h-10 max-h-20 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none resize-none no-scrollbar disabled:opacity-60"
                />
                <button
                  onClick={() => { void sendTalk(); }}
                  disabled={!talkInput.trim() || talkBusy}
                  className="h-10 rounded-lg bg-slate-950 text-white flex items-center justify-center active:scale-95 disabled:opacity-40"
                  title="发送"
                >
                  <PaperPlaneTilt size={17} weight="fill" />
                </button>
              </div>
            </div>

            <div className="rounded-lg bg-white border border-slate-200 shadow-sm p-4">
              <div className="flex items-center justify-between gap-3 mb-3">
                <div className="flex items-center gap-2 min-w-0">
                  <Sparkle size={20} weight="fill" />
                  <div className="font-black truncate">{role.name} 的设定</div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={async () => {
                      const next = state.aiEnabled === false;
                      await setAiEnabled(next);
                      addToast(next ? 'AI 回应已开启' : 'AI 回应已关闭', 'success');
                    }}
                    className={`h-7 px-2 rounded-full text-[10px] font-black border active:scale-95 ${state.aiEnabled === false ? 'bg-slate-100 text-slate-500 border-slate-200' : 'bg-slate-950 text-white border-slate-950'}`}
                  >
                    {state.aiEnabled === false ? 'AI 关' : 'AI 开'}
                  </button>
                  <div className="text-[11px] font-black text-slate-400">
                    {promptDraft.length}/{DESKTOP_PET_PROMPT_LIMIT}
                  </div>
                </div>
              </div>
              <textarea
                value={promptDraft}
                onChange={(event) => setPromptDraft(event.target.value.slice(0, DESKTOP_PET_PROMPT_LIMIT))}
                maxLength={DESKTOP_PET_PROMPT_LIMIT}
                rows={5}
                placeholder={`写给 ${role.name} 的对话风格、称呼、喜好或禁忌。`}
                className="w-full min-h-[112px] rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm leading-relaxed outline-none resize-none no-scrollbar"
              />
              <div className="mt-3 grid grid-cols-[1fr_auto] gap-2">
                <button
                  onClick={() => { void handlePromptSave(); }}
                  disabled={promptDraft === activeRolePrompt}
                  className="h-10 rounded-lg bg-slate-950 text-white text-sm font-black active:scale-[0.98] disabled:opacity-40"
                >
                  保存设定
                </button>
                <button
                  onClick={() => { void handlePromptClear(); }}
                  disabled={!activeRolePrompt && !promptDraft}
                  className="h-10 px-4 rounded-lg bg-slate-100 text-slate-600 text-sm font-black active:scale-[0.98] disabled:opacity-40"
                >
                  清空
                </button>
              </div>
            </div>

            <div className="rounded-lg bg-white border border-slate-200 shadow-sm p-4">
              <div className="flex items-center gap-2 mb-3">
                <Sparkle size={20} weight="fill" />
                <div className="font-black">动作</div>
              </div>
              {manualActions.length > 0 ? (
                <div className="grid grid-cols-3 gap-2">
                  {manualActions.map(action => (
                    <button
                      key={action.id}
                      onClick={() => { playAction(action.id); }}
                      className={`h-10 rounded-lg border text-[12px] font-black active:scale-[0.98] ${currentActionId === action.id ? 'bg-slate-950 text-white border-slate-950' : 'bg-slate-50 border-slate-100 text-slate-700'}`}
                    >
                      {action.label}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="py-6 text-center text-xs text-slate-400 font-bold">当前桌宠没有可手动播放的动作</div>
              )}
            </div>

            <div className="rounded-lg bg-white border border-slate-200 shadow-sm p-4">
              <div className="flex items-center gap-2 mb-3">
                <BowlFood size={20} weight="bold" />
                <div className="font-black">喂食</div>
              </div>
              {lastFeedSpeech && (
                <div className="mb-3 rounded-lg bg-emerald-50 border border-emerald-100 px-3 py-2 text-[12px] leading-relaxed text-emerald-900">
                  {lastFeedSpeech.text}
                </div>
              )}
              {selectedFoodItem && (
                <div className="mb-3 rounded-lg bg-slate-50 border border-slate-100 p-3 grid grid-cols-[64px_1fr] gap-3 items-center">
                  <div className="w-16 h-16 rounded-lg bg-white border border-slate-100 grid place-items-center overflow-hidden">
                    {selectedFoodItem.image ? (
                      <img src={selectedFoodItem.image} alt={selectedFoodItem.name} loading="lazy" decoding="async" className="w-14 h-14 object-contain" />
                    ) : (
                      <BowlFood size={28} className="text-slate-300" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-black truncate">{selectedFoodItem.name}</div>
                    <div className="mt-1 text-[11px] leading-relaxed text-slate-500 line-clamp-2">
                      {selectedFoodItem.description || '没有食物描述。'}
                    </div>
                    <div className="mt-1 text-[10px] font-black text-slate-400">
                      饱腹 +{selectedFoodItem.effectHP} · 好感 +{selectedFoodItem.effectFV + (selectedFoodItem.fvReward || 0)}
                    </div>
                  </div>
                </div>
              )}
              <div className="grid grid-cols-[1fr_auto] gap-2 mb-3">
                <select
                  value={selectedFood}
                  onChange={(event) => setSelectedFood(event.target.value)}
                  className="min-w-0 h-10 rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm font-bold outline-none"
                >
                  <option value="">选择食物</option>
                  {foods.map(food => (
                    <option key={food.id} value={food.id}>{food.name}</option>
                  ))}
                </select>
                <button onClick={() => { void handleFeed(); }} className="h-10 px-4 rounded-lg bg-slate-950 text-white text-sm font-black active:scale-95">
                  喂
                </button>
              </div>
              <div className="grid grid-cols-4 gap-2 max-h-48 overflow-y-auto pr-1">
                {foods.slice(0, FOOD_GRID_LIMIT).map(food => (
                  <button
                    key={food.id}
                    onClick={() => { setSelectedFood(food.id); }}
                    className={`rounded-lg border p-2 active:scale-95 transition ${selectedFood === food.id ? 'bg-slate-950 text-white border-slate-950' : 'bg-slate-50 border-slate-100'}`}
                    title={food.description}
                  >
                    {food.image ? <img src={food.image} alt="" loading="lazy" decoding="async" className="w-full aspect-square object-contain" /> : <BowlFood size={24} className="mx-auto text-slate-300" />}
                    <div className="mt-1 text-[10px] font-bold truncate">{food.name}</div>
                  </button>
                ))}
              </div>
            </div>

            <div className="rounded-lg bg-white border border-slate-200 shadow-sm p-4">
              <div className="flex items-center gap-2 mb-3">
                <ArrowsOut size={20} weight="bold" />
                <div className="font-black">悬浮设置</div>
              </div>
              <label data-manual-anchor="manual-pet-floating" className="block mb-4">
                <div className="flex items-center justify-between gap-3 mb-2">
                  <span className="text-sm font-black text-slate-700">自动活跃度</span>
                  <span className="text-[11px] font-black text-slate-400">{selectedAutoBehavior.label}</span>
                </div>
                <select
                  value={state.autoBehavior || 'gentle'}
                  onChange={async (event) => {
                    const value = event.target.value as DesktopPetAutoBehavior;
                    await setAutoBehavior(value);
                    const label = AUTO_BEHAVIOR_OPTIONS.find(option => option.id === value)?.label || '温和活跃';
                    addToast(`自动活跃度：${label}`, 'success');
                  }}
                  className="w-full h-10 rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm font-bold outline-none"
                >
                  {AUTO_BEHAVIOR_OPTIONS.map(option => (
                    <option key={option.id} value={option.id}>{option.label}</option>
                  ))}
                </select>
                <div className="mt-2 text-[11px] leading-relaxed text-slate-400">
                  {selectedAutoBehavior.description}
                </div>
              </label>
              <label className="block">
                <div className="flex items-center justify-between gap-3 mb-2">
                  <span className="text-sm font-black text-slate-700">桌宠大小</span>
                  <span className="text-[11px] font-black text-slate-400">{Math.round(state.overlay.scale * 100)}%</span>
                </div>
                <input
                  type="range"
                  min={0.45}
                  max={1.35}
                  step={0.05}
                  value={state.overlay.scale}
                  onChange={(event) => {
                    const scale = Number(event.target.value);
                    const nextSize = {
                      width: Math.max(120, (role?.width || 300) * scale),
                      height: Math.max(128, (role?.height || 320) * scale),
                    };
                    const next = clampDesktopPetOverlay(
                      { ...state.overlay, scale },
                      { width: window.innerWidth, height: window.innerHeight },
                      nextSize,
                    );
                    void updateOverlay(next);
                  }}
                  className="w-full accent-slate-950"
                />
              </label>
              <label className="block">
                <div className="flex items-center justify-between gap-3 mb-2">
                  <span className="text-sm font-black text-slate-700">掉落速度</span>
                  <span className="text-[11px] font-black text-slate-400">{Math.round(state.fallSpeed || 150)} px/s</span>
                </div>
                <input
                  type="range"
                  min={DESKTOP_PET_FALL_SPEED_MIN}
                  max={DESKTOP_PET_FALL_SPEED_MAX}
                  step={10}
                  value={state.fallSpeed || 150}
                  onChange={(event) => { void setFallSpeed(Number(event.target.value)); }}
                  className="w-full accent-slate-950"
                />
              </label>
              <div className="mt-2 text-[11px] leading-relaxed text-slate-400">
                松开拖拽后只向下落一小段，不会自动贴到屏幕底部。
              </div>
            </div>

            <div data-manual-anchor="manual-pet-reminders" className="rounded-lg bg-white border border-slate-200 shadow-sm p-4">
              <div className="flex items-center justify-between gap-2 mb-3">
                <div className="flex items-center gap-2">
                  <Alarm size={20} weight="bold" />
                  <div className="font-black">提醒</div>
                </div>
                <button
                  onClick={async () => {
                    const result = await triggerTestReminder();
                    addToast(result.notified ? '测试提醒已发出' : '测试提醒已显示在桌宠里', 'success');
                  }}
                  className="h-8 px-3 rounded-full bg-slate-100 text-slate-600 text-[11px] font-black active:scale-95"
                >
                  测试
                </button>
              </div>
              <div className="space-y-2">
                <input
                  value={reminderTitle}
                  onChange={(event) => setReminderTitle(event.target.value)}
                  placeholder="提醒标题"
                  className="w-full h-10 rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm font-bold outline-none"
                />
                <input
                  value={reminderNote}
                  onChange={(event) => setReminderNote(event.target.value)}
                  placeholder="备注"
                  className="w-full h-10 rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm outline-none"
                />
                <div className="grid grid-cols-[1fr_92px_44px] gap-2">
                  <input
                    type="datetime-local"
                    value={reminderTime}
                    onChange={(event) => setReminderTime(event.target.value)}
                    className="min-w-0 h-10 rounded-lg border border-slate-200 bg-slate-50 px-2 text-xs font-bold outline-none"
                  />
                  <select
                    value={reminderRepeat}
                    onChange={(event) => setReminderRepeat(event.target.value as 'none' | 'daily')}
                    className="h-10 rounded-lg border border-slate-200 bg-slate-50 px-2 text-xs font-bold outline-none"
                  >
                    <option value="none">一次</option>
                    <option value="daily">每天</option>
                  </select>
                  <button onClick={() => { void handleReminderAdd(); }} className="h-10 rounded-lg bg-slate-950 text-white flex items-center justify-center active:scale-95" title="添加提醒">
                    <Plus size={18} weight="bold" />
                  </button>
                </div>
              </div>

              <div className="mt-4 space-y-2">
                {state.reminders.length === 0 && (
                  <div className="py-8 text-center text-xs text-slate-400 font-bold">还没有提醒</div>
                )}
                {state.reminders.map(reminder => (
                  <div key={reminder.id} className="rounded-lg bg-slate-50 border border-slate-100 px-3 py-2 flex items-center gap-2">
                    <button
                      onClick={() => { void updateReminder(reminder.id, { enabled: !reminder.enabled }); }}
                      className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${reminder.enabled ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-400'}`}
                      title={reminder.enabled ? '关闭提醒' : '开启提醒'}
                    >
                      <Bell size={16} weight="bold" />
                    </button>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-black truncate">{reminder.title}</div>
                      <div className="text-[11px] text-slate-500 truncate">
                        {new Date(reminder.dueAt).toLocaleString()} · {reminder.repeat === 'daily' ? '每天' : '一次'}
                        {reminder.note ? ` · ${reminder.note}` : ''}
                      </div>
                    </div>
                    <button onClick={() => { void deleteReminder(reminder.id); }} className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 active:bg-slate-200" title="删除">
                      <Trash size={15} weight="bold" />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <div className="pb-4 text-[11px] leading-relaxed text-slate-400">
              桌宠提醒只在 Moro 页面运行时检查；浏览器关闭后不会常驻执行。桌宠互动只影响本 App 内的养成状态，不会写入聊天或记忆。
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};

export default DesktopPetApp;
