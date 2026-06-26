
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useOS } from '../context/OSContext';
import { DB } from '../utils/db';
import { XhsActivityRecord } from '../types';
import { XhsFreeRoamEngine, FreeRoamCallbacks } from '../utils/xhsFreeRoam';
import { resolveAuxApi } from '../utils/auxApi';
import { XhsMcpClient } from '../utils/xhsMcpClient';
import { Book, CaretLeft, CaretDown, WarningCircle } from '@phosphor-icons/react';
import {
    InsShell, IconCircle, InsButton, InsCard, InsDialog, InsSheet, StoryRing, InsEmpty, accent, INK, INK_SOFT,
} from '../components/ui/insKit';

// 自由活动强调色（取自 constants：XhsFreeRoam = rose）
const AC = 'rose' as const;
const A = accent(AC);

const TwemojiImg: React.FC<{ code: string; alt?: string; className?: string }> = ({ code, alt, className = 'w-4 h-4 inline-block' }) => (
  <img src={`https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/${code}.png`} alt={alt || ''} className={className} draggable={false} />
);

const ACTION_LABELS: Record<string, string> = {
    post: '发帖', browse: '刷首页', search: '搜索', comment: '评论', save_topic: '收藏话题', idle: '休息',
};
const ACTION_ICON_CODES: Record<string, string> = {
    post: '270d', browse: '1f4f1', search: '1f50d', comment: '1f4ac', save_topic: '1f4cc', idle: '1f634',
};
const ActionIcon: React.FC<{ type: string; className?: string }> = ({ type, className = 'w-5 h-5 inline-block' }) => {
    const code = ACTION_ICON_CODES[type] || '1f4dd';
    return <TwemojiImg code={code} className={className} />;
};
const resultStyle = (r: string): React.CSSProperties =>
    r === 'success' ? { color: '#059669', background: '#e3f8f0' }
    : r === 'failed' ? { color: '#e11d48', background: '#ffe4e6' }
    : { color: INK_SOFT, background: '#f1efeb' };

const XhsFreeRoamApp: React.FC = () => {
    const { goBack, addToast, characters, activeCharacterId, apiConfig, auxApiConfig, realtimeConfig, userProfile } = useOS();
    const auxApi = { ...apiConfig, ...resolveAuxApi(auxApiConfig, apiConfig) };

    const [selectedCharId, setSelectedCharId] = useState<string>(activeCharacterId || characters[0]?.id || '');
    const [showCharPicker, setShowCharPicker] = useState(false);
    const char = characters.find(c => c.id === selectedCharId) || null;

    const [activities, setActivities] = useState<XhsActivityRecord[]>([]);
    const [isRunning, setIsRunning] = useState(false);
    const [status, setStatus] = useState('');
    const [thinking, setThinking] = useState('');
    const [liveActivities, setLiveActivities] = useState<XhsActivityRecord[]>([]);
    const [mcpStatus, setMcpStatus] = useState<'unknown' | 'connected' | 'error'>('unknown');
    const [showDetail, setShowDetail] = useState<XhsActivityRecord | null>(null);
    const [confirmDialog, setConfirmDialog] = useState<{ title: string; message: string; onConfirm: () => void; } | null>(null);

    const scrollRef = useRef<HTMLDivElement>(null);
    const mcpUrl = realtimeConfig?.xhsMcpConfig?.serverUrl || '';
    const mcpEnabled = realtimeConfig?.xhsMcpConfig?.enabled || false;

    const loadActivities = useCallback(async () => {
        if (!char) { setActivities([]); return; }
        const acts = await DB.getXhsActivities(char.id, 50);
        setActivities(acts);
    }, [char]);

    useEffect(() => { loadActivities(); }, [loadActivities]);

    useEffect(() => {
        if (scrollRef.current && isRunning) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }, [liveActivities, thinking, status, isRunning]);

    useEffect(() => {
        if (!mcpEnabled || !mcpUrl) { setMcpStatus('unknown'); return; }
        XhsMcpClient.testConnection(mcpUrl).then(r => setMcpStatus(r.connected ? 'connected' : 'error')).catch(() => setMcpStatus('error'));
    }, [mcpEnabled, mcpUrl]);

    const handleStart = async () => {
        if (!char || isRunning) return;
        if (!mcpEnabled || !mcpUrl) { addToast('请先在「文具盒」里配置小红书 MCP Server', 'error'); return; }
        if (!auxApi.baseUrl) { addToast('请先在「文具盒」里配置 API', 'error'); return; }

        setIsRunning(true); setStatus('启动中...'); setThinking(''); setLiveActivities([]);
        const callbacks: FreeRoamCallbacks = {
            onStatus: (s) => setStatus(s),
            onThinking: (t) => setThinking(t),
            onActivity: (a) => setLiveActivities(prev => [...prev, a]),
            onComplete: (session) => {
                setStatus(`活动结束: ${session.summary || '完成'}`);
                setIsRunning(false); loadActivities();
                addToast(`${char.name}的自由活动结束了`, 'success');
            },
            onError: (err) => {
                setStatus(`出错: ${err}`); setIsRunning(false);
                addToast(`自由活动出错: ${err}`, 'error');
            },
        };
        try {
            await XhsFreeRoamEngine.run(char, userProfile, auxApi, realtimeConfig || {} as any, callbacks);
        } catch (e: any) {
            setStatus(`异常: ${e.message}`); setIsRunning(false);
        }
    };

    const handleClearHistory = () => {
        if (!char) return;
        setConfirmDialog({
            title: '清除活动记录',
            message: `确定清除 ${char.name} 的所有小红书活动记录吗？`,
            onConfirm: async () => {
                await DB.clearXhsActivities(char.id); setActivities([]); setConfirmDialog(null);
                addToast('记录已清除', 'success');
            }
        });
    };

    const formatTime = (ts: number) => {
        const d = new Date(ts), now = new Date();
        const isToday = d.toDateString() === now.toDateString();
        const time = `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
        return isToday ? time : `${d.getMonth() + 1}/${d.getDate()} ${time}`;
    };

    const Panel: React.FC<{ label: string; tint: string; color: string; children: React.ReactNode }> = ({ label, tint, color, children }) => (
        <div className="rounded-2xl p-3" style={{ background: tint }}>
            <p className="text-[10px] font-bold mb-1" style={{ color }}>{label}</p>
            {children}
        </div>
    );

    if (characters.length === 0) {
        return (
            <InsShell accent={AC}>
                <div className="shrink-0 relative z-10 flex items-center gap-2.5 px-3.5 pt-2.5 pb-2.5" style={{ paddingTop: 'var(--safe-top)' }}>
                    <IconCircle onClick={goBack}><CaretLeft size={18} weight="bold" /></IconCircle>
                    <h1 className="text-[18px] font-extrabold" style={{ color: INK }}>自由活动</h1>
                </div>
                <InsEmpty icon={<Book size={48} weight="fill" />} title="还没有角色" hint="先去创建一个角色，再让 TA 自己去刷小红书" />
            </InsShell>
        );
    }

    return (
        <InsShell accent={AC}>
            {/* Header：返回 + 角色切换 + MCP 状态 + 清除 */}
            <div className="shrink-0 relative z-10" style={{ paddingTop: 'var(--safe-top)' }}>
                <div className="flex items-center justify-between px-3.5 pt-2.5 pb-2.5 gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                        <IconCircle onClick={goBack}><CaretLeft size={18} weight="bold" /></IconCircle>
                        <button onClick={() => !isRunning && setShowCharPicker(true)} disabled={isRunning} className="flex items-center gap-2 press-soft min-w-0">
                            <StoryRing src={char?.avatar} size={38} active={!isRunning} fallback={char?.name?.[0] || '?'} />
                            <div className="min-w-0 text-left">
                                <div className="flex items-center gap-1">
                                    <h1 className="text-[16px] font-extrabold truncate" style={{ color: INK }}>{char?.name || '选择角色'}</h1>
                                    {!isRunning && <CaretDown size={12} weight="bold" style={{ color: INK_SOFT }} />}
                                </div>
                                <p className="text-[10px]" style={{ color: INK_SOFT }}>自由活动</p>
                            </div>
                        </button>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                        <span className="w-2 h-2 rounded-full" style={{ background: mcpStatus === 'connected' ? '#34d399' : mcpStatus === 'error' ? '#f87171' : '#d1d5db' }} title={mcpStatus === 'connected' ? 'MCP已连接' : mcpStatus === 'error' ? 'MCP未连接' : '未检测'} />
                        {activities.length > 0 && !isRunning && (
                            <button onClick={handleClearHistory} className="text-[11px] font-medium press-soft" style={{ color: INK_SOFT }}>清除</button>
                        )}
                    </div>
                </div>
            </div>

            {/* MCP 未配置警告 */}
            {!mcpEnabled && (
                <div className="mx-4 mb-2 rounded-2xl p-3 relative z-10 flex gap-2" style={{ background: '#fef3e0' }}>
                    <WarningCircle size={16} weight="fill" className="shrink-0 mt-0.5" style={{ color: '#f59e0b' }} />
                    <div>
                        <p className="text-[12px] font-bold" style={{ color: '#92400e' }}>小红书 MCP 未开启</p>
                        <p className="text-[10px] mt-0.5" style={{ color: '#b45309' }}>前往 文具盒 → 风向标（实时感知）→ 小红书 MCP，开启并配置 Server URL。</p>
                    </div>
                </div>
            )}

            {/* 主体：运行中实况 / 历史记录 */}
            {isRunning ? (
                <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-0 relative z-10">
                    <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                        <span className="text-[12px] font-medium" style={{ color: INK }}>{status}</span>
                    </div>
                    {thinking && char && (
                        <Panel label={`${char.name} 在想…`} tint="#f1ebff" color="#7c3aed">
                            <div className="flex items-center gap-1.5 mb-1">
                                {char.avatar && <img src={char.avatar} className="w-5 h-5 rounded-full object-cover" alt="" />}
                            </div>
                            <p className="text-[12px] leading-relaxed italic" style={{ color: '#6d28d9' }}>"{thinking}"</p>
                        </Panel>
                    )}
                    {liveActivities.map((a, i) => (
                        <InsCard key={a.id || i} className="p-3 space-y-1.5 animate-ins-card">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-1.5"><ActionIcon type={a.actionType} className="w-4 h-4 inline-block" /><span className="text-[12px] font-bold" style={{ color: INK }}>{ACTION_LABELS[a.actionType]}</span></div>
                                <span className="text-[10px] px-2 py-0.5 rounded-full font-medium" style={resultStyle(a.result)}>{a.result === 'success' ? '完成' : a.result === 'failed' ? '失败' : '跳过'}</span>
                            </div>
                            {a.content.title && <p className="text-[12px]" style={{ color: '#4a4750' }}>{a.content.title}</p>}
                            {a.content.keyword && <p className="text-[12px]" style={{ color: INK_SOFT }}>搜索: {a.content.keyword}</p>}
                            {a.resultMessage && <p className="text-[10px]" style={{ color: INK_SOFT }}>{a.resultMessage}</p>}
                        </InsCard>
                    ))}
                    {isRunning && liveActivities.length === 0 && !thinking && (
                        <div className="flex flex-col items-center justify-center py-12">
                            <div className="w-8 h-8 rounded-full animate-spin" style={{ border: `2px solid ${A.soft}`, borderTopColor: A.solid }} />
                            <p className="text-[12px] mt-3" style={{ color: INK_SOFT }}>{char?.name || '角色'} 正在活动中…</p>
                        </div>
                    )}
                </div>
            ) : (
                <div className="flex-1 overflow-y-auto px-4 py-2 space-y-2.5 min-h-0 relative z-10">
                    {activities.length === 0 ? (
                        <div className="flex flex-col items-center px-2 py-6 space-y-4">
                            <div className="text-center"><Book size={48} weight="fill" style={{ color: A.solid }} /><p className="text-[14px] font-bold mt-2" style={{ color: INK }}>{char?.name || '角色'} 还没有自由活动记录</p></div>
                            <InsCard className="w-full p-4 space-y-3">
                                <p className="text-[12px] font-bold" style={{ color: INK }}>自由活动是什么？</p>
                                <p className="text-[11px] leading-relaxed" style={{ color: INK_SOFT }}>让 {char?.name || '角色'} 自主使用小红书——就像一个真实的人在刷手机。TA 会根据性格和最近的聊天，决定要做什么。</p>
                                <div className="space-y-1.5">
                                    <p className="text-[10px] font-bold" style={{ color: INK_SOFT }}>TA 可能会：</p>
                                    <div className="grid grid-cols-2 gap-1.5">
                                        {[{ code: '270d', text: '发一条笔记' }, { code: '1f50d', text: '搜感兴趣的话题' }, { code: '1f4f1', text: '刷首页看热门' }, { code: '1f3e0', text: '查看自己主页' }, { code: '1f4ac', text: '回复评论' }, { code: '1f634', text: '什么都不做' }].map((item, i) => (
                                            <div key={i} className="flex items-center gap-1.5 rounded-xl px-2 py-1.5" style={{ background: '#f7f5f2' }}><TwemojiImg code={item.code} className="w-3.5 h-3.5 inline-block" /><span className="text-[10px]" style={{ color: INK_SOFT }}>{item.text}</span></div>
                                        ))}
                                    </div>
                                </div>
                                <div className="rounded-xl p-2.5" style={{ background: A.soft }}><p className="text-[10px] leading-relaxed" style={{ color: A.ink }}>活动结束后，{char?.name || '角色'} 会记住看到的内容。下次聊天时可能会主动分享。</p></div>
                            </InsCard>
                        </div>
                    ) : (
                        activities.map(a => (
                            <button key={a.id} onClick={() => setShowDetail(a)} className="w-full text-left press-soft">
                                <InsCard className="p-3">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-1.5"><ActionIcon type={a.actionType} className="w-4 h-4 inline-block" /><span className="text-[12px] font-bold" style={{ color: INK }}>{ACTION_LABELS[a.actionType]}</span><span className="text-[9px] px-1.5 py-0.5 rounded-full font-medium" style={resultStyle(a.result)}>{a.result}</span></div>
                                        <span className="text-[10px]" style={{ color: INK_SOFT }}>{formatTime(a.timestamp)}</span>
                                    </div>
                                    <p className="text-[11px] mt-1 line-clamp-1" style={{ color: INK_SOFT }}>{a.thinking.slice(0, 80)}</p>
                                    {a.content.title && <p className="text-[10px] mt-0.5 line-clamp-1" style={{ color: A.solid }}>{a.content.title}</p>}
                                    {a.content.savedTopics && a.content.savedTopics.length > 0 && (
                                        <div className="flex gap-1 mt-1">{a.content.savedTopics.map((t, i) => <span key={i} className="text-[9px] px-1.5 py-0.5 rounded-full" style={{ background: '#fef3e0', color: '#b45309' }}>{t.title.slice(0, 10)}</span>)}</div>
                                    )}
                                </InsCard>
                            </button>
                        ))
                    )}
                </div>
            )}

            {/* 底部开始按钮 */}
            <div className="shrink-0 px-4 pb-5 pt-3 relative z-10" style={{ borderTop: '1px solid rgba(0,0,0,0.05)', background: 'rgba(255,255,255,0.7)', backdropFilter: 'blur(8px)' }}>
                {(!mcpEnabled || !char) ? (
                    <button disabled className="w-full py-3.5 rounded-2xl font-bold text-sm" style={{ background: '#efece7', color: '#bcb9b2' }}>
                        <span className="flex items-center justify-center gap-2"><Book size={18} weight="fill" />{!char ? '请先选择角色' : '请先开启 MCP'}</span>
                    </button>
                ) : isRunning ? (
                    <button disabled className="w-full py-3.5 rounded-2xl font-bold text-sm" style={{ background: '#efece7', color: INK_SOFT }}>
                        <span className="flex items-center justify-center gap-2"><div className="w-4 h-4 rounded-full animate-spin" style={{ border: '2px solid #d1d5db', borderTopColor: 'transparent' }} />活动中…</span>
                    </button>
                ) : (
                    <InsButton variant="gradient" onClick={handleStart} className="w-full py-3.5 text-sm" icon={<Book size={18} weight="fill" />}>
                        {char.name}，去自由活动吧！
                    </InsButton>
                )}
                <p className="text-[9px] text-center mt-2 leading-relaxed" style={{ color: '#d6a35a' }}>角色可能会给无关用户评论，对真人造成困扰，请及时检查并清理不当评论</p>
            </div>

            {/* 角色选择抽屉 */}
            <InsSheet open={showCharPicker} title="选择角色" onClose={() => setShowCharPicker(false)}>
                <div className="max-h-[55vh] overflow-y-auto no-scrollbar space-y-1.5">
                    {characters.map(c => (
                        <button key={c.id} onClick={() => { setSelectedCharId(c.id); setShowCharPicker(false); }}
                            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-2xl text-left press-soft" style={{ background: c.id === selectedCharId ? A.soft : '#f7f5f2' }}>
                            {c.avatar ? <img src={c.avatar} className="w-9 h-9 rounded-full object-cover shrink-0" alt="" /> : <div className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold shrink-0" style={{ background: A.soft, color: A.ink }}>{c.name[0]}</div>}
                            <div className="flex-1 min-w-0">
                                <p className="text-[13.5px] font-bold truncate" style={{ color: INK }}>{c.name}</p>
                                {c.description && <p className="text-[10px] truncate" style={{ color: INK_SOFT }}>{c.description}</p>}
                            </div>
                            {c.id === selectedCharId && <span className="w-2 h-2 rounded-full shrink-0" style={{ background: A.solid }} />}
                        </button>
                    ))}
                </div>
            </InsSheet>

            {/* 活动详情抽屉 */}
            <InsSheet open={!!showDetail} title={showDetail ? (ACTION_LABELS[showDetail.actionType] || showDetail.actionType) : ''} onClose={() => setShowDetail(null)}
                right={showDetail ? <span className="text-[10px] px-2 py-0.5 rounded-full font-medium" style={resultStyle(showDetail.result)}>{showDetail.result}</span> : undefined}>
                {showDetail && (() => {
                    const a = showDetail;
                    return (
                        <div className="max-h-[60vh] overflow-y-auto no-scrollbar space-y-3">
                            <Panel label="内心想法" tint="#f1ebff" color="#7c3aed"><p className="text-[12px] leading-relaxed" style={{ color: '#6d28d9' }}>{a.thinking}</p></Panel>
                            {a.content.title && <Panel label="标题" tint="#f7f5f2" color={INK_SOFT}><p className="text-[14px] font-medium" style={{ color: INK }}>{a.content.title}</p></Panel>}
                            {a.content.body && <Panel label="正文" tint="#f7f5f2" color={INK_SOFT}><p className="text-[12px] leading-relaxed whitespace-pre-wrap" style={{ color: '#4a4750' }}>{a.content.body}</p></Panel>}
                            {a.content.tags && a.content.tags.length > 0 && <div className="flex flex-wrap gap-1.5">{a.content.tags.map((t, i) => <span key={i} className="px-2 py-0.5 text-[10px] rounded-full" style={{ background: A.soft, color: A.ink }}>#{t}</span>)}</div>}
                            {a.content.keyword && <Panel label="搜索关键词" tint="#e9f1fe" color="#3b82f6"><p className="text-[14px]" style={{ color: '#1d4ed8' }}>{a.content.keyword}</p></Panel>}
                            {a.content.notesViewed && a.content.notesViewed.length > 0 && (
                                <div className="space-y-1.5"><p className="text-[10px] font-bold" style={{ color: INK_SOFT }}>浏览过的帖子</p>
                                    {a.content.notesViewed.map((n, i) => <div key={i} className="rounded-xl p-2.5" style={{ background: '#f7f5f2' }}><p className="text-[12px] font-medium" style={{ color: INK }}>{n.title}</p><p className="text-[10px] mt-0.5" style={{ color: INK_SOFT }}>by {n.author} · {n.likes} likes</p>{n.desc && <p className="text-[10px] mt-1 line-clamp-2" style={{ color: INK_SOFT }}>{n.desc}</p>}</div>)}
                                </div>
                            )}
                            {a.content.savedTopics && a.content.savedTopics.length > 0 && (
                                <div className="space-y-1.5"><p className="text-[10px] font-bold" style={{ color: '#b45309' }}>保存的话题</p>
                                    {a.content.savedTopics.map((t, i) => <div key={i} className="rounded-xl p-2.5" style={{ background: '#fef3e0' }}><p className="text-[12px] font-medium" style={{ color: '#92400e' }}>{t.title}</p><p className="text-[10px] mt-0.5" style={{ color: '#b45309' }}>{t.desc}</p></div>)}
                                </div>
                            )}
                            {a.content.commentText && <Panel label="评论内容" tint="#e3f8f0" color="#059669"><p className="text-[12px]" style={{ color: '#047857' }}>{a.content.commentText}</p>{a.content.commentTarget && <p className="text-[10px] mt-1" style={{ color: '#059669' }}>对「{a.content.commentTarget.title}」的评论</p>}</Panel>}
                            {a.resultMessage && <p className="text-[10px] text-center" style={{ color: INK_SOFT }}>{a.resultMessage}</p>}
                            <button onClick={() => setConfirmDialog({
                                title: '删除此条记录', message: `确定删除这条${ACTION_LABELS[a.actionType] || '活动'}记录吗？`,
                                onConfirm: async () => { await DB.deleteXhsActivity(a.id); setShowDetail(null); setConfirmDialog(null); await loadActivities(); addToast('已删除', 'success'); }
                            })} className="w-full py-2.5 rounded-2xl text-[12px] font-bold press-soft" style={{ color: '#e11d48', background: '#ffe4e6' }}>删除此条记录</button>
                        </div>
                    );
                })()}
            </InsSheet>

            {/* 确认弹窗 */}
            <InsDialog open={!!confirmDialog} title={confirmDialog?.title} accent={AC} onClose={() => setConfirmDialog(null)}
                actions={confirmDialog ? <>
                    <InsButton variant="soft" accent="slate" onClick={() => setConfirmDialog(null)} className="flex-1 py-2.5 text-[13px]">取消</InsButton>
                    <InsButton variant="solid" accent={AC} onClick={confirmDialog.onConfirm} className="flex-1 py-2.5 text-[13px]">删除</InsButton>
                </> : null}>
                {confirmDialog?.message}
            </InsDialog>
        </InsShell>
    );
};

export default XhsFreeRoamApp;
