/**
 * 登场人物 —— 角色档案管理（原「神经链接」），黑白拼贴手账风界面。
 *
 * 词汇对照（数据结构不变，只换了说法）：
 *  - 名册 = 角色列表；名帖 = 一位角色（CharacterProfile）
 *  - 底稿 = 设定页（性格底稿/核心指令、TA 的世界、台词样张、开场白）
 *  - 往事 = 记忆页；日账 = 每日记忆碎片；月签 = 月度核心记忆（refinedMemories）
 *  - 收名帖 / 拓名帖 = 导入 / 导出角色卡；送离 = 删除角色
 * 功能与旧版完全一致：ST/Moro 卡导入导出、头像上传/URL、音色、批量总结、
 * 记忆导入清洗、月度精炼、深链接返回等逻辑原样保留。
 */
import React, { useState, useRef, useEffect } from 'react';
import { useOS } from '../context/OSContext';
import { AppID, CharacterProfile, CharacterExportData, MemoryFragment } from '../types';
import {
    Waveform, VinylRecord, UserPlus, TrayArrowDown, TrayArrowUp, PaperPlaneTilt, X,
} from '@phosphor-icons/react';
import { processImage } from '../utils/file';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { DB } from '../utils/db';
import { ContextBuilder } from '../utils/context';
import { formatMessageWithTime } from '../utils/messageFormat';
import { DEFAULT_ARCHIVE_PROMPTS } from '../components/chat/ChatConstants';
import MemoryArchivist from '../components/character/MemoryArchivist';
import { safeResponseJson, extractContent } from '../utils/safeApi';
import { fetchMiniMaxVoices, MiniMaxVoiceItem } from '../utils/minimaxVoice';
import { resolveMiniMaxApiKey } from '../utils/minimaxApiKey';
import { injectMemoryPalace } from '../utils/memoryPalace/pipeline';
import { generateLifeProfile } from '../utils/lifeProfile';
import { resolveAuxApi } from '../utils/auxApi';
import { extractCardJsonFromPng, parseSillyTavernCard, convertSTCardToCharacter, ParsedSTCard } from '../utils/sillyTavernCard';

// ── 黑白手账设计 token（与剪影集全家同一套语言） ───────────
const INK = '#1c1b1a';
const STICKER = 'border-2 border-[#1c1b1a] bg-white shadow-[2px_2px_0_#1c1b1a] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-all';
const INK_BTN = 'bg-[#1c1b1a] text-[#f7f5ef] border-2 border-[#1c1b1a] shadow-[2px_2px_0_rgba(28,27,26,0.35)] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-all';
const HAND_CN: React.CSSProperties = { fontFamily: "'Long Cang', 'Caveat', cursive" };
const DOT_BG: React.CSSProperties = {
    backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(28,27,26,0.10) 1px, transparent 0)',
    backgroundSize: '16px 16px',
};
const RULED_BG: React.CSSProperties = {
    backgroundImage: 'repeating-linear-gradient(transparent, transparent 23px, rgba(28,27,26,0.13) 23px, rgba(28,27,26,0.13) 24px)',
    lineHeight: '24px',
};

const Tape: React.FC<{ className?: string }> = ({ className }) => (
    <div
        aria-hidden
        className={`pointer-events-none absolute h-5 w-16 bg-white/60 border-x border-dashed border-[#1c1b1a]/30 shadow-sm backdrop-blur-[1px] ${className || ''}`}
    />
);

/** 拼贴弹层：撕边纸卡 + 顶部胶带（与扮相手账同款） */
const PaperSheet: React.FC<{
    open: boolean;
    tag: string;
    title: string;
    onClose: () => void;
    children: React.ReactNode;
    footer?: React.ReactNode;
}> = ({ open, tag, title, onClose, children, footer }) => {
    if (!open) return null;
    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-5 animate-fade-in">
            <div className="absolute inset-0 bg-[#1c1b1a]/45" onClick={onClose} />
            <div className="relative w-full max-w-sm bg-[#f7f5ef] border-2 border-[#1c1b1a] shadow-[5px_5px_0_#1c1b1a] rotate-[-0.4deg] animate-slide-up" style={DOT_BG}>
                <Tape className="-top-2.5 left-1/2 -translate-x-1/2 rotate-[-3deg]" />
                <button
                    onClick={onClose}
                    className={`absolute -top-3 -right-3 w-8 h-8 flex items-center justify-center rotate-[4deg] ${STICKER}`}
                    aria-label="合上"
                >
                    <X size={14} weight="bold" color={INK} />
                </button>
                <div className="px-5 pt-6 pb-2">
                    <div className="label-mono text-[9px] text-[#1c1b1a]/45">{tag}</div>
                    <h3 className="text-lg font-black text-[#1c1b1a] tracking-wide mt-0.5">{title}</h3>
                    <div className="h-[3px] w-14 bg-[#1c1b1a] mt-1.5" />
                </div>
                <div className="px-5 py-3 max-h-[58vh] overflow-y-auto no-scrollbar">{children}</div>
                {footer && <div className="px-5 pb-5 pt-2 flex gap-3">{footer}</div>}
            </div>
        </div>
    );
};

/** 名帖（名册里的一条）：相角贴照片 + 名字 + 一句话印象 */
const CharacterCard: React.FC<{
    char: CharacterProfile;
    tilt: string;
    onClick: () => void;
    onDelete: (e: React.MouseEvent) => void;
}> = ({ char, tilt, onClick, onDelete }) => (
    <div
        onClick={onClick}
        className="relative bg-white border-2 border-[#1c1b1a]/45 shadow-sm pl-4 pr-3 py-3 flex items-center gap-3 cursor-pointer transition-all active:scale-[0.99] hover:border-[#1c1b1a]"
        style={{ rotate: tilt }}
    >
        <div className="relative shrink-0">
            <img src={char.avatar} className="w-12 h-12 object-cover border-2 border-[#1c1b1a]/70 grayscale-[35%] contrast-105" alt={char.name} />
            <span aria-hidden className="absolute -top-1 -left-1 w-2.5 h-2.5 border-t-2 border-l-2 border-[#1c1b1a]" />
            <span aria-hidden className="absolute -bottom-1 -right-1 w-2.5 h-2.5 border-b-2 border-r-2 border-[#1c1b1a]" />
        </div>
        <div className="flex-1 min-w-0">
            <h3 className="text-sm font-black text-[#1c1b1a] truncate">{char.name}</h3>
            <p className="text-[11px] text-[#1c1b1a]/50 truncate mt-0.5" style={HAND_CN}>
                {char.description || '还没写下印象'}
            </p>
        </div>
        <button
            onClick={onDelete}
            className="shrink-0 p-1.5 rotate-[3deg] border-2 border-[#1c1b1a]/30 bg-white text-[#1c1b1a]/40 hover:border-[#1c1b1a] hover:text-[#1c1b1a] active:scale-90 transition-all"
            title="送 TA 离场"
        >
            <X size={12} weight="bold" />
        </button>
    </div>
);

/** onExit：剪影集（PersonaHubApp）嵌入时返回封面页；不传则关闭 App 回桌面（旧行为） */
const Character: React.FC<{ onExit?: () => void }> = ({ onExit }) => {
  const { closeApp: closeAppOS, openApp, characters, activeCharacterId, setActiveCharacterId, addCharacter, importCharacter, updateCharacter, deleteCharacter, apiConfig, auxApiConfig, addToast, userProfile, customThemes, addCustomTheme, worldbooks, addWorldbook } = useOS();
  const [isGeneratingLifeProfile, setIsGeneratingLifeProfile] = useState(false);
  const closeApp = onExit || closeAppOS;
  const [view, setView] = useState<'list' | 'detail'>('list');
  const [detailTab, setDetailTab] = useState<'identity' | 'memory'>('identity');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<CharacterProfile | null>(null);
  const [isCompressing, setIsCompressing] = useState(false);
  // 头像 URL 输入的 draft, 不逐字 commit 到 formData.avatar —— 否则每输入一个字符,
  // 所有引用 char.avatar 的 <img> 都会拿到不完整字符串当相对路径请求根目录,
  // 导致打字时疯狂 GET / 和满屏破图. 失焦 / 回车才校验 + commit.
  const [avatarUrlDraft, setAvatarUrlDraft] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cardImportRef = useRef<HTMLInputElement>(null);

  // Race Condition Guards
  const editingIdRef = useRef<string | null>(null);

  // Modals
  const [showImportModal, setShowImportModal] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [showBatchModal, setShowBatchModal] = useState(false);
  const [deleteConfirmTarget, setDeleteConfirmTarget] = useState<string | null>(null);

  const [importText, setImportText] = useState('');
  const [exportText, setExportText] = useState('');
  const [isProcessingMemory, setIsProcessingMemory] = useState(false);
  const [importStatus, setImportStatus] = useState('');

  // Batch Summarize State
  const [batchRange, setBatchRange] = useState({ start: '', end: '' });
  const [isBatchProcessing, setIsBatchProcessing] = useState(false);
  const [batchProgress, setBatchProgress] = useState('');

  // Archive Prompts State (shared with ChatApp)
  const [archivePrompts, setArchivePrompts] = useState<{id: string, name: string, content: string}[]>(DEFAULT_ARCHIVE_PROMPTS);
  const [selectedPromptId, setSelectedPromptId] = useState<string>('preset_rational');
  const [editingPrompt, setEditingPrompt] = useState<{id: string, name: string, content: string} | null>(null);
  const [showPromptEditor, setShowPromptEditor] = useState(false);

  const [isLoadingVoices, setIsLoadingVoices] = useState(false);
  const [voiceOptions, setVoiceOptions] = useState<Record<'system' | 'voice_cloning' | 'voice_generation', MiniMaxVoiceItem[]>>({
      system: [],
      voice_cloning: [],
      voice_generation: [],
  });

  const handleLoadMiniMaxVoices = async () => {
      const minimaxApiKey = resolveMiniMaxApiKey(apiConfig);
      if (!minimaxApiKey) {
          addToast('请先在「文具盒」里填入 MiniMax API Key（未填写时会回退使用通用 API Key）', 'error');
          return;
      }

      setIsLoadingVoices(true);
      try {
          const result = await fetchMiniMaxVoices(minimaxApiKey, 'all');
          setVoiceOptions({
              system: result.system_voice,
              voice_cloning: result.voice_cloning,
              voice_generation: result.voice_generation,
          });
          addToast(`唱片柜翻好了：现货 ${result.system_voice.length} / 复刻 ${result.voice_cloning.length} / 文生 ${result.voice_generation.length}`, 'success');
      } catch (e: any) {
          console.error('[MiniMax Voice] load failed', e);
          addToast(e?.message || '翻唱片柜失败（MiniMax 音色拉取）', 'error');
      } finally {
          setIsLoadingVoices(false);
      }
  };

  const applyVoiceToCharacter = (voice: MiniMaxVoiceItem, source: 'system' | 'voice_cloning' | 'voice_generation') => {
      if (!formData) return;
      handleChange('voiceProfile', {
          provider: 'minimax',
          voiceId: voice.voice_id,
          voiceName: voice.voice_name || '',
          source,
          model: formData.voiceProfile?.model || 'speech-2.8-hd',
          notes: formData.voiceProfile?.notes || '',
      });
      addToast(`这张唱片放上去了：${voice.voice_name || voice.voice_id}`, 'success');
  };

  // Load archive prompts from localStorage (shared with ChatApp)
  useEffect(() => {
      const savedPrompts = localStorage.getItem('chat_archive_prompts');
      if (savedPrompts) {
          try {
              const parsed = JSON.parse(savedPrompts);
              const merged = [...DEFAULT_ARCHIVE_PROMPTS, ...parsed.filter((p: any) => !p.id.startsWith('preset_'))];
              setArchivePrompts(merged);
          } catch(e) {}
      }
      const savedId = localStorage.getItem('chat_active_archive_prompt_id');
      if (savedId) setSelectedPromptId(savedId);
  }, []);

  // 深链接：聊天里点头像/右上角"角色设置"会写入该 key，再打开本 App 时直接进对应角色的编辑页。
  // moro_character_return_app 记录来源 App：返回键回到上一级页面（聊天/聊天列表）而不是桌面。
  const returnAppRef = useRef<AppID | null>(null);
  useEffect(() => {
      try {
          const target = localStorage.getItem('moro_character_open_target');
          const returnApp = localStorage.getItem('moro_character_return_app');
          if (returnApp) {
              localStorage.removeItem('moro_character_return_app');
              if (Object.values(AppID).includes(returnApp as AppID)) {
                  returnAppRef.current = returnApp as AppID;
              }
          }
          if (target) {
              localStorage.removeItem('moro_character_open_target');
              if (characters.some(c => c.id === target)) {
                  setEditingId(target);
                  setView('detail');
              }
          }
      } catch { /* ignore */ }
  }, []);

  // Sync Ref with State
  useEffect(() => {
      editingIdRef.current = editingId;
  }, [editingId]);

  // CRITICAL FIX: Breaking the render loop.
  // We only sync from global 'characters' to local 'formData' when:
  // 1. We enter edit mode (view becomes detail)
  // 2. We switch character IDs
  useEffect(() => {
    if (editingId && view === 'detail') {
        // Only if formData is not set OR the ID doesn't match
        if (!formData || formData.id !== editingId) {
            const target = characters.find(c => c.id === editingId);
            if (target) setFormData(target);
        }
    }
  }, [editingId, view]);

  // 切换角色时把 URL draft 同步成该角色当前 https 头像 (若有), 否则清空.
  // 不监听 formData.avatar 的每次变化 —— 文件上传走 data URL 路径时 draft 应保持原样.
  useEffect(() => {
    if (!editingId) return;
    const target = characters.find(c => c.id === editingId);
    const av = target?.avatar || '';
    setAvatarUrlDraft(/^https?:\/\/.+/i.test(av) ? av : '');
  }, [editingId]);

  // EXTERNAL-UPDATE SYNC: pull in memories/refinedMemories written by other apps
  // (e.g. Chat archive calling updateCharacter) so stale formData doesn't overwrite them.
  useEffect(() => {
    if (!editingId || !formData || formData.id !== editingId) return;
    const latest = characters.find(c => c.id === editingId);
    if (!latest) return;
    const latestMemCount = latest.memories?.length ?? 0;
    const localMemCount = formData.memories?.length ?? 0;
    const latestRefKeys = Object.keys(latest.refinedMemories || {}).length;
    const localRefKeys = Object.keys(formData.refinedMemories || {}).length;
    if (latestMemCount > localMemCount || latestRefKeys > localRefKeys) {
        setFormData(prev => prev && prev.id === editingId
            ? { ...prev, memories: latest.memories, refinedMemories: latest.refinedMemories }
            : prev);
    }
  }, [characters, editingId]);

  // Auto-save Effect with Safety Guard
  useEffect(() => {
    if (formData && editingId) {
        // SAFETY GUARD: Only save if the formData ID matches the currently active editing ID.
        // This prevents overwriting Character B with Character A's data if a delayed async call updates formData.
        if (formData.id === editingId) {
            updateCharacter(editingId, formData);
        } else {
            console.warn(`Race condition prevented: Tried to save data for ${formData.id} into slot ${editingId}`);
        }
    }
  }, [formData]);

  const handleBack = () => {
      // 从聊天 App 深链进来的：返回键直接回到来源页面（聊天/聊天列表），不落回本 App 列表或桌面
      if (returnAppRef.current) {
          const target = returnAppRef.current;
          returnAppRef.current = null;
          openApp(target);
          return;
      }
      if (view === 'detail') {
          setView('list');
          setEditingId(null);
      } else closeApp();
  };

  const handleChange = (field: keyof CharacterProfile, value: any) => {
      // Functional update to prevent stale state issues in simple closures
      setFormData(prev => {
          if (!prev) return null;
          return { ...prev, [field]: value };
      });
  };

  // 生活侧写：用副 API（没开就回退主 API）依据人设 + 记忆生成一份「帮 TA 更了解自己」的速写。
  const handleGenerateLifeProfile = async () => {
      if (!formData) return;
      const api = resolveAuxApi(auxApiConfig, apiConfig);
      if (!api.baseUrl || !api.model) { addToast('请先在「文具盒」配置 API（主线或副线）', 'error'); return; }
      setIsGeneratingLifeProfile(true);
      try {
          const content = await generateLifeProfile(formData, userProfile, api);
          if (!content) { addToast('侧写没写出来，待会儿再试试', 'error'); return; }
          handleChange('lifeProfile', { content, generatedAt: Date.now(), edited: false });
          addToast('生活侧写写好了', 'success');
      } catch (e: any) {
          console.warn('[LifeProfile] generate failed:', e?.message || e);
          addToast('生成失败了，待会儿再试试', 'error');
      } finally {
          setIsGeneratingLifeProfile(false);
      }
  };

  // 「扩展设定 (Worldbooks)」区块已从角色设置移除：
  // 世界书（剪报夹）挂载统一在「聊天设置 → 剪报夹页」里管理（与剪报夹 App 实况同步）。

  // ... (Other handlers unchanged)
  const handleToggleActiveMonth = (year: string, month: string) => {
      if (!formData) return;
      const key = `${year}-${month}`;
      const current = formData.activeMemoryMonths || [];
      const next = current.includes(key) ? current.filter(k => k !== key) : [...current, key];
      handleChange('activeMemoryMonths', next);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
          try {
              setIsCompressing(true);
              const processedBase64 = await processImage(file);
              handleChange('avatar', processedBase64);
              // 清空 URL draft, 否则用户之后再触发 URL input 的 onBlur 会用脏旧 URL
              // 把刚上传的 data URL 头像盖掉. 不走 effect 监听 avatar 的方案 —— 那会
              // 在用户正在打 URL 时吃掉 draft.
              setAvatarUrlDraft('');
              addToast('照片贴好了', 'success');
          } catch (error: any) {
              addToast(error.message || '图片处理失败', 'error');
          } finally {
              setIsCompressing(false);
              if (fileInputRef.current) fileInputRef.current.value = '';
          }
      }
  };

  const handleRefineMonth = async (year: string, month: string, rawText: string, formattedPrompt?: string) => {
      if (!apiConfig.apiKey) { addToast('请先配置 API Key', 'error'); return; }
      if (!formData) return;

      const targetId = formData.id; // LOCK ID

      // Build lightweight character identity context (no memories - we're generating those)
      let identityContext = `[角色身份]\n名字: ${formData.name}\n`;
      if (formData.systemPrompt) identityContext += `核心性格/指令:\n${formData.systemPrompt}\n`;
      if (formData.worldview?.trim()) identityContext += `世界观设定: ${formData.worldview}\n`;
      identityContext += `互动对象: ${userProfile.name}`;
      if (userProfile.bio) identityContext += ` (${userProfile.bio})`;
      identityContext += '\n\n';

      // Gemini 3.1 preview 对"人设堆 3000+ token → 迟到任务句"的 all-in-one user 消息
      // 会静默拒答（completion_tokens=0，代理回 "Token count: N" stub 污染记忆库）。
      // 两条对抗措施一起上：
      //   (A) 任务声明放最前，明确这是总结不是角色扮演
      //   (B) 拆 system+user：规则/身份/任务走 system，原始日记走 user，
      //       让模型看清哪段是指令、哪段是数据
      const taskPreamble = `### 任务（最优先，请先读此段再读后文）
你正在执行"月度记忆精炼"：把 user 消息里提供的【${year}-${month} 每日记忆碎片】压缩成一份简洁的月度核心记忆。
这是**总结写作任务**，不是角色扮演对话——不要进入聊天模式、不要等待对方发言、不要只输出空白或沉默，直接输出总结正文。`;

      const systemContent = formattedPrompt
          ? `${taskPreamble}\n\n### 角色视角（仅供写作口吻参考）\n${identityContext}### 详细规则与输出格式\n${formattedPrompt}`
          : `${taskPreamble}\n\n### 角色视角（仅供写作口吻参考）\n${identityContext}### 详细规则\n以该角色的第一人称写作，使用与日记相同的语言（中文），输出一段精简的月度核心记忆。`;
      const userContent = rawText;

      const refineUrl = `${apiConfig.baseUrl.replace(/\/+$/, '')}/chat/completions`;
      const t0 = performance.now();
      try {
          const response = await fetch(refineUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiConfig.apiKey}` },
              body: JSON.stringify({
                  model: apiConfig.model,
                  messages: [
                      { role: 'system', content: systemContent },
                      { role: 'user', content: userContent },
                  ],
                  temperature: 0.3,
              })
          });
          const dt = Math.round(performance.now() - t0);
          if (!response.ok) throw new Error(`API Request failed (HTTP ${response.status} after ${dt}ms)`);
          const data = await safeResponseJson(response);
          const summary = extractContent(data);
          if (!summary) {
              // 失败时留一条诊断 warn：Gemini 3.1 preview 在某些 prompt 下会静默拒答
              // （completion_tokens=0，代理回 "Token count: N" stub），这些信息能帮
              // 之后快速确认是不是同一个坑复发
              const msg = data?.choices?.[0]?.message;
              const rawContent = typeof msg?.content === 'string' ? msg.content : '';
              const finishReason = data?.choices?.[0]?.finish_reason;
              console.warn(`🧠 [Refine ${year}-${month}] 模型返回空: dt=${dt}ms finish=${finishReason} content.length=${rawContent.length} preview=${rawContent.slice(0, 120)} usage=`, data?.usage);
              addToast(`凝缩失败: 模型返回为空 (${dt}ms, finish=${finishReason || 'n/a'})，详情见控制台`, 'error');
              return;
          }
          const key = `${year}-${month}`;

          // CHECK IF USER SWITCHED
          if (editingIdRef.current === targetId) {
              // Still on same page
              handleChange('refinedMemories', { ...(formData.refinedMemories || {}), [key]: summary });
              addToast(`${year} 年 ${month} 月的月签凝好了`, 'success');
          } else {
              // Switched page - Save to DB directly
              const currentRefined = characters.find(c => c.id === targetId)?.refinedMemories || {};
              updateCharacter(targetId, { refinedMemories: { ...currentRefined, [key]: summary } });
              addToast('后台凝缩完成：月签已存回原角色', 'success');
          }
      } catch (e: any) { addToast(`凝缩失败: ${e.message}`, 'error'); }
  };

  const handleDeleteMemories = (ids: string[]) => { if (!formData) return; handleChange('memories', (formData.memories || []).filter(m => !ids.includes(m.id))); addToast(`撕掉了 ${ids.length} 条日账`, 'success'); };
  const handleUpdateMemory = (id: string, newSummary: string) => { if (!formData) return; handleChange('memories', (formData.memories || []).map(m => m.id === id ? { ...m, summary: newSummary } : m)); addToast('这条日账改好了', 'success'); };

  /**
   * 按指定日期强制重新总结：读原始聊天记录（忽略 hideBeforeMessageId），LLM 总结，
   * upsert 同日期的 'archive' MemoryFragment（'palace' 自动归档的不动，保持并存）。
   * 这是自动化的兜底路径：即使 4.5 已经被 palace 处理+隐藏+向量化，用户依然能让 AI
   * 重新阅读 4.5 原始聊天做一版手动总结。
   */
  /**
   * @param overridePromptId 用户在 MemoryArchivist 的重总结弹窗里现场选的模板 id；
   *                        没提供则退回到当前 selectedPromptId
   */
  const handleForceArchiveDate = async (dateStr: string, overridePromptId?: string): Promise<void> => {
      if (!apiConfig.apiKey || !formData) { addToast('请先配置 API Key', 'error'); return; }
      const targetId = formData.id;
      try {
          const allMsgs = await DB.getMessagesByCharId(targetId, true);
          // 忽略 hideBeforeMessageId —— 这是强制重总结的关键
          const dayMsgs = allMsgs.filter(m => {
              const d = new Date(m.timestamp);
              const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
              return key === dateStr;
          });
          if (dayMsgs.length === 0) { addToast(`${dateStr} 这天没有消息可誊`, 'info'); return; }

          const timeFmt = (ts: number) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
          const rawLog = dayMsgs
              .map(m => formatMessageWithTime(m, formData.name, userProfile.name, timeFmt))
              .join('\n');

          // 模板优先级：override（弹窗现场选）→ 当前 state → 默认 preset
          const effectivePromptId = overridePromptId || selectedPromptId;
          const templateObj = archivePrompts.find(p => p.id === effectivePromptId) || DEFAULT_ARCHIVE_PROMPTS[0];
          const baseContext = ContextBuilder.buildCoreContext(formData, userProfile);
          let prompt = baseContext + '\n\n' + templateObj.content;
          prompt = prompt.replace(/\$\{dateStr\}/g, dateStr);
          prompt = prompt.replace(/\$\{char\.name\}/g, formData.name);
          prompt = prompt.replace(/\$\{userProfile\.name\}/g, userProfile.name);
          prompt = prompt.replace(/\$\{rawLog.*?\}/g, rawLog.substring(0, 200000));

          const response = await fetch(`${apiConfig.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiConfig.apiKey}` },
              body: JSON.stringify({ model: apiConfig.model, messages: [{ role: 'user', content: prompt }], temperature: 0.5, max_tokens: 8000, stream: false }),
          });
          if (!response.ok) throw new Error(`API ${response.status}`);
          const data = await safeResponseJson(response);
          let summary = (data.choices?.[0]?.message?.content || '').trim().replace(/^["']|["']$/g, '');
          if (!summary) throw new Error('空响应');

          // upsert：同日期的 mood='archive' 替换；'palace' 自动归档不碰
          const existing = formData.memories || [];
          const kept = existing.filter(m => !(m.date === dateStr && (m.mood === 'archive' || !m.mood)));
          const newFrag: MemoryFragment = {
              id: `mem-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              date: dateStr,
              summary,
              mood: 'archive',
          };

          if (editingIdRef.current === targetId) {
              handleChange('memories', [...kept, newFrag]);
          } else {
              // 用户切角色了 —— 直接写回目标角色
              const currentMems = characters.find(c => c.id === targetId)?.memories || [];
              const curKept = currentMems.filter(m => !(m.date === dateStr && (m.mood === 'archive' || !m.mood)));
              updateCharacter(targetId, { memories: [...curKept, newFrag] });
          }
          addToast(`${dateStr} 这天已重誊一遍`, 'success');
      } catch (e: any) {
          addToast(`重誊失败: ${e.message || '未知错误'}`, 'error');
      }
  };

  // NEW: Core Memory Handlers
  const handleUpdateRefinedMemory = (year: string, month: string, newContent: string) => {
      if (!formData) return;
      const key = `${year}-${month}`;
      handleChange('refinedMemories', { ...(formData.refinedMemories || {}), [key]: newContent });
      addToast('月签改好了', 'success');
  };

  const handleDeleteRefinedMemory = (year: string, month: string) => {
      if (!formData || !formData.refinedMemories) return;
      const key = `${year}-${month}`;
      const newRefined = { ...formData.refinedMemories };
      delete newRefined[key];
      handleChange('refinedMemories', newRefined);
      addToast('月签撕掉了', 'success');
  };

  const handleExportPreview = () => { if (!formData) return; const mems = formData.memories as any[]; if (!mems || mems.length === 0) { addToast('往事栏还空着，没东西可拓', 'info'); return; } const sortedMemories = [...mems].sort((a, b) => a.date.localeCompare(b.date)); let text = `【角色档案】\nName: ${formData.name}\nExported: ${new Date().toLocaleString()}\n\n`; if (formData.refinedMemories) { text += `=== 核心记忆 ===\n`; Object.entries(formData.refinedMemories).sort().forEach(([k, v]) => { text += `[${k}]: ${v}\n`; }); text += `\n=== 详细日志 ===\n`; } let currentYear = '', currentMonth = ''; sortedMemories.forEach(mem => { const match = mem.date.match(/(\d{4})[-/年](\d{1,2})/); if (match) { const y = match[1], m = match[2]; if (y !== currentYear) { text += `\n[ ${y}年 ]\n`; currentYear = y; currentMonth = ''; } if (m !== currentMonth) { text += `\n-- ${parseInt(m)}月 --\n\n`; currentMonth = m; } } text += `${mem.date} ${mem.mood ? `(#${mem.mood})` : ''}\n${mem.summary}\n\n--------------------------\n\n`; }); setExportText(text); setShowExportModal(true); navigator.clipboard.writeText(text).then(() => addToast('全文已自动抄进剪贴板', 'info')).catch(() => {}); };
  const handleNativeShare = async () => { if(!exportText) return; if (Capacitor.isNativePlatform()) { try { const fileName = `${formData?.name || 'character'}_memories.txt`; await Filesystem.writeFile({ path: fileName, data: exportText, directory: Directory.Cache, encoding: Encoding.UTF8 }); const uri = await Filesystem.getUri({ directory: Directory.Cache, path: fileName }); await Share.share({ title: '记忆档案', files: [uri.uri] }); } catch(e: any) { console.error("Native share failed", e); addToast('分享组件调起失败，请直接复制文本', 'error'); } } };
  const handleWebFileDownload = () => { const fileName = `${formData?.name || 'character'}_memories.txt`; const blob = new Blob([exportText], { type: 'text/plain' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = fileName; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url); addToast('浏览器开始下载了', 'success'); };

  const handleImportMemories = async () => {
      if (!importText.trim() || !apiConfig.apiKey) { addToast('请检查输入内容或 API 设置', 'error'); return; }
      if (!formData) return;

      const targetId = formData.id; // LOCK ID
      setIsProcessingMemory(true);
      setImportStatus('稿子送去清洗了，稍等…');

      try {
          const prompt = `Task: Convert this text log into a JSON array. Format: [{ "date": "YYYY-MM-DD", "summary": "...", "mood": "..." }] Text: ${importText.substring(0, 8000)}`;
          const response = await fetch(`${apiConfig.baseUrl.replace(/\/+$/, '')}/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiConfig.apiKey}` }, body: JSON.stringify({ model: apiConfig.model, messages: [{ role: "user", content: prompt }], temperature: 0.1 }) });
          if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);
          const data = await safeResponseJson(response);
          let content = data.choices?.[0]?.message?.content || '';
          content = content.replace(/```json/g, '').replace(/```/g, '').trim();
          const firstBracket = content.indexOf('[');
          const lastBracket = content.lastIndexOf(']');
          if (firstBracket !== -1 && lastBracket !== -1) { content = content.substring(firstBracket, lastBracket + 1); }
          let parsed; try { parsed = JSON.parse(content); } catch (e) { throw new Error('解析返回数据失败'); }
          let targetArray = Array.isArray(parsed) ? parsed : (parsed.memories || parsed.data);

          if (Array.isArray(targetArray)) {
              const newMems = targetArray.map((m: any) => ({ id: `mem-${Date.now()}-${Math.random()}`, date: m.date || '未知', summary: m.summary || '无内容', mood: m.mood || '记录' }));

              if (editingIdRef.current === targetId) {
                  handleChange('memories', [...(formData.memories || []), ...newMems]);
                  setShowImportModal(false);
                  addToast(`${newMems.length} 条外稿清洗完毕，已入册`, 'success');
              } else {
                  // Background update
                  const currentMems = characters.find(c => c.id === targetId)?.memories || [];
                  updateCharacter(targetId, { memories: [...currentMems, ...newMems] });
                  addToast('后台清洗完成：外稿已存回原角色', 'success');
              }
          } else { throw new Error('结构错误'); }
      } catch (e: any) { setImportStatus(`错误: ${e.message || '未知错误'}`); addToast('外稿清洗失败', 'error'); } finally { setIsProcessingMemory(false); }
  };

  const handleBatchSummarize = async () => {
        if (!apiConfig.apiKey || !formData) return;

        const targetId = formData.id; // LOCK ID
        setIsBatchProcessing(true);
        setBatchProgress('Initializing...');

        try {
            const msgs = await DB.getMessagesByCharId(targetId, true);
            // hideBeforeMessageId 之前的消息已被归档/隐藏，不应再进批量总结
            // （此前 validMsgs 算完没用上，遍历的还是未过滤的 msgs —— 修复）
            const validMsgs = msgs.filter(m => !formData.hideBeforeMessageId || m.id >= formData.hideBeforeMessageId);
            const msgsByDate: Record<string, any[]> = {};

            validMsgs.forEach(m => {
                const d = new Date(m.timestamp);
                const year = d.getFullYear();
                const month = String(d.getMonth() + 1).padStart(2, '0');
                const day = String(d.getDate()).padStart(2, '0');
                const dateStr = `${year}-${month}-${day}`;

                if (batchRange.start && dateStr < batchRange.start) return;
                if (batchRange.end && dateStr > batchRange.end) return;

                if (!msgsByDate[dateStr]) msgsByDate[dateStr] = [];
                msgsByDate[dateStr].push(m);
            });

            const dates = Object.keys(msgsByDate).sort();
            const newMemories: MemoryFragment[] = [];

            await injectMemoryPalace(formData);
            const baseContext = ContextBuilder.buildCoreContext(formData, userProfile);

            for (let i = 0; i < dates.length; i++) {
                const date = dates[i];
                setBatchProgress(`Processing ${date} (${i+1}/${dates.length})`);

                const dayMsgs = msgsByDate[date];
                const timeFmt = (ts: number) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
                const rawLog = dayMsgs
                    .map(m => formatMessageWithTime(m, formData.name, userProfile.name, timeFmt))
                    .join('\n');

                // Use selected template (same as ChatApp) with variable substitution
                const templateObj = archivePrompts.find(p => p.id === selectedPromptId) || DEFAULT_ARCHIVE_PROMPTS[0];
                let prompt = baseContext + '\n\n' + templateObj.content;
                prompt = prompt.replace(/\$\{dateStr\}/g, date);
                prompt = prompt.replace(/\$\{char\.name\}/g, formData.name);
                prompt = prompt.replace(/\$\{userProfile\.name\}/g, userProfile.name);
                prompt = prompt.replace(/\$\{rawLog.*?\}/g, rawLog.substring(0, 200000));

                const response = await fetch(`${apiConfig.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiConfig.apiKey}` },
                    body: JSON.stringify({
                        model: apiConfig.model,
                        messages: [{ role: "user", content: prompt }],
                        max_tokens: 8000,
                        temperature: 0.5
                    })
                });

                if (response.ok) {
                    const data = await safeResponseJson(response);
                    let summary = extractContent(data);
                    summary = summary.replace(/^["']|["']$/g, '').trim();

                    if (summary) {
                        newMemories.push({
                            id: `mem-${Date.now()}-${Math.random()}`,
                            date: date,
                            summary: summary,
                            mood: 'auto'
                        });
                    }
                }
                await new Promise(r => setTimeout(r, 500));
            }

            const totalDays = dates.length;
            const okCount = newMemories.length;
            const toastLevel: 'success' | 'info' | 'error' =
                okCount === 0 ? 'error' : okCount < totalDays ? 'info' : 'success';
            const toastMsg = okCount === 0
                ? `成批誊写失败：${totalDays} 天全都没写成（查查 API / 模型）`
                : okCount < totalDays
                    ? `成批誊写完成：${okCount}/${totalDays} 天写成（有几天没成）`
                    : `成批誊写完成：${okCount} 条日账已入册`;

            if (editingIdRef.current === targetId) {
                if (okCount > 0) handleChange('memories', [...(formData.memories || []), ...newMemories]);
                setBatchProgress('Done!');
                setTimeout(() => {
                    setIsBatchProcessing(false);
                    setShowBatchModal(false);
                    addToast(toastMsg, toastLevel);
                }, 1000);
            } else {
                // Background update
                if (okCount > 0) {
                    const currentMems = characters.find(c => c.id === targetId)?.memories || [];
                    updateCharacter(targetId, { memories: [...currentMems, ...newMemories] });
                }
                setIsBatchProcessing(false);
                setShowBatchModal(false);
                addToast(`${formData.name}：${toastMsg}`, toastLevel);
            }

        } catch (e: any) {
            setBatchProgress(`Error: ${e.message}`);
            setIsBatchProcessing(false);
            setShowBatchModal(false);
            addToast(`成批誊写失败: ${e.message}`, 'error');
        }
    };

  const confirmDeleteCharacter = () => {
      if (deleteConfirmTarget) {
          deleteCharacter(deleteConfirmTarget);
          setDeleteConfirmTarget(null);
          addToast('名帖撕下了，TA 已离场', 'success');
      }
  };

  const handleExportCard = async () => {
      if (!formData) return;

      const {
          id, memories, refinedMemories, activeMemoryMonths, guidebookInsights,
          ...cardProps
      } = formData;

      const exportData: CharacterExportData = {
          ...cardProps,
          version: 1,
          type: 'moro_character_card'
      };

      if (formData.bubbleStyle) {
          const customTheme = customThemes.find(t => t.id === formData.bubbleStyle);
          if (customTheme) {
              exportData.embeddedTheme = customTheme;
          }
      }

      const json = JSON.stringify(exportData, null, 2);
      const fileName = `${formData.name || 'Character'}_Card.json`;

      if (Capacitor.isNativePlatform()) {
          try {
              await Filesystem.writeFile({
                  path: fileName,
                  data: json,
                  directory: Directory.Cache,
                  encoding: Encoding.UTF8,
              });
              const uriResult = await Filesystem.getUri({
                  directory: Directory.Cache,
                  path: fileName,
              });
              await Share.share({
                  title: '导出角色卡',
                  files: [uriResult.uri],
              });
              addToast('已调起分享', 'success');
              return;
          } catch (e: any) {
              console.error("Native Export Error", e);
              addToast('原生分享失败，尝试浏览器分享/下载', 'info');
          }
      }

      try {
          // Align with Settings export fallback logic for wrapped webviews:
          // try Web Share first, then fallback to download.
          const file = new File([json], fileName, { type: 'application/json' });
          const canShareFile = typeof navigator !== 'undefined'
              && typeof navigator.share === 'function'
              && (typeof navigator.canShare !== 'function' || navigator.canShare({ files: [file] }));

          if (canShareFile) {
              await navigator.share({
                  title: '导出角色卡',
                  files: [file],
              });
              addToast('已调起分享', 'success');
              return;
          }
      } catch (e: any) {
          // User cancellation and unsupported cases should continue to download fallback.
          if (e?.name !== 'AbortError') {
              console.error('Web Share Export Error', e);
          }
      }

          const blob = new Blob([json], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = fileName;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);

          addToast('名帖拓好，已开始下载', 'success');
  };

  /**
   * SillyTavern 卡导入：世界书条目全部写入全局世界书库（默认局部作用域，开关/
   * 位置/顺序按原卡映射，原始设置另存 stData），有内容的条目按插入顺序挂载到
   * 新角色；ST 里禁用的条目 enabled=false，挂载但不注入。
   */
  const importSillyTavernCard = async (parsed: ParsedSTCard, avatarDataUrl: string) => {
      const result = convertSTCardToCharacter(parsed, { userName: userProfile.name });

      for (const wb of result.worldbooks) {
          await addWorldbook(wb);
      }

      const newChar: CharacterProfile = {
          id: `char-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          name: result.name,
          avatar: avatarDataUrl || result.avatarFallback,
          description: result.description,
          systemPrompt: result.systemPrompt,
          worldview: result.worldview,
          firstMes: result.firstMes,
          alternateGreetings: result.alternateGreetings.length > 0 ? result.alternateGreetings : undefined,
          mesExample: result.mesExample,
          memories: [],
          refinedMemories: {},
          activeMemoryMonths: [],
          mountedWorldbooks: result.mountedWorldbooks,
          regexScripts: result.regexScripts.length > 0 ? result.regexScripts : undefined,
          contextLimit: 500,
          emotionConfig: { enabled: true },
      };

      // 走 importCharacter 直接进 state，不再 window.location.reload() 整页重启
      await importCharacter(newChar);
      const wbSuffix = result.worldbooks.length > 0
          ? `，随卡剪报 ${result.worldbooks.length} 条进了剪报夹（挂上 ${result.mountedWorldbooks.length} 条）`
          : '';
      const regexSuffix = result.regexScripts.length > 0
          ? `，随卡正则 ${result.regexScripts.length} 条也收了`
          : '';
      addToast(`SillyTavern 角色 ${newChar.name} 已入册${wbSuffix}${regexSuffix}`, 'success');
  };

  const handleImportCard = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      (async () => {
          try {
              const isPng = file.type === 'image/png' || /\.png$/i.test(file.name);
              if (isPng) {
                  // SillyTavern PNG 卡：角色数据在 tEXt 元数据块里，图片本身作头像
                  const cardJson = extractCardJsonFromPng(await file.arrayBuffer());
                  const parsed = parseSillyTavernCard(cardJson);
                  if (!parsed) throw new Error('PNG 内的元数据不是可识别的 SillyTavern 角色卡');
                  let avatar = '';
                  try {
                      avatar = await processImage(file);
                  } catch (imgErr) {
                      console.warn('[ST Import] 头像处理失败，使用兜底头像', imgErr);
                  }
                  await importSillyTavernCard(parsed, avatar);
                  return;
              }

              const data = JSON.parse(await file.text());
              if (data?.type === 'moro_character_card') {
                  await importMoroCard(data as CharacterExportData);
                  return;
              }
              const parsed = parseSillyTavernCard(data);
              if (!parsed) throw new Error('无法识别的角色卡格式（支持 Moro 卡 JSON、SillyTavern 卡 PNG / JSON）');
              await importSillyTavernCard(parsed, '');
          } catch (err: any) {
              console.error(err);
              addToast(err.message || '导入失败', 'error');
          } finally {
              if (cardImportRef.current) cardImportRef.current.value = '';
          }
      })();
  };

  const importMoroCard = async (data: CharacterExportData) => {
      if (data.embeddedTheme) {
          const exists = customThemes.some(t => t.id === data.embeddedTheme!.id);
          if (!exists) {
              addCustomTheme(data.embeddedTheme);
          }
      }

      // Sync mounted worldbooks into the global worldbook app so they
      // appear under their original category (or the character's name
      // as a sensible fallback when the card has no category set).
      const incomingMounted = (data.mountedWorldbooks || []).map(wb => ({ ...wb }));
      const fallbackCategory = `${data.name || '导入角色'} 的世界书`;
      let importedWbCount = 0;
      for (const wb of incomingMounted) {
          if (!wb.id || worldbooks.some(existing => existing.id === wb.id)) continue;
          const category = wb.category && wb.category.trim() ? wb.category : fallbackCategory;
          wb.category = category;
          await addWorldbook({
              id: wb.id,
              title: wb.title || '未命名设定',
              content: wb.content || '',
              category,
              createdAt: Date.now(),
              updatedAt: Date.now(),
          });
          importedWbCount++;
      }

      const newChar: CharacterProfile = {
          ...data,
          id: `char-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          memories: [],
          refinedMemories: {},
          activeMemoryMonths: [],
          mountedWorldbooks: incomingMounted,
          embeddedTheme: undefined
      } as CharacterProfile;

      // 旧实现：DB.saveCharacter + addCharacter()「naive 刷新」+ reload —— 整页重启之外，
      // addCharacter() 还会额外创建一个空白 New Character 留在列表里。改走 importCharacter。
      await importCharacter(newChar);

      const wbToastSuffix = importedWbCount > 0 ? `，随帖收进 ${importedWbCount} 卷剪报` : '';
      addToast(`角色 ${newChar.name} 已入册${wbToastSuffix}`, 'success');
  };

  // ── 渲染 ────────────────────────────────────────────────
  const fieldLabel = (cn: string, en: string) => (
      <label className="label-mono text-[8px] text-[#1c1b1a]/45 mb-1.5 block">{cn} / {en}</label>
  );

  return (
    <div className="h-full w-full bg-[#f2f0e9] text-[#1c1b1a] relative" style={DOT_BG}>
       {view === 'list' ? (
           <div className="flex flex-col h-full animate-fade-in" style={{ paddingTop: 'var(--safe-top)' }}>
               {/* 刊头 */}
               <div className="relative shrink-0 px-4 pt-3 pb-3 border-b-2 border-dashed border-[#1c1b1a]/30">
                   <div className="flex items-center gap-3">
                       <button onClick={closeApp} className={`shrink-0 px-2.5 py-2 rotate-[-2deg] flex items-center gap-1 ${STICKER}`} title="合上名册">
                           <svg viewBox="0 0 24 24" fill="none" stroke={INK} strokeWidth={2.5} className="w-3.5 h-3.5">
                               <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
                           </svg>
                           <span className="text-[10px] font-black">合上</span>
                       </button>
                       <div className="flex-1 min-w-0 relative">
                           <Tape className="-top-4 left-8 rotate-[-5deg] w-12" />
                           <div className="label-mono text-[8px] text-[#1c1b1a]/45">CAST LIST — DRAMATIS PERSONAE</div>
                           <div className="flex items-baseline gap-2">
                               <h1 className="text-2xl font-black tracking-[0.08em]">登场人物</h1>
                               <span className="text-sm text-[#1c1b1a]/55 truncate" style={HAND_CN}>对面的人，名帖都收在这本册子里</span>
                           </div>
                       </div>
                       <div className="shrink-0 w-12 h-12 rounded-full border-2 border-dashed border-[#1c1b1a]/60 flex flex-col items-center justify-center rotate-[6deg] select-none">
                           <span className="text-base font-black leading-none">{characters.length}</span>
                           <span className="label-mono text-[7px] text-[#1c1b1a]/55 leading-none mt-0.5">位</span>
                       </div>
                   </div>
               </div>

               {/* 名册 */}
               <div className="flex-1 overflow-y-auto px-4 py-4 pb-20 no-scrollbar flex flex-col gap-3">
                   {characters.map((char, i) => (
                       <CharacterCard
                           key={char.id}
                           char={char}
                           tilt={i % 2 === 0 ? '-0.35deg' : '0.35deg'}
                           onClick={() => { setEditingId(char.id); setView('detail'); }}
                           onDelete={(e) => {
                               e.stopPropagation();
                               setDeleteConfirmTarget(char.id);
                           }}
                       />
                   ))}
                   {/* 添人 / 收名帖：虚线裁切卡（原顶栏入口移到列表末尾） */}
                   <div className="flex gap-3 shrink-0">
                       <button
                           onClick={addCharacter}
                           className="flex-1 py-4 border-2 border-dashed border-[#1c1b1a]/50 text-[#1c1b1a]/60 hover:border-[#1c1b1a] hover:text-[#1c1b1a] bg-white/40 transition-all active:scale-[0.98] flex items-center justify-center gap-1.5 rotate-[-0.3deg]"
                       >
                           <UserPlus size={15} weight="bold" />
                           <span className="text-[11px] font-black">添一位入册</span>
                       </button>
                       <button
                           onClick={() => cardImportRef.current?.click()}
                           className="flex-1 py-4 border-2 border-dashed border-[#1c1b1a]/50 text-[#1c1b1a]/60 hover:border-[#1c1b1a] hover:text-[#1c1b1a] bg-white/40 transition-all active:scale-[0.98] flex items-center justify-center gap-1.5 rotate-[0.3deg]"
                           title="收一张角色卡（Moro JSON / SillyTavern PNG·JSON）"
                       >
                           <TrayArrowDown size={15} weight="bold" />
                           <span className="text-[11px] font-black">收一张名帖</span>
                       </button>
                       <input type="file" ref={cardImportRef} className="hidden" accept=".json,.png,image/png,application/json" onChange={handleImportCard} />
                   </div>
                   {characters.length === 0 && (
                       <p className="text-center text-sm text-[#1c1b1a]/45 pt-2" style={HAND_CN}>
                           册子还空着——添一位，或把酒馆 / Moro 的角色卡收进来。
                       </p>
                   )}
               </div>
           </div>
       ) : formData && (
           <div className="flex flex-col h-full animate-fade-in relative" style={{ paddingTop: 'var(--safe-top)' }}>
               {/* 摊开名帖的页眉 */}
               <div className="relative shrink-0 px-4 pt-3 pb-0 border-b-2 border-dashed border-[#1c1b1a]/30 bg-[#f2f0e9]/95 z-40 sticky top-0" style={DOT_BG}>
                   <div className="flex items-center gap-3 mb-3">
                       <button onClick={handleBack} className={`shrink-0 px-2.5 py-2 rotate-[-2deg] flex items-center gap-1 ${STICKER}`}>
                           <svg viewBox="0 0 24 24" fill="none" stroke={INK} strokeWidth={2.5} className="w-3.5 h-3.5">
                               <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
                           </svg>
                           <span className="text-[10px] font-black">返回</span>
                       </button>
                       <div className="flex-1 min-w-0">
                           <div className="label-mono text-[8px] text-[#1c1b1a]/45">NOW READING</div>
                           <div className="text-sm font-black truncate">{formData.name || '（未署名的名帖）'}</div>
                       </div>
                       <button
                           onClick={() => { setActiveCharacterId(formData.id); openApp(AppID.Chat); }}
                           className={`shrink-0 px-3 py-2 text-[10px] font-black flex items-center gap-1.5 rotate-[1.5deg] ${INK_BTN}`}
                       >
                           <PaperPlaneTilt size={12} weight="bold" /> 去找 TA
                       </button>
                   </div>
                   {/* 卷宗签：底稿 / 往事 */}
                   <div className="flex gap-2 pl-1">
                       {([
                           ['identity', `底稿`, 'SCRIPT'],
                           ['memory', `往事 ${(formData.memories || []).length}`, 'MEMOIRS'],
                       ] as const).map(([tab, cn, en]) => (
                           <button
                               key={tab}
                               onClick={() => setDetailTab(tab)}
                               className={`px-4 pt-1.5 pb-2 border-2 border-b-0 border-[#1c1b1a] flex flex-col items-center transition-colors ${detailTab === tab ? 'bg-[#1c1b1a] text-[#f7f5ef]' : 'bg-white/70 text-[#1c1b1a]/55'}`}
                           >
                               <span className="label-mono text-[7px] opacity-60">{en}</span>
                               <span className="text-[11px] font-black leading-tight">{cn}</span>
                           </button>
                       ))}
                   </div>
               </div>

               <div className="flex-1 overflow-y-auto p-4 no-scrollbar pb-10">
                   {detailTab === 'identity' && (
                       <div className="space-y-6 animate-fade-in">
                           {/* 拍立得 + 名字 / 印象 / 图片链接 */}
                           <div className="flex items-start gap-4">
                               <div
                                   className="shrink-0 bg-white border-2 border-[#1c1b1a]/70 p-1.5 pb-4 rotate-[-2.5deg] shadow-[2px_2px_0_rgba(28,27,26,0.4)] cursor-pointer relative group"
                                   onClick={() => fileInputRef.current?.click()}
                                   title="揭下旧照，换一张"
                               >
                                   <img src={formData.avatar} className={`w-20 h-20 object-cover grayscale-[35%] contrast-105 group-hover:opacity-75 transition-opacity ${isCompressing ? 'opacity-50 blur-sm' : ''}`} alt="A" />
                                   <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 text-[10px] text-[#1c1b1a]/55 whitespace-nowrap" style={HAND_CN}>换张照片</span>
                                   <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleFileChange} />
                               </div>
                               <div className="flex-1 min-w-0 space-y-3">
                                   <div>
                                       <label className="label-mono text-[8px] text-[#1c1b1a]/45 block">名字 / NAME</label>
                                       <input value={formData.name} onChange={(e) => handleChange('name', e.target.value)} className="w-full bg-transparent border-b-2 border-[#1c1b1a] py-1 text-lg font-black outline-none focus:border-dashed" placeholder="TA 叫什么" />
                                   </div>
                                   <div>
                                       <label className="label-mono text-[8px] text-[#1c1b1a]/45 block">一句话印象 / TAGLINE</label>
                                       <input value={formData.description} onChange={(e) => handleChange('description', e.target.value)} className="w-full bg-transparent border-b border-dashed border-[#1c1b1a]/50 py-1 text-xs text-[#1c1b1a]/70 outline-none focus:border-[#1c1b1a]" placeholder="名册里露出的那一行小字" />
                                   </div>
                                   {/* 头像 URL 入口: 与左侧上传文件平级. 走 draft -> 失焦/回车 commit,
                                       避免逐字 commit 导致所有引用 char.avatar 的 <img> 在打字时疯狂
                                       请求不完整 URL. https URL 会作为 Instant Push 通知图标传到 worker;
                                       本地上传 (data URL) 仅本地显示, 不进 push payload (data: 被 0.6+ 拒). */}
                                   <input
                                       type="url"
                                       value={avatarUrlDraft}
                                       onChange={(e) => setAvatarUrlDraft(e.target.value)}
                                       onBlur={() => {
                                           const v = avatarUrlDraft.trim();
                                           // 空 draft 分两种情况:
                                           //  - 当前 avatar 是 https URL: 用户清空 = 想移除这个 URL, commit '' 让头像清空
                                           //  - 当前 avatar 是 data URL / emoji / 空: input 本就为空, 不动 (避免误清已上传的图)
                                           if (!v) {
                                               if (/^https?:\/\//i.test(formData.avatar || '')) {
                                                   handleChange('avatar', '');
                                                   addToast('图片链接撕掉了', 'info');
                                               }
                                               return;
                                           }
                                           try {
                                               const u = new URL(v);
                                               if (!/^https?:$/.test(u.protocol)) throw new Error();
                                           } catch {
                                               addToast('请填写有效的 http(s) 图片链接', 'error');
                                               return;
                                           }
                                           if (v !== formData.avatar) {
                                               handleChange('avatar', v);
                                               addToast('图片链接贴上了', 'success');
                                           }
                                       }}
                                       onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                                       placeholder="或贴一个图片链接（回车贴上）"
                                       className="w-full bg-transparent border-b border-dashed border-[#1c1b1a]/35 py-1 text-[11px] text-[#1c1b1a]/60 outline-none focus:border-[#1c1b1a] placeholder:text-[#1c1b1a]/25"
                                   />
                               </div>
                           </div>

                           <div>
                               {fieldLabel('性格底稿（核心指令）', 'SCRIPT')}
                               <textarea value={formData.systemPrompt} onChange={(e) => handleChange('systemPrompt', e.target.value)} className="w-full h-40 bg-white border-2 border-[#1c1b1a]/60 px-3 py-0 text-xs resize-none outline-none focus:border-[#1c1b1a]" style={RULED_BG} placeholder="TA 是个什么样的人，从这里写起…" />
                               <p className="text-[12px] text-[#1c1b1a]/55 mt-1.5 leading-relaxed" style={HAND_CN}>
                                   ✎ 支持酒馆宏：{'{{user}}'} / {'{{char}}'}（及 {'<user>'} / {'<char>'}）发送时自动替换为用户名 / 角色名。开着活字盘（预设）时，这份底稿对应字版里的 Char Description 占位。
                               </p>
                           </div>

                           <div>
                               {fieldLabel('TA 的世界（世界观补充）', 'WORLD')}
                               <textarea
                                    value={formData.worldview || ''}
                                    onChange={(e) => handleChange('worldview', e.target.value)}
                                    className="w-full h-24 bg-white border-2 border-[#1c1b1a]/60 px-3 py-0 text-xs resize-none outline-none focus:border-[#1c1b1a]"
                                    style={RULED_BG}
                                    placeholder="在这个世界里，魔法是存在的…"
                                />
                           </div>

                           {/* 生活侧写：帮 TA 更了解自己的生活速写（副 API 生成，可手动改） */}
                           <div>
                               <div className="flex items-center justify-between mb-1.5">
                                   {fieldLabel('生活侧写（TA 更懂自己）', 'LIFE SKETCH')}
                                   <button
                                       onClick={handleGenerateLifeProfile}
                                       disabled={isGeneratingLifeProfile}
                                       className={`px-2.5 py-1 text-[10px] font-black rotate-[1deg] disabled:opacity-60 ${formData.lifeProfile?.content ? STICKER : INK_BTN}`}
                                   >
                                       {isGeneratingLifeProfile ? '执笔中…' : (formData.lifeProfile?.content ? '↻ 重新写一份' : '✎ 写一份侧写')}
                                   </button>
                               </div>
                               <textarea
                                    value={formData.lifeProfile?.content || ''}
                                    onChange={(e) => handleChange('lifeProfile', { content: e.target.value, generatedAt: formData.lifeProfile?.generatedAt || Date.now(), edited: true })}
                                    className="w-full h-44 bg-white border-2 border-[#1c1b1a]/60 px-3 py-0 text-xs resize-none outline-none focus:border-[#1c1b1a]"
                                    style={RULED_BG}
                                    placeholder="点右上「写一份侧写」，让 TA 照着人设和记忆把自己写下来——日常节奏、习惯癖好、在意的事、和你相处的样子…（也可以直接手写）"
                                />
                               <p className="text-[12px] text-[#1c1b1a]/55 mt-1.5 leading-relaxed" style={HAND_CN}>
                                   ✎ 这份侧写会像「内在认知」一样垫进 TA 的设定里，帮 TA 更稳地"像自己"。用副 API 跑（没开就走主线），改完自动存。
                               </p>
                           </div>

                           {/* 对话示例（mes_example）—— SillyTavern 语义：说话风格示例，独立于角色描述。
                               未启用预设时作为「对话示例」块注入；启用预设时落在 dialogueExamples 占位 */}
                           <div>
                               {fieldLabel('台词样张（对话示例）', 'SAMPLE LINES')}
                               <textarea
                                    value={formData.mesExample || ''}
                                    onChange={(e) => handleChange('mesExample', e.target.value || undefined)}
                                    className="w-full h-32 bg-white border-2 border-[#1c1b1a]/60 px-3 py-0 text-xs resize-none outline-none focus:border-[#1c1b1a]"
                                    style={RULED_BG}
                                    placeholder={'<START>\n{{user}}: 在画什么？\n{{char}}: 在画云。'}
                                />
                               <p className="text-[12px] text-[#1c1b1a]/55 mt-1.5 leading-relaxed" style={HAND_CN}>
                                   ✎ TA 说话腔调的参考样张，不会和底稿混在一起。多段样张用 &lt;START&gt; 隔开（同酒馆惯例）；开着活字盘（预设）时对应 Chat Examples 占位。
                               </p>
                           </div>

                           {/* 开场白（first_mes）+ 备选开场白（alternate_greetings）—— SillyTavern 语义：
                               进入空聊天时左右切换选择其中一条作为角色的第一条消息，不进 systemPrompt */}
                           <div>
                               {fieldLabel('开场第一句', 'OPENER')}
                               <textarea
                                    value={formData.firstMes || ''}
                                    onChange={(e) => handleChange('firstMes', e.target.value)}
                                    className="w-full h-24 bg-white border-2 border-[#1c1b1a]/60 px-3 py-0 text-xs resize-none outline-none focus:border-[#1c1b1a]"
                                    style={RULED_BG}
                                    placeholder="新聊天里 TA 先开口的那句话（{{user}} / {{char}} 宏照常可用）…"
                                />
                               <p className="text-[12px] text-[#1c1b1a]/55 mt-1.5 leading-relaxed" style={HAND_CN}>
                                   ✎ 走进空聊天时，可以在这句和下面的备稿之间左右翻，挑一句开场（同酒馆的开场白 swipe）。留白就不出选择器。
                               </p>
                           </div>

                           <div>
                               <div className="flex items-center justify-between mb-1.5">
                                   <label className="label-mono text-[8px] text-[#1c1b1a]/45 block">备用开场 / SPARE OPENERS</label>
                                   <button
                                       onClick={() => handleChange('alternateGreetings', [...(formData.alternateGreetings || []), ''])}
                                       className={`px-2.5 py-1 text-[10px] font-black rotate-[1deg] ${STICKER}`}
                                   >＋ 再备一稿</button>
                               </div>
                               {(formData.alternateGreetings || []).length === 0 && (
                                   <p className="text-[12px] text-[#1c1b1a]/45 pl-1" style={HAND_CN}>还没有备稿。点「＋ 再备一稿」，给同一位 TA 多备几种开局。</p>
                               )}
                               <div className="space-y-3">
                                   {(formData.alternateGreetings || []).map((greeting, idx) => (
                                       <div key={idx} className="relative border-l-2 border-dashed border-[#1c1b1a]/40 pl-3">
                                           <div className="flex items-center justify-between mb-1">
                                               <span className="label-mono text-[8px] text-[#1c1b1a]/45">第 {idx + 1} 稿</span>
                                               <button
                                                   onClick={() => {
                                                       const next = (formData.alternateGreetings || []).filter((_, i) => i !== idx);
                                                       handleChange('alternateGreetings', next.length > 0 ? next : undefined);
                                                   }}
                                                   className="text-[10px] font-black text-[#1c1b1a]/50 hover:text-[#1c1b1a] px-1.5 line-through decoration-2"
                                                   title="撕掉这一稿"
                                               >撕掉</button>
                                           </div>
                                           <textarea
                                               value={greeting}
                                               onChange={(e) => {
                                                   const next = [...(formData.alternateGreetings || [])];
                                                   next[idx] = e.target.value;
                                                   handleChange('alternateGreetings', next);
                                               }}
                                               className="w-full h-20 bg-white border-2 border-[#1c1b1a]/60 px-3 py-0 text-xs resize-none outline-none focus:border-[#1c1b1a]"
                                               style={RULED_BG}
                                               placeholder={`备用开场第 ${idx + 1} 稿…`}
                                           />
                                       </div>
                                   ))}
                               </div>
                           </div>

                           {/* 嗓音唱片（MiniMax 音色） */}
                           <div className="relative bg-[#fbfaf6] border-2 border-[#1c1b1a] shadow-[4px_4px_0_#1c1b1a] p-4 space-y-3">
                               <Tape className="-top-2.5 left-6 rotate-[-4deg]" />
                               <div className="flex items-center justify-between flex-wrap gap-2">
                                   <label className="label-mono text-[8px] text-[#1c1b1a]/45 flex items-center gap-1"><VinylRecord size={12} weight="bold" /> 嗓音唱片（MINIMAX VOICE）</label>
                                   <div className="flex gap-2">
                                       <button
                                           onClick={() => { setActiveCharacterId(formData.id); openApp(AppID.VoiceDesigner); }}
                                           className={`px-2.5 py-1 text-[10px] font-black flex items-center gap-1 rotate-[-1deg] ${STICKER}`}
                                       >
                                           <Waveform size={11} weight="bold" /> 去捏嗓音
                                       </button>
                                       <button
                                           onClick={handleLoadMiniMaxVoices}
                                           className={`px-2.5 py-1 text-[10px] font-black rotate-[1deg] disabled:opacity-40 ${STICKER}`}
                                           disabled={isLoadingVoices}
                                       >
                                           {isLoadingVoices ? '翻柜中…' : '翻翻唱片柜'}
                                       </button>
                                   </div>
                               </div>
                               <p className="text-[12px] text-[#1c1b1a]/55 leading-relaxed" style={HAND_CN}>✎ 手里有 voice_id 就直接填，不用翻柜。配好后聊天和 TTS 都直接读这张唱片。</p>

                               <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                   <input
                                       value={formData.voiceProfile?.voiceId || ''}
                                       onChange={(e) => handleChange('voiceProfile', {
                                           provider: 'minimax',
                                           voiceId: e.target.value,
                                           voiceName: formData.voiceProfile?.voiceName || '',
                                           source: formData.voiceProfile?.source || 'custom',
                                           model: formData.voiceProfile?.model || 'speech-2.8-hd',
                                           notes: formData.voiceProfile?.notes || '',
                                       })}
                                       className="w-full bg-white border-2 border-[#1c1b1a]/50 px-3 py-2 text-xs outline-none focus:border-[#1c1b1a] placeholder:text-[#1c1b1a]/25"
                                       placeholder="voice_id（可直接贴）"
                                   />
                                   <input
                                       value={formData.voiceProfile?.model || 'speech-2.8-hd'}
                                       onChange={(e) => handleChange('voiceProfile', {
                                           provider: 'minimax',
                                           voiceId: formData.voiceProfile?.voiceId || '',
                                           voiceName: formData.voiceProfile?.voiceName || '',
                                           source: formData.voiceProfile?.source || 'custom',
                                           model: e.target.value,
                                           notes: formData.voiceProfile?.notes || '',
                                       })}
                                       className="w-full bg-white border-2 border-[#1c1b1a]/50 px-3 py-2 text-xs outline-none focus:border-[#1c1b1a] placeholder:text-[#1c1b1a]/25"
                                       placeholder="TTS 模型（默认 speech-2.8-hd）"
                                   />
                               </div>

                               {(voiceOptions.system.length + voiceOptions.voice_cloning.length + voiceOptions.voice_generation.length) > 0 && (
                                   <div className="space-y-2 pt-1">
                                       {([
                                           ['system', '柜里现货（系统音色）'],
                                           ['voice_cloning', '复刻盘（复刻音色）'],
                                           ['voice_generation', '文生盘（文生音色）'],
                                       ] as const).map(([source, label]) => {
                                           const list = voiceOptions[source];
                                           if (!list.length) return null;
                                           return (
                                               <div key={source}>
                                                   <div className="label-mono text-[8px] text-[#1c1b1a]/45 mb-1">{label}</div>
                                                   <div className="max-h-28 overflow-y-auto space-y-1 pr-1">
                                                       {list.slice(0, 50).map((v) => (
                                                           <button
                                                               key={`${source}-${v.voice_id}`}
                                                               onClick={() => applyVoiceToCharacter(v, source)}
                                                               className="w-full text-left px-2 py-1 text-xs border border-[#1c1b1a]/35 bg-white hover:border-[#1c1b1a] transition-colors"
                                                           >
                                                               <div className="font-black truncate">{v.voice_name || '未命名音色'}</div>
                                                               <div className="label-mono text-[8px] text-[#1c1b1a]/40 truncate">{v.voice_id}</div>
                                                           </button>
                                                       ))}
                                                   </div>
                                               </div>
                                           );
                                       })}
                                   </div>
                               )}
                           </div>

                           {/* 拓名帖（导出角色卡） */}
                           <div className="pt-2 pb-2">
                               <button
                                   onClick={handleExportCard}
                                   className={`w-full py-3.5 text-xs font-black flex items-center justify-center gap-2 rotate-[-0.3deg] ${INK_BTN}`}
                               >
                                   <TrayArrowUp size={15} weight="bold" />
                                   拓一份名帖带走（分享 / 导出）
                               </button>
                               <p className="text-[12px] text-[#1c1b1a]/45 text-center mt-2" style={HAND_CN}>拓出去的名帖不带往事和聊天记录。</p>
                           </div>
                       </div>
                   )}

                   {detailTab === 'memory' && (
                       <div className="space-y-4 animate-fade-in">
                           <div className="flex justify-center gap-2 mb-4 flex-wrap">
                               <button onClick={() => setShowBatchModal(true)} className={`px-3.5 py-2 text-[10px] font-black rotate-[-0.8deg] ${STICKER}`}>成批誊写（可指定日期）</button>
                               <button onClick={() => setShowImportModal(true)} className={`px-3.5 py-2 text-[10px] font-black rotate-[0.6deg] ${STICKER}`}>外稿清洗入册</button>
                               <button onClick={handleExportPreview} className={`px-3.5 py-2 text-[10px] font-black rotate-[-0.4deg] ${STICKER}`}>拓一份往事</button>
                           </div>
                           <MemoryArchivist
                               memories={formData.memories || []}
                               refinedMemories={formData.refinedMemories || {}}
                               activeMemoryMonths={formData.activeMemoryMonths || []}
                               charName={formData.name || ''}
                               userName={userProfile.name}
                               onRefine={handleRefineMonth}
                               onDeleteMemories={handleDeleteMemories}
                               onUpdateMemory={handleUpdateMemory}
                               onToggleActiveMonth={handleToggleActiveMonth}
                               onUpdateRefinedMemory={handleUpdateRefinedMemory}
                               onDeleteRefinedMemory={handleDeleteRefinedMemory}
                               onForceArchiveDate={handleForceArchiveDate}
                               forceArchiveTemplates={archivePrompts}
                               forceArchiveDefaultPromptId={selectedPromptId}
                           />
                       </div>
                   )}
               </div>
           </div>
       )}

       {/* ── 外稿清洗入册 ── */}
       <PaperSheet
           open={showImportModal}
           tag="LAUNDRY / 外稿清洗"
           title="把乱稿洗成日账"
           onClose={() => setShowImportModal(false)}
           footer={<>
               <button onClick={() => setShowImportModal(false)} className={`flex-1 py-2.5 text-xs font-black ${STICKER}`}>先不洗</button>
               <button onClick={handleImportMemories} disabled={isProcessingMemory} className={`flex-1 py-2.5 text-xs font-black flex items-center justify-center gap-2 disabled:opacity-60 ${INK_BTN}`}>
                   {isProcessingMemory && <div className="w-3.5 h-3.5 border-2 border-[#f7f5ef]/30 border-t-[#f7f5ef] rounded-full animate-spin"></div>}
                   {isProcessingMemory ? '清洗中…' : '开始清洗'}
               </button>
           </>}
       >
           <div className="space-y-3">
               <p className="text-[13px] text-[#1c1b1a]/55 leading-relaxed" style={HAND_CN}>把乱七八糟的旧文本贴进来，AI 会洗成一条条带日期的日账，自动归进往事栏。</p>
               {importStatus && <div className="text-xs font-black border-l-2 border-[#1c1b1a] pl-2">{importStatus}</div>}
               <textarea value={importText} onChange={e => setImportText(e.target.value)} placeholder="把原稿贴在这里…" className="w-full h-32 bg-white border-2 border-[#1c1b1a]/60 px-3 py-2 text-xs resize-none outline-none focus:border-[#1c1b1a] placeholder:text-[#1c1b1a]/25" />
           </div>
       </PaperSheet>

       {/* ── 成批誊写 ── */}
       <PaperSheet
           open={showBatchModal}
           tag="BATCH / 按天成批"
           title="成批誊写往事"
           onClose={() => { setShowBatchModal(false); setShowPromptEditor(false); }}
           footer={
               isBatchProcessing ? (
                   <div className="w-full py-2.5 border-2 border-dashed border-[#1c1b1a]/60 text-xs font-black text-center flex items-center justify-center gap-2">
                       <div className="w-3.5 h-3.5 border-2 border-[#1c1b1a] border-t-transparent rounded-full animate-spin"></div>
                       {batchProgress}
                   </div>
               ) : (
                   <button onClick={handleBatchSummarize} className={`w-full py-2.5 text-xs font-black ${INK_BTN}`}>开始誊写</button>
               )
           }
       >
           <div className="space-y-3">
               <p className="text-[13px] text-[#1c1b1a]/55 leading-relaxed" style={HAND_CN}>翻遍全部聊天记录，按天用选好的口吻把往事誊进册子。</p>
               {/* Prompt Selection */}
               <div className="border-2 border-dashed border-[#1c1b1a]/40 p-3">
                   <label className="label-mono text-[8px] text-[#1c1b1a]/45 mb-2 block">挑一种誊写口吻</label>
                   <div className="flex flex-col gap-2">
                       {archivePrompts.map(p => (
                           <div key={p.id} onClick={() => { setSelectedPromptId(p.id); localStorage.setItem('chat_active_archive_prompt_id', p.id); }} className={`px-3 py-2 border-2 cursor-pointer flex items-center justify-between transition-colors ${selectedPromptId === p.id ? 'border-[#1c1b1a] bg-white shadow-[2px_2px_0_#1c1b1a]' : 'border-[#1c1b1a]/30 bg-white/60'}`}>
                               <span className="text-xs font-black">{selectedPromptId === p.id ? '◉ ' : '○ '}{p.name}</span>
                               <div className="flex gap-1.5">
                                   <button onClick={(e) => { e.stopPropagation(); setEditingPrompt(p); setShowPromptEditor(true); }} className="label-mono text-[8px] px-2 py-0.5 border border-[#1c1b1a]/40 hover:border-[#1c1b1a]">翻开</button>
                                   {!p.id.startsWith('preset_') && (
                                       <button onClick={(e) => { e.stopPropagation(); const next = archivePrompts.filter(ap => ap.id !== p.id); setArchivePrompts(next); localStorage.setItem('chat_archive_prompts', JSON.stringify(next.filter(ap => !ap.id.startsWith('preset_')))); if (selectedPromptId === p.id) setSelectedPromptId('preset_rational'); }} className="label-mono text-[8px] px-1.5 py-0.5 border border-[#1c1b1a]/40 hover:border-[#1c1b1a] line-through">撕</button>
                                   )}
                               </div>
                           </div>
                       ))}
                   </div>
                   <button onClick={() => { const newP = { id: `custom_${Date.now()}`, name: '新自定义口吻', content: DEFAULT_ARCHIVE_PROMPTS[0].content }; setEditingPrompt(newP); setShowPromptEditor(true); }} className="mt-2 w-full py-1.5 text-[10px] font-black border-2 border-dashed border-[#1c1b1a]/50 hover:border-[#1c1b1a] transition-colors">＋ 写一种自己的口吻</button>
               </div>
               {/* Date Range */}
               <div className="flex gap-2">
                   <div className="flex-1"><label className="label-mono text-[8px] text-[#1c1b1a]/45 block mb-1">从哪天起（可选）</label><input type="date" value={batchRange.start} onChange={e => setBatchRange({...batchRange, start: e.target.value})} className="w-full bg-white border-2 border-[#1c1b1a]/50 px-3 py-2 text-xs outline-none focus:border-[#1c1b1a]" /></div>
                   <div className="flex-1"><label className="label-mono text-[8px] text-[#1c1b1a]/45 block mb-1">到哪天止（可选）</label><input type="date" value={batchRange.end} onChange={e => setBatchRange({...batchRange, end: e.target.value})} className="w-full bg-white border-2 border-[#1c1b1a]/50 px-3 py-2 text-xs outline-none focus:border-[#1c1b1a]" /></div>
               </div>
               <div className="text-[10px] text-[#1c1b1a]/55 border border-dashed border-[#1c1b1a]/40 p-2.5 leading-relaxed">
                   口吻里可用的变量: <code>{'${dateStr}'}</code>, <code>{'${char.name}'}</code>, <code>{'${userProfile.name}'}</code>, <code>{'${rawLog}'}</code>
               </div>
           </div>
       </PaperSheet>

       {/* ── 口吻编辑 ── */}
       <PaperSheet
           open={showPromptEditor}
           tag="TONE / 誊写口吻"
           title={editingPrompt?.id.startsWith('preset_') ? '翻看这种口吻' : '修这种口吻'}
           onClose={() => setShowPromptEditor(false)}
           footer={!editingPrompt?.id.startsWith('preset_') ? (
               <button onClick={() => {
                   if (!editingPrompt) return;
                   const isNew = !archivePrompts.some(p => p.id === editingPrompt.id);
                   const next = isNew ? [...archivePrompts, editingPrompt] : archivePrompts.map(p => p.id === editingPrompt.id ? editingPrompt : p);
                   setArchivePrompts(next);
                   setSelectedPromptId(editingPrompt.id);
                   localStorage.setItem('chat_archive_prompts', JSON.stringify(next.filter(p => !p.id.startsWith('preset_'))));
                   localStorage.setItem('chat_active_archive_prompt_id', editingPrompt.id);
                   setShowPromptEditor(false);
                   addToast('这种口吻记下了', 'success');
               }} className={`w-full py-2.5 text-xs font-black ${INK_BTN}`}>记下来</button>
           ) : (
               <button onClick={() => {
                   if (!editingPrompt) return;
                   const isNew = !archivePrompts.some(p => p.id === editingPrompt.id);
                   const next = isNew ? [...archivePrompts, editingPrompt] : archivePrompts.map(p => p.id === editingPrompt.id ? editingPrompt : p);
                   setArchivePrompts(next);
                   setSelectedPromptId(editingPrompt.id);
                   localStorage.setItem('chat_archive_prompts', JSON.stringify(next.filter(p => !p.id.startsWith('preset_'))));
                   localStorage.setItem('chat_active_archive_prompt_id', editingPrompt.id);
                   setShowPromptEditor(false);
                   addToast('这种口吻记下了', 'success');
               }} className={`w-full py-2.5 text-xs font-black ${INK_BTN}`}>就用这种</button>
           )}
       >
           <div className="space-y-3">
               <input
                   value={editingPrompt?.name || ''}
                   onChange={e => setEditingPrompt(prev => prev ? {...prev, name: e.target.value} : null)}
                   placeholder="口吻名字"
                   className="w-full bg-transparent border-b-2 border-[#1c1b1a] py-1.5 text-sm font-black outline-none focus:border-dashed read-only:border-[#1c1b1a]/30 read-only:text-[#1c1b1a]/55"
                   readOnly={editingPrompt?.id.startsWith('preset_')}
               />
               <textarea
                   value={editingPrompt?.content || ''}
                   onChange={e => setEditingPrompt(prev => prev ? {...prev, content: e.target.value} : null)}
                   className="w-full h-64 bg-white border-2 border-[#1c1b1a]/60 p-3 text-xs font-mono resize-none outline-none focus:border-[#1c1b1a] leading-relaxed read-only:border-[#1c1b1a]/30 read-only:text-[#1c1b1a]/55"
                   placeholder="把誊写口吻写在这里…"
                   readOnly={editingPrompt?.id.startsWith('preset_')}
               />
               {editingPrompt?.id.startsWith('preset_') && (
                   <p className="text-[12px] text-[#1c1b1a]/45 text-center" style={HAND_CN}>自带的口吻只能翻看，改不了。</p>
               )}
           </div>
       </PaperSheet>

       {/* ── 拓往事（文本导出） ── */}
       <PaperSheet
           open={showExportModal}
           tag="RUBBING / 拓本"
           title="往事拓本"
           onClose={() => setShowExportModal(false)}
           footer={<div className="flex gap-2 w-full">
               <button onClick={() => { navigator.clipboard.writeText(exportText); addToast('抄好了', 'success'); }} className={`flex-1 py-2.5 text-xs font-black ${STICKER}`}>抄全文</button>
               {Capacitor.isNativePlatform() ? (
                   <button onClick={handleNativeShare} className={`flex-1 py-2.5 text-xs font-black flex items-center justify-center gap-1.5 ${INK_BTN}`}>
                       <TrayArrowUp size={13} weight="bold" />递出去
                   </button>
               ) : (
                   <button onClick={handleWebFileDownload} className={`flex-1 py-2.5 text-xs font-black flex items-center justify-center gap-1.5 ${INK_BTN}`}>
                       <TrayArrowDown size={13} weight="bold" />存成文件
                   </button>
               )}
           </div>}
       >
           <div className="border-2 border-dashed border-[#1c1b1a]/40 p-3 space-y-2">
               <div className="text-[12px] text-[#1c1b1a]/55" style={HAND_CN}>全文已自动抄进剪贴板；递不出去就直接手动抄。</div>
               <textarea value={exportText} readOnly className="w-full h-40 bg-transparent border-none text-[10px] font-mono text-[#1c1b1a]/70 resize-none focus:ring-0 leading-relaxed select-all" onClick={(e) => e.currentTarget.select()} />
           </div>
       </PaperSheet>

       {/* ── 送离确认 ── */}
       <PaperSheet
           open={!!deleteConfirmTarget}
           tag="EXIT STAGE / 不可复原"
           title="送 TA 离场？"
           onClose={() => setDeleteConfirmTarget(null)}
           footer={<div className="flex gap-2 w-full">
               <button onClick={() => setDeleteConfirmTarget(null)} className={`flex-1 py-2.5 text-xs font-black ${STICKER}`}>还是留着</button>
               <button onClick={confirmDeleteCharacter} className={`flex-1 py-2.5 text-xs font-black ${INK_BTN}`}>送离！</button>
           </div>}
       >
           <p className="text-sm text-[#1c1b1a]/70 text-center leading-relaxed py-2">
               这一撕，TA 的名帖、往事和这段关系都没了。<br />
               <span className="text-xs font-black">撕下去就拼不回来了。</span>
           </p>
       </PaperSheet>
    </div>
  );
};
export default Character;
