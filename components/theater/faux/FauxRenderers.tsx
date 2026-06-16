import React from 'react';
import type { FauxWeChat, FauxMoments, FauxXhs, FauxForum } from '../../../types';

/**
 * 番外仿真渲染 —— 把 genFauxPiece 的结构化 JSON 渲染成仿微信/朋友圈/小红书/论坛 UI。
 * 用户用手机系统截屏即可保存。纯展示组件，无副作用。
 */

const PlaceholderGrid: React.FC<{ count: number; tone?: 'light' | 'dark' }> = ({ count, tone = 'light' }) => {
    const n = Math.max(0, Math.min(9, count || 0));
    if (n === 0) return null;
    const cols = n === 1 ? 1 : n === 4 ? 2 : 3;
    const bg = tone === 'light' ? 'bg-slate-200' : 'bg-white/10';
    return (
        <div className="grid gap-1 mt-2" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
            {Array.from({ length: n }).map((_, i) => (
                <div key={i} className={`aspect-square ${bg} rounded-md flex items-center justify-center`}>
                    <span className="text-2xl opacity-40">🖼️</span>
                </div>
            ))}
        </div>
    );
};

// ── 微信聊天截图 ────────────────────────────────────────────────────────────
export const WeChatScreenshot: React.FC<{ data: FauxWeChat; charAvatar?: string; userAvatar?: string }> = ({ data, charAvatar, userAvatar }) => (
    <div className="rounded-xl overflow-hidden border border-black/10 bg-[#ededed] text-[#181818]">
        <div className="h-10 bg-[#ededed] border-b border-black/5 flex items-center justify-center relative">
            <span className="text-[13px] font-semibold">{data.contactName || '对方'}</span>
        </div>
        <div className="p-3 space-y-3 max-h-[460px] overflow-y-auto no-scrollbar">
            {(data.messages || []).map((m, i) => {
                const mine = m.from === 'user';
                const avatar = mine ? userAvatar : charAvatar;
                return (
                    <div key={i}>
                        {m.time && <div className="text-center text-[10px] text-black/35 mb-1.5">{m.time}</div>}
                        <div className={`flex items-start gap-2 ${mine ? 'flex-row-reverse' : ''}`}>
                            {avatar
                                ? <img src={avatar} className="w-8 h-8 rounded-md object-cover shrink-0" alt="" />
                                : <div className={`w-8 h-8 rounded-md shrink-0 ${mine ? 'bg-[#95ec69]' : 'bg-slate-300'}`} />}
                            <div className={`max-w-[72%] px-3 py-2 text-[14px] leading-snug rounded-lg relative ${mine ? 'bg-[#95ec69]' : 'bg-white'}`}>
                                {m.text}
                            </div>
                        </div>
                    </div>
                );
            })}
        </div>
    </div>
);

// ── 朋友圈 ──────────────────────────────────────────────────────────────────
export const MomentsCard: React.FC<{ data: FauxMoments; avatar?: string }> = ({ data, avatar }) => (
    <div className="rounded-xl overflow-hidden border border-black/10 bg-white text-[#181818] p-4">
        <div className="flex gap-3">
            {avatar ? <img src={avatar} className="w-10 h-10 rounded-md object-cover shrink-0" alt="" /> : <div className="w-10 h-10 rounded-md bg-slate-300 shrink-0" />}
            <div className="flex-1 min-w-0">
                <div className="text-[14px] font-semibold text-[#576b95]">{data.author || '某人'}</div>
                <div className="text-[14px] mt-1 leading-relaxed whitespace-pre-wrap">{data.text}</div>
                <PlaceholderGrid count={data.images || 0} />
                <div className="text-[11px] text-black/35 mt-2">{data.time || '刚刚'}</div>
                {(data.likes?.length || data.comments?.length) ? (
                    <div className="mt-2 bg-slate-50 rounded-lg p-2 space-y-1">
                        {data.likes?.length > 0 && (
                            <div className="text-[12px] text-[#576b95]">♡ {data.likes.join('，')}</div>
                        )}
                        {(data.comments || []).map((c, i) => (
                            <div key={i} className="text-[12px]"><span className="text-[#576b95] font-medium">{c.name}</span>：{c.text}</div>
                        ))}
                    </div>
                ) : null}
            </div>
        </div>
    </div>
);

// ── 小红书 ──────────────────────────────────────────────────────────────────
export const XhsCard: React.FC<{ data: FauxXhs }> = ({ data }) => (
    <div className="rounded-xl overflow-hidden border border-black/10 bg-white text-[#181818]">
        <PlaceholderGrid count={Math.max(1, data.images || 1)} />
        <div className="p-3.5 space-y-2">
            <div className="text-[15px] font-bold leading-snug">{data.title}</div>
            <div className="text-[13px] leading-relaxed whitespace-pre-wrap text-black/80">{data.body}</div>
            {data.tags?.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                    {data.tags.map((t, i) => <span key={i} className="text-[12px] text-[#3a5fa0]">#{t}</span>)}
                </div>
            )}
            <div className="flex items-center justify-between pt-1 border-t border-black/5">
                <span className="text-[12px] text-black/45">@{data.author || '小红薯'}</span>
                <span className="text-[12px] text-[#ff2e4d]">♥ {data.likes ?? 0}</span>
            </div>
            {(data.comments || []).length > 0 && (
                <div className="space-y-1 pt-1">
                    {data.comments.map((c, i) => (
                        <div key={i} className="text-[12px] text-black/70"><span className="font-medium">{c.name}</span>：{c.text}</div>
                    ))}
                </div>
            )}
        </div>
    </div>
);

// ── 匿名论坛 ────────────────────────────────────────────────────────────────
export const ForumThread: React.FC<{ data: FauxForum }> = ({ data }) => (
    <div className="rounded-xl overflow-hidden border border-white/10 bg-[#1b2330] text-white/85">
        <div className="px-3.5 py-2 bg-white/[0.04] border-b border-white/10 flex items-center gap-2">
            <span className="text-[11px] px-1.5 py-0.5 rounded bg-amber-400/20 text-amber-200">{data.board || '匿名版'}</span>
            <span className="text-[13px] font-bold truncate">{data.title}</span>
        </div>
        <div className="p-3.5 space-y-2.5">
            {data.op && (
                <div className="bg-white/[0.05] rounded-lg p-2.5">
                    <div className="text-[10px] text-amber-200/70 mb-1">{data.op.floor || '楼主'}</div>
                    <div className="text-[13px] leading-relaxed whitespace-pre-wrap">{data.op.text}</div>
                </div>
            )}
            {(data.replies || []).map((r, i) => (
                <div key={i} className="border-l-2 border-white/10 pl-2.5">
                    <div className="text-[10px] text-white/40 mb-0.5">{r.floor || `${i + 1}L`}</div>
                    <div className="text-[13px] leading-relaxed whitespace-pre-wrap text-white/80">{r.text}</div>
                </div>
            ))}
        </div>
    </div>
);
