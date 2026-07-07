/**
 * 登场人物：角色资料管理。
 * 功能与旧版一致：ST/Moro 卡导入导出、头像上传/URL、音色、批量总结、
 * 旧文本导入、月度核心记忆生成、深链接返回等逻辑原样保留。
 */
import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useOS } from '../context/OSContext';
import { AppID, CharacterProfile, CharacterExportData, MemoryFragment, Worldbook } from '../types';
import {
    Waveform, VinylRecord, UserPlus, TrayArrowDown, TrayArrowUp, PaperPlaneTilt, X, Binoculars,
} from '@phosphor-icons/react';
import { processImage } from '../utils/file';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { DB } from '../utils/db';
import { formatMessageWithTime } from '../utils/messageFormat';
import { DEFAULT_ARCHIVE_PROMPTS } from '../components/chat/ChatConstants';
import MemoryArchivist from '../components/character/MemoryArchivist';
import { extractContent } from '../utils/safeApi';
import { fetchMiniMaxVoices, MiniMaxVoiceItem } from '../utils/minimaxVoice';
import { resolveMiniMaxApiKey } from '../utils/minimaxApiKey';
import { injectMemoryPalace } from '../utils/memoryPalace/pipeline';
import { generateLifeProfile } from '../utils/lifeProfile';
import { generateAppearanceTags } from '../utils/appearanceTags';
import { resolveAuxApi } from '../utils/auxApi';
import { extractCardJsonFromPng, parseSillyTavernCard, convertSTCardToCharacter, ParsedSTCard } from '../utils/sillyTavernCard';
import { buildCharacterCardExportData, stripCharacterCardPrivateFields } from '../utils/characterCardExport';
import { createCharacterId } from '../utils/characterIdentity';
import { applyCharacterEditorMacros } from '../utils/characterEditorMacros';
import { scrollToManualAnchor } from '../utils/manualDeepLink';
import { PAPER_TONES, MONO_STACK } from '../components/handbook/paper';
import { callChatCompletion } from '../utils/llmClient';
import { makeApiUsageMeta } from '../utils/apiUsageCatalog';
import { buildFullCharacterSetting, buildFullActiveUserSetting } from '../utils/characterPromptProfile';

// ── 剪影集专属胶片资料册色板：冷雾白 + 鼠尾草绿 + 胶片灰 ──
const INK = '#2f3432';
const ROSE = '#6f8f82';
const ROSE_DARK = '#405f56';
const BORDER = '#dfe7e1';
const CARD_SHADOW = '0 1px 2px rgba(47,64,60,0.08), 0 14px 30px -24px rgba(47,64,60,0.34)';
const STICKER = 'border border-[#dfe7e1] rounded-full bg-[#fbfcf8] text-[#405f56] shadow-[0_1px_2px_rgba(47,64,60,0.10)] press-soft';
const INK_BTN = 'bg-[#6f8f82] text-white border border-[#dfe7e1] rounded-full shadow-[0_8px_16px_-12px_rgba(47,64,60,0.44)] press-soft';
const DOT_BG: React.CSSProperties = {
    background: '#f5f7f4',
};
const LINE_INPUT = 'w-full px-3 py-2 text-[13px] outline-none rounded-[14px] bg-[#fbfcf8] border border-[#dfe7e1] text-[#2f3432] placeholder:text-[#9baaa4] focus:border-[#6f8f82]';
const AREA_INPUT = 'w-full bg-white border border-[#dfe7e1] rounded-[14px] px-3 py-2 text-xs resize-none outline-none focus:border-[#6f8f82] placeholder:text-[#9baaa4]';
const NOTE_TEXT = { color: PAPER_TONES.inkSoft };

const isGeneratedLetterAvatar = (src?: string) => {
    if (!src?.startsWith('data:image/svg+xml')) return false;
    let decoded = src;
    try { decoded = decodeURIComponent(src); } catch {}
    return decoded.includes('<text') && decoded.includes('font-size="50"');
};

const usablePhoto = (src?: string) => (src && !isGeneratedLetterAvatar(src) ? src : '');

const CharacterPlaceholder: React.FC = () => (
    <div className="w-full h-full flex items-center justify-center bg-[#eef5ef]">
        <div className="w-[68%] h-[72%] rounded-[14px] border" style={{ borderColor: '#d5e1da', background: 'rgba(255,255,255,0.30)' }} />
    </div>
);

const MiniPhotoAction: React.FC<{ type: 'new' | 'import' }> = ({ type }) => (
    <div className="relative w-9 h-9 shrink-0">
        <div className="absolute left-1 top-1 w-7 h-8 rounded-[6px] bg-white border rotate-[-8deg]" style={{ borderColor: BORDER }} />
        <div className="absolute left-3 top-0 w-7 h-8 rounded-[6px] bg-[#eef5ef] border rotate-[6deg] flex items-center justify-center" style={{ borderColor: BORDER }}>
            {type === 'new' ? <UserPlus size={13} weight="bold" color={ROSE_DARK} /> : <TrayArrowDown size={13} weight="bold" color={ROSE_DARK} />}
        </div>
    </div>
);

/** 浅色设置弹层：使用剪影集资料册卡片语言 */
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
            <div className="absolute inset-0 bg-[#1f2a27]/28 backdrop-blur-[2px]" onClick={onClose} />
            <div className="relative w-full max-w-sm bg-white border border-[#e6ece8] rounded-[18px] animate-slide-up" style={{ boxShadow: CARD_SHADOW }}>
                <button
                    onClick={onClose}
                    className={`absolute -top-3 -right-3 w-8 h-8 flex items-center justify-center ${STICKER}`}
                    aria-label="关闭"
                >
                    <X size={14} weight="bold" color={INK} />
                </button>
                <div className="px-5 pt-6 pb-2">
                    <div className="text-[9px] tracking-[0.18em] uppercase" style={{ ...MONO_STACK, color: PAPER_TONES.inkFaint }}>{tag}</div>
                    <h3 className="text-lg font-black mt-0.5" style={{ color: INK }}>{title}</h3>
                    <div className="h-[3px] w-14 rounded-full mt-1.5" style={{ background: ROSE }} />
                </div>
                <div className="px-5 py-3 max-h-[58vh] overflow-y-auto no-scrollbar">{children}</div>
                {footer && <div className="px-5 pb-5 pt-2 flex gap-3">{footer}</div>}
            </div>
        </div>
    );
};

/** 角色照片卡：点击对应拍立得进入该角色资料 */
const CharacterCard: React.FC<{
    char: CharacterProfile;
    onClick: () => void;
    onDelete: (e: React.MouseEvent) => void;
}> = ({ char, onClick, onDelete }) => {
    const photo = usablePhoto(char.avatar);
    return (
        <button
            onClick={onClick}
            className="relative bg-white border rounded-[16px] p-2 pb-3 text-left transition-all active:scale-[0.98] hover:border-[#6f8f82]"
            style={{ borderColor: '#e6ece8', boxShadow: CARD_SHADOW }}
        >
            <div className="aspect-[4/5] rounded-[11px] overflow-hidden bg-[#eef5ef]">
                {photo ? <img src={photo} className="w-full h-full object-cover" alt={char.name} /> : <CharacterPlaceholder />}
            </div>
            <div className="pt-2 min-w-0">
                <div className="flex items-start justify-between gap-2">
                    <h3 className="text-sm font-black truncate" style={{ color: INK }}>{char.name}</h3>
                    <span className="text-[8px] rounded-full px-1.5 py-0.5 shrink-0" style={{ ...MONO_STACK, color: ROSE_DARK, background: '#eef5ef', border: `1px solid ${BORDER}` }}>{(char.memories || []).length}</span>
                </div>
                <p className="text-[11px] truncate mt-0.5" style={{ color: PAPER_TONES.inkSoft }}>
                    {char.description || '暂无列表备注'}
                </p>
            </div>
            <button
                onClick={onDelete}
                className="absolute top-3 right-3 p-1.5 rounded-full bg-white/88 text-[#8da099] hover:text-[#405f56] active:scale-90 transition-all"
                style={{ border: `1px solid ${BORDER}` }}
                title="删除角色"
            >
                <X size={12} weight="bold" />
            </button>
        </button>
    );
};

/** onExit：剪影集（PersonaHubApp）嵌入时返回封面页；不传则关闭 App 回桌面（旧行为） */
const Character: React.FC<{ onExit?: () => void; manualTarget?: { anchorId?: string; nonce: number } }> = ({ onExit, manualTarget }) => {
  const { closeApp: closeAppOS, openApp, characters, activeCharacterId, setActiveCharacterId, addCharacter, importCharacter, updateCharacter, deleteCharacter, apiConfig, auxApiConfig, addToast, userProfile, customThemes, addCustomTheme, worldbooks, addWorldbook, worldbookGroupSettings } = useOS();
  // 角色卡生成/润色/导入属「聊天以外」的功能：走副 API（未配置副 API 时回退主 API）
  const auxApi = { ...apiConfig, ...resolveAuxApi(auxApiConfig, apiConfig) };
  const [isGeneratingLifeProfile, setIsGeneratingLifeProfile] = useState(false);
  const [isGeneratingTags, setIsGeneratingTags] = useState(false);
  const closeApp = onExit || closeAppOS;
  const [view, setView] = useState<'list' | 'detail'>('list');
  const [detailTab, setDetailTab] = useState<'identity' | 'memory'>('identity');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<CharacterProfile | null>(null);
  const [search, setSearch] = useState('');
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
          addToast(`音色列表已加载：系统 ${result.system_voice.length} / 复刻 ${result.voice_cloning.length} / 文生 ${result.voice_generation.length}`, 'success');
      } catch (e: any) {
          console.error('[MiniMax Voice] load failed', e);
          addToast(e?.message || 'MiniMax 音色列表加载失败', 'error');
      } finally {
          setIsLoadingVoices(false);
      }
  };

  const visibleCharacters = useMemo(() => {
      const q = search.trim().toLowerCase();
      if (!q) return characters;
      return characters.filter(char => {
          const blob = [
              char.name,
              char.description,
              char.systemPrompt,
              char.worldview,
              char.appearanceTags,
          ].filter(Boolean).join('\n').toLowerCase();
          return blob.includes(q);
      });
  }, [characters, search]);

  useEffect(() => {
      if (!manualTarget) return;
      const anchorId = manualTarget.anchorId;
      const fallback = 'manual-personas-characters';

      if (anchorId === 'manual-personas-character-export' && view === 'list') {
          const targetId = activeCharacterId && characters.some(c => c.id === activeCharacterId)
              ? activeCharacterId
              : characters[0]?.id;
          if (targetId) {
              setEditingId(targetId);
              setView('detail');
              setDetailTab('identity');
              return;
          }
      }

      if (anchorId === 'manual-personas-character-export' && view === 'detail' && !formData) return;

      const timeout = window.setTimeout(() => {
          if (!scrollToManualAnchor(anchorId)) scrollToManualAnchor(fallback);
      }, 260);
      return () => window.clearTimeout(timeout);
  }, [manualTarget?.nonce, manualTarget?.anchorId, view, activeCharacterId, characters, formData]);

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
      addToast(`音色已应用：${voice.voice_name || voice.voice_id}`, 'success');
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
          const nextValue = applyCharacterEditorMacros(field, value, prev, userProfile);
          return { ...prev, [field]: nextValue };
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

  // 外貌 Tag：从人设 + 角色绑定（已挂载）的世界书生成 booru 风格英文外貌标签（副 API）。
  const handleGenerateAppearanceTags = async () => {
      if (!formData) return;
      const api = resolveAuxApi(auxApiConfig, apiConfig);
      if (!api.baseUrl || !api.model) { addToast('请先在「文具盒」配置 API（主线或副线）', 'error'); return; }
      setIsGeneratingTags(true);
      try {
          const tags = await generateAppearanceTags(formData, api);
          if (!tags) { addToast('没提炼出标签，待会儿再试试', 'error'); return; }
          handleChange('appearanceTags', tags);
          addToast('外貌 Tag 生成好了', 'success');
      } catch (e: any) {
          console.warn('[AppearanceTags] generate failed:', e?.message || e);
          addToast('生成失败了，待会儿再试试', 'error');
      } finally {
          setIsGeneratingTags(false);
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
      if (!auxApi.baseUrl || !auxApi.model) { addToast('请先配置 API', 'error'); return; }
      if (!formData) return;

      const targetId = formData.id; // LOCK ID

      const identityContext = [
          buildFullCharacterSetting(formData, { includeMemos: true }),
          await buildFullActiveUserSetting(userProfile),
      ].join('\n\n') + '\n\n';

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

      const t0 = performance.now();
      try {
          const data = await callChatCompletion(auxApi, {
              model: auxApi.model,
              messages: [
                  { role: 'system', content: systemContent },
                  { role: 'user', content: userContent },
              ],
              temperature: 0.3,
              stream: false,
          }, {
              meta: makeApiUsageMeta('character.memoryArchive', {
                  charId: targetId,
                  charName: formData.name,
                  apiRole: auxApi.apiRole || 'aux',
                  apiBinding: auxApi.apiBinding || '月度核心记忆',
              }),
          });
          const dt = Math.round(performance.now() - t0);
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
              addToast(`${year} 年 ${month} 月核心记忆已生成`, 'success');
          } else {
              // Switched page - Save to DB directly
              const currentRefined = characters.find(c => c.id === targetId)?.refinedMemories || {};
              updateCharacter(targetId, { refinedMemories: { ...currentRefined, [key]: summary } });
              addToast('后台生成完成：核心记忆已保存到角色', 'success');
          }
      } catch (e: any) { addToast(`凝缩失败: ${e.message}`, 'error'); }
  };

  const handleDeleteMemories = (ids: string[]) => { if (!formData) return; handleChange('memories', (formData.memories || []).filter(m => !ids.includes(m.id))); addToast(`已删除 ${ids.length} 条记忆`, 'success'); };
  const handleUpdateMemory = (id: string, newSummary: string) => { if (!formData) return; handleChange('memories', (formData.memories || []).map(m => m.id === id ? { ...m, summary: newSummary } : m)); addToast('记忆内容已更新', 'success'); };

  /**
   * 按指定日期强制重新总结：读原始聊天记录（忽略 hideBeforeMessageId），LLM 总结，
   * upsert 同日期的 'archive' MemoryFragment（'palace' 自动归档的不动，保持并存）。
   * 这是自动化的兜底路径：即使 4.5 已经被 palace 处理+隐藏，用户依然能让 AI
   * 重新阅读 4.5 原始聊天做一版手动总结。
   */
  /**
   * @param overridePromptId 用户在 MemoryArchivist 的重总结弹窗里现场选的模板 id；
   *                        没提供则退回到当前 selectedPromptId
   */
  const handleForceArchiveDate = async (dateStr: string, overridePromptId?: string): Promise<void> => {
      if (!auxApi.baseUrl || !auxApi.model || !formData) { addToast('请先配置 API', 'error'); return; }
      const targetId = formData.id;
      try {
          const allMsgs = await DB.getMessagesByCharId(targetId, true);
          // 忽略 hideBeforeMessageId —— 这是强制重总结的关键
          const dayMsgs = allMsgs.filter(m => {
              const d = new Date(m.timestamp);
              const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
              return key === dateStr;
          });
          if (dayMsgs.length === 0) { addToast(`${dateStr} 没有可生成记忆的消息`, 'info'); return; }

          const timeFmt = (ts: number) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
          const rawLog = dayMsgs
              .map(m => formatMessageWithTime(m, formData.name, userProfile.name, timeFmt))
              .join('\n');

          // 模板优先级：override（弹窗现场选）→ 当前 state → 默认 preset
          const effectivePromptId = overridePromptId || selectedPromptId;
          const templateObj = archivePrompts.find(p => p.id === effectivePromptId) || DEFAULT_ARCHIVE_PROMPTS[0];
          const baseContext = [
              buildFullCharacterSetting(formData, { includeMemos: true }),
              await buildFullActiveUserSetting(userProfile),
          ].join('\n\n');
          let prompt = baseContext + '\n\n' + templateObj.content;
          prompt = prompt.replace(/\$\{dateStr\}/g, dateStr);
          prompt = prompt.replace(/\$\{char\.name\}/g, formData.name);
          prompt = prompt.replace(/\$\{userProfile\.name\}/g, userProfile.name);
          prompt = prompt.replace(/\$\{rawLog.*?\}/g, rawLog.substring(0, 200000));

          const data = await callChatCompletion(auxApi, {
              model: auxApi.model,
              messages: [{ role: 'user', content: prompt }],
              temperature: 0.5,
              max_tokens: 8000,
              stream: false,
          }, {
              meta: makeApiUsageMeta('character.memoryArchive', {
                  charId: targetId,
                  charName: formData.name,
                  apiRole: auxApi.apiRole || 'aux',
                  apiBinding: auxApi.apiBinding || '单日记忆重总结',
              }),
          });
          let summary = (extractContent(data) || '').trim().replace(/^["']|["']$/g, '');
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
          addToast(`${dateStr} 的记忆已重新生成`, 'success');
      } catch (e: any) {
          addToast(`重新生成失败: ${e.message || '未知错误'}`, 'error');
      }
  };

  // NEW: Core Memory Handlers
  const handleUpdateRefinedMemory = (year: string, month: string, newContent: string) => {
      if (!formData) return;
      const key = `${year}-${month}`;
      handleChange('refinedMemories', { ...(formData.refinedMemories || {}), [key]: newContent });
      addToast('核心记忆已更新', 'success');
  };

  const handleDeleteRefinedMemory = (year: string, month: string) => {
      if (!formData || !formData.refinedMemories) return;
      const key = `${year}-${month}`;
      const newRefined = { ...formData.refinedMemories };
      delete newRefined[key];
      handleChange('refinedMemories', newRefined);
      addToast('核心记忆已删除', 'success');
  };

  const handleExportPreview = () => { if (!formData) return; const mems = formData.memories as any[]; if (!mems || mems.length === 0) { addToast('暂无可导出的记忆', 'info'); return; } const sortedMemories = [...mems].sort((a, b) => a.date.localeCompare(b.date)); let text = `【角色档案】\nName: ${formData.name}\nExported: ${new Date().toLocaleString()}\n\n`; if (formData.refinedMemories) { text += `=== 核心记忆 ===\n`; Object.entries(formData.refinedMemories).sort().forEach(([k, v]) => { text += `[${k}]: ${v}\n`; }); text += `\n=== 详细日志 ===\n`; } let currentYear = '', currentMonth = ''; sortedMemories.forEach(mem => { const match = mem.date.match(/(\d{4})[-/年](\d{1,2})/); if (match) { const y = match[1], m = match[2]; if (y !== currentYear) { text += `\n[ ${y}年 ]\n`; currentYear = y; currentMonth = ''; } if (m !== currentMonth) { text += `\n-- ${parseInt(m)}月 --\n\n`; currentMonth = m; } } text += `${mem.date} ${mem.mood ? `(#${mem.mood})` : ''}\n${mem.summary}\n\n--------------------------\n\n`; }); setExportText(text); setShowExportModal(true); navigator.clipboard.writeText(text).then(() => addToast('记忆文本已复制到剪贴板', 'info')).catch(() => {}); };
  const handleNativeShare = async () => { if(!exportText) return; if (Capacitor.isNativePlatform()) { try { const fileName = `${formData?.name || 'character'}_memories.txt`; await Filesystem.writeFile({ path: fileName, data: exportText, directory: Directory.Cache, encoding: Encoding.UTF8 }); const uri = await Filesystem.getUri({ directory: Directory.Cache, path: fileName }); await Share.share({ title: '记忆档案', files: [uri.uri] }); } catch(e: any) { console.error("Native share failed", e); addToast('分享组件调起失败，请直接复制文本', 'error'); } } };
  const handleWebFileDownload = () => { const fileName = `${formData?.name || 'character'}_memories.txt`; const blob = new Blob([exportText], { type: 'text/plain' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = fileName; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url); addToast('浏览器开始下载了', 'success'); };

  const handleImportMemories = async () => {
      if (!importText.trim() || !auxApi.baseUrl || !auxApi.model) { addToast('请检查输入内容或 API 设置', 'error'); return; }
      if (!formData) return;

      const targetId = formData.id; // LOCK ID
      setIsProcessingMemory(true);
      setImportStatus('正在分析旧文本，请稍等…');

      try {
          const prompt = `Task: Convert this text log into a JSON array. Format: [{ "date": "YYYY-MM-DD", "summary": "...", "mood": "..." }] Text: ${importText.substring(0, 8000)}`;
          const data = await callChatCompletion(auxApi, {
              model: auxApi.model,
              messages: [{ role: "user", content: prompt }],
              temperature: 0.1,
              stream: false,
          }, {
              meta: makeApiUsageMeta('character.importParse', {
                  charId: targetId,
                  charName: formData.name,
                  apiRole: auxApi.apiRole || 'aux',
                  apiBinding: auxApi.apiBinding || '旧文本导入',
              }),
          });
          let content = extractContent(data) || '';
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
                  addToast(`${newMems.length} 条记忆已导入`, 'success');
              } else {
                  // Background update
                  const currentMems = characters.find(c => c.id === targetId)?.memories || [];
                  updateCharacter(targetId, { memories: [...currentMems, ...newMems] });
                  addToast('后台导入完成：记忆已保存到角色', 'success');
              }
          } else { throw new Error('结构错误'); }
      } catch (e: any) { setImportStatus(`错误: ${e.message || '未知错误'}`); addToast('旧文本导入失败', 'error'); } finally { setIsProcessingMemory(false); }
  };

  const handleBatchSummarize = async () => {
        if (!auxApi.baseUrl || !auxApi.model || !formData) return;

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
            const baseContext = [
                buildFullCharacterSetting(formData, { includeMemos: true }),
                await buildFullActiveUserSetting(userProfile),
            ].join('\n\n');

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

                try {
                    const data = await callChatCompletion(auxApi, {
                        model: auxApi.model,
                        messages: [{ role: "user", content: prompt }],
                        max_tokens: 8000,
                        temperature: 0.5,
                        stream: false,
                    }, {
                        meta: makeApiUsageMeta('character.memoryArchive', {
                            charId: targetId,
                            charName: formData.name,
                            apiRole: auxApi.apiRole || 'aux',
                            apiBinding: auxApi.apiBinding || '批量记忆总结',
                        }),
                    });
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
                } catch (e) {
                    console.warn(`[Character] batch summarize failed for ${date}:`, e);
                }
                await new Promise(r => setTimeout(r, 500));
            }

            const totalDays = dates.length;
            const okCount = newMemories.length;
            const toastLevel: 'success' | 'info' | 'error' =
                okCount === 0 ? 'error' : okCount < totalDays ? 'info' : 'success';
            const toastMsg = okCount === 0
                ? `批量生成失败：${totalDays} 天全部失败（请检查 API / 模型）`
                : okCount < totalDays
                    ? `批量生成完成：${okCount}/${totalDays} 天成功`
                    : `批量生成完成：${okCount} 条记忆已保存`;

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
            addToast(`批量生成失败: ${e.message}`, 'error');
        }
    };

  const confirmDeleteCharacter = () => {
      if (deleteConfirmTarget) {
          deleteCharacter(deleteConfirmTarget);
          setDeleteConfirmTarget(null);
          addToast('角色已删除', 'success');
      }
  };

  const handleExportCard = async () => {
      if (!formData) return;

      const { exportData, worldbookCount, regexScriptCount } = buildCharacterCardExportData(formData, {
          customThemes,
          worldbooks,
          worldbookGroupSettings,
      });
      const packedParts = [
          worldbookCount > 0 ? `${worldbookCount} 条世界书` : '',
          regexScriptCount > 0 ? `${regexScriptCount} 条正则` : '',
      ].filter(Boolean);
      const packedSuffix = packedParts.length > 0 ? `（含 ${packedParts.join('、')}）` : '';

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
              addToast(`已调起分享${packedSuffix}`, 'success');
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
              addToast(`已调起分享${packedSuffix}`, 'success');
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

          addToast(`角色卡已导出${packedSuffix}`, 'success');
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
          id: createCharacterId('import'),
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
      addToast(`SillyTavern 角色 ${newChar.name} 已导入${wbSuffix}${regexSuffix}`, 'success');
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
      const now = Date.now();
      const fallbackCategory = `${data.name || '导入角色'} 的世界书`;
      const incomingMounted: Worldbook[] = (data.mountedWorldbooks || []).map((wb, index) => {
          const category = wb.category && wb.category.trim() ? wb.category : fallbackCategory;
          return {
              ...wb,
              id: wb.id || `wb-import-${now}-${index}`,
              title: wb.title || '未命名设定',
              content: wb.content || '',
              category,
              createdAt: typeof wb.createdAt === 'number' ? wb.createdAt : now,
              updatedAt: typeof wb.updatedAt === 'number' ? wb.updatedAt : now,
          };
      });
      let importedWbCount = 0;
      for (const wb of incomingMounted) {
          if (!wb.id || worldbooks.some(existing => existing.id === wb.id)) continue;
          await addWorldbook(wb);
          importedWbCount++;
      }

      const {
          id: _id,
          modelId: _modelId,
          version: _version,
          type: _type,
          embeddedTheme: _embeddedTheme,
          spec: _spec,
          spec_version: _specVersion,
          data: _stCompatData,
          ...rawCharacterFields
      } = data as CharacterExportData & { id?: string; modelId?: string; convoSettings?: CharacterProfile['convoSettings'] };
      const characterFields = stripCharacterCardPrivateFields(rawCharacterFields);

      const newChar: CharacterProfile = {
          ...characterFields,
          id: createCharacterId('import'),
          memories: [],
          refinedMemories: {},
          activeMemoryMonths: [],
          mountedWorldbooks: incomingMounted.map(wb => ({
              id: wb.id,
              title: wb.title,
              content: wb.content,
              category: wb.category,
              enabled: wb.enabled,
          })),
      } as CharacterProfile;

      // 旧实现：DB.saveCharacter + addCharacter()「naive 刷新」+ reload —— 整页重启之外，
      // addCharacter() 还会额外创建一个空白 New Character 留在列表里。改走 importCharacter。
      await importCharacter(newChar);

      const wbToastSuffix = importedWbCount > 0 ? `，同步导入 ${importedWbCount} 条世界书` : '';
      addToast(`角色 ${newChar.name} 已导入${wbToastSuffix}`, 'success');
  };

  // ── 渲染 ────────────────────────────────────────────────
  const fieldLabel = (cn: string, en: string) => (
      <label className="text-[8px] tracking-[0.16em] uppercase mb-1.5 block" style={{ ...MONO_STACK, color: PAPER_TONES.inkFaint }}>{cn} / {en}</label>
  );

  return (
    <div data-manual-anchor="manual-personas-characters" className="h-full w-full text-[#2f3432] relative" style={DOT_BG}>
       {view === 'list' ? (
           <div className="flex flex-col min-h-0 h-full animate-fade-in">
               {/* 顶栏 */}
               <div className="relative shrink-0 px-4 pt-3 pb-3 bg-[#f5f7f4]/95 backdrop-blur border-b border-[#e6ece8]">
                   <div className="flex items-center gap-3">
                       <button onClick={closeApp} className={`shrink-0 px-2.5 py-2 flex items-center gap-1 ${STICKER}`} title="返回剪影集">
                           <svg viewBox="0 0 24 24" fill="none" stroke={INK} strokeWidth={2.5} className="w-3.5 h-3.5">
                               <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
                           </svg>
                           <span className="text-[10px] font-black">返回</span>
                       </button>
                       <div className="flex-1 min-w-0 relative">
                           <div className="text-[8px] tracking-[0.18em] uppercase" style={{ ...MONO_STACK, color: PAPER_TONES.inkFaint }}>CHARACTER LIST</div>
                           <div className="flex items-baseline gap-2">
                               <h1 className="text-2xl font-black tracking-normal">登场人物</h1>
                               <span className="text-sm truncate" style={{ color: PAPER_TONES.inkSoft }}>选择照片进入角色资料</span>
                           </div>
                       </div>
                       <div className="shrink-0 w-12 h-12 rounded-full flex flex-col items-center justify-center select-none bg-white" style={{ border: `1px solid ${BORDER}`, color: PAPER_TONES.ink }}>
                           <span className="text-base font-black leading-none">{characters.length}</span>
                           <span className="text-[7px] leading-none mt-0.5" style={{ ...MONO_STACK, color: PAPER_TONES.inkFaint }}>角色</span>
                       </div>
                   </div>
               </div>

               {/* 角色照片墙 */}
               <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 pb-20 no-scrollbar">
                   <div className="flex items-center gap-2 bg-white border rounded-[14px] px-3 mb-3" style={{ borderColor: BORDER }}>
                       <Binoculars size={15} color={INK} className="shrink-0 opacity-70" />
                       <input
                           value={search}
                           onChange={(e) => setSearch(e.target.value)}
                           placeholder="搜索角色名称、列表备注或设定"
                           className="flex-1 bg-transparent py-2 text-xs outline-none placeholder:text-[#8fa5ae]"
                       />
                   </div>
                   <div className="grid grid-cols-2 gap-3 mb-3">
                       <button
                           onClick={addCharacter}
                           className="bg-white border rounded-[16px] px-3 py-2.5 flex items-center gap-3 text-left active:scale-[0.99] transition-all"
                           style={{ borderColor: BORDER, boxShadow: '0 1px 2px rgba(47,64,60,0.06)' }}
                       >
                           <MiniPhotoAction type="new" />
                           <div className="min-w-0">
                               <div className="text-xs font-black" style={{ color: INK }}>新建角色</div>
                               <div className="text-[10px] truncate" style={{ color: PAPER_TONES.inkSoft }}>空白角色卡</div>
                           </div>
                       </button>
                       <button
                           onClick={() => cardImportRef.current?.click()}
                           className="bg-white border rounded-[16px] px-3 py-2.5 flex items-center gap-3 text-left active:scale-[0.99] transition-all"
                           style={{ borderColor: BORDER, boxShadow: '0 1px 2px rgba(47,64,60,0.06)' }}
                           title="导入角色卡（Moro JSON / SillyTavern PNG·JSON）"
                       >
                           <MiniPhotoAction type="import" />
                           <div className="min-w-0">
                               <div className="text-xs font-black" style={{ color: INK }}>导入角色卡</div>
                               <div className="text-[10px] truncate" style={{ color: PAPER_TONES.inkSoft }}>JSON / PNG</div>
                           </div>
                       </button>
                       <input type="file" ref={cardImportRef} className="hidden" accept=".json,.png,image/png,application/json" onChange={handleImportCard} />
                   </div>
                   <div className="grid grid-cols-2 gap-3">
                   {visibleCharacters.map((char) => (
                       <CharacterCard
                           key={char.id}
                           char={char}
                           onClick={() => { setEditingId(char.id); setView('detail'); }}
                           onDelete={(e) => {
                               e.stopPropagation();
                               setDeleteConfirmTarget(char.id);
                           }}
                       />
                   ))}
                   </div>
                   {characters.length === 0 && (
                       <p className="text-center text-sm pt-2" style={{ color: PAPER_TONES.inkFaint }}>
                           还没有角色。可以新建角色，或导入 Moro / SillyTavern 角色卡。
                       </p>
                   )}
                   {characters.length > 0 && visibleCharacters.length === 0 && (
                       <p className="text-center text-sm pt-2" style={{ color: PAPER_TONES.inkFaint }}>
                           没找到匹配角色。换个名称、备注或设定关键词试试。
                       </p>
                   )}
               </div>
           </div>
       ) : formData && (
           <div className="flex flex-col min-h-0 h-full animate-fade-in relative">
               {/* 角色详情页头 */}
               <div className="relative shrink-0 px-4 pt-3 pb-0 bg-[#f5f7f4]/95 z-40 sticky top-0 backdrop-blur border-b border-[#e6ece8]">
                   <div className="flex items-center gap-3 mb-3">
                       <button onClick={handleBack} className={`shrink-0 px-2.5 py-2 flex items-center gap-1 ${STICKER}`}>
                           <svg viewBox="0 0 24 24" fill="none" stroke={INK} strokeWidth={2.5} className="w-3.5 h-3.5">
                               <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
                           </svg>
                           <span className="text-[10px] font-black">返回</span>
                       </button>
                       <div className="flex-1 min-w-0">
                           <div className="text-[8px] tracking-[0.18em] uppercase" style={{ ...MONO_STACK, color: PAPER_TONES.inkFaint }}>EDIT CHARACTER</div>
                           <div className="text-sm font-black truncate">{formData.name || '未命名角色'}</div>
                       </div>
                       <button
                           onClick={() => { setActiveCharacterId(formData.id); openApp(AppID.Chat); }}
                           className={`shrink-0 px-3 py-2 text-[10px] font-black flex items-center gap-1.5 ${INK_BTN}`}
                       >
                           <PaperPlaneTilt size={12} weight="bold" /> 开始聊天
                       </button>
                   </div>
                   {/* 分区切换 */}
                   <div className="flex gap-2 pl-1 pb-2">
                       {([
                           ['identity', `基础设定`, 'PROFILE'],
                           ['memory', `记忆档案 ${(formData.memories || []).length}`, 'MEMORY'],
                       ] as const).map(([tab, cn, en]) => (
                           <button
                               key={tab}
                               onClick={() => setDetailTab(tab)}
                               className="px-4 py-2 rounded-full flex flex-col items-center transition-colors"
                               style={detailTab === tab
                                   ? { background: '#eef5ef', border: `1px solid ${BORDER}`, color: INK, boxShadow: '0 6px 14px -12px rgba(47,64,60,0.35)' }
                                   : { background: '#fbfcf8', border: `1px solid ${BORDER}`, color: PAPER_TONES.inkFaint }}
                           >
                               <span className="text-[7px] opacity-60" style={MONO_STACK}>{en}</span>
                               <span className="text-[11px] font-black leading-tight">{cn}</span>
                           </button>
                       ))}
                   </div>
               </div>

               <div className="flex-1 overflow-y-auto p-4 no-scrollbar pb-10">
                   {detailTab === 'identity' && (
                       <div className="space-y-6 animate-fade-in">
                           {/* 头像 + 名字 / 列表备注 / 图片链接 */}
                           <div className="flex items-start gap-4">
                               <div
                                   className="shrink-0 bg-white border border-[#dfe7e1] rounded-[16px] p-1.5 cursor-pointer relative group"
                                   style={{ boxShadow: '0 8px 18px -16px rgba(47,64,60,0.30)' }}
                                   onClick={() => fileInputRef.current?.click()}
                                   title="上传头像"
                               >
                                   <img src={formData.avatar} className={`w-20 h-20 object-cover rounded-[12px] group-hover:opacity-75 transition-opacity ${isCompressing ? 'opacity-50 blur-sm' : ''}`} alt="角色头像" />
                                   <span className="absolute inset-x-2 bottom-2 rounded-full bg-white/88 text-[9px] text-center py-0.5" style={{ color: ROSE_DARK }}>上传</span>
                                   <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleFileChange} />
                               </div>
                               <div className="flex-1 min-w-0 space-y-3">
                                   <div>
                                       {fieldLabel('角色名称', 'NAME')}
                                       <input value={formData.name} onChange={(e) => handleChange('name', e.target.value)} className={`${LINE_INPUT} text-lg font-black`} placeholder="填写角色名称" />
                                   </div>
                                   <div>
                                       {fieldLabel('列表备注', 'LIST NOTE')}
                                       <input value={formData.description} onChange={(e) => handleChange('description', e.target.value)} className={LINE_INPUT} placeholder="仅用于剪影集列表展示，不发送给 AI" />
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
                                                   addToast('图片链接已清空', 'info');
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
                                               addToast('图片链接已保存', 'success');
                                           }
                                       }}
                                       onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                                       placeholder="或填写头像图片链接（回车保存）"
                                       className={`${LINE_INPUT} text-[11px]`}
                                   />
                               </div>
                           </div>

                           {/* 外貌 Tag：从人设 + 绑定世界书一键生成 booru 风格英文标签，喂文生图用 */}
                           <div>
                               <div className="flex items-center justify-between mb-1.5">
                                   {fieldLabel('外貌 Tag（文生图用）', 'APPEARANCE TAGS')}
                                   <button
                                       onClick={handleGenerateAppearanceTags}
                                       disabled={isGeneratingTags}
                                       className={`px-2.5 py-1 text-[10px] font-black disabled:opacity-60 ${formData.appearanceTags ? STICKER : INK_BTN}`}
                                   >
                                       {isGeneratingTags ? '提炼中…' : (formData.appearanceTags ? '↻ 重新生成' : '✨ 一键生成')}
                                   </button>
                               </div>
                               <textarea
                                    value={formData.appearanceTags || ''}
                                    onChange={(e) => handleChange('appearanceTags', e.target.value)}
                                    className={`${AREA_INPUT} h-20`}
                                    placeholder="填写或生成英文外貌标签，例如 long_hair, silver eyes"
                                />
                               <p className="text-[12px] mt-1.5 leading-relaxed" style={NOTE_TEXT}>
                                   用于生成立绘、头像或相册图。生成时会参考核心设定、世界观和绑定的世界书，优先使用副 API。
                               </p>
                           </div>

                           <div>
                               {fieldLabel('核心设定（角色指令）', 'SCRIPT')}
                               <textarea value={formData.systemPrompt} onChange={(e) => handleChange('systemPrompt', e.target.value)} className={`${AREA_INPUT} h-40`} placeholder="填写角色身份、性格、行为规则和对话边界" />
                               <p className="text-[12px] mt-1.5 leading-relaxed" style={NOTE_TEXT}>
                                   输入 {'{{user}}'} / {'{{char}}'} 以及 {'<user>'} / {'<char>'} 后，会自动替换为当前用户和角色名称；启用活字盘预设时对应 Char Description 占位。
                               </p>
                           </div>

                           {/* 柔顺奉养（Soft Devotion Chat）：开启后角色共情能力大幅提升 */}
                           <div className="p-3 rounded-[18px] bg-white" style={{ border: '1px solid #e6ece8', boxShadow: CARD_SHADOW }}>
                               <div className="flex items-start justify-between gap-3">
                                   <div className="min-w-0">
                                       <div className="text-[8px] tracking-[0.16em] uppercase mb-1.5" style={{ ...MONO_STACK, color: PAPER_TONES.inkFaint }}>高共情聊天 / SOFT DEVOTION CHAT</div>
                                       <p className="text-[12px] leading-relaxed" style={NOTE_TEXT}>
                                           开启后，这个角色在聊天里会更偏安抚、陪伴和情绪承接。
                                       </p>
                                   </div>
                                   <button
                                       role="switch"
                                       aria-checked={!!formData.softDevotionChatEnabled}
                                       onClick={() => handleChange('softDevotionChatEnabled', !formData.softDevotionChatEnabled)}
                                       className="relative w-[52px] h-[28px] shrink-0 rounded-full transition-all active:scale-95"
                                       style={{
                                           background: formData.softDevotionChatEnabled ? ROSE : '#eef2ee',
                                           border: `1px solid ${BORDER}`,
                                           boxShadow: formData.softDevotionChatEnabled ? '0 8px 16px -12px rgba(47,64,60,0.42)' : 'inset 0 1px 2px rgba(47,64,60,0.08)',
                                       }}
                                       title="高共情聊天"
                                   >
                                       <span className="absolute top-1/2 -translate-y-1/2 text-[8px] font-bold transition-opacity duration-300 pointer-events-none" style={{ ...MONO_STACK, left: 8, color: 'rgba(255,255,255,0.92)', opacity: formData.softDevotionChatEnabled ? 1 : 0 }}>ON</span>
                                       <span className="absolute top-1/2 -translate-y-1/2 text-[8px] font-bold transition-opacity duration-300 pointer-events-none" style={{ ...MONO_STACK, right: 7, color: '#d8c2cd', opacity: formData.softDevotionChatEnabled ? 0 : 1 }}>off</span>
                                       <span
                                           className="absolute top-1/2 -translate-y-1/2 w-[22px] h-[22px] rounded-full bg-white transition-all duration-300"
                                           style={{ left: formData.softDevotionChatEnabled ? 27 : 3, boxShadow: '0 2px 6px rgba(47,64,60,0.24)' }}
                                       />
                                   </button>
                               </div>
                           </div>

                           <div>
                               {fieldLabel('世界观补充', 'WORLD')}
                               <textarea
                                    value={formData.worldview || ''}
                                    onChange={(e) => handleChange('worldview', e.target.value)}
                                    className={`${AREA_INPUT} h-24`}
                                    placeholder="填写角色所在世界、背景规则或重要常识"
                                />
                               <p className="text-[12px] mt-1.5 leading-relaxed" style={NOTE_TEXT}>
                                   这里输入角色 / 用户宏也会自动替换成当前名字。
                               </p>
                           </div>

                           {/* 生活侧写：帮 TA 更了解自己的生活速写（副 API 生成，可手动改） */}
                           <div>
                               <div className="flex items-center justify-between mb-1.5">
                                   {fieldLabel('生活侧写', 'LIFE PROFILE')}
                                   <button
                                       onClick={handleGenerateLifeProfile}
                                       disabled={isGeneratingLifeProfile}
                                       className={`px-2.5 py-1 text-[10px] font-black disabled:opacity-60 ${formData.lifeProfile?.content ? STICKER : INK_BTN}`}
                                   >
                                       {isGeneratingLifeProfile ? '生成中…' : (formData.lifeProfile?.content ? '重新生成' : '生成侧写')}
                                   </button>
                               </div>
                               <textarea
                                    value={formData.lifeProfile?.content || ''}
                                    onChange={(e) => handleChange('lifeProfile', { content: e.target.value, generatedAt: formData.lifeProfile?.generatedAt || Date.now(), edited: true })}
                                    className={`${AREA_INPUT} h-44`}
                                    placeholder="记录角色的日常节奏、习惯、在意事项和相处方式；可生成后手动修改"
                                />
                               <p className="text-[12px] mt-1.5 leading-relaxed" style={NOTE_TEXT}>
                                   会作为角色自我认知补充进上下文，帮助长期对话更稳定。生成时优先使用副 API。
                               </p>
                           </div>

                           {/* 对话示例（mes_example）—— SillyTavern 语义：说话风格示例，独立于角色描述。
                               未启用预设时作为「对话示例」块注入；启用预设时落在 dialogueExamples 占位 */}
                           <div>
                               {fieldLabel('对话示例', 'SAMPLE LINES')}
                               <textarea
                                    value={formData.mesExample || ''}
                                    onChange={(e) => handleChange('mesExample', e.target.value || undefined)}
                                    className={`${AREA_INPUT} h-32`}
                                    placeholder={'<START>\n{{user}}: 在画什么？\n{{char}}: 在画云。'}
                                />
                               <p className="text-[12px] mt-1.5 leading-relaxed" style={NOTE_TEXT}>
                                   用来约束角色说话方式。多段示例用 &lt;START&gt; 分隔；角色 / 用户宏会自动替换；启用活字盘预设时对应 Chat Examples 占位。
                               </p>
                           </div>

                           {/* 开场白（first_mes）+ 备选开场白（alternate_greetings）—— SillyTavern 语义：
                               进入空聊天时左右切换选择其中一条作为角色的第一条消息，不进 systemPrompt */}
                           <div>
                               {fieldLabel('开场第一句', 'OPENER')}
                               <textarea
                                    value={formData.firstMes || ''}
                                    onChange={(e) => handleChange('firstMes', e.target.value)}
                                    className={`${AREA_INPUT} h-24`}
                                    placeholder="新聊天里 TA 先开口的那句话（{{user}} / {{char}} 会自动替换）…"
                                />
                               <p className="text-[12px] mt-1.5 leading-relaxed" style={NOTE_TEXT}>
                                   新聊天为空时显示。支持多个备选开场，进入聊天后可切换选择。
                               </p>
                           </div>

                           <div>
                               <div className="flex items-center justify-between mb-1.5">
                                   {fieldLabel('备选开场', 'SPARE OPENERS')}
                                   <button
                                       onClick={() => handleChange('alternateGreetings', [...(formData.alternateGreetings || []), ''])}
                                       className={`px-2.5 py-1 text-[10px] font-black ${STICKER}`}
                                   >新增开场</button>
                               </div>
                               {(formData.alternateGreetings || []).length === 0 && (
                                   <p className="text-[12px] pl-1" style={{ color: PAPER_TONES.inkFaint }}>暂无备选开场。点击「新增开场」添加更多开局文本。</p>
                               )}
                               <div className="space-y-3">
                                   {(formData.alternateGreetings || []).map((greeting, idx) => (
                                       <div key={idx} className="relative border-l-2 border-dashed border-[#dfe7e1] pl-3">
                                           <div className="flex items-center justify-between mb-1">
                                               <span className="text-[8px]" style={{ ...MONO_STACK, color: PAPER_TONES.inkFaint }}>备选 {idx + 1}</span>
                                               <button
                                                   onClick={() => {
                                                       const next = (formData.alternateGreetings || []).filter((_, i) => i !== idx);
                                                       handleChange('alternateGreetings', next.length > 0 ? next : undefined);
                                                   }}
                                                   className="text-[10px] font-black px-1.5"
                                                   style={{ color: ROSE_DARK }}
                                                   title="删除这个开场"
                                               >删除</button>
                                           </div>
                                           <textarea
                                               value={greeting}
                                               onChange={(e) => {
                                                   const next = [...(formData.alternateGreetings || [])];
                                                   next[idx] = e.target.value;
                                                   handleChange('alternateGreetings', next);
                                               }}
                                               className={`${AREA_INPUT} h-20`}
                                               placeholder={`备选开场 ${idx + 1}`}
                                           />
                                       </div>
                                   ))}
                               </div>
                           </div>

                           {/* 语音设置（MiniMax 音色） */}
                           <div className="relative bg-white rounded-[18px] p-4 space-y-3" style={{ border: '1px solid #e6ece8', boxShadow: CARD_SHADOW }}>
                               <div className="flex items-center justify-between flex-wrap gap-2">
                                   <label className="text-[8px] tracking-[0.16em] uppercase flex items-center gap-1" style={{ ...MONO_STACK, color: PAPER_TONES.inkFaint }}><VinylRecord size={12} weight="bold" /> 语音设置（MINIMAX VOICE）</label>
                                   <div className="flex gap-2">
                                       <button
                                           onClick={() => { setActiveCharacterId(formData.id); openApp(AppID.VoiceDesigner); }}
                                           className={`px-2.5 py-1 text-[10px] font-black flex items-center gap-1 ${STICKER}`}
                                       >
                                           <Waveform size={11} weight="bold" /> 打开音色设计
                                       </button>
                                       <button
                                           onClick={handleLoadMiniMaxVoices}
                                           className={`px-2.5 py-1 text-[10px] font-black disabled:opacity-40 ${STICKER}`}
                                           disabled={isLoadingVoices}
                                       >
                                           {isLoadingVoices ? '加载中…' : '加载音色列表'}
                                       </button>
                                   </div>
                               </div>
                               <p className="text-[12px] leading-relaxed" style={NOTE_TEXT}>可直接填写 voice_id；配置后聊天朗读和 TTS 会使用该音色。</p>

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
                                       className={LINE_INPUT}
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
                                       className={LINE_INPUT}
                                       placeholder="TTS 模型（默认 speech-2.8-hd）"
                                   />
                               </div>

                               {(voiceOptions.system.length + voiceOptions.voice_cloning.length + voiceOptions.voice_generation.length) > 0 && (
                                   <div className="space-y-2 pt-1">
                                       {([
                                           ['system', '系统音色'],
                                           ['voice_cloning', '复刻音色'],
                                           ['voice_generation', '文生音色'],
                                       ] as const).map(([source, label]) => {
                                           const list = voiceOptions[source];
                                           if (!list.length) return null;
                                           return (
                                               <div key={source}>
                                                   <div className="text-[8px] mb-1" style={{ ...MONO_STACK, color: PAPER_TONES.inkFaint }}>{label}</div>
                                                   <div className="max-h-28 overflow-y-auto space-y-1 pr-1">
                                                       {list.slice(0, 50).map((v) => (
                                                           <button
                                                               key={`${source}-${v.voice_id}`}
                                                               onClick={() => applyVoiceToCharacter(v, source)}
                                                               className="w-full text-left px-2 py-1 text-xs border bg-white hover:border-[#6f8f82] transition-colors rounded-[10px]"
                                                               style={{ borderColor: BORDER }}
                                                           >
                                                               <div className="font-black truncate">{v.voice_name || '未命名音色'}</div>
                                                               <div className="text-[8px] truncate" style={{ ...MONO_STACK, color: PAPER_TONES.inkFaint }}>{v.voice_id}</div>
                                                           </button>
                                                       ))}
                                                   </div>
                                               </div>
                                           );
                                       })}
                                   </div>
                               )}
                           </div>

                           {/* 导出角色卡 */}
                           <div data-manual-anchor="manual-personas-character-export" className="pt-2 pb-2">
                               <button
                                   onClick={handleExportCard}
                                   className={`w-full py-3.5 text-xs font-black flex items-center justify-center gap-2 ${INK_BTN}`}
                               >
                                   <TrayArrowUp size={15} weight="bold" />
                                   导出角色卡
                               </button>
                               <p className="text-[12px] text-center mt-2" style={{ color: PAPER_TONES.inkFaint }}>导出的角色卡会带上已绑定世界书和角色正则，不包含记忆档案和聊天记录。</p>
                           </div>
                       </div>
                   )}

                   {detailTab === 'memory' && (
                       <div className="space-y-4 animate-fade-in">
                           <div className="flex justify-center gap-2 mb-4 flex-wrap">
                               <button onClick={() => setShowBatchModal(true)} className={`px-3.5 py-2 text-[10px] font-black ${STICKER}`}>批量生成记忆</button>
                               <button onClick={() => setShowImportModal(true)} className={`px-3.5 py-2 text-[10px] font-black ${STICKER}`}>导入旧文本</button>
                               <button onClick={handleExportPreview} className={`px-3.5 py-2 text-[10px] font-black ${STICKER}`}>导出记忆文本</button>
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

       {/* ── 导入旧文本 ── */}
       <PaperSheet
           open={showImportModal}
           tag="IMPORT / 旧文本导入"
           title="导入旧文本为记忆"
           onClose={() => setShowImportModal(false)}
           footer={<>
               <button onClick={() => setShowImportModal(false)} className={`flex-1 py-2.5 text-xs font-black ${STICKER}`}>取消</button>
               <button onClick={handleImportMemories} disabled={isProcessingMemory} className={`flex-1 py-2.5 text-xs font-black flex items-center justify-center gap-2 disabled:opacity-60 ${INK_BTN}`}>
                   {isProcessingMemory && <div className="w-3.5 h-3.5 border-2 border-[#f7f5ef]/30 border-t-[#f7f5ef] rounded-full animate-spin"></div>}
                   {isProcessingMemory ? '导入中…' : '开始导入'}
               </button>
           </>}
       >
           <div className="space-y-3">
               <p className="text-[13px] leading-relaxed" style={NOTE_TEXT}>粘贴旧聊天记录或摘要，AI 会整理为带日期的记忆条目并保存到当前角色。</p>
               {importStatus && <div className="text-xs font-black border-l-2 pl-2" style={{ borderColor: ROSE, color: PAPER_TONES.ink }}>{importStatus}</div>}
               <textarea value={importText} onChange={e => setImportText(e.target.value)} placeholder="粘贴要导入的旧文本" className={`${AREA_INPUT} h-32`} />
           </div>
       </PaperSheet>

       {/* ── 批量生成 ── */}
       <PaperSheet
           open={showBatchModal}
           tag="BATCH / 批量生成"
           title="从聊天记录生成记忆"
           onClose={() => { setShowBatchModal(false); setShowPromptEditor(false); }}
           footer={
               isBatchProcessing ? (
                   <div className="w-full py-2.5 border border-dashed text-xs font-black text-center flex items-center justify-center gap-2 rounded-[14px]" style={{ borderColor: BORDER, color: PAPER_TONES.ink }}>
                       <div className="w-3.5 h-3.5 border border-[#dfe7e1] border-t-transparent rounded-full animate-spin"></div>
                       {batchProgress}
                   </div>
               ) : (
                   <button onClick={handleBatchSummarize} className={`w-full py-2.5 text-xs font-black ${INK_BTN}`}>开始生成</button>
               )
           }
       >
           <div className="space-y-3">
               <p className="text-[13px] leading-relaxed" style={NOTE_TEXT}>按日期读取聊天记录，并使用所选模板生成记忆摘要。</p>
               {/* Prompt Selection */}
               <div className="border border-dashed rounded-[16px] p-3" style={{ borderColor: BORDER }}>
                   <label className="text-[8px] tracking-[0.16em] uppercase mb-2 block" style={{ ...MONO_STACK, color: PAPER_TONES.inkFaint }}>选择记忆生成模板</label>
                   <div className="flex flex-col gap-2">
                       {archivePrompts.map(p => (
                           <div
                               key={p.id}
                               onClick={() => { setSelectedPromptId(p.id); localStorage.setItem('chat_active_archive_prompt_id', p.id); }}
                               className="px-3 py-2 border cursor-pointer flex items-center justify-between transition-colors rounded-[14px] bg-white"
                               style={selectedPromptId === p.id ? { borderColor: ROSE, boxShadow: CARD_SHADOW } : { borderColor: BORDER, color: PAPER_TONES.inkSoft }}
                           >
                               <span className="text-xs font-black">{selectedPromptId === p.id ? '◉ ' : '○ '}{p.name}</span>
                               <div className="flex gap-1.5">
                                   <button onClick={(e) => { e.stopPropagation(); setEditingPrompt(p); setShowPromptEditor(true); }} className="text-[8px] px-2 py-0.5 border rounded-full" style={{ ...MONO_STACK, borderColor: BORDER, color: ROSE_DARK }}>查看</button>
                                   {!p.id.startsWith('preset_') && (
                                       <button onClick={(e) => { e.stopPropagation(); const next = archivePrompts.filter(ap => ap.id !== p.id); setArchivePrompts(next); localStorage.setItem('chat_archive_prompts', JSON.stringify(next.filter(ap => !ap.id.startsWith('preset_')))); if (selectedPromptId === p.id) setSelectedPromptId('preset_rational'); }} className="text-[8px] px-1.5 py-0.5 border rounded-full" style={{ ...MONO_STACK, borderColor: BORDER, color: '#b36a5e' }}>删除</button>
                                   )}
                               </div>
                           </div>
                       ))}
                   </div>
                   <button onClick={() => { const newP = { id: `custom_${Date.now()}`, name: '新自定义模板', content: DEFAULT_ARCHIVE_PROMPTS[0].content }; setEditingPrompt(newP); setShowPromptEditor(true); }} className="mt-2 w-full py-1.5 text-[10px] font-black border border-dashed rounded-full transition-colors" style={{ borderColor: BORDER, color: ROSE_DARK }}>新增自定义模板</button>
               </div>
               {/* Date Range */}
               <div className="flex gap-2">
                   <div className="flex-1"><label className="text-[8px] block mb-1" style={{ ...MONO_STACK, color: PAPER_TONES.inkFaint }}>开始日期（可选）</label><input type="date" value={batchRange.start} onChange={e => setBatchRange({...batchRange, start: e.target.value})} className={LINE_INPUT} /></div>
                   <div className="flex-1"><label className="text-[8px] block mb-1" style={{ ...MONO_STACK, color: PAPER_TONES.inkFaint }}>结束日期（可选）</label><input type="date" value={batchRange.end} onChange={e => setBatchRange({...batchRange, end: e.target.value})} className={LINE_INPUT} /></div>
               </div>
               <div className="text-[10px] border border-dashed rounded-[14px] p-2.5 leading-relaxed" style={{ borderColor: BORDER, color: PAPER_TONES.inkSoft }}>
                   模板可用变量: <code>{'${dateStr}'}</code>, <code>{'${char.name}'}</code>, <code>{'${userProfile.name}'}</code>, <code>{'${rawLog}'}</code>
               </div>
           </div>
       </PaperSheet>

       {/* ── 模板编辑 ── */}
       <PaperSheet
           open={showPromptEditor}
           tag="TEMPLATE / 生成模板"
           title={editingPrompt?.id.startsWith('preset_') ? '查看模板' : '编辑模板'}
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
                   addToast('模板已保存', 'success');
               }} className={`w-full py-2.5 text-xs font-black ${INK_BTN}`}>保存模板</button>
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
                   addToast('模板已选中', 'success');
               }} className={`w-full py-2.5 text-xs font-black ${INK_BTN}`}>使用这个模板</button>
           )}
       >
           <div className="space-y-3">
               <input
                   value={editingPrompt?.name || ''}
                   onChange={e => setEditingPrompt(prev => prev ? {...prev, name: e.target.value} : null)}
                   placeholder="模板名称"
                   className={`${LINE_INPUT} text-sm font-black read-only:text-[#8da099]`}
                   readOnly={editingPrompt?.id.startsWith('preset_')}
               />
               <textarea
                   value={editingPrompt?.content || ''}
                   onChange={e => setEditingPrompt(prev => prev ? {...prev, content: e.target.value} : null)}
                   className={`${AREA_INPUT} h-64 font-mono leading-relaxed read-only:text-[#8da099]`}
                   placeholder="填写记忆生成模板"
                   readOnly={editingPrompt?.id.startsWith('preset_')}
               />
               {editingPrompt?.id.startsWith('preset_') && (
                   <p className="text-[12px] text-center" style={{ color: PAPER_TONES.inkFaint }}>系统模板只能查看，不能编辑。</p>
               )}
           </div>
       </PaperSheet>

       {/* ── 记忆导出 ── */}
       <PaperSheet
           open={showExportModal}
           tag="EXPORT / 记忆导出"
           title="导出记忆文本"
           onClose={() => setShowExportModal(false)}
           footer={<div className="flex gap-2 w-full">
               <button onClick={() => { navigator.clipboard.writeText(exportText); addToast('已复制全文', 'success'); }} className={`flex-1 py-2.5 text-xs font-black ${STICKER}`}>复制全文</button>
               {Capacitor.isNativePlatform() ? (
                   <button onClick={handleNativeShare} className={`flex-1 py-2.5 text-xs font-black flex items-center justify-center gap-1.5 ${INK_BTN}`}>
                       <TrayArrowUp size={13} weight="bold" />分享
                   </button>
               ) : (
                   <button onClick={handleWebFileDownload} className={`flex-1 py-2.5 text-xs font-black flex items-center justify-center gap-1.5 ${INK_BTN}`}>
                       <TrayArrowDown size={13} weight="bold" />下载文件
                   </button>
               )}
           </div>}
       >
           <div className="border border-dashed rounded-[16px] p-3 space-y-2" style={{ borderColor: BORDER }}>
               <div className="text-[12px]" style={NOTE_TEXT}>文本已自动复制到剪贴板，也可以在这里手动复制或下载。</div>
               <textarea value={exportText} readOnly className="w-full h-40 bg-transparent border-none text-[10px] font-mono text-[#2f3432]/70 resize-none focus:ring-0 leading-relaxed select-all" onClick={(e) => e.currentTarget.select()} />
           </div>
       </PaperSheet>

       {/* ── 删除确认 ── */}
       <PaperSheet
           open={!!deleteConfirmTarget}
           tag="DELETE / 不可复原"
           title="删除角色？"
           onClose={() => setDeleteConfirmTarget(null)}
           footer={<div className="flex gap-2 w-full">
               <button onClick={() => setDeleteConfirmTarget(null)} className={`flex-1 py-2.5 text-xs font-black ${STICKER}`}>取消</button>
               <button onClick={confirmDeleteCharacter} className={`flex-1 py-2.5 text-xs font-black ${INK_BTN}`}>确认删除</button>
           </div>}
       >
           <p className="text-sm text-center leading-relaxed py-2" style={{ color: PAPER_TONES.inkSoft }}>
               删除后，这个角色的资料、记忆档案和关系数据都会移除。<br />
               <span className="text-xs font-black">此操作无法撤销。</span>
           </p>
       </PaperSheet>
    </div>
  );
};
export default Character;
