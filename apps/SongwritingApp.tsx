
import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useOS } from '../context/OSContext';
import { resolveAuxApi } from '../utils/auxApi';
import { SongSheet, SongLine, SongComment, SongMood, SongGenre, SongAudio, MusicProvider, AppID } from '../types';
import { SONG_GENRES, SONG_MOODS, SECTION_LABELS, COVER_STYLES, SongPrompts, LYRIC_TEMPLATES, getLyricTemplate } from '../utils/songPrompts';
import { injectMemoryPalace } from '../utils/memoryPalace/pipeline';
import { safeResponseJson, extractJson } from '../utils/safeApi';
import { DB } from '../utils/db';
import {
    synthesizeSong,
    buildAceStepTags,
    buildAceStepLyrics,
    hashSongInputs,
    loadSongAudioBlob,
    generatePromptViaLLM,
    VOICE_PRESETS,
    type AceStepInput,
} from '../utils/aceStepApi';
import {
    synthesizeSongMinimax,
    buildMinimaxMusicLyrics,
    hashMinimaxMusicInputs,
    type MinimaxMusicInput,
} from '../utils/minimaxMusic';
import {
    Check, PencilSimple,
    Sparkle as SparkleP, Butterfly, Feather, Lightning, MicrophoneStage,
    MusicNotes, Wind, Cookie, UsersThree, Heart, Diamond, MusicNoteSimple,
    HeartStraight, Plus, Trash, ShareNetwork, CaretRight, ArrowsClockwise, MagicWand, ListChecks, PaperPlaneRight,
} from '@phosphor-icons/react';
import {
    PAPER, PAPER_CARD, HAND, BRUSH, DOT_BG, GRID_BG, LINES_BG,
    Tape, SectionTitle, BackSticker, TopBar, IconStamp, InkButton, Chip, TypingDots,
    CollageModal, CollageConfirm,
} from './creative/collage';
import { useMusic, type Song as MusicSong } from '../context/MusicContext';

// --- Helper Components ---

// Phosphor icon map for voice presets — replaces flat emoji with weighted line art
const VOICE_ICONS: Record<string, React.ComponentType<any>> = {
    'auto':         SparkleP,
    'female-sweet': Butterfly,
    'female-soft':  Feather,
    'female-rock':  Lightning,
    'male-deep':    MicrophoneStage,
    'male-high':    MusicNotes,
    'male-soft':    Wind,
    'child':        Cookie,
    'duet':         UsersThree,
};

// Phosphor icon map for music providers (used in modal segmented picker)
const PROVIDER_ICONS: Record<string, React.ComponentType<any>> = {
    'minimax-free': Heart,
    'minimax-paid': Diamond,
    'ace-step':     MusicNoteSimple,
};

const SectionBadge: React.FC<{ section: string; small?: boolean }> = ({ section, small }) => {
    const info = SECTION_LABELS[section] || { label: section, color: '' };
    return (
        <span className={`inline-block border-2 border-[#1c1b1a] bg-white text-[#1c1b1a] font-bold leading-none ${small ? 'text-[8px] px-1.5 py-0.5' : 'text-[9px] px-2 py-1'}`}>
            {info.label}
        </span>
    );
};

type TimelineItem = { kind: 'line'; data: SongLine } | { kind: 'feedback'; data: { id: string; timestamp: number; reaction?: SongComment; details: SongComment[] } } | { kind: 'pending'; data: SongLine };

function mkLineItem(l: SongLine): TimelineItem { return { kind: 'line', data: l }; }
function mkLineItem2(group: { id: string; timestamp: number; reaction?: SongComment; details: SongComment[] }): TimelineItem { return { kind: 'feedback', data: group }; }
function mkPendingItem(l: SongLine): TimelineItem { return { kind: 'pending', data: l }; }

// --- Main App ---

/** onExit：嵌在「创作社」壳里时，顶层返回回到创作社首页而非直接关到桌面。未传则回桌面。 */
const SongwritingApp: React.FC<{ onExit?: () => void }> = ({ onExit }) => {
    const { closeApp, openApp, songs, addSong, updateSong, deleteSong, characters, apiConfig, auxApiConfig, addToast, userProfile } = useOS();
    // 写歌·歌词/Prompt 生成属「聊天以外」的功能：走副 API（音乐合成仍用各自的 MiniMax/ACE 线路）
    const auxApi = { ...apiConfig, ...resolveAuxApi(auxApiConfig, apiConfig) };
    const exitApp = onExit ?? closeApp;
    const { addLocalSong, removeLocalSong, localAlbumSongs, playSong, current: currentMusicSong, markRegenerating } = useMusic();

    // Navigation
    const [view, setView] = useState<'shelf' | 'create' | 'partner' | 'write' | 'preview'>('shelf');
    const [activeSong, setActiveSong] = useState<SongSheet | null>(null);

    // Create Form State
    const [tempTitle, setTempTitle] = useState('');
    const [tempSubtitle, setTempSubtitle] = useState('');
    const [tempGenre, setTempGenre] = useState<SongGenre>('pop');
    const [tempMood, setTempMood] = useState<SongMood>('happy');
    const [tempCollaboratorId, setTempCollaboratorId] = useState('');
    const [tempCoverStyle, setTempCoverStyle] = useState(COVER_STYLES[0]?.id || 'dawn-blush');
    const [tempTemplate, setTempTemplate] = useState<string>('free');
    const [customCoverFrom, setCustomCoverFrom] = useState('#FB7185');
    const [customCoverVia, setCustomCoverVia] = useState('#A855F7');
    const [customCoverTo, setCustomCoverTo] = useState('#2563EB');

    // Write View State
    const [inputText, setInputText] = useState('');
    const [currentSection, setCurrentSection] = useState<string>('verse');
    const [isTyping, setIsTyping] = useState(false);
    const [lastTokenUsage, setLastTokenUsage] = useState<number | null>(null);
    const [showStructureGuide, setShowStructureGuide] = useState(false);
    const [expandedFeedbackIds, setExpandedFeedbackIds] = useState<Record<string, boolean>>({});

    // Pending candidate lines (not yet committed to song)
    const [pendingLines, setPendingLines] = useState<SongLine[]>([]);

    // Modals
    const [confirmDialog, setConfirmDialog] = useState<{ isOpen: boolean; title: string; message: string; variant: 'danger' | 'warning' | 'info'; confirmText?: string; onConfirm: () => void } | null>(null);
    const [showPreviewModal, setShowPreviewModal] = useState(false);
    const [completionReview, setCompletionReview] = useState('');
    const [isCompleting, setIsCompleting] = useState(false);
    const [showShareModal, setShowShareModal] = useState(false);

    // ACE-Step audio synth (preview view)
    const [audioUrl, setAudioUrl] = useState<string | null>(null);
    const [isGeneratingAudio, setIsGeneratingAudio] = useState(false);
    const [audioGenStatus, setAudioGenStatus] = useState<string>('');
    const [audioError, setAudioError] = useState<string | null>(null);
    const audioAbortRef = useRef<AbortController | null>(null);
    // Track which song the current blob: URL belongs to so we can revoke it on switch
    const currentAudioOwnerRef = useRef<string | null>(null);
    // Voice preset (per-song, persisted in localStorage)
    const [voicePresetId, setVoicePresetIdState] = useState<string>('auto');
    // Unified "AI 出歌引导" modal — entry point now lives on the big button
    const [showCustomPrompt, setShowCustomPrompt] = useState(false);
    const [promptGuidance, setPromptGuidance] = useState('');
    const [promptDraft, setPromptDraft] = useState('');
    const [isAiWritingPrompt, setIsAiWritingPrompt] = useState(false);
    // Active music provider for the modal — defaults to whichever key the user has,
    // preferring free MiniMax over paid ACE-Step. Saved per song via SongSheet.musicProvider.
    const [provider, setProvider] = useState<MusicProvider>('minimax-free');
    // Custom shizuku-styled audio player state (replaces <audio controls>)
    const audioElRef = useRef<HTMLAudioElement | null>(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [playProgress, setPlayProgress] = useState(0);
    const [playDuration, setPlayDuration] = useState(0);
    // Cover confirm modal — opens between ❤︎ click and music-app jump
    type CoverMode = 'char' | 'user' | 'dual';
    const [showCoverConfirm, setShowCoverConfirm] = useState(false);
    const [coverMode, setCoverMode] = useState<CoverMode>('char');
    const [dualCoverUrl, setDualCoverUrl] = useState<string | null>(null);
    const [isBuildingDual, setIsBuildingDual] = useState(false);
    // 冷却已关闭 — 后端撑得住, 留 0 让所有 cooldownSecsLeft > 0 分支自然成 dead code。
    const COOLDOWN_MS = 0;
    const [cooldownSecsLeft, setCooldownSecsLeft] = useState(0);

    const scrollRef = useRef<HTMLDivElement>(null);

    // Long press for mobile delete
    const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const touchStartPos = useRef({ x: 0, y: 0 });
    const [longPressLineId, setLongPressLineId] = useState<string | null>(null);

    const handleLineTouchStart = useCallback((e: React.TouchEvent, lineId: string) => {
        touchStartPos.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        longPressTimerRef.current = setTimeout(() => {
            setLongPressLineId(lineId);
        }, 500);
    }, []);

    const handleLineTouchMove = useCallback((e: React.TouchEvent) => {
        if (!longPressTimerRef.current) return;
        const dx = Math.abs(e.touches[0].clientX - touchStartPos.current.x);
        const dy = Math.abs(e.touches[0].clientY - touchStartPos.current.y);
        if (dx > 10 || dy > 10) {
            clearTimeout(longPressTimerRef.current);
            longPressTimerRef.current = null;
        }
    }, []);

    const handleLineTouchEnd = useCallback(() => {
        if (longPressTimerRef.current) {
            clearTimeout(longPressTimerRef.current);
            longPressTimerRef.current = null;
        }
    }, []);

    // Computed
    const collaborator = useMemo(() => {
        if (!activeSong) return null;
        return characters.find(c => c.id === activeSong.collaboratorId) || null;
    }, [activeSong, characters]);

    const getCoverStyle = (styleId: string) => COVER_STYLES.find(s => s.id === styleId) || COVER_STYLES[0];

    const isCustomCoverStyle = (styleId: string) => styleId.startsWith('custom:');

    const buildCustomCoverStyleId = (from: string = customCoverFrom, via: string = customCoverVia, to: string = customCoverTo) => `custom:${from}-${via}-${to}`;

    const updateCustomCoverColor = (position: 'from' | 'via' | 'to', color: string) => {
        const nextFrom = position === 'from' ? color : customCoverFrom;
        const nextVia = position === 'via' ? color : customCoverVia;
        const nextTo = position === 'to' ? color : customCoverTo;

        if (position === 'from') setCustomCoverFrom(color);
        if (position === 'via') setCustomCoverVia(color);
        if (position === 'to') setCustomCoverTo(color);

        setTempCoverStyle(buildCustomCoverStyleId(nextFrom, nextVia, nextTo));
    };

    const getCoverVisual = (styleId: string): { textClass: string; className: string; style: React.CSSProperties } => {
        if (!isCustomCoverStyle(styleId)) {
            const preset = getCoverStyle(styleId);
            return { textClass: preset.text, className: `bg-gradient-to-br ${preset.gradient}`, style: {} };
        }

        const [, palette = ''] = styleId.split(':');
        const [from = '#FB7185', via = '#A855F7', to = '#2563EB'] = palette.split('-');
        return {
            textClass: 'text-white',
            className: '',
            style: {
                backgroundImage: `linear-gradient(135deg, ${from} 0%, ${via} 50%, ${to} 100%)`,
                backgroundColor: from,
            }
        };
    };

    const feedbackGroups = useMemo(() => {
        if (!activeSong) return [] as { id: string; timestamp: number; reaction?: SongComment; details: SongComment[] }[];
        const groups = new Map<string, { id: string; timestamp: number; reaction?: SongComment; details: SongComment[] }>();
        activeSong.comments.forEach((comment) => {
            const match = comment.id.match(/^cmt-(\d+)-/);
            const key = match?.[1] || comment.id;
            if (!groups.has(key)) groups.set(key, { id: key, timestamp: Number(key) || comment.timestamp, details: [] });
            const group = groups.get(key)!;
            if (comment.type === 'reaction' && !group.reaction) {
                group.reaction = comment;
            } else {
                group.details.push(comment);
            }
        });
        return [...groups.values()].sort((a, b) => a.timestamp - b.timestamp);
    }, [activeSong]);

    const toggleFeedback = (id: string) => {
        setExpandedFeedbackIds(prev => ({ ...prev, [id]: !prev[id] }));
    };

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [activeSong?.lines, activeSong?.comments, pendingLines, isTyping]);

    // --- CRUD ---

    /** Step 1 → step 2: validate basics, then jump to partner-pick view. */
    const handleGoPartner = () => {
        if (!tempTitle.trim()) { addToast('请给歌曲起个名字', 'error'); return; }
        setView('partner');
    };

    const handleCreate = () => {
        if (!tempTitle.trim()) { addToast('请给歌曲起个名字', 'error'); return; }
        if (!tempCollaboratorId) { addToast('请选择一个角色作为创作伙伴', 'error'); return; }

        const newSong: SongSheet = {
            id: `song-${Date.now()}`,
            title: tempTitle,
            subtitle: tempSubtitle || undefined,
            genre: tempGenre,
            mood: tempMood,
            collaboratorId: tempCollaboratorId,
            lines: [],
            comments: [],
            status: 'draft',
            coverStyle: tempCoverStyle,
            createdAt: Date.now(),
            lastActiveAt: Date.now(),
            lyricTemplate: tempTemplate || 'free',
        };
        addSong(newSong);
        setActiveSong(newSong);
        setView('write');
        resetTempState();
    };

    const resetTempState = () => {
        setTempTitle(''); setTempSubtitle(''); setTempGenre('pop'); setTempMood('happy');
        setTempCollaboratorId(''); setTempCoverStyle(COVER_STYLES[0]?.id || 'dawn-blush');
        setCustomCoverFrom('#FB7185'); setCustomCoverVia('#A855F7'); setCustomCoverTo('#2563EB');
        setTempTemplate('free');
    };

    const handleDeleteSong = (id: string) => {
        setConfirmDialog({
            isOpen: true, title: '删除歌曲', message: '确定要删除这首歌吗？删除后无法恢复。', variant: 'danger',
            onConfirm: () => {
                deleteSong(id);
                if (activeSong?.id === id) { setActiveSong(null); setView('shelf'); }
                setConfirmDialog(null);
                addToast('已删除', 'success');
            }
        });
    };

    // --- AI Interaction ---

    const handleSendToAI = async (userMessage: string, addAsLine: boolean = false, requestedType?: 'inspiration' | 'discussion' | 'feedback') => {
        if (!activeSong || !collaborator) return;
        setIsTyping(true);
        setLastTokenUsage(null);

        let updatedSong = { ...activeSong };

        // If user wrote lyrics, add as a pending candidate (not committed yet)
        if (addAsLine && userMessage.trim()) {
            const newLine: SongLine = {
                id: `line-${Date.now()}`,
                authorId: 'user',
                content: userMessage.trim(),
                section: currentSection as SongLine['section'],
                timestamp: Date.now(),
            };
            setPendingLines(prev => [...prev, newLine]);
        }

        try {
            // Fetch recent 200 messages for context
            const recentMessages = await DB.getRecentMessagesByCharId(collaborator.id, 200);
            const msgContext = recentMessages.slice(-20).map(m => ({
                role: m.role === 'user' ? 'user' : 'assistant',
                content: m.content
            }));

            await injectMemoryPalace(collaborator, undefined, `${updatedSong.title || ''} ${userMessage}`.trim() || undefined);
            const systemPrompt = SongPrompts.buildMentorSystemPrompt(collaborator, userProfile, updatedSong, msgContext);
            let userPrompt = SongPrompts.buildUserMessage(updatedSong, userMessage, currentSection);
            if (requestedType) {
                const typeHints: Record<string, string> = {
                    inspiration: '\n\n【请求类型】: inspiration — 请用 inspiration 格式回复，提供示范歌词和创作技巧解释。',
                    discussion: '\n\n【请求类型】: discussion — 请用 discussion 格式回复，讨论创作方向和结构，不要提供示范歌词。',
                    feedback: '\n\n【请求类型】: feedback — 请用 feedback 格式回复，评价用户写的歌词。',
                };
                userPrompt += typeHints[requestedType] || '';
            }

            // Build messages array with recent chat context
            const apiMessages: { role: string; content: string }[] = [
                { role: 'system', content: systemPrompt },
            ];

            // Include last few song comments as conversation history
            const recentSongComments = updatedSong.comments.slice(-6);
            for (const c of recentSongComments) {
                apiMessages.push({ role: 'assistant', content: JSON.stringify({ type: 'feedback', reaction: c.content.substring(0, 50), feedback: c.content }) });
            }

            apiMessages.push({ role: 'user', content: userPrompt });

            const response = await fetch(`${auxApi.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${auxApi.apiKey}` },
                body: JSON.stringify({ model: auxApi.model, messages: apiMessages, temperature: 0.8, max_tokens: 2000 })
            });

            if (response.ok) {
                const data = await safeResponseJson(response);
                if (data.usage?.total_tokens) setLastTokenUsage(data.usage.total_tokens);

                const rawContent = data.choices[0].message.content.trim();
                const parsed = extractJson(rawContent);

                const newComments: SongComment[] = [];
                const baseTime = Date.now();

                if (parsed) {
                    // Add reaction as a comment
                    if (parsed.reaction) {
                        newComments.push({
                            id: `cmt-${baseTime}-r`,
                            authorId: collaborator.id,
                            type: 'reaction',
                            content: parsed.reaction,
                            timestamp: baseTime,
                        });
                    }

                    // Type-specific handling
                    if (parsed.type === 'feedback') {
                        if (parsed.feedback) {
                            newComments.push({
                                id: `cmt-${baseTime}-f`,
                                authorId: collaborator.id,
                                type: 'suggestion',
                                content: parsed.feedback,
                                timestamp: baseTime + 1,
                            });
                        }
                        if (parsed.teaching) {
                            newComments.push({
                                id: `cmt-${baseTime}-t`,
                                authorId: collaborator.id,
                                type: 'teaching',
                                content: parsed.teaching,
                                timestamp: baseTime + 2,
                            });
                        }
                        if (parsed.suggestion) {
                            newComments.push({
                                id: `cmt-${baseTime}-s`,
                                authorId: collaborator.id,
                                type: 'guidance',
                                content: parsed.suggestion,
                                timestamp: baseTime + 3,
                            });
                        }
                        if (parsed.encouragement) {
                            newComments.push({
                                id: `cmt-${baseTime}-e`,
                                authorId: collaborator.id,
                                type: 'praise',
                                content: parsed.encouragement,
                                timestamp: baseTime + 4,
                            });
                        }
                    } else if (parsed.type === 'inspiration') {
                        if (parsed.example_lines && Array.isArray(parsed.example_lines)) {
                            const exampleCandidates: SongLine[] = [];
                            for (let i = 0; i < parsed.example_lines.length; i++) {
                                exampleCandidates.push({
                                    id: `line-${baseTime}-ex${i}`,
                                    authorId: collaborator.id,
                                    content: parsed.example_lines[i],
                                    section: currentSection as SongLine['section'],
                                    annotation: '示范参考',
                                    timestamp: baseTime + 10 + i,
                                });
                            }
                            setPendingLines(prev => [...prev, ...exampleCandidates]);
                        }
                        if (parsed.explanation) {
                            newComments.push({
                                id: `cmt-${baseTime}-exp`,
                                authorId: collaborator.id,
                                type: 'teaching',
                                content: parsed.explanation,
                                timestamp: baseTime + 5,
                            });
                        }
                        if (parsed.challenge) {
                            newComments.push({
                                id: `cmt-${baseTime}-ch`,
                                authorId: collaborator.id,
                                type: 'guidance',
                                content: parsed.challenge,
                                timestamp: baseTime + 6,
                            });
                        }
                    } else if (parsed.type === 'discussion') {
                        if (parsed.content) {
                            newComments.push({
                                id: `cmt-${baseTime}-d`,
                                authorId: collaborator.id,
                                type: 'guidance',
                                content: parsed.content,
                                timestamp: baseTime + 1,
                            });
                        }
                        if (parsed.question) {
                            newComments.push({
                                id: `cmt-${baseTime}-q`,
                                authorId: collaborator.id,
                                type: 'guidance',
                                content: parsed.question,
                                timestamp: baseTime + 2,
                            });
                        }
                    }
                } else {
                    // Fallback: treat raw text as general feedback
                    newComments.push({
                        id: `cmt-${baseTime}-raw`,
                        authorId: collaborator.id,
                        type: 'suggestion',
                        content: rawContent,
                        timestamp: baseTime,
                    });
                }

                const finalSong = {
                    ...updatedSong,
                    comments: [...updatedSong.comments, ...newComments],
                };
                setActiveSong(finalSong);
                await updateSong(finalSong.id, { comments: finalSong.comments });
            } else {
                throw new Error(`API Error: ${response.status}`);
            }
        } catch (e: any) {
            addToast('请求失败: ' + e.message, 'error');
        } finally {
            setIsTyping(false);
        }
    };

    const handleSend = async () => {
        const text = inputText.trim();
        if (!text) return;
        setInputText('');
        await handleSendToAI(text, true, 'feedback');
    };

    const handleAskForHelp = async () => {
        setInputText('');
        await handleSendToAI('我不知道怎么写，能给我一些灵感和示范吗？', false, 'inspiration');
    };

    const handleDiscuss = async () => {
        const text = inputText.trim();
        if (!text) {
            await handleSendToAI('我想讨论一下接下来怎么写，有什么建议吗？', false, 'discussion');
        } else {
            setInputText('');
            await handleSendToAI(text, false, 'discussion');
        }
    };

    // --- Delete Line ---
    const handleDeleteLine = (lineId: string) => {
        if (!activeSong) return;
        const newLines = activeSong.lines.filter(l => l.id !== lineId);
        const updated = { ...activeSong, lines: newLines };
        setActiveSong(updated);
        updateSong(updated.id, { lines: newLines });
    };

    // --- Delete Feedback Group (comments) ---
    const handleDeleteFeedback = (groupId: string) => {
        if (!activeSong) return;
        // Remove all comments whose id starts with `cmt-{groupId}-`
        const newComments = activeSong.comments.filter(c => {
            const match = c.id.match(/^cmt-(\d+)-/);
            const key = match?.[1] || c.id;
            return key !== groupId;
        });
        const updated = { ...activeSong, comments: newComments };
        setActiveSong(updated);
        updateSong(updated.id, { comments: newComments });
    };

    // --- Accept / Dismiss Pending Lines ---
    const handleAcceptPending = (lineId: string) => {
        if (!activeSong) return;
        const line = pendingLines.find(l => l.id === lineId);
        if (!line) return;
        const newLines = [...activeSong.lines, line];
        const updated = { ...activeSong, lines: newLines };
        setActiveSong(updated);
        updateSong(updated.id, { lines: newLines });
        setPendingLines(prev => prev.filter(l => l.id !== lineId));
    };

    const handleDismissPending = (lineId: string) => {
        if (!activeSong) { setPendingLines(prev => prev.filter(l => l.id !== lineId)); return; }
        const line = pendingLines.find(l => l.id === lineId);
        if (!line) return;
        // Save as draft instead of discarding — it stays in the record, just not as a final lyric
        const draftLine: SongLine = { ...line, isDraft: true };
        const newLines = [...activeSong.lines, draftLine];
        const updated = { ...activeSong, lines: newLines };
        setActiveSong(updated);
        updateSong(updated.id, { lines: newLines });
        setPendingLines(prev => prev.filter(l => l.id !== lineId));
    };

    // --- Restore Draft Line to Active ---
    const handleRestoreDraft = (lineId: string) => {
        if (!activeSong) return;
        const newLines = activeSong.lines.map(l => l.id === lineId ? { ...l, isDraft: false } : l);
        const updated = { ...activeSong, lines: newLines };
        setActiveSong(updated);
        updateSong(updated.id, { lines: newLines });
    };

    // --- Edit Line ---
    const [editingLineId, setEditingLineId] = useState<string | null>(null);
    const [editLineContent, setEditLineContent] = useState('');

    const startEditLine = (line: SongLine) => {
        setEditingLineId(line.id);
        setEditLineContent(line.content);
    };

    const saveEditLine = () => {
        if (!activeSong || !editingLineId) return;
        const newLines = activeSong.lines.map(l => l.id === editingLineId ? { ...l, content: editLineContent } : l);
        const updated = { ...activeSong, lines: newLines };
        setActiveSong(updated);
        updateSong(updated.id, { lines: newLines });
        setEditingLineId(null);
    };

    // --- Completion ---
    const handleComplete = async () => {
        if (!activeSong || !collaborator) return;
        if (activeSong.lines.filter(l => !l.isDraft).length === 0) { addToast('歌曲还没有任何歌词', 'error'); return; }

        setIsCompleting(true);
        setShowPreviewModal(true);
        setCompletionReview('正在让导师评价...');

        try {
            const prompt = SongPrompts.buildCompletionPrompt(collaborator, userProfile, activeSong);
            const response = await fetch(`${auxApi.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${auxApi.apiKey}` },
                body: JSON.stringify({ model: auxApi.model, messages: [{ role: 'user', content: prompt }], temperature: 0.7, max_tokens: 500 })
            });

            if (response.ok) {
                const data = await safeResponseJson(response);
                setCompletionReview(data.choices[0].message.content.trim());
            } else {
                setCompletionReview('(评价生成失败，但不影响保存)');
            }
        } catch {
            setCompletionReview('(网络错误，但不影响保存)');
        } finally {
            setIsCompleting(false);
        }
    };

    const confirmComplete = async () => {
        if (!activeSong || !collaborator) return;
        const completed: SongSheet = {
            ...activeSong,
            status: 'completed',
            completedAt: Date.now(),
        };
        setActiveSong(completed);
        await updateSong(completed.id, { status: 'completed', completedAt: completed.completedAt });

        // Send system message to chat
        const genreInfo = SONG_GENRES.find(g => g.id === completed.genre);
        await DB.saveMessage({
            charId: collaborator.id,
            role: 'system',
            type: 'text',
            content: `[系统: ${userProfile.name} 和 ${collaborator.name} 一起完成了歌曲创作《${completed.title}》(${genreInfo?.label || completed.genre})]`,
        });

        setShowPreviewModal(false);
        addToast('歌曲已完成！乐谱已保存', 'success');
        setView('shelf');
    };

    // --- Share to Chat as Card ---
    const handleShareToChat = async (charId: string) => {
        if (!activeSong) return;

        // Build lyrics text (exclude draft lines)
        let lyrics = '';
        let currentSec = '';
        for (const line of activeSong.lines.filter(l => !l.isDraft)) {
            if (line.section !== currentSec) {
                currentSec = line.section;
                const secInfo = SECTION_LABELS[currentSec];
                lyrics += `\n[${secInfo?.label || currentSec}]\n`;
            }
            lyrics += `${line.content}\n`;
        }

        const genreInfo = SONG_GENRES.find(g => g.id === activeSong.genre);
        const moodInfo = SONG_MOODS.find(m => m.id === activeSong.mood);

        const cardData = {
            songId: activeSong.id,
            title: activeSong.title,
            subtitle: activeSong.subtitle,
            genre: genreInfo?.label || activeSong.genre,
            genreIcon: genreInfo?.icon || '',
            mood: moodInfo?.label || activeSong.mood,
            moodIcon: moodInfo?.icon || '',
            coverStyle: activeSong.coverStyle,
            lyrics: lyrics.trim(),
            lineCount: activeSong.lines.filter(l => !l.isDraft).length,
            status: activeSong.status,
            completedAt: activeSong.completedAt,
        };

        await DB.saveMessage({
            charId,
            role: 'user',
            type: 'score_card',
            content: JSON.stringify(cardData),
            metadata: { scoreCard: cardData },
        });

        setShowShareModal(false);
        addToast('乐谱已分享到聊天', 'success');
    };

    // --- Pause (just go back) ---
    const handlePause = () => {
        setView('shelf');
        setActiveSong(null);
        setPendingLines([]);
    };

    // --- ACE-Step audio synth (preview view) ---

    // Provider availability — detected from configured keys
    const hasMiniMaxKey = !!(apiConfig.minimaxApiKey || apiConfig.apiKey);
    const hasReplicateKey = !!apiConfig.aceStepApiKey?.trim();

    /** Pick the best default provider given keys + previous song setting. */
    const pickDefaultProvider = useCallback((song?: SongSheet | null): MusicProvider => {
        if (song?.musicProvider) {
            // Honor previous choice if its key is still configured
            if (song.musicProvider === 'ace-step' && hasReplicateKey) return 'ace-step';
            if (song.musicProvider !== 'ace-step' && hasMiniMaxKey) return song.musicProvider;
        }
        if (hasMiniMaxKey) return 'minimax-free';
        if (hasReplicateKey) return 'ace-step';
        return 'minimax-free'; // best fallback — modal will warn
    }, [hasMiniMaxKey, hasReplicateKey]);

    // Per-song voice preset persistence + reset provider on song switch
    const voicePresetStorageKey = (songId: string) => `ace-step:voice:${songId}`;
    useEffect(() => {
        if (!activeSong?.id) return;
        try {
            const stored = localStorage.getItem(voicePresetStorageKey(activeSong.id));
            setVoicePresetIdState(stored || 'auto');
        } catch {
            setVoicePresetIdState('auto');
        }
        setProvider(pickDefaultProvider(activeSong));
    }, [activeSong?.id, pickDefaultProvider]);
    const setVoicePresetId = useCallback((id: string) => {
        setVoicePresetIdState(id);
        if (activeSong?.id) {
            try { localStorage.setItem(voicePresetStorageKey(activeSong.id), id); } catch { /* ignore */ }
        }
    }, [activeSong?.id]);

    // Cooldown ticker — reads last-fire timestamp from localStorage so cooldown
    // survives reloads. Free-plan sfworker protection: 60s between requests.
    const COOLDOWN_KEY = 'ace-step:last-fire-at';
    useEffect(() => {
        const tick = () => {
            try {
                const last = parseInt(localStorage.getItem(COOLDOWN_KEY) || '0', 10);
                if (!last) { setCooldownSecsLeft(0); return; }
                const remaining = Math.max(0, Math.ceil((last + COOLDOWN_MS - Date.now()) / 1000));
                setCooldownSecsLeft(remaining);
            } catch { setCooldownSecsLeft(0); }
        };
        tick();
        const id = setInterval(tick, 500);
        return () => clearInterval(id);
    }, []);

    // Hydrate previously rendered audio when entering preview, and revoke any
    // stale blob URL when switching songs / leaving the view.
    useEffect(() => {
        let cancelled = false;
        if (view !== 'preview' || !activeSong?.audio?.assetKey) {
            // Switching away — drop the URL we last created.
            if (audioUrl && currentAudioOwnerRef.current !== activeSong?.id) {
                URL.revokeObjectURL(audioUrl);
                setAudioUrl(null);
                currentAudioOwnerRef.current = null;
            }
            setAudioError(null);
            return;
        }
        // Already showing this song's audio — nothing to do.
        if (currentAudioOwnerRef.current === activeSong.id && audioUrl) return;

        const assetKey = activeSong.audio.assetKey;
        loadSongAudioBlob(assetKey).then(result => {
            if (cancelled || !result) return;
            const url = URL.createObjectURL(result.blob);
            setAudioUrl(url);
            currentAudioOwnerRef.current = activeSong.id;
        }).catch(() => { /* ignore — user can regenerate */ });

        return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [view, activeSong?.id, activeSong?.audio?.assetKey]);

    // Cancel any in-flight generation when the component unmounts or song changes.
    useEffect(() => {
        return () => {
            audioAbortRef.current?.abort();
            audioAbortRef.current = null;
        };
    }, [activeSong?.id]);

    /**
     * Run a synth with the given provider + style prompt string. Single source
     * of truth for both modal confirm and "重录" button.
     */
    const runSynth = async (providerArg: MusicProvider, promptArg: string) => {
        if (!activeSong) return;

        // Provider-specific key check
        if (providerArg === 'ace-step') {
            if (!apiConfig.aceStepApiKey?.trim()) {
                addToast('请先在「文具盒」里填 Replicate API Token', 'error');
                return;
            }
        } else {
            if (!apiConfig.minimaxApiKey && !apiConfig.apiKey) {
                addToast('请先在「文具盒」里填 MiniMax API Key', 'error');
                return;
            }
        }

        // Cooldown gate — protects sfworker / MiniMax RPM
        if (cooldownSecsLeft > 0) {
            addToast(`冷却中，再等 ${cooldownSecsLeft}s`, 'info');
            return;
        }

        const finalLines = activeSong.lines.filter(l => !l.isDraft);
        if (finalLines.length === 0) {
            addToast('歌词是空的，先写两句再来', 'error');
            return;
        }

        const styleStr = (promptArg || '').trim() || buildAceStepTags(activeSong, voicePresetId);

        // Stamp the cooldown immediately so a same-second double-tap is blocked
        try { localStorage.setItem(COOLDOWN_KEY, String(Date.now())); } catch { /* ignore */ }
        setCooldownSecsLeft(Math.ceil(COOLDOWN_MS / 1000));

        setIsGeneratingAudio(true);
        setAudioError(null);
        setAudioGenStatus('排队中…');
        const ctrl = new AbortController();
        audioAbortRef.current = ctrl;

        // Push regen state to MusicContext so MusicApp / MiniPlayer also show progress
        const localId = localSongIdFor(activeSong.id);
        const wasInAlbumBefore = localAlbumSongs.some(s => s.id === localId);
        markRegenerating(localId, '排队中…');

        const statusMap: Record<string, string> = {
            resolving: '查询模型版本…',
            starting: '模型冷启动中…',
            processing: '生成中…',
            downloading: '下载音频…',
            done: '完成',
            cached: '已命中缓存',
        };

        try {
            let assetKey: string;
            let resultUrl: string;
            let resultMime: string;
            let cached: boolean;
            let promptHash: string;

            // Wrap status callback so it updates BOTH local dock and global music app indicator
            const pushStatus = (s: string) => {
                const friendly = statusMap[s] || s;
                setAudioGenStatus(friendly);
                markRegenerating(localId, friendly);
            };

            if (providerArg === 'ace-step') {
                const lyrics = buildAceStepLyrics(activeSong.lines);
                const input: AceStepInput = { tags: styleStr, lyrics };
                const result = await synthesizeSong(input, apiConfig, {
                    signal: ctrl.signal,
                    onStatus: pushStatus,
                    // Modal flow always means user wants a fresh take; cooldown +
                    // explicit "开始录制" click already establishes intent.
                    forceRegenerate: true,
                });
                assetKey = result.assetKey;
                resultUrl = result.url;
                resultMime = result.mimeType;
                cached = result.cached;
                promptHash = hashSongInputs(input);
            } else {
                const lyrics = buildMinimaxMusicLyrics(activeSong.lines);
                const model = providerArg === 'minimax-paid' ? 'music-2.6' : 'music-2.6-free';
                const input: MinimaxMusicInput = { model, prompt: styleStr, lyrics };
                const result = await synthesizeSongMinimax(input, apiConfig, {
                    signal: ctrl.signal,
                    onStatus: pushStatus,
                    forceRegenerate: true,
                });
                assetKey = result.assetKey;
                resultUrl = result.url;
                resultMime = result.mimeType;
                cached = result.cached;
                promptHash = hashMinimaxMusicInputs(input);
            }

            // Replace any previous blob URL on this song
            if (audioUrl && currentAudioOwnerRef.current === activeSong.id) {
                URL.revokeObjectURL(audioUrl);
            }
            setAudioUrl(resultUrl);
            currentAudioOwnerRef.current = activeSong.id;

            const audioMeta: SongAudio = {
                assetKey,
                mimeType: resultMime,
                generatedAt: Date.now(),
                provider: providerArg,
                promptHash,
                tagsUsed: styleStr,
                lyricsLineCount: finalLines.length,
            };
            const updated = { ...activeSong, audio: audioMeta, musicProvider: providerArg };
            setActiveSong(updated);
            await updateSong(activeSong.id, { audio: audioMeta, musicProvider: providerArg });
            addToast(cached ? '已命中之前生成的版本' : '出歌完成！', 'success');

            // ── 默认 like 点亮 ── 一生成出来就自动加入「一起写的歌」相册，
            // 用 char 头像作默认封面。用户依然可以点 ❤︎ 改封面 / 移除 / 去音乐 App 听。
            const authorNames = [
                userProfile?.name || '我',
                collaborator?.name || 'AI',
            ].filter(Boolean).join(' & ');
            const localSong: MusicSong = {
                id: localId,
                name: activeSong.title || '未命名',
                artists: authorNames,
                album: '一起写的歌',
                albumPic: collaborator?.avatar || '',
                duration: audioMeta.durationSec ?? finalLines.length * 5,
                fee: 0,
                local: true,
                localAssetKey: audioMeta.assetKey,
                localMimeType: audioMeta.mimeType,
                localCoverStyle: activeSong.coverStyle,
                customAuthorCharIds: collaborator?.id ? [collaborator.id] : [],
                localLyrics: buildMinimaxMusicLyrics(activeSong.lines),
            };
            addLocalSong(localSong);

            // ── 如果音乐 App 此刻正在播这首歌（重录前的旧版本），自动重播新版本 ──
            // playSong 的本地分支会从 IndexedDB 重读 blob → 用户立即听到新版本，
            // 不用手动操作。
            if (wasInAlbumBefore && currentMusicSong?.id === localId) {
                playSong(localSong, { alsoSetQueue: false });
                addToast('音乐 App 已切到新版本', 'info');
            }
        } catch (err: any) {
            if (err?.name === 'AbortError') {
                setAudioGenStatus('已取消');
            } else {
                console.error('[Music] generate failed', err);
                const msg = err?.message || String(err);
                setAudioError(msg);
                addToast(`出歌失败: ${msg.slice(0, 60)}`, 'error');
            }
        } finally {
            setIsGeneratingAudio(false);
            audioAbortRef.current = null;
            // Always clear regen state, even on error/abort
            markRegenerating(null);
        }
    };

    const handleCancelGenerate = () => {
        audioAbortRef.current?.abort();
    };

    // ── Shizuku-styled audio player wiring ──

    // Reset player state whenever the audio source changes (new render or song switch)
    useEffect(() => {
        setIsPlaying(false);
        setPlayProgress(0);
        setPlayDuration(0);
    }, [audioUrl]);

    const handleTogglePlay = useCallback(() => {
        const el = audioElRef.current;
        if (!el) return;
        if (el.paused) {
            el.play().catch(() => { /* autoplay can fail silently */ });
        } else {
            el.pause();
        }
    }, []);

    const handleSeek = useCallback((pct: number) => {
        const el = audioElRef.current;
        if (!el || !playDuration) return;
        el.currentTime = Math.max(0, Math.min(playDuration, pct * playDuration));
        setPlayProgress(el.currentTime);
    }, [playDuration]);

    const fmtTime = (s: number): string => {
        if (!isFinite(s) || s < 0) return '0:00';
        const m = Math.floor(s / 60);
        const sec = Math.floor(s % 60);
        return `${m}:${String(sec).padStart(2, '0')}`;
    };

    // ── Prompt modal: entry point + AI helper + confirm ──

    /** Open the unified "AI 出歌引导" modal — also the entry point for generation. */
    const openCustomPromptModal = () => {
        if (!activeSong) return;
        // Pre-fill the editable tags with whatever would be sent right now
        const current = activeSong.aceStepCustomTags || buildAceStepTags(activeSong, voicePresetId);
        setPromptDraft(current);
        setPromptGuidance('');
        setShowCustomPrompt(true);
    };

    /**
     * Modal "开始录制" — persist the final tags then kick off synth with them
     * passed directly (so we don't have to wait for state to flush).
     */
    const handleConfirmAndGenerate = async () => {
        if (!activeSong) return;
        if (cooldownSecsLeft > 0) {
            addToast(`冷却中，再等 ${cooldownSecsLeft}s`, 'info');
            return;
        }
        const tags = promptDraft.trim();
        if (!tags) {
            addToast('tags 不能为空', 'error');
            return;
        }
        const updatedSong = { ...activeSong, aceStepCustomTags: tags };
        setActiveSong(updatedSong);
        await updateSong(activeSong.id, { aceStepCustomTags: tags });
        setShowCustomPrompt(false);
        runSynth(provider, tags);
    };

    const handleAiWritePrompt = async () => {
        if (!activeSong) return;
        if (!auxApi.baseUrl || !auxApi.apiKey) {
            addToast('请先在「文具盒」里配置 LLM API', 'error');
            return;
        }
        setIsAiWritingPrompt(true);
        try {
            // MiniMax 是中文模型 → 输出中文 natural-language prompt
            // ACE-Step 国外模型 → 输出英文 comma-separated tags
            const lang: 'en' | 'zh' = provider === 'ace-step' ? 'en' : 'zh';
            const generated = await generatePromptViaLLM(promptGuidance.trim(), activeSong, auxApi, collaborator, undefined, lang);
            setPromptDraft(generated);
            addToast(promptGuidance.trim() ? 'AI 已结合角色生成' : `AI 凭${collaborator?.name || '角色'}的气质写了一段`, 'success');
        } catch (err: any) {
            console.error('[ACE-Step] LLM prompt failed', err);
            addToast(`生成失败: ${err?.message?.slice(0, 80) || err}`, 'error');
        } finally {
            setIsAiWritingPrompt(false);
        }
    };

    /** Reset draft tags back to whatever the preset+genre+mood combo would be. */
    const handleResetCustomPrompt = () => {
        if (!activeSong) return;
        setPromptDraft(buildAceStepTags(activeSong, voicePresetId));
    };

    // ── 喜欢 → 加入「一起写的歌」专辑（同步到音乐 App） ──

    /** Stable synthetic song id derived from songId — avoids netease numeric collision. */
    const localSongIdFor = useCallback((songId: string): number => {
        // Use a hash of songId + a fixed negative offset to guarantee non-netease range
        let h = 0;
        for (let i = 0; i < songId.length; i++) {
            h = (Math.imul(31, h) + songId.charCodeAt(i)) | 0;
        }
        // Negative range is "free" — netease ids are positive 32/64-bit ints.
        return -1_000_000 - Math.abs(h);
    }, []);

    const isLikedToMusic = useMemo(() => {
        if (!activeSong) return false;
        const localId = localSongIdFor(activeSong.id);
        return localAlbumSongs.some(s => s.id === localId);
    }, [activeSong?.id, localAlbumSongs, localSongIdFor]);

    /** Compose user + char avatars side-by-side on canvas → data URL. */
    const buildDualCover = useCallback(async (charUrl: string, userUrl: string): Promise<string | null> => {
        try {
            const loadImg = (src: string) => new Promise<HTMLImageElement>((resolve, reject) => {
                const img = new Image();
                img.crossOrigin = 'anonymous';
                img.onload = () => resolve(img);
                img.onerror = reject;
                img.src = src;
            });
            const canvas = document.createElement('canvas');
            const SIZE = 400;
            canvas.width = SIZE; canvas.height = SIZE;
            const ctx = canvas.getContext('2d');
            if (!ctx) return null;

            // 樱粉 → 薰衣草 → 水蓝渐变背景
            const grad = ctx.createLinearGradient(0, 0, SIZE, SIZE);
            grad.addColorStop(0, '#f2b8c6');
            grad.addColorStop(0.5, '#c5b3e6');
            grad.addColorStop(1, '#9bcbf8');
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, SIZE, SIZE);

            // 半圆裁切左右两边 — 用户在左，char 在右
            const drawCircle = (img: HTMLImageElement, cx: number, cy: number, r: number) => {
                ctx.save();
                ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.clip();
                const ratio = Math.max(2 * r / img.width, 2 * r / img.height);
                const w = img.width * ratio; const h = img.height * ratio;
                ctx.drawImage(img, cx - w / 2, cy - h / 2, w, h);
                ctx.restore();
                // 描边
                ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
                ctx.strokeStyle = 'rgba(255,255,255,0.85)';
                ctx.lineWidth = 5;
                ctx.stroke();
            };

            const tasks: Promise<HTMLImageElement | null>[] = [
                charUrl ? loadImg(charUrl).catch(() => null) : Promise.resolve(null),
                userUrl ? loadImg(userUrl).catch(() => null) : Promise.resolve(null),
            ];
            const [charImg, userImg] = await Promise.all(tasks);
            if (userImg) drawCircle(userImg, SIZE * 0.32, SIZE * 0.55, SIZE * 0.22);
            if (charImg) drawCircle(charImg, SIZE * 0.68, SIZE * 0.55, SIZE * 0.22);

            // 顶部小标题
            ctx.fillStyle = 'rgba(255,255,255,0.95)';
            ctx.font = 'bold 22px Georgia, "Noto Serif SC", serif';
            ctx.textAlign = 'center';
            ctx.fillText('一起写的歌', SIZE / 2, SIZE * 0.18);

            try {
                return canvas.toDataURL('image/jpeg', 0.85);
            } catch {
                // CORS taint — fallback null
                return null;
            }
        } catch {
            return null;
        }
    }, []);

    /** Open the manage-album-entry modal. Always opens regardless of liked state —
     *  for liked songs it lets you edit cover / remove / go listen; for unliked
     *  (user previously removed) it re-adds. */
    const handleSendToMusicApp = async () => {
        if (!activeSong || !activeSong.audio) {
            addToast('歌还没生成出来', 'info');
            return;
        }
        // Reset modal state — pre-pick char avatar, no dual cached
        setCoverMode('char');
        setDualCoverUrl(null);
        setShowCoverConfirm(true);
    };

    /** Remove the song from local album (un-like). Closes modal. */
    const handleRemoveFromAlbum = () => {
        if (!activeSong) return;
        const localId = localSongIdFor(activeSong.id);
        removeLocalSong(localId);
        setShowCoverConfirm(false);
        addToast('已从「一起写的歌」移除', 'info');
    };

    /** Step 2: confirm cover → actually add to album + play + jump to MusicApp. */
    const handleConfirmAddToAlbum = async () => {
        if (!activeSong || !activeSong.audio) return;

        const localId = localSongIdFor(activeSong.id);
        const authorNames = [
            userProfile?.name || '我',
            collaborator?.name || 'AI',
        ].filter(Boolean).join(' & ');

        // Resolve the chosen albumPic
        let albumPic = '';
        if (coverMode === 'char') {
            albumPic = collaborator?.avatar || '';
        } else if (coverMode === 'user') {
            albumPic = userProfile?.avatar || '';
        } else if (coverMode === 'dual') {
            // Reuse cached dual URL or build now
            if (dualCoverUrl) {
                albumPic = dualCoverUrl;
            } else {
                setIsBuildingDual(true);
                const built = await buildDualCover(collaborator?.avatar || '', userProfile?.avatar || '');
                setIsBuildingDual(false);
                albumPic = built || collaborator?.avatar || '';
            }
        }

        const durationSec = activeSong.audio.durationSec
            ?? Math.max(playDuration, 0)
            ?? 0;
        const lyricsText = buildMinimaxMusicLyrics(activeSong.lines);

        const localSong: MusicSong = {
            id: localId,
            name: activeSong.title || '未命名',
            artists: authorNames,
            album: '一起写的歌',
            albumPic,
            duration: durationSec,
            fee: 0,
            local: true,
            localAssetKey: activeSong.audio.assetKey,
            localMimeType: activeSong.audio.mimeType,
            localCoverStyle: activeSong.coverStyle,
            customAuthorCharIds: collaborator?.id ? [collaborator.id] : [],
            localLyrics: lyricsText,
        };
        addLocalSong(localSong);
        setShowCoverConfirm(false);
        addToast(`已加入「一起写的歌」专辑 ❤︎`, 'success');
        playSong(localSong, { alsoSetQueue: true });
        openApp(AppID.Music);
    };

    // Pre-compute the dual cover when user picks that mode for instant preview.
    useEffect(() => {
        if (coverMode !== 'dual' || dualCoverUrl || isBuildingDual) return;
        if (!collaborator?.avatar && !userProfile?.avatar) return;
        setIsBuildingDual(true);
        buildDualCover(collaborator?.avatar || '', userProfile?.avatar || '').then(url => {
            if (url) setDualCoverUrl(url);
            setIsBuildingDual(false);
        });
    }, [coverMode, collaborator?.avatar, userProfile?.avatar, dualCoverUrl, isBuildingDual, buildDualCover]);

    /** Apply a voice-preset chip click — overwrite the draft with new tag string. */
    const applyVoicePreset = (presetId: string) => {
        if (!activeSong) return;
        setVoicePresetId(presetId);
        setPromptDraft(buildAceStepTags(activeSong, presetId));
    };

    // ==================== RENDER ====================

    // --- Shelf View ---
    if (view === 'shelf') {
        const drafts = songs.filter(s => s.status === 'draft');
        const completed = songs.filter(s => s.status === 'completed');

        const SongCard = ({ song, done }: { song: SongSheet; done: boolean }) => {
            const style = getCoverVisual(song.coverStyle);
            const char = characters.find(c => c.id === song.collaboratorId);
            const genreInfo = SONG_GENRES.find(g => g.id === song.genre);
            const moodInfo = SONG_MOODS.find(m => m.id === song.mood);
            return (
                <div className="relative group">
                    <button
                        onClick={() => { setActiveSong(song); setView(done ? 'preview' : 'write'); }}
                        className="w-full flex items-stretch text-left border-2 border-[#1c1b1a] shadow-[3px_3px_0_#1c1b1a] overflow-hidden active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-all"
                        style={{ background: PAPER_CARD }}
                    >
                        {/* 封面书脊（主题色点缀） */}
                        <div className={`w-16 shrink-0 border-r-2 border-[#1c1b1a] flex items-center justify-center ${style.className}`} style={style.style}>
                            <span className={`text-2xl ${style.textClass}`}>{genreInfo?.icon || '♪'}</span>
                        </div>
                        <div className="flex-1 p-3 min-w-0">
                            <h3 className="font-black text-sm text-[#1c1b1a] truncate" style={BRUSH}>{song.title}</h3>
                            {!done && song.subtitle && <div className="label-mono text-[7px] text-[#1c1b1a]/45 truncate mt-0.5">{song.subtitle}</div>}
                            <div className="flex items-center flex-wrap gap-x-1.5 gap-y-0.5 mt-1.5 text-[10px] text-[#1c1b1a]/55">
                                <span className="label-mono text-[7px] px-1 py-0.5 border border-[#1c1b1a] text-[#1c1b1a]/70">{genreInfo?.label}</span>
                                {done
                                    ? <span style={HAND}>{moodInfo?.icon} {moodInfo?.label}</span>
                                    : <><span style={HAND}>{song.lines.filter(l => !l.isDraft).length} 行</span>{song.lines.some(l => l.isDraft) && <span className="text-[#1c1b1a]/35" style={HAND}>· {song.lines.filter(l => l.isDraft).length} 草稿</span>}</>}
                                {char && <span className="inline-flex items-center gap-1" style={HAND}>· <img src={char.avatar} className="w-3.5 h-3.5 object-cover border border-[#1c1b1a]" /> {char.name}</span>}
                            </div>
                        </div>
                        {done && (
                            <span onClick={(e) => { e.stopPropagation(); setActiveSong(song); setShowShareModal(true); }} className="self-center mr-2 w-9 h-9 flex items-center justify-center border-2 border-[#1c1b1a] bg-white shadow-[1px_1px_0_#1c1b1a] active:translate-y-[1px] transition-all" title="分享乐谱">
                                <ShareNetwork size={15} weight="bold" className="text-[#1c1b1a]" />
                            </span>
                        )}
                    </button>
                    {done && <span aria-hidden className="absolute -top-2 left-3 label-mono text-[7px] px-1.5 py-0.5 border-2 border-[#1c1b1a] bg-white text-[#1c1b1a] rotate-[-5deg] pointer-events-none">完 成</span>}
                    <button onClick={(e) => { e.stopPropagation(); handleDeleteSong(song.id); }} className="absolute -top-2 -right-2 w-6 h-6 bg-white border-2 border-[#1c1b1a] text-[#1c1b1a] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity z-10"><Trash size={12} weight="bold" /></button>
                </div>
            );
        };

        const ShelfHeading = ({ label, en, count }: { label: string; en: string; count: number }) => (
            <div className="flex items-center gap-2 mb-3">
                <span className="w-2 h-2 rounded-full bg-[#1c1b1a]" />
                <div className="label-mono text-[9px] text-[#1c1b1a]/55">{en} · {label}</div>
                <div className="flex-1 border-t-2 border-dashed border-[#1c1b1a]/25" />
                <span className="label-mono text-[8px] px-1.5 py-0.5 border border-[#1c1b1a] text-[#1c1b1a]/65">{count}</span>
            </div>
        );

        return (
            <div className="absolute inset-0 flex flex-col text-[#1c1b1a] animate-fade-in" style={{ background: PAPER, ...DOT_BG }}>
                <TopBar
                    left={<BackSticker onClick={exitApp} label="返回" />}
                    center={<><div className="label-mono text-[9px] text-[#1c1b1a]/45">LYRIC · 写歌</div><div className="text-[11px] tracking-[0.3em] text-[#1c1b1a]/45 mt-0.5">歌 词 本</div></>}
                    right={<IconStamp tone="ink" onClick={() => setView('create')} title="起个新本子"><Plus size={18} weight="bold" /></IconStamp>}
                />

                <div className="flex-1 overflow-y-auto px-4 pt-2 pb-10 space-y-7 no-scrollbar">
                    {songs.length === 0 && (
                        <div className="flex flex-col items-center justify-center h-72 gap-4 text-[#1c1b1a]/45">
                            <div className="relative">
                                <Tape className="-top-3 left-1/2 -translate-x-1/2 rotate-[-6deg] w-14" />
                                <div className="w-24 h-32 bg-white border-2 border-dashed border-[#1c1b1a]/40 flex items-center justify-center rotate-[2deg]"><MusicNotes size={40} weight="light" /></div>
                            </div>
                            <div className="text-center" style={HAND}>
                                <div className="text-lg text-[#1c1b1a]/70">本子还空着</div>
                                <div className="text-sm">点右上角 ＋ 起个头</div>
                            </div>
                        </div>
                    )}

                    {drafts.length > 0 && (
                        <div>
                            <ShelfHeading en="DRAFTS" label="写到一半" count={drafts.length} />
                            <div className="space-y-4">
                                {drafts.sort((a, b) => b.lastActiveAt - a.lastActiveAt).map(song => <SongCard key={song.id} song={song} done={false} />)}
                            </div>
                        </div>
                    )}

                    {completed.length > 0 && (
                        <div>
                            <ShelfHeading en="FINISHED" label="收工了" count={completed.length} />
                            <div className="space-y-4">
                                {completed.sort((a, b) => (b.completedAt || b.lastActiveAt) - (a.completedAt || a.lastActiveAt)).map(song => <SongCard key={song.id} song={song} done={true} />)}
                            </div>
                        </div>
                    )}
                </div>

                <CollageModal isOpen={showShareModal} title="寄一张乐谱" kicker="SHARE SCORE" onClose={() => setShowShareModal(false)}>
                    <p className="text-sm text-[#1c1b1a]/55 mb-3" style={HAND}>挑个人，把这张乐谱卡片塞进 TA 的聊天</p>
                    <div className="space-y-2.5">
                        {characters.map(c => (
                            <button key={c.id} onClick={() => handleShareToChat(c.id)} className="w-full flex items-center gap-3 p-2.5 border-2 border-[#1c1b1a] bg-white shadow-[2px_2px_0_#1c1b1a] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-all text-left">
                                <img src={c.avatar} className="w-9 h-9 object-cover border border-[#1c1b1a]" />
                                <span className="font-black text-sm text-[#1c1b1a]" style={BRUSH}>{c.name}</span>
                            </button>
                        ))}
                    </div>
                </CollageModal>

                <CollageConfirm isOpen={!!confirmDialog} title={confirmDialog?.title || ''} message={confirmDialog?.message || ''} variant={confirmDialog?.variant} confirmText={confirmDialog?.confirmText} cancelText="算了" onConfirm={confirmDialog?.onConfirm || (() => {})} onCancel={() => setConfirmDialog(null)} />
            </div>
        );
    }

    // --- Create View ---
    if (view === 'create') {
        const StepHead = ({ no, cn, en }: { no: string; cn: string; en: string }) => (
            <div className="flex items-baseline gap-2 mb-2">
                <span className="font-display-italic text-3xl leading-none text-[#1c1b1a]">{no}</span>
                <span className="text-base font-black text-[#1c1b1a]" style={BRUSH}>{cn}</span>
                <span className="label-mono text-[8px] text-[#1c1b1a]/40">{en}</span>
            </div>
        );
        return (
            <div className="absolute inset-0 flex flex-col text-[#1c1b1a] animate-fade-in" style={{ background: PAPER, ...GRID_BG }}>
                <TopBar
                    left={<BackSticker onClick={() => setView('shelf')} label="回本子" />}
                    center={<><div className="label-mono text-[9px] text-[#1c1b1a]/45">NEW SCORE</div><div className="text-[11px] tracking-[0.3em] text-[#1c1b1a]/45 mt-0.5">起 个 头</div></>}
                />

                <div className="flex-1 overflow-y-auto px-4 pt-2 pb-28 space-y-6 no-scrollbar">
                    {/* 01 歌名 */}
                    <div className="relative bg-white border-2 border-[#1c1b1a] shadow-[3px_3px_0_#1c1b1a] p-4 rotate-[-0.4deg]">
                        <Tape className="-top-2.5 right-6 rotate-[4deg] w-14" />
                        <StepHead no="01" cn="歌名" en="TITLE" />
                        <input value={tempTitle} onChange={e => setTempTitle(e.target.value)} placeholder="先给它起个名字" className="w-full text-2xl bg-transparent border-b-2 border-[#1c1b1a]/30 py-1 outline-none focus:border-[#1c1b1a] placeholder:text-[#1c1b1a]/25" style={BRUSH} />
                    </div>

                    {/* 02 副标题 */}
                    <div className="bg-white border-2 border-[#1c1b1a] shadow-[3px_3px_0_#1c1b1a] p-4 rotate-[0.3deg]">
                        <StepHead no="02" cn="副标题" en="SUBTITLE" />
                        <input value={tempSubtitle} onChange={e => setTempSubtitle(e.target.value)} placeholder="一句话，它想说什么？" className="w-full text-sm bg-transparent border-b border-dashed border-[#1c1b1a]/30 py-1.5 outline-none focus:border-[#1c1b1a] text-[#1c1b1a]/75 placeholder:text-[#1c1b1a]/30" style={HAND} />
                    </div>

                    {/* 03 风格 */}
                    <div>
                        <StepHead no="03" cn="风格" en="GENRE" />
                        <div className="flex flex-wrap gap-2">
                            {SONG_GENRES.map(g => (
                                <Chip key={g.id} active={tempGenre === g.id} onClick={() => setTempGenre(g.id)}>{g.label}</Chip>
                            ))}
                        </div>
                    </div>

                    {/* 04 情绪 */}
                    <div>
                        <StepHead no="04" cn="情绪" en="MOOD" />
                        <div className="grid grid-cols-4 gap-2">
                            {SONG_MOODS.map(m => { const on = tempMood === m.id; return (
                                <button key={m.id} onClick={() => setTempMood(m.id)} className={`flex flex-col items-center gap-1 py-2 border-2 border-[#1c1b1a] transition-all ${on ? 'bg-[#1c1b1a] text-[#f2f0e9] translate-x-[1px] translate-y-[1px] shadow-none' : 'bg-white text-[#1c1b1a] shadow-[2px_2px_0_#1c1b1a] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none'}`}>
                                    <span className="text-lg leading-none">{m.icon}</span>
                                    <span className="text-[10px] font-bold">{m.label}</span>
                                </button>
                            ); })}
                        </div>
                    </div>

                    {/* 05 歌词结构 */}
                    <div>
                        <StepHead no="05" cn="骨架" en="STRUCTURE" />
                        <p className="text-xs text-[#1c1b1a]/50 mb-2.5 -mt-1" style={HAND}>挑个结构当骨架，之后随便改</p>
                        <div className="grid grid-cols-2 gap-3">
                            {LYRIC_TEMPLATES.map(t => {
                                const active = tempTemplate === t.id;
                                const totalLines = t.structure.reduce((sum, s) => sum + s.lines, 0);
                                return (
                                    <button key={t.id} onClick={() => setTempTemplate(t.id)} className={`relative text-left p-3 border-2 border-[#1c1b1a] transition-all ${active ? 'bg-[#1c1b1a] text-[#f2f0e9] translate-x-[1px] translate-y-[1px] shadow-none' : 'bg-white text-[#1c1b1a] shadow-[3px_3px_0_#1c1b1a] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none'}`}>
                                        <div className="flex items-center gap-1.5 mb-1">
                                            <span className="text-base leading-none">{t.icon}</span>
                                            <span className="text-sm font-black" style={BRUSH}>{t.label}</span>
                                            {totalLines > 0 && <span className={`label-mono text-[7px] ml-auto ${active ? 'text-[#f2f0e9]/70' : 'text-[#1c1b1a]/45'}`}>{totalLines} 句</span>}
                                        </div>
                                        <div className={`text-[10px] leading-snug ${active ? 'text-[#f2f0e9]/75' : 'text-[#1c1b1a]/55'}`} style={HAND}>{t.desc}</div>
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                </div>

                {/* 下一步：去找搭子 */}
                <div className="absolute bottom-0 w-full px-4 pt-5 pb-6 pb-safe" style={{ background: `linear-gradient(to top, ${PAPER} 70%, ${PAPER}00 100%)` }}>
                    <InkButton tone="ink" onClick={handleGoPartner} className="w-full py-4 text-base">
                        下一步 · 去找搭子 <CaretRight size={18} weight="bold" />
                    </InkButton>
                </div>
            </div>
        );
    }

    // --- Partner View (Step 2 of create flow) ---
    if (view === 'partner') {
        return (
            <div className="absolute inset-0 flex flex-col text-[#1c1b1a] animate-fade-in" style={{ background: PAPER, ...DOT_BG }}>
                <TopBar
                    left={<BackSticker onClick={() => setView('create')} label="上一步" />}
                    center={<><div className="label-mono text-[9px] text-[#1c1b1a]/45">PARTNER</div><div className="text-[11px] tracking-[0.3em] text-[#1c1b1a]/45 mt-0.5">找 搭 子</div></>}
                />
                <p className="text-center pb-3 px-6 text-sm text-[#1c1b1a]/55" style={HAND}>挑个角色，陪你把这首歌凑出来</p>

                <div className="flex-1 overflow-y-auto px-4 pb-28 space-y-6 no-scrollbar">
                    {/* 搭子名单 */}
                    <div className="space-y-2.5">
                        {characters.map(c => { const active = tempCollaboratorId === c.id; return (
                            <button key={c.id} onClick={() => setTempCollaboratorId(c.id)} className={`w-full flex items-center gap-3 p-3 border-2 border-[#1c1b1a] text-left transition-all ${active ? 'bg-[#1c1b1a] text-[#f2f0e9] translate-x-[1px] translate-y-[1px] shadow-none' : 'bg-white text-[#1c1b1a] shadow-[3px_3px_0_#1c1b1a] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none'}`}>
                                <img src={c.avatar} className="w-12 h-12 object-cover border-2 border-current shrink-0" />
                                <div className="flex-1 min-w-0">
                                    <div className="font-black text-sm" style={BRUSH}>{c.name}</div>
                                    <div className={`text-[10px] truncate leading-snug mt-0.5 ${active ? 'text-[#f2f0e9]/70' : 'text-[#1c1b1a]/55'}`} style={HAND}>{c.description || '当你的音乐搭子'}</div>
                                </div>
                                {active && <span className="w-6 h-6 rounded-full bg-[#f2f0e9] text-[#1c1b1a] flex items-center justify-center shrink-0"><Check size={12} weight="bold" /></span>}
                            </button>
                        ); })}
                        {characters.length === 0 && (
                            <div className="p-5 text-center border-2 border-dashed border-[#1c1b1a]/40 text-sm text-[#1c1b1a]/45" style={HAND}>还没有可选角色 — 先去捏一个</div>
                        )}
                    </div>

                    {/* 纸张色调 */}
                    <div>
                        <SectionTitle en="PAPER TONE" cn="纸张色调" className="mb-2.5" />
                        <div className="flex gap-3 overflow-x-auto no-scrollbar pb-1">
                            {COVER_STYLES.map(s => { const active = tempCoverStyle === s.id; return (
                                <button key={s.id} onClick={() => setTempCoverStyle(s.id)} className="shrink-0 flex flex-col items-center gap-1" title={s.label}>
                                    <div className={`w-12 h-14 border-2 border-[#1c1b1a] bg-gradient-to-br ${s.gradient} ${active ? 'shadow-[2px_2px_0_#1c1b1a] -translate-y-0.5' : 'opacity-80'} flex items-end justify-center pb-1`}>{active && <span className="w-2 h-2 rounded-full bg-[#1c1b1a]" />}</div>
                                    <span className={`label-mono text-[7px] ${active ? 'text-[#1c1b1a]' : 'text-[#1c1b1a]/45'}`}>{s.label}</span>
                                </button>
                            ); })}
                            <button onClick={() => setTempCoverStyle(buildCustomCoverStyleId())} className="shrink-0 flex flex-col items-center gap-1" title="自定义">
                                <div className={`w-12 h-14 border-2 border-[#1c1b1a] ${isCustomCoverStyle(tempCoverStyle) ? 'shadow-[2px_2px_0_#1c1b1a] -translate-y-0.5' : 'opacity-80'} flex items-end justify-center pb-1`} style={{ backgroundImage: `linear-gradient(135deg, ${customCoverFrom} 0%, ${customCoverVia} 50%, ${customCoverTo} 100%)` }}>{isCustomCoverStyle(tempCoverStyle) && <span className="w-2 h-2 rounded-full bg-white" />}</div>
                                <span className={`label-mono text-[7px] ${isCustomCoverStyle(tempCoverStyle) ? 'text-[#1c1b1a]' : 'text-[#1c1b1a]/45'}`}>自调</span>
                            </button>
                        </div>
                    </div>

                    {/* 自己调色 */}
                    <div>
                        <SectionTitle en="MIX YOUR OWN" cn="自己调色" className="mb-2.5" />
                        <div className="bg-white border-2 border-[#1c1b1a] shadow-[3px_3px_0_#1c1b1a] p-4">
                            <div className="grid grid-cols-3 gap-3">
                                {[
                                    { label: '起手', color: customCoverFrom, position: 'from' as const },
                                    { label: '过渡', color: customCoverVia, position: 'via' as const },
                                    { label: '收尾', color: customCoverTo,  position: 'to' as const }
                                ].map(item => (
                                    <label key={item.label} className="space-y-1.5">
                                        <span className="label-mono text-[8px] text-[#1c1b1a]/55 block">{item.label}</span>
                                        <div className="overflow-hidden border-2 border-[#1c1b1a]" style={{ height: 32, background: item.color }}>
                                            <input type="color" value={item.color} onChange={(e) => updateCustomCoverColor(item.position, e.target.value)} className="w-full h-full opacity-0 cursor-pointer" />
                                        </div>
                                    </label>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>

                {/* 翻开第一页 */}
                <div className="absolute bottom-0 w-full px-4 pt-5 pb-6 pb-safe" style={{ background: `linear-gradient(to top, ${PAPER} 70%, ${PAPER}00 100%)` }}>
                    <InkButton tone="ink" onClick={handleCreate} disabled={!tempCollaboratorId} className="w-full py-4 text-base">
                        <Feather size={18} weight="fill" /> 翻开第一页 · 开写
                    </InkButton>
                </div>
            </div>
        );
    }

    // --- Preview View (completed songs) ---
    if (view === 'preview' && activeSong) {
        const style = getCoverVisual(activeSong.coverStyle);
        const genreInfo = SONG_GENRES.find(g => g.id === activeSong.genre);
        const moodInfo = SONG_MOODS.find(m => m.id === activeSong.mood);
        const LYRIC: React.CSSProperties = { fontFamily: "'Shippori Mincho','Noto Serif SC',serif" };

        let currentSec = '';
        return (
            <div className="absolute inset-0 flex flex-col text-[#1c1b1a] overflow-hidden" style={{ background: PAPER }}>
                {/* 封面 / 扉页 —— 主题色横幅 + 钉上去的标题纸 */}
                <div className={`relative shrink-0 border-b-2 border-[#1c1b1a] ${style.className} ${style.textClass}`} style={{ ...style.style, minHeight: '212px' }}>
                    <button onClick={() => { setView('shelf'); setActiveSong(null); }} className="absolute left-4 z-10 w-9 h-9 flex items-center justify-center border-2 border-[#1c1b1a] bg-white text-[#1c1b1a] shadow-[2px_2px_0_#1c1b1a] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-all" style={{ top: 'calc(var(--safe-top) + 0.75rem)' }}>
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" /></svg>
                    </button>
                    <button onClick={() => { setShowShareModal(true); }} className="absolute right-4 z-10 w-9 h-9 flex items-center justify-center border-2 border-[#1c1b1a] bg-white text-[#1c1b1a] shadow-[2px_2px_0_#1c1b1a] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-all" style={{ top: 'calc(var(--safe-top) + 0.75rem)' }}>
                        <ShareNetwork size={16} weight="bold" />
                    </button>
                    {/* 钉在封面上的标题纸（任意底色都看得清） */}
                    <div className="flex flex-col items-center justify-end h-full px-8 pb-7" style={{ paddingTop: 'calc(var(--safe-top) + 3.5rem)' }}>
                        <div className="relative bg-white border-2 border-[#1c1b1a] shadow-[4px_4px_0_#1c1b1a] px-6 py-5 text-center rotate-[-1deg] max-w-[85%]">
                            <Tape className="-top-2.5 left-1/2 -translate-x-1/2 rotate-[-3deg] w-20" />
                            <div className="label-mono text-[8px] text-[#1c1b1a]/45 mb-1.5">{genreInfo?.label} · {moodInfo?.icon} {moodInfo?.label}</div>
                            <h1 className="text-2xl font-black text-[#1c1b1a] leading-tight" style={BRUSH}>{activeSong.title}</h1>
                            {activeSong.subtitle && <p className="text-sm text-[#1c1b1a]/60 mt-1" style={HAND}>{activeSong.subtitle}</p>}
                            {collaborator && (
                                <div className="flex items-center justify-center gap-1.5 mt-2.5 pt-2 border-t-2 border-dashed border-[#1c1b1a]/20">
                                    <img src={collaborator.avatar} className="w-4 h-4 object-cover border border-[#1c1b1a]" />
                                    <span className="label-mono text-[7px] text-[#1c1b1a]/55">与 {collaborator.name} 合写</span>
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* 歌词内页 —— 横线纸 */}
                <div className="flex-1 overflow-y-auto px-6 py-7 no-scrollbar relative z-10 pb-44" style={{ background: PAPER, ...LINES_BG }}>
                    {activeSong.lines.filter(l => !l.isDraft).map(line => {
                        const showSection = line.section !== currentSec;
                        if (showSection) currentSec = line.section;
                        return (
                            <div key={line.id}>
                                {showSection && (
                                    <div className="mt-7 mb-3 first:mt-0 flex items-center gap-2">
                                        <span className="label-mono text-[8px] px-1.5 py-0.5 border-2 border-[#1c1b1a] bg-white text-[#1c1b1a]">{SECTION_LABELS[line.section]?.label || line.section}</span>
                                        <div className="flex-1 border-t-2 border-dashed border-[#1c1b1a]/25" />
                                    </div>
                                )}
                                <p className="text-[16px] text-[#1c1b1a]/85 leading-[2.05]" style={LYRIC}>{line.content}</p>
                            </div>
                        );
                    })}
                    {/* 收尾 */}
                    <div className="flex justify-center mt-9 text-[#1c1b1a]/35 text-sm tracking-[0.3em]" style={HAND}>— 完 —</div>
                </div>

                {/* ─── AI 出歌 / 播放坞 ─── */}
                <div className="absolute bottom-0 left-0 right-0 z-20 border-t-2 border-[#1c1b1a] pb-safe" style={{ background: PAPER_CARD }}>
                    {/* 隐藏 audio 元素，驱动自定义播放器 */}
                    {audioUrl && (
                        <audio
                            ref={audioElRef}
                            src={audioUrl}
                            onPlay={() => setIsPlaying(true)}
                            onPause={() => setIsPlaying(false)}
                            onLoadedMetadata={(e) => setPlayDuration((e.target as HTMLAudioElement).duration || 0)}
                            onTimeUpdate={(e) => setPlayProgress((e.target as HTMLAudioElement).currentTime || 0)}
                            onEnded={() => setIsPlaying(false)}
                            preload="metadata"
                            className="hidden"
                        />
                    )}

                    <div className="relative px-4 py-3">
                        {audioUrl ? (
                            // ── 状态 A：已出歌 —— 黑胶迷你播放器 ──
                            <div className="flex items-center gap-3">
                                <div className="relative w-12 h-12 rounded-full shrink-0 flex items-center justify-center border-2 border-[#1c1b1a] bg-[#1c1b1a]" style={{ animation: isPlaying ? 'shizuku-vinyl 6s linear infinite' : 'none' }}>
                                    <div className="absolute inset-1.5 rounded-full border border-[#f2f0e9]/25" />
                                    <div className="w-3.5 h-3.5 rounded-full bg-[#f2f0e9] border border-[#1c1b1a]" />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-1.5 mb-1.5">
                                        <span className="label-mono text-[7px] px-1.5 py-0.5 border border-[#1c1b1a] text-[#1c1b1a]/70">
                                            {activeSong.audio?.provider === 'ace-step' ? 'ACE-Step' : activeSong.audio?.provider === 'minimax-paid' ? 'MiniMax' : 'MiniMax 免费'}
                                        </span>
                                        {activeSong.audio?.generatedAt && (
                                            <span className="label-mono text-[7px] text-[#1c1b1a]/45">{new Date(activeSong.audio.generatedAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                                        )}
                                        <div className="flex-1" />
                                        <button
                                            onClick={handleSendToMusicApp}
                                            className={`w-7 h-7 flex items-center justify-center border-2 border-[#1c1b1a] transition-all active:translate-y-[1px] shrink-0 ${isLikedToMusic ? 'bg-[#1c1b1a] text-[#f2f0e9]' : 'bg-white text-[#1c1b1a]'}`}
                                            title={isLikedToMusic ? '已收进「一起写的歌」' : '收进音乐 App'}
                                            aria-label={isLikedToMusic ? '已喜欢' : '喜欢'}
                                        >
                                            <HeartStraight size={12} weight={isLikedToMusic ? 'fill' : 'regular'} />
                                        </button>
                                        <button
                                            onClick={openCustomPromptModal}
                                            disabled={cooldownSecsLeft > 0}
                                            className="inline-flex items-center gap-1 label-mono text-[8px] px-2 py-1 border-2 border-[#1c1b1a] bg-white text-[#1c1b1a] shadow-[1px_1px_0_#1c1b1a] active:translate-y-[1px] transition-all disabled:opacity-40"
                                            title={cooldownSecsLeft > 0 ? `缓一下 ${cooldownSecsLeft}s` : '重录一版'}
                                        >
                                            <ArrowsClockwise size={10} weight="bold" /> 重录{cooldownSecsLeft > 0 ? ` ${cooldownSecsLeft}s` : ''}
                                        </button>
                                    </div>
                                    {/* 拼贴进度条（可点击拖动） */}
                                    <div className="cursor-pointer" onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); handleSeek((e.clientX - r.left) / r.width); }}>
                                        <div className="relative h-2.5 border-2 border-[#1c1b1a] bg-white overflow-hidden">
                                            <div className="absolute inset-y-0 left-0 bg-[#1c1b1a]" style={{ width: `${playDuration ? Math.min(100, (playProgress / playDuration) * 100) : 0}%` }} />
                                        </div>
                                        <div className="flex justify-between mt-0.5 label-mono text-[7px] text-[#1c1b1a]/55"><span>{fmtTime(playProgress)}</span><span>{fmtTime(playDuration)}</span></div>
                                    </div>
                                </div>
                                <button onClick={handleTogglePlay} className="w-11 h-11 shrink-0 flex items-center justify-center border-2 border-[#1c1b1a] bg-[#1c1b1a] text-[#f2f0e9] shadow-[2px_2px_0_#1c1b1a] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-all">
                                    {isPlaying
                                        ? <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M6 5h4v14H6V5zm8 0h4v14h-4V5z" /></svg>
                                        : <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7L8 5z" /></svg>}
                                </button>
                            </div>
                        ) : isGeneratingAudio ? (
                            // ── 状态 B：录制中 ──
                            <div className="flex items-center gap-3 py-1">
                                <div className="relative w-12 h-12 shrink-0">
                                    <div className="absolute inset-0 rounded-full border-2 border-[#1c1b1a] border-t-transparent animate-spin" />
                                    <div className="absolute inset-[6px] rounded-full bg-[#1c1b1a] flex items-center justify-center"><MicrophoneStage size={15} weight="fill" className="text-[#f2f0e9]" /></div>
                                </div>
                                <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-2"><span className="text-base font-black text-[#1c1b1a]" style={BRUSH}>正在录制</span><TypingDots /></div>
                                    <div className="label-mono text-[8px] text-[#1c1b1a]/55 mt-1 truncate">{audioGenStatus || '处理中'}</div>
                                </div>
                                <button onClick={handleCancelGenerate} className="px-3 py-2 text-xs font-bold border-2 border-[#1c1b1a] bg-white text-[#1c1b1a] shadow-[2px_2px_0_#1c1b1a] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-all shrink-0">喊停</button>
                            </div>
                        ) : (
                            // ── 状态 C：空闲 —— 大按钮 ──
                            <div className="flex flex-col items-center gap-2">
                                <InkButton tone="ink" onClick={openCustomPromptModal} disabled={cooldownSecsLeft > 0} className="w-full py-3.5 text-sm tracking-[0.18em]">
                                    {cooldownSecsLeft > 0 ? `缓一下 · ${cooldownSecsLeft}s` : '✦ AI 出歌 · 让它唱出来 ✦'}
                                </InkButton>
                                {audioError ? (
                                    <div className="text-[10.5px] leading-relaxed text-center px-2 text-[#1c1b1a]"><span className="font-black">没成：</span>{audioError}</div>
                                ) : (
                                    <div className="label-mono text-[8px] text-[#1c1b1a]/45 text-center">点开调声线 / 风格 · 半分钟出一首</div>
                                )}
                            </div>
                        )}
                    </div>
                </div>

                {/* 寄乐谱 */}
                <CollageModal isOpen={showShareModal} title="寄一张乐谱" kicker="SHARE SCORE" onClose={() => setShowShareModal(false)}>
                    <p className="text-sm text-[#1c1b1a]/55 mb-3" style={HAND}>挑个人，把这张乐谱卡片寄进 TA 的聊天</p>
                    <div className="space-y-2.5">
                        {characters.map(c => (
                            <button key={c.id} onClick={() => handleShareToChat(c.id)} className="w-full flex items-center gap-3 p-2.5 border-2 border-[#1c1b1a] bg-white shadow-[2px_2px_0_#1c1b1a] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-all text-left">
                                <img src={c.avatar} className="w-9 h-9 object-cover border border-[#1c1b1a]" />
                                <span className="font-black text-sm text-[#1c1b1a]" style={BRUSH}>{c.name}</span>
                            </button>
                        ))}
                    </div>
                </CollageModal>

                {/* ─── 封面确认 —— 喜欢 → 跳音乐 App 的中间步骤 ─── */}
                <CollageModal
                    isOpen={showCoverConfirm}
                    title="配张封面"
                    kicker="ALBUM COVER"
                    onClose={() => setShowCoverConfirm(false)}
                    footer={<>
                        <button onClick={() => setShowCoverConfirm(false)} className="flex-1 py-3 text-xs font-bold border-2 border-[#1c1b1a] bg-white text-[#1c1b1a] shadow-[2px_2px_0_#1c1b1a] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-all">取消</button>
                        {isLikedToMusic && <button onClick={handleRemoveFromAlbum} className="flex-1 py-3 text-xs font-bold border-2 border-[#1c1b1a] bg-white text-[#1c1b1a] shadow-[2px_2px_0_#1c1b1a] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-all">撤下</button>}
                        <button onClick={handleConfirmAddToAlbum} disabled={isBuildingDual && coverMode === 'dual'} className="flex-[2] py-3 text-xs font-black border-2 border-[#1c1b1a] bg-[#1c1b1a] text-[#f2f0e9] shadow-[2px_2px_0_#1c1b1a] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-all disabled:opacity-50">❤ {isLikedToMusic ? '存好 · 去听' : '加入 · 去听'}</button>
                    </>}
                >
                    <div className="space-y-4">
                        {/* 大预览 */}
                        <div className="flex items-center justify-center">
                            <div className="relative w-40 h-40 border-2 border-[#1c1b1a] shadow-[4px_4px_0_#1c1b1a] overflow-hidden bg-[#f2f0e9]">
                                <Tape className="-top-2.5 left-1/2 -translate-x-1/2 rotate-[-4deg] w-16" />
                                {coverMode === 'char' && collaborator?.avatar && <img src={collaborator.avatar} alt="" className="w-full h-full object-cover" />}
                                {coverMode === 'user' && userProfile?.avatar && <img src={userProfile.avatar} alt="" className="w-full h-full object-cover" />}
                                {coverMode === 'dual' && (
                                    isBuildingDual
                                        ? <div className="w-full h-full flex items-center justify-center"><div className="w-7 h-7 border-2 border-[#1c1b1a] border-t-transparent rounded-full animate-spin" /></div>
                                        : dualCoverUrl
                                            ? <img src={dualCoverUrl} alt="" className="w-full h-full object-cover" />
                                            : <div className="w-full h-full flex items-center justify-center label-mono text-[8px] text-[#1c1b1a]/55">合影封面</div>
                                )}
                            </div>
                        </div>

                        {/* 三个候选 */}
                        <div className="grid grid-cols-3 gap-2">
                            {([
                                { id: 'char' as CoverMode, label: collaborator?.name || '搭档', src: collaborator?.avatar || '' },
                                { id: 'user' as CoverMode, label: userProfile?.name || '我', src: userProfile?.avatar || '' },
                                { id: 'dual' as CoverMode, label: '合影', src: dualCoverUrl || '' },
                            ]).map(opt => {
                                const active = opt.id === coverMode;
                                return (
                                    <button key={opt.id} onClick={() => setCoverMode(opt.id)} className={`p-2 border-2 border-[#1c1b1a] flex flex-col items-center gap-1 transition-all ${active ? 'bg-[#1c1b1a] text-[#f2f0e9] translate-x-[1px] translate-y-[1px] shadow-none' : 'bg-white text-[#1c1b1a] shadow-[2px_2px_0_#1c1b1a] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none'}`}>
                                        <div className="w-12 h-12 overflow-hidden border-2 border-current bg-[#f2f0e9]">
                                            {opt.src
                                                ? <img src={opt.src} alt="" className="w-full h-full object-cover" />
                                                : <div className="w-full h-full flex items-center justify-center">{opt.id === 'dual' && (isBuildingDual ? <div className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin" /> : <MusicNotes size={14} weight="bold" />)}</div>}
                                        </div>
                                        <span className="label-mono text-[7px] leading-tight">{opt.label}</span>
                                    </button>
                                );
                            })}
                        </div>

                        {/* 备注便签 */}
                        <div className="border-2 border-dashed border-[#1c1b1a]/40 p-3 text-[12px] leading-relaxed text-[#1c1b1a]/75" style={HAND}>
                            <div><span className="font-bold">♪</span> 《{activeSong.title}》</div>
                            <div className="mt-0.5">词曲：{userProfile?.name || '我'} & {collaborator?.name || 'AI'}</div>
                            <div className="mt-0.5">收进：一起写的歌</div>
                        </div>
                    </div>
                </CollageModal>

                {/* ─── 让 AI 唱出来 引导弹窗 ─── */}
                <CollageModal
                    isOpen={showCustomPrompt}
                    title="让 AI 唱出来"
                    kicker="MAKE IT SING"
                    onClose={() => setShowCustomPrompt(false)}
                    footer={<>
                        <button onClick={() => setShowCustomPrompt(false)} className="flex-1 py-3 text-xs font-bold border-2 border-[#1c1b1a] bg-white text-[#1c1b1a] shadow-[2px_2px_0_#1c1b1a] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-all">收起</button>
                        <button onClick={handleConfirmAndGenerate} disabled={cooldownSecsLeft > 0 || !promptDraft.trim()} className="flex-[2] py-3 text-xs font-black tracking-[0.2em] border-2 border-[#1c1b1a] bg-[#1c1b1a] text-[#f2f0e9] shadow-[2px_2px_0_#1c1b1a] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-all disabled:opacity-50">
                            {cooldownSecsLeft > 0 ? `缓一下 ${cooldownSecsLeft}s` : '✦ 开录 ✦'}
                        </button>
                    </>}
                >
                    <div className="space-y-5">
                        {/* 选生成器 */}
                        <div>
                            <div className="label-mono text-[9px] text-[#1c1b1a]/55 mb-2">CHOOSE ENGINE · 选生成器</div>
                            {(() => {
                                const opts: { id: MusicProvider; title: string; sub: string; available: boolean; needs: string }[] = [
                                    { id: 'minimax-free', title: 'MiniMax 免费', sub: '不花钱 · 完整长歌', available: hasMiniMaxKey, needs: 'MiniMax Key' },
                                    { id: 'minimax-paid', title: 'MiniMax 付费', sub: 'Token · 完整长歌', available: hasMiniMaxKey, needs: 'MiniMax Key' },
                                    { id: 'ace-step',     title: 'ACE-Step',     sub: '~$0.015 · 长歌', available: hasReplicateKey, needs: 'Replicate Token' },
                                ];
                                return (
                                    <div className="grid grid-cols-3 gap-2">
                                        {opts.map(opt => {
                                            const isActive = opt.id === provider;
                                            const Ico = PROVIDER_ICONS[opt.id] || Heart;
                                            return (
                                                <button key={opt.id} onClick={() => setProvider(opt.id)} disabled={!opt.available} className={`relative text-left p-2 border-2 border-[#1c1b1a] transition-all disabled:opacity-40 disabled:cursor-not-allowed ${isActive ? 'bg-[#1c1b1a] text-[#f2f0e9] translate-x-[1px] translate-y-[1px] shadow-none' : 'bg-white text-[#1c1b1a] shadow-[2px_2px_0_#1c1b1a] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none'}`}>
                                                    <div className="flex items-center gap-1 mb-0.5"><Ico size={13} weight={isActive ? 'fill' : 'bold'} /><span className="text-[10px] font-black leading-none">{opt.title}</span></div>
                                                    <div className={`text-[8px] leading-tight ${isActive ? 'text-[#f2f0e9]/75' : 'text-[#1c1b1a]/55'}`}>{opt.sub}</div>
                                                    {!opt.available && <div className="label-mono text-[7px] mt-0.5 leading-tight">缺 {opt.needs}</div>}
                                                </button>
                                            );
                                        })}
                                    </div>
                                );
                            })()}
                            <p className="text-[11px] leading-relaxed mt-2 text-[#1c1b1a]/55" style={HAND}>
                                {provider === 'ace-step'
                                    ? '完整长歌（最长 4 分钟）— 自费走 Replicate，约 ¥0.1-0.3/首'
                                    : provider === 'minimax-paid'
                                        ? '完整长歌（最长 4-6 分钟）— Token Plan，RPM 高'
                                        : '完整长歌（最长 4-6 分钟）— 完全免费，用你已填的 MiniMax Key'}
                            </p>
                        </div>

                        {/* I 快速选声线 */}
                        <div>
                            <div className="flex items-baseline gap-2 mb-2"><span className="font-display-italic text-xl text-[#1c1b1a]">I</span><span className="text-sm font-black text-[#1c1b1a]" style={BRUSH}>挑个声线</span><div className="flex-1 border-t-2 border-dashed border-[#1c1b1a]/25" /></div>
                            <div className="grid grid-cols-3 gap-2">
                                {VOICE_PRESETS.map(preset => {
                                    const isActive = preset.id === voicePresetId;
                                    const Ico = VOICE_ICONS[preset.id] || SparkleP;
                                    return (
                                        <button key={preset.id} onClick={() => applyVoicePreset(preset.id)} className={`py-2.5 border-2 border-[#1c1b1a] flex flex-col items-center justify-center gap-1 transition-all ${isActive ? 'bg-[#1c1b1a] text-[#f2f0e9] translate-x-[1px] translate-y-[1px] shadow-none' : 'bg-white text-[#1c1b1a] shadow-[2px_2px_0_#1c1b1a] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none'}`}>
                                            <Ico size={18} weight={isActive ? 'fill' : 'bold'} />
                                            <span className="text-[11px] font-bold leading-tight">{preset.label}</span>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        {/* II 描述风格 */}
                        <div>
                            <div className="flex items-baseline gap-2 mb-2"><span className="font-display-italic text-xl text-[#1c1b1a]">II</span><span className="text-sm font-black text-[#1c1b1a]" style={BRUSH}>说说想要的味道</span><div className="flex-1 border-t-2 border-dashed border-[#1c1b1a]/25" /></div>
                            <textarea value={promptGuidance} onChange={(e) => setPromptGuidance(e.target.value)} placeholder="慵懒的爵士女声，钢琴和萨克斯为主，60bpm，雨夜的感觉…" rows={3} className="w-full bg-white border-2 border-[#1c1b1a] px-3 py-2 text-sm resize-none outline-none focus:shadow-[2px_2px_0_#1c1b1a] transition-shadow" style={HAND} />
                            <button onClick={handleAiWritePrompt} disabled={isAiWritingPrompt} className="w-full mt-2 py-2.5 border-2 border-[#1c1b1a] bg-[#1c1b1a] text-[#f2f0e9] text-xs font-black flex items-center justify-center gap-2 active:translate-y-[2px] transition-all disabled:opacity-40">
                                {isAiWritingPrompt ? <><span className="w-3 h-3 border-2 border-[#f2f0e9] border-t-transparent rounded-full animate-spin" /> AI 琢磨中…</> : <><MagicWand size={14} weight="bold" />{promptGuidance.trim() ? `让 AI 照${collaborator?.name || '角色'}的脾性改` : `让 AI 凭${collaborator?.name || '角色'}的脾性写`}</>}
                            </button>
                            <p className="text-[11px] leading-relaxed mt-2 text-[#1c1b1a]/55" style={HAND}>AI 会读{collaborator ? `「${collaborator.name}」` : '这首歌'}的人设，自己拿主意——你不用懂音乐。</p>
                        </div>

                        {/* III 最终 prompt */}
                        <div>
                            <div className="flex items-center justify-between gap-2 mb-2">
                                <div className="flex items-baseline gap-2 min-w-0 flex-1"><span className="font-display-italic text-xl text-[#1c1b1a] shrink-0">III</span><span className="text-sm font-black text-[#1c1b1a] truncate" style={BRUSH}>最终配方 · 喂给{provider === 'ace-step' ? ' ACE-Step' : ' MiniMax'}</span></div>
                                <button onClick={handleResetCustomPrompt} className="label-mono text-[8px] text-[#1c1b1a]/55 underline decoration-dashed shrink-0">复位</button>
                            </div>
                            <textarea value={promptDraft} onChange={(e) => setPromptDraft(e.target.value)} placeholder={provider === 'ace-step' ? 'female vocal, breathy, dreamy pop, soft piano, 75 bpm, c minor' : '女声, 气声, 梦幻流行, 钢琴轻柔, 黑胶噪点, 75bpm, c 小调'} rows={3} className="w-full px-3 py-2 text-[12px] font-mono resize-none outline-none border-2 border-[#1c1b1a]" style={{ background: '#1c1b1a', color: '#f2f0e9' }} />
                            <p className="text-[11px] leading-relaxed mt-2 text-[#1c1b1a]/55" style={HAND}>
                                {provider === 'ace-step'
                                    ? '逗号分隔的英文 tag。vocal：female/male vocal、breathy/husky/sweet；风格：pop/rock/jazz/lo-fi；情绪：dreamy/upbeat/melancholy。'
                                    : '逗号分隔的中文描述（MiniMax 中文模型最好用）。例：女声 / 气声 / 慵懒哼唱 / 爵士 / 钢琴 / 黑胶噪点 / 60bpm / e 小调。'}
                            </p>
                        </div>

                        {/* 提示条 */}
                        <div className="border-2 border-dashed border-[#1c1b1a]/40 px-3 py-2 flex items-center gap-2 text-[12px] text-[#1c1b1a]/65" style={HAND}>
                            <span className="text-base">✦</span>
                            <span>{provider === 'ace-step' ? '约 30-60s 出歌 · ~¥0.1-0.3/首' : '约 30-60s 出歌 · 免费完整长歌'}</span>
                        </div>
                    </div>
                </CollageModal>
            </div>
        );
    }

    // --- Write View ---
    if (view === 'write' && activeSong) {
        const genreInfo = SONG_GENRES.find(g => g.id === activeSong.genre);

        // Interleave lines, feedback groups, and pending candidates by timestamp for display
        const lineItems = activeSong.lines.map(mkLineItem);
        const fbItems = feedbackGroups.map(mkLineItem2);
        const pendingItems = pendingLines.map(mkPendingItem);
        const timeline = [...lineItems, ...fbItems, ...pendingItems].sort((a, b) => a.data.timestamp - b.data.timestamp);

        return (
            <div className="absolute inset-0 flex flex-col text-[#1c1b1a] overflow-hidden" style={{ background: PAPER, ...DOT_BG }}>
                <CollageConfirm isOpen={!!confirmDialog} title={confirmDialog?.title || ''} message={confirmDialog?.message || ''} variant={confirmDialog?.variant} confirmText={confirmDialog?.confirmText} cancelText="算了" onConfirm={confirmDialog?.onConfirm || (() => {})} onCancel={() => setConfirmDialog(null)} />

                {/* 顶栏 */}
                <div className="shrink-0 z-20 border-b-2 border-[#1c1b1a]" style={{ background: PAPER }}>
                    <div className="relative flex items-center gap-2 px-4 pb-2" style={{ paddingTop: 'calc(var(--safe-top) + 0.6rem)' }}>
                        <BackSticker onClick={handlePause} label="暂存" />
                        <div className="flex-1 min-w-0 text-center">
                            <div className="font-black text-base text-[#1c1b1a] truncate" style={BRUSH}>{activeSong.title}</div>
                            <div className="label-mono text-[8px] text-[#1c1b1a]/55 mt-0.5">{genreInfo?.label}{lastTokenUsage ? ` · ${lastTokenUsage}t` : ''}</div>
                        </div>
                        <div className="flex items-center gap-1.5">
                            <IconStamp tone={showStructureGuide ? 'ink' : 'paper'} onClick={() => setShowStructureGuide(!showStructureGuide)} title="骨架表"><ListChecks size={18} weight="bold" /></IconStamp>
                            <IconStamp tone="ink" onClick={handleComplete} title="收工"><Check size={18} weight="bold" /></IconStamp>
                        </div>
                    </div>
                    {collaborator && (
                        <div className="px-4 pb-2 flex items-center gap-2">
                            <img src={collaborator.avatar} className="w-5 h-5 object-cover border border-[#1c1b1a]" />
                            <span className="label-mono text-[8px] text-[#1c1b1a]/55">{collaborator.name} · 一起写</span>
                        </div>
                    )}
                </div>

                {/* 骨架表（可折叠）—— 优先显示当前 song 的歌词模板 */}
                {showStructureGuide && (() => {
                    const tpl = getLyricTemplate(activeSong.lyricTemplate);
                    const writtenBySection = activeSong.lines.filter(l => !l.isDraft).reduce<Record<string, number>>((acc, l) => {
                        acc[l.section] = (acc[l.section] || 0) + 1;
                        return acc;
                    }, {});
                    return (
                        <div className="shrink-0 z-10 border-b-2 border-[#1c1b1a] p-4" style={{ background: PAPER_CARD, ...GRID_BG }}>
                            {tpl.id !== 'free' && tpl.structure.length > 0 ? (
                                <>
                                    <div className="flex items-center justify-between mb-3">
                                        <div className="flex items-center gap-1.5">
                                            <span className="text-base leading-none">{tpl.icon}</span>
                                            <h3 className="text-sm font-black text-[#1c1b1a]" style={BRUSH}>{tpl.label} · 骨架</h3>
                                        </div>
                                        <span className="label-mono text-[8px] px-1.5 py-0.5 border border-[#1c1b1a] text-[#1c1b1a]/65">已写 {activeSong.lines.filter(l => !l.isDraft).length} 句</span>
                                    </div>
                                    <p className="text-[11px] text-[#1c1b1a]/50 mb-3" style={HAND}>{tpl.desc}</p>
                                    <div className="space-y-1.5">
                                        {tpl.structure.map((sec, i) => {
                                            const written = writtenBySection[sec.section] || 0;
                                            // count this section's slot — distribute writes across repeat sections
                                            const sectionSlotIdx = tpl.structure.slice(0, i + 1).filter(s => s.section === sec.section).length - 1;
                                            const sectionTotal = tpl.structure.filter(s => s.section === sec.section).length;
                                            const writtenForSlot = sectionTotal === 1 ? written : Math.min(sec.lines, Math.max(0, written - sectionSlotIdx * sec.lines));
                                            const fullyWritten = writtenForSlot >= sec.lines;
                                            return (
                                                <div key={i} className="flex items-center gap-2 py-0.5">
                                                    <span className="label-mono text-[8px] tabular-nums w-4 text-[#1c1b1a]/35">{i + 1}</span>
                                                    <SectionBadge section={sec.section} small />
                                                    <span className="text-[10px] text-[#1c1b1a]/55" style={HAND}>{sec.lines} 句 · {sec.chars} 字</span>
                                                    <div className="flex-1 border-t border-dashed border-[#1c1b1a]/20" />
                                                    <span className={`label-mono text-[8px] tabular-nums ${fullyWritten ? 'text-[#1c1b1a] font-black' : 'text-[#1c1b1a]/40'}`}>
                                                        {writtenForSlot}/{sec.lines}{fullyWritten && ' ✓'}
                                                    </span>
                                                </div>
                                            );
                                        })}
                                    </div>
                                    <p className="text-[11px] text-[#1c1b1a]/50 mt-3 border-t-2 border-dashed border-[#1c1b1a]/20 pt-2" style={HAND}>
                                        底部「段落」切章节，照着填就行——AI 也会按这骨架给建议。
                                    </p>
                                </>
                            ) : (
                                <>
                                    <h3 className="label-mono text-[9px] text-[#1c1b1a]/55 mb-2">SONG STRUCTURE · 歌曲结构</h3>
                                    <div className="space-y-1.5">
                                        {Object.entries(SECTION_LABELS).map(([key, info]) => (
                                            <div key={key} className="flex items-center gap-2">
                                                <SectionBadge section={key} small />
                                                <span className="text-[10px] text-[#1c1b1a]/55" style={HAND}>{info.desc}</span>
                                            </div>
                                        ))}
                                    </div>
                                    <p className="text-[11px] text-[#1c1b1a]/50 mt-2 border-t-2 border-dashed border-[#1c1b1a]/20 pt-2" style={HAND}>
                                        常见走向：主歌 → 导歌 → 副歌 → 主歌 → 导歌 → 副歌 → 桥段 → 副歌
                                    </p>
                                </>
                            )}
                        </div>
                    );
                })()}

                {/* 时间线 */}
                <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3 no-scrollbar pb-48 relative z-10" ref={scrollRef} onClick={() => longPressLineId && setLongPressLineId(null)}>
                    {timeline.length === 0 && (
                        <div className="flex flex-col items-center justify-center py-20 text-center text-[#1c1b1a]/45">
                            <div className="relative mb-4">
                                <Tape className="-top-3 left-1/2 -translate-x-1/2 rotate-[-6deg] w-12" />
                                <div className="w-20 h-24 bg-white border-2 border-dashed border-[#1c1b1a]/40 flex items-center justify-center rotate-[-2deg]"><MusicNotes size={32} weight="light" /></div>
                            </div>
                            <p className="text-lg text-[#1c1b1a]/70" style={HAND}>写下第一句</p>
                            <p className="text-sm mt-1" style={HAND}>像在纸上慢慢落笔</p>
                        </div>
                    )}

                    {timeline.map(item => {
                        if (item.kind === 'line') {
                            const line = item.data;
                            const isUser = line.authorId === 'user';
                            const author = isUser ? null : characters.find(c => c.id === line.authorId);

                            // --- 草稿行 ---
                            if (line.isDraft) {
                                return (
                                    <div key={line.id} className="group relative">
                                        <div className="p-3 border-2 border-dashed border-[#1c1b1a]/40 bg-white/60">
                                            <div className="flex items-center gap-2 mb-1.5">
                                                <SectionBadge section={line.section} small />
                                                <span className="label-mono text-[7px] text-[#1c1b1a]/55">{isUser ? '我' : author?.name}</span>
                                                <span className="label-mono text-[7px] px-1 border border-[#1c1b1a]/50 text-[#1c1b1a]/55">草稿</span>
                                                {line.annotation && <span className="label-mono text-[7px] px-1 border border-[#1c1b1a]/40 text-[#1c1b1a]/45">{line.annotation}</span>}
                                            </div>
                                            <p className="text-sm text-[#1c1b1a]/45 leading-relaxed" style={{ fontFamily: "'Shippori Mincho','Noto Serif SC',serif" }}>{line.content}</p>
                                            <div className="flex gap-2 mt-2 pt-1.5 border-t-2 border-dashed border-[#1c1b1a]/20">
                                                <button onClick={() => handleRestoreDraft(line.id)} className="flex-1 py-1 text-[10px] font-bold text-[#1c1b1a] bg-white border-2 border-[#1c1b1a] active:translate-y-[1px] transition-all">捡回来</button>
                                                <button onClick={() => handleDeleteLine(line.id)} className="px-3 py-1 text-[10px] text-[#1c1b1a]/50 hover:text-[#1c1b1a] transition-colors">扔掉</button>
                                            </div>
                                        </div>
                                    </div>
                                );
                            }

                            if (editingLineId === line.id) {
                                return (
                                    <div key={line.id} className="bg-white p-3 border-2 border-[#1c1b1a] shadow-[2px_2px_0_#1c1b1a]">
                                        <div className="flex items-center gap-2 mb-2">
                                            <SectionBadge section={line.section} small />
                                            <span className="label-mono text-[7px] text-[#1c1b1a]/55">改写中</span>
                                        </div>
                                        <textarea value={editLineContent} onChange={e => setEditLineContent(e.target.value)} className="w-full bg-white border-2 border-[#1c1b1a] p-2 text-sm resize-none focus:outline-none text-[#1c1b1a]" rows={2} style={{ fontFamily: "'Shippori Mincho','Noto Serif SC',serif" }} />
                                        <div className="flex gap-2 mt-2">
                                            <button onClick={saveEditLine} className="px-3 py-1 bg-[#1c1b1a] text-[#f2f0e9] text-xs font-black border-2 border-[#1c1b1a] active:translate-y-[1px]">改好</button>
                                            <button onClick={() => setEditingLineId(null)} className="px-3 py-1 bg-white text-[#1c1b1a] text-xs font-bold border-2 border-[#1c1b1a] active:translate-y-[1px]">不改了</button>
                                        </div>
                                    </div>
                                );
                            }

                            return (
                                <div key={line.id} className="group relative"
                                    onTouchStart={(e) => handleLineTouchStart(e, line.id)}
                                    onTouchMove={handleLineTouchMove}
                                    onTouchEnd={handleLineTouchEnd}
                                    onContextMenu={(e) => { e.preventDefault(); setLongPressLineId(line.id); }}
                                >
                                    <div className={`p-3 border-2 border-[#1c1b1a] shadow-[2px_2px_0_#1c1b1a] ${isUser ? 'bg-white' : 'bg-[#fdf6b2]/55'}`}>
                                        <div className="flex items-center gap-2 mb-1.5">
                                            <SectionBadge section={line.section} small />
                                            <span className="label-mono text-[7px] text-[#1c1b1a]/55">{isUser ? '我' : author?.name}</span>
                                            {line.annotation && <span className="label-mono text-[7px] px-1 border border-[#1c1b1a]/40 text-[#1c1b1a]/55">{line.annotation}</span>}
                                        </div>
                                        <p className="text-[15px] text-[#1c1b1a]/85 leading-relaxed" style={{ fontFamily: "'Shippori Mincho','Noto Serif SC',serif" }}>{line.content}</p>
                                    </div>
                                    {/* 悬浮操作（桌面） */}
                                    <div className="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 flex gap-1 transition-opacity">
                                        <button onClick={() => startEditLine(line)} className="w-6 h-6 bg-white border-2 border-[#1c1b1a] flex items-center justify-center text-[#1c1b1a] active:translate-y-[1px]"><PencilSimple size={11} weight="bold" /></button>
                                        <button onClick={() => handleDeleteLine(line.id)} className="w-6 h-6 bg-white border-2 border-[#1c1b1a] flex items-center justify-center text-[#1c1b1a] active:translate-y-[1px]"><Trash size={11} weight="bold" /></button>
                                    </div>
                                    {/* 长按菜单（移动端） */}
                                    {longPressLineId === line.id && (
                                        <div className="absolute top-0 right-0 z-20 bg-white border-2 border-[#1c1b1a] shadow-[2px_2px_0_#1c1b1a] py-1 min-w-[96px]">
                                            <button onClick={() => { startEditLine(line); setLongPressLineId(null); }} className="w-full text-left px-3 py-2 text-xs font-bold text-[#1c1b1a] hover:bg-[#f2f0e9]">改写</button>
                                            <button onClick={() => { handleDeleteLine(line.id); setLongPressLineId(null); }} className="w-full text-left px-3 py-2 text-xs font-bold text-[#1c1b1a] hover:bg-[#f2f0e9] border-t-2 border-dashed border-[#1c1b1a]/25">删掉</button>
                                        </div>
                                    )}
                                </div>
                            );
                        }

                        // 候选行
                        if (item.kind === 'pending') {
                            const line = item.data;
                            const isUser = line.authorId === 'user';
                            const author = isUser ? null : characters.find(c => c.id === line.authorId);

                            return (
                                <div key={line.id} className="relative">
                                    <div className="p-3 border-2 border-dashed border-[#1c1b1a] bg-white/70">
                                        <div className="flex items-center gap-2 mb-1.5">
                                            <SectionBadge section={line.section} small />
                                            <span className="label-mono text-[7px] text-[#1c1b1a]/55">{isUser ? '我' : author?.name}</span>
                                            <span className="label-mono text-[7px] px-1 border-2 border-[#1c1b1a] bg-[#1c1b1a] text-[#f2f0e9]">{isUser ? '待点头' : '示范参考'}</span>
                                        </div>
                                        <p className="text-[15px] text-[#1c1b1a]/85 leading-relaxed" style={{ fontFamily: "'Shippori Mincho','Noto Serif SC',serif" }}>{line.content}</p>
                                        <div className="flex gap-2 mt-2.5 pt-2 border-t-2 border-dashed border-[#1c1b1a]/25">
                                            <button onClick={() => handleAcceptPending(line.id)} className="flex-1 py-1.5 bg-[#1c1b1a] text-[#f2f0e9] text-xs font-black border-2 border-[#1c1b1a] active:translate-y-[1px] transition-all">收下</button>
                                            <button onClick={() => handleDismissPending(line.id)} className="flex-1 py-1.5 bg-white text-[#1c1b1a] text-xs font-bold border-2 border-[#1c1b1a] active:translate-y-[1px] transition-all">不要</button>
                                        </div>
                                    </div>
                                </div>
                            );
                        }

                        // 反馈卡
                        const feedback = item.data as { id: string; timestamp: number; reaction?: SongComment; details: SongComment[] };
                        const lead = feedback.reaction || feedback.details[0];
                        const commentAuthor = characters.find(c => c.id === lead?.authorId);
                        const isExpanded = !!expandedFeedbackIds[feedback.id];
                        const detailMeta: Record<string, { label: string }> = {
                            guidance: { label: '引导' },
                            teaching: { label: '拆解' },
                            suggestion: { label: '建议' },
                            praise: { label: '鼓励' },
                        };

                        return (
                            <div key={feedback.id} className="group/fb relative">
                                <div className="bg-white border-2 border-[#1c1b1a] shadow-[2px_2px_0_#1c1b1a] p-3.5">
                                    <div className="flex items-start gap-2.5">
                                        {commentAuthor && <img src={commentAuthor.avatar} className="w-7 h-7 object-cover border-2 border-[#1c1b1a] shrink-0" />}
                                        <div className="flex-1">
                                            <p className="label-mono text-[7px] text-[#1c1b1a]/50 mb-1">{commentAuthor?.name || '搭档'} 说</p>
                                            <p className="text-sm text-[#1c1b1a]/75 leading-relaxed whitespace-pre-wrap" style={HAND}>{lead?.content || '我在这儿，陪你把下一句写出来。'}</p>
                                        </div>
                                    </div>
                                    <button onClick={() => handleDeleteFeedback(feedback.id)} className="absolute -top-2 -right-2 w-5 h-5 bg-white border-2 border-[#1c1b1a] text-[#1c1b1a] text-xs leading-none flex items-center justify-center opacity-0 group-hover/fb:opacity-100 transition-opacity" title="撕掉这条">✕</button>
                                    {feedback.details.length > 0 && (
                                        <div className="mt-3">
                                            <button onClick={() => toggleFeedback(feedback.id)} className="label-mono text-[8px] px-2 py-1 border-2 border-[#1c1b1a] bg-white text-[#1c1b1a] active:translate-y-[1px] transition-all">
                                                {isExpanded ? '收起' : '看细节'}
                                            </button>
                                            {isExpanded && (
                                                <div className="mt-3 space-y-2 border-t-2 border-dashed border-[#1c1b1a]/25 pt-3">
                                                    {feedback.details.map(detail => {
                                                        const meta = detailMeta[detail.type] || { label: '补充' };
                                                        return (
                                                            <div key={detail.id} className="border-l-4 border-[#1c1b1a] bg-[#f2f0e9] pl-3 py-2 pr-2">
                                                                <p className="label-mono text-[7px] text-[#1c1b1a]/50 mb-1">{meta.label}</p>
                                                                <p className="text-xs text-[#1c1b1a]/70 leading-6 whitespace-pre-wrap" style={HAND}>{detail.content}</p>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </div>
                        );
                    })}

                    {isTyping && (
                        <div className="flex gap-2 items-center">
                            {collaborator && <img src={collaborator.avatar} className="w-6 h-6 object-cover border-2 border-[#1c1b1a]" />}
                            <div className="px-3 py-2.5 bg-white border-2 border-[#1c1b1a] shadow-[2px_2px_0_#1c1b1a]"><TypingDots /></div>
                        </div>
                    )}
                </div>

                {/* 输入区 */}
                <div className="absolute bottom-0 w-full border-t-2 border-[#1c1b1a] z-30 pb-safe" style={{ background: PAPER_CARD }}>
                    {/* 段落选择 */}
                    <div className="flex gap-1.5 px-4 py-2 overflow-x-auto no-scrollbar border-b-2 border-dashed border-[#1c1b1a]/25">
                        {Object.entries(SECTION_LABELS).map(([key, info]) => (
                            <button key={key} onClick={() => setCurrentSection(key)} className={`px-2.5 py-1 text-[10px] font-bold whitespace-nowrap border-2 border-[#1c1b1a] transition-all ${currentSection === key ? 'bg-[#1c1b1a] text-[#f2f0e9]' : 'bg-white text-[#1c1b1a] active:translate-y-[1px]'}`}>
                                {info.label}
                            </button>
                        ))}
                    </div>

                    {/* 快捷动作 */}
                    <div className="flex gap-2 px-4 py-1.5 border-b-2 border-dashed border-[#1c1b1a]/25 items-center">
                        <button onClick={handleAskForHelp} disabled={isTyping} className="px-2.5 py-1 text-[10px] font-bold text-[#1c1b1a] border-2 border-[#1c1b1a] bg-white active:translate-y-[1px] disabled:opacity-40 transition-all">讨灵感</button>
                        <button
                            onClick={handleDiscuss}
                            disabled={isTyping}
                            className={`px-2.5 py-1 text-[10px] font-bold border-2 border-[#1c1b1a] disabled:opacity-40 transition-all active:translate-y-[1px] ${inputText.trim() ? 'bg-[#1c1b1a] text-[#f2f0e9]' : 'bg-white text-[#1c1b1a]'}`}
                            title={inputText.trim() ? '把输入框的内容当作讨论发出（不计入歌词）' : '聊聊创作方向'}
                        >
                            {inputText.trim() ? '只是聊聊' : '聊两句'}
                        </button>
                        {inputText.trim() && <span className="label-mono text-[7px] text-[#1c1b1a]/45 ml-auto pr-1">发送→入词 · 只是聊聊→讨论</span>}
                    </div>

                    {/* 文本输入 */}
                    <div className="p-3 flex gap-2 items-end">
                        <textarea
                            value={inputText}
                            onChange={e => setInputText(e.target.value)}
                            placeholder="写一句词，或点「聊两句」聊聊创作……"
                            className="flex-1 bg-white border-2 border-[#1c1b1a] px-3 py-2.5 text-sm text-[#1c1b1a] outline-none resize-none max-h-32 placeholder:text-[#1c1b1a]/35 focus:shadow-[2px_2px_0_#1c1b1a] transition-shadow"
                            rows={1}
                            style={{ minHeight: '46px', fontFamily: "'Shippori Mincho','Noto Serif SC',serif" }}
                            onKeyDown={e => {
                                if (e.key === 'Enter' && !e.shiftKey) {
                                    e.preventDefault();
                                    handleSend();
                                }
                            }}
                        />
                        <button
                            onClick={handleSend}
                            disabled={isTyping || !inputText.trim()}
                            className={`w-11 h-11 flex items-center justify-center border-2 border-[#1c1b1a] shadow-[2px_2px_0_#1c1b1a] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-all shrink-0 disabled:opacity-40 ${inputText.trim() ? 'bg-[#1c1b1a] text-[#f2f0e9]' : 'bg-white text-[#1c1b1a]'}`}
                            title="入词"
                        >
                            <PaperPlaneRight size={17} weight="bold" />
                        </button>
                    </div>
                </div>

                {/* 收工弹窗 */}
                <CollageModal isOpen={showPreviewModal} title="收工啦" kicker="WRAP IT UP" onClose={() => setShowPreviewModal(false)} footer={isCompleting ? <div className="w-full py-3 border-2 border-dashed border-[#1c1b1a]/40 text-[#1c1b1a]/55 font-black text-center text-sm flex items-center justify-center gap-2"><TypingDots /> 搭档琢磨中</div> : <InkButton tone="ink" onClick={confirmComplete} className="w-full text-sm tracking-[0.2em]">收工 · 存成乐谱</InkButton>}>
                    <div className="space-y-4">
                        <div className="relative bg-white border-2 border-[#1c1b1a] shadow-[2px_2px_0_#1c1b1a] p-4">
                            <span className="label-mono text-[8px] text-[#1c1b1a]/50">搭档评语</span>
                            <p className="text-sm text-[#1c1b1a]/75 leading-relaxed whitespace-pre-wrap mt-1.5" style={HAND}>{isCompleting ? '正在琢磨……' : completionReview}</p>
                        </div>
                        <p className="text-[12px] text-[#1c1b1a]/55 leading-5" style={HAND}>收工后这首歌会存成乐谱，并在聊天里通知搭档。乐谱随时能寄给别的角色。</p>
                    </div>
                </CollageModal>
            </div>
        );
    }


    return null;
};

export default SongwritingApp;
