import React, { useMemo, useState } from 'react';
import { CharacterProfile, RelationshipStage } from '../../types';
import {
    STAGE_DEFAULT_LABEL,
    STAGE_NETWORK_META,
    STAGE_DASHED,
    inferStageFromAffection,
} from '../../utils/relationship';
import { ShareNetwork, X, ChatCircleDots, Heart } from '@phosphor-icons/react';

/**
 * 角色关系网 —— 把「用户 ↔ 各角色」的关系一张图看完。
 * 用户在正中，角色环绕四周：连线/光环按关系阶段配色，离用户越近代表越亲密（按好感/阶段亲密度排布）。
 * 点角色节点弹出详情卡（好感条 / 关系名 / 在一起天数 / 当前心情 / 关系变更简史），可一键进聊天。
 *
 * 纯 SVG + 绝对定位节点，方形画布让 0~100 视图坐标与百分比定位精确对齐，不引第三方图库。
 */

interface NetNode {
    char: CharacterProfile;
    stage: RelationshipStage;
    affection: number;       // 用于布局/展示，缺省按 50 处理
    hasAffection: boolean;
    x: number;               // 0~100 视图坐标
    y: number;
    color: string;
    dashed: boolean;
}

interface Props {
    characters: CharacterProfile[];
    userName: string;
    userAvatar: string;
    onClose: () => void;
    onOpenChat: (charId: string) => void;
}

const nameOf = (c: CharacterProfile): string =>
    c.convoSettings?.remarkName?.trim() || c.name;
const avatarOf = (c: CharacterProfile): string =>
    c.convoSettings?.charAvatarOverride || c.avatar;

const stageOf = (c: CharacterProfile): RelationshipStage =>
    c.relationship?.stage || inferStageFromAffection(c.affection);

const daysSince = (ts?: number): number | null => {
    if (!ts || !Number.isFinite(ts)) return null;
    const d = Math.floor((Date.now() - ts) / 86_400_000);
    return d >= 0 ? d + 1 : null;
};

const RelationshipNetwork: React.FC<Props> = ({ characters, userName, userAvatar, onClose, onOpenChat }) => {
    const [selectedId, setSelectedId] = useState<string | null>(null);

    // 布局：按亲密度从高到低排序后均匀分布角度；半径由亲密度决定（越亲密越靠内），
    // 再叠加一点按索引的微抖动，避免同亲密度节点恰好叠在一个环上。
    const nodes = useMemo<NetNode[]>(() => {
        const sorted = [...characters].sort(
            (a, b) => STAGE_NETWORK_META[stageOf(b)].intimacy - STAGE_NETWORK_META[stageOf(a)].intimacy,
        );
        const n = sorted.length;
        const CENTER = 50;
        const R_NEAR = 18;   // 最亲密节点离圆心的半径
        const R_FAR = 40;    // 最疏远节点的半径（留边，避免头像贴边被裁）
        return sorted.map((char, i) => {
            const stage = stageOf(char);
            const meta = STAGE_NETWORK_META[stage];
            const t = meta.intimacy / 7;                       // 0(疏)~1(亲)
            const jitter = (i % 2 === 0 ? 1 : -1) * (n > 6 ? 2.4 : 0);
            const radius = Math.max(R_NEAR, Math.min(R_FAR, R_FAR - t * (R_FAR - R_NEAR) + jitter));
            const angle = (i / Math.max(n, 1)) * Math.PI * 2 - Math.PI / 2;
            return {
                char,
                stage,
                affection: typeof char.affection === 'number' ? char.affection : 50,
                hasAffection: typeof char.affection === 'number',
                x: CENTER + radius * Math.cos(angle),
                y: CENTER + radius * Math.sin(angle),
                color: meta.color,
                dashed: STAGE_DASHED.has(stage),
            };
        });
    }, [characters]);

    const selected = useMemo(
        () => nodes.find(nd => nd.char.id === selectedId) || null,
        [nodes, selectedId],
    );

    return (
        <div className="absolute inset-0 z-[60] flex flex-col bg-[#fafafa] moro-laiwang animate-fade-in">
            {/* 顶栏 */}
            <div className="shrink-0">
                <div className="bg-transparent backdrop-blur-xl" style={{ height: 'var(--safe-top)' }} />
                <div className="bg-white/90 backdrop-blur-md flex items-center px-4 border-b border-[#ededed] h-16 gap-2">
                    <ShareNetwork size={22} weight="duotone" className="text-[#2b2933]" />
                    <span className="font-bold text-[#262626] text-lg tracking-tight">关系网</span>
                    <span className="text-[11px] text-slate-400 ml-1">{nodes.length} 位角色</span>
                    <div className="flex-1" />
                    <button onClick={onClose} className="p-2 -mr-2 rounded-full hover:bg-black/5 active:scale-90 transition-transform" title="关闭">
                        <X size={22} className="text-slate-500" />
                    </button>
                </div>
            </div>

            {nodes.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center text-slate-400 gap-2">
                    <ShareNetwork size={40} weight="thin" />
                    <p className="text-sm">还没有角色，先去添加好友吧</p>
                </div>
            ) : (
                <div className="flex-1 overflow-y-auto scrap-list px-4 py-4">
                    {/* 关系图画布（方形，0~100 视图坐标与百分比定位对齐） */}
                    <div className="relative w-full max-w-[420px] mx-auto aspect-square">
                        {/* 连线层 */}
                        <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet" className="absolute inset-0 w-full h-full pointer-events-none">
                            {/* 几圈淡淡的同心参考环 */}
                            {[18, 29, 40].map(r => (
                                <circle key={r} cx={50} cy={50} r={r} fill="none" stroke="#00000008" strokeWidth={0.4} />
                            ))}
                            {nodes.map(nd => {
                                const active = nd.char.id === selectedId;
                                return (
                                    <line
                                        key={nd.char.id}
                                        x1={50} y1={50} x2={nd.x} y2={nd.y}
                                        stroke={nd.color}
                                        strokeOpacity={selectedId && !active ? 0.18 : 0.55}
                                        strokeWidth={0.5 + (nd.affection / 100) * 1.2}
                                        strokeDasharray={nd.dashed ? '2 1.6' : undefined}
                                        strokeLinecap="round"
                                    />
                                );
                            })}
                        </svg>

                        {/* 角色节点 */}
                        {nodes.map(nd => {
                            const active = nd.char.id === selectedId;
                            return (
                                <button
                                    key={nd.char.id}
                                    onClick={() => setSelectedId(active ? null : nd.char.id)}
                                    className="absolute flex flex-col items-center gap-0.5 transition-transform active:scale-95"
                                    style={{
                                        left: `${nd.x}%`,
                                        top: `${nd.y}%`,
                                        transform: 'translate(-50%, -50%)',
                                        opacity: selectedId && !active ? 0.45 : 1,
                                        zIndex: active ? 20 : 10,
                                    }}
                                >
                                    <img
                                        src={avatarOf(nd.char)}
                                        alt={nameOf(nd.char)}
                                        className="w-11 h-11 rounded-full object-cover bg-white"
                                        style={{
                                            border: `2.5px solid ${nd.color}`,
                                            boxShadow: active ? `0 0 0 4px ${nd.color}33, 0 6px 14px rgba(0,0,0,0.16)` : '0 2px 6px rgba(0,0,0,0.12)',
                                        }}
                                    />
                                    <span className="text-[10px] font-semibold text-slate-600 max-w-[64px] truncate leading-tight px-1 rounded bg-white/70 backdrop-blur-sm">
                                        {nameOf(nd.char)}
                                    </span>
                                </button>
                            );
                        })}

                        {/* 中心：用户 */}
                        <div
                            className="absolute flex flex-col items-center gap-0.5 pointer-events-none"
                            style={{ left: '50%', top: '50%', transform: 'translate(-50%, -50%)', zIndex: 15 }}
                        >
                            <img
                                src={userAvatar}
                                alt={userName}
                                className="w-14 h-14 rounded-full object-cover border-[3px] border-white bg-slate-100"
                                style={{ boxShadow: '0 4px 16px rgba(0,0,0,0.18)' }}
                            />
                            <span className="text-[11px] font-bold text-[#2b2933] max-w-[80px] truncate px-1.5 rounded-full bg-white/80 backdrop-blur-sm">
                                {userName || '我'}
                            </span>
                        </div>
                    </div>

                    {/* 图例 */}
                    <div className="max-w-[420px] mx-auto mt-3 flex flex-wrap justify-center gap-x-3 gap-y-1.5">
                        {(['friend', 'close', 'crush', 'lover', 'married', 'ex'] as RelationshipStage[]).map(s => (
                            <span key={s} className="inline-flex items-center gap-1 text-[10px] text-slate-500">
                                <span className="w-2.5 h-2.5 rounded-full" style={{ background: STAGE_NETWORK_META[s].color }} />
                                {STAGE_DEFAULT_LABEL[s]}
                            </span>
                        ))}
                    </div>
                    <p className="max-w-[420px] mx-auto mt-2 text-center text-[10px] text-slate-400">
                        连线越粗、节点越靠内 = 越亲密 · 点头像看详情
                    </p>
                </div>
            )}

            {/* 详情卡：从底部滑出 */}
            {selected && (
                <div className="absolute inset-x-0 bottom-0 z-30 animate-slide-up">
                    <div className="mx-3 mb-3 rounded-3xl bg-white shadow-2xl border border-slate-100 overflow-hidden">
                        <div className="p-4">
                            <div className="flex items-center gap-3">
                                <img
                                    src={avatarOf(selected.char)}
                                    className="w-14 h-14 rounded-full object-cover"
                                    style={{ border: `2.5px solid ${selected.color}` }}
                                />
                                <div className="flex-1 min-w-0">
                                    <div className="font-bold text-slate-800 truncate">{nameOf(selected.char)}</div>
                                    <span
                                        className="inline-block mt-1 px-2 py-0.5 rounded-full text-[11px] font-semibold text-white"
                                        style={{ background: selected.color }}
                                    >
                                        {selected.char.relationship?.label?.trim() || STAGE_DEFAULT_LABEL[selected.stage]}
                                    </span>
                                </div>
                                <button onClick={() => setSelectedId(null)} className="p-1.5 rounded-full hover:bg-slate-100 text-slate-400 shrink-0">
                                    <X size={18} />
                                </button>
                            </div>

                            {/* 好感条 */}
                            <div className="mt-3">
                                <div className="flex items-center justify-between text-[11px] mb-1">
                                    <span className="text-slate-400 flex items-center gap-1"><Heart size={12} weight="fill" className="text-pink-400" />好感</span>
                                    <span className="font-bold tabular-nums" style={{ color: selected.color }}>
                                        {selected.hasAffection ? selected.affection : '—'}<span className="text-slate-300 font-normal"> / 100</span>
                                    </span>
                                </div>
                                <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                                    <div className="h-full rounded-full transition-all" style={{ width: `${selected.affection}%`, background: selected.color }} />
                                </div>
                            </div>

                            {/* 状态行 */}
                            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500">
                                {(() => {
                                    const d = daysSince(selected.char.relationship?.since);
                                    return d != null && STAGE_NETWORK_META[selected.stage].intimacy >= 5
                                        ? <span>在一起 <b className="text-slate-700">{d}</b> 天</span>
                                        : null;
                                })()}
                                {selected.char.currentMood?.label && (
                                    <span>当前心情 {selected.char.currentMood.emoji || ''}<b className="text-slate-700">{selected.char.currentMood.label}</b></span>
                                )}
                            </div>

                            {/* 关系变更简史 */}
                            {selected.char.relationship?.history && selected.char.relationship.history.length > 0 && (
                                <div className="mt-3 pt-3 border-t border-slate-100">
                                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">关系变化</div>
                                    <div className="space-y-1">
                                        {selected.char.relationship.history.slice(0, 3).map((h, i) => (
                                            <div key={i} className="flex items-center gap-2 text-[11px] text-slate-500">
                                                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: STAGE_NETWORK_META[h.stage]?.color || '#cbd5e1' }} />
                                                <span className="truncate">{h.label || STAGE_DEFAULT_LABEL[h.stage]}</span>
                                                <span className="text-slate-300 ml-auto shrink-0">{new Date(h.at).toLocaleDateString()}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            <button
                                onClick={() => onOpenChat(selected.char.id)}
                                className="mt-4 w-full py-3 bg-[#2b2933] text-white font-bold rounded-2xl shadow-lg shadow-slate-300/60 active:scale-[0.98] transition-transform flex items-center justify-center gap-2"
                            >
                                <ChatCircleDots size={18} weight="fill" />
                                进入聊天
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default RelationshipNetwork;
