import React from 'react';
import type {
    FauxWeChat, FauxMoments, FauxXhs, FauxForum,
    FauxWeibo, FauxQzone, FauxDouban, FauxCampus, FauxMemo, FauxSchedule, FauxReceipt, FauxBrowser,
} from '../../../types';

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

// ── 微博热搜 ────────────────────────────────────────────────────────────────
export const WeiboHotCard: React.FC<{ data: FauxWeibo }> = ({ data }) => (
    <div className="rounded-xl overflow-hidden border border-black/10 bg-[#fff7f2] text-[#1f1f1f]">
        <div className="px-3.5 py-2.5 bg-[#ff6a00] text-white flex items-center justify-between">
            <span className="text-[13px] font-black">微博热搜</span>
            <span className="text-[11px] font-bold opacity-90">{data.rank || '热搜'}</span>
        </div>
        <div className="p-3.5 space-y-2.5 max-h-[520px] overflow-y-auto no-scrollbar">
            <div className="text-[18px] font-black leading-tight">#{data.topic || '热搜话题'}#</div>
            {(data.posts || []).map((p, i) => (
                <div key={i} className="rounded-lg bg-white p-2.5 border border-black/5">
                    <div className="text-[12px] font-bold text-[#eb7350]">{p.author || `博主${i + 1}`}</div>
                    <div className="text-[13px] leading-relaxed whitespace-pre-wrap mt-1">{p.text}</div>
                    <div className="flex gap-3 text-[10.5px] text-black/40 mt-1.5">
                        <span>{p.time || '刚刚'}</span><span>转 {p.reposts ?? 0}</span><span>评 {p.comments ?? 0}</span><span>赞 {p.likes ?? 0}</span>
                    </div>
                </div>
            ))}
            {(data.hotComments || []).length > 0 && (
                <div className="rounded-lg bg-white/75 p-2.5 space-y-1">
                    <div className="text-[11px] font-black text-[#eb7350]">热门评论</div>
                    {(data.hotComments || []).map((c, i) => (
                        <div key={i} className="text-[12px] leading-relaxed"><span className="font-bold">{c.name}</span>：{c.text}<span className="text-black/35"> · {c.likes ?? 0}赞</span></div>
                    ))}
                </div>
            )}
        </div>
    </div>
);

// ── QQ 空间 ────────────────────────────────────────────────────────────────
export const QzoneCard: React.FC<{ data: FauxQzone }> = ({ data }) => {
    const visitors = data.visitors || [];
    const likes = data.likes || [];
    const comments = data.comments || [];
    return (
        <div className="rounded-xl overflow-hidden border border-black/10 bg-[#eef6ff] text-[#1b2b3a]">
            <div className="h-16 bg-gradient-to-r from-[#6eb6ff] to-[#9dd7ff] px-4 py-3 text-white">
                <div className="text-[15px] font-black">{data.owner || '空间主人'}</div>
                <div className="text-[11px] opacity-85">{data.mood || '今天也有一点心事'}</div>
            </div>
            <div className="p-3.5 space-y-2.5">
                <div className="rounded-lg bg-white p-3 border border-black/5">
                    <div className="text-[13px] leading-relaxed whitespace-pre-wrap">{data.text}</div>
                    <PlaceholderGrid count={data.images || 0} />
                    <div className="text-[11px] text-black/40 mt-2">{data.time || '刚刚'}</div>
                </div>
                {(visitors.length || likes.length || comments.length) ? (
                    <div className="rounded-lg bg-white/80 p-2.5 space-y-1">
                        {visitors.length > 0 && <div className="text-[11px] text-black/45">最近访客：{visitors.join('、')}</div>}
                        {likes.length > 0 && <div className="text-[12px] text-[#2878c8]">赞了这条说说：{likes.join('、')}</div>}
                        {comments.map((c, i) => <div key={i} className="text-[12px]"><span className="font-bold text-[#2878c8]">{c.name}</span>：{c.text}</div>)}
                    </div>
                ) : null}
            </div>
        </div>
    );
};

// ── 豆瓣小组 ────────────────────────────────────────────────────────────────
export const DoubanThread: React.FC<{ data: FauxDouban }> = ({ data }) => (
    <div className="rounded-xl overflow-hidden border border-black/10 bg-[#f7f4ed] text-[#222]">
        <div className="px-3.5 py-2.5 border-b border-black/10 flex items-center justify-between">
            <span className="text-[12px] font-black text-[#007722]">{data.group || '生活碎片小组'}</span>
            <span className="text-[10px] text-black/40">豆瓣小组</span>
        </div>
        <div className="p-3.5 space-y-2.5 max-h-[520px] overflow-y-auto no-scrollbar">
            <div className="text-[17px] font-black leading-tight">{data.title}</div>
            <div className="text-[11px] text-black/45">楼主：{data.author || '匿名'}</div>
            <div className="rounded-lg bg-white p-3 text-[13px] leading-relaxed whitespace-pre-wrap">{data.text}</div>
            {(data.replies || []).map((r, i) => (
                <div key={i} className="rounded-lg bg-white/75 p-2.5">
                    <div className="text-[11px] text-[#007722] font-bold">{r.name || `组员${i + 1}`} <span className="text-black/35 font-normal">{r.time || ''} · {r.likes ?? 0} 有用</span></div>
                    <div className="text-[12.5px] leading-relaxed mt-1 whitespace-pre-wrap">{r.text}</div>
                </div>
            ))}
        </div>
    </div>
);

// ── 校园墙 ────────────────────────────────────────────────────────────────
export const CampusWallCard: React.FC<{ data: FauxCampus }> = ({ data }) => (
    <div className="rounded-xl overflow-hidden border border-black/10 bg-white text-[#1f2933]">
        <div className="px-4 py-3 bg-[#2f6fed] text-white">
            <div className="text-[12px] opacity-85">{data.school || '某某大学'}</div>
            <div className="text-[16px] font-black">{data.wallName || '校园墙'}</div>
        </div>
        <div className="p-3.5 space-y-2.5">
            {data.title && <div className="text-[15px] font-black">{data.title}</div>}
            <div className="text-[13px] leading-relaxed whitespace-pre-wrap">{data.text}</div>
            <PlaceholderGrid count={data.images || 0} />
            <div className="text-[11px] text-black/40">匿名投稿 · {data.likes ?? 0} 人赞过</div>
            {(data.comments || []).length > 0 && (
                <div className="rounded-lg bg-slate-50 p-2.5 space-y-1">
                    {(data.comments || []).map((c, i) => <div key={i} className="text-[12px]"><span className="font-bold text-[#2f6fed]">{c.name}</span>：{c.text}</div>)}
                </div>
            )}
        </div>
    </div>
);

// ── 备忘录 ────────────────────────────────────────────────────────────────
export const MemoScreen: React.FC<{ data: FauxMemo }> = ({ data }) => (
    <div className="rounded-xl overflow-hidden border border-black/10 bg-[#fff8d8] text-[#211f18]">
        <div className="px-4 py-3 border-b border-black/10">
            <div className="text-[18px] font-black">{data.title || '备忘录'}</div>
            <div className="text-[11px] text-black/40">{data.updatedAt || '刚刚'}</div>
        </div>
        <div className="p-4 max-h-[520px] overflow-y-auto no-scrollbar">
            {(data.lines || []).map((line, i) => (
                <div key={i} className="min-h-[28px] border-b border-[#e6d99e] text-[14px] leading-7 whitespace-pre-wrap">{line}</div>
            ))}
        </div>
    </div>
);

// ── 日程表 ────────────────────────────────────────────────────────────────
export const ScheduleScreen: React.FC<{ data: FauxSchedule }> = ({ data }) => (
    <div className="rounded-xl overflow-hidden border border-black/10 bg-white text-[#151515]">
        <div className="px-4 py-3 bg-[#f5f5f7] border-b border-black/10">
            <div className="text-[12px] text-black/45">{data.date || '今天'}</div>
            <div className="text-[18px] font-black">{data.title || '日程'}</div>
        </div>
        <div className="p-3.5 space-y-2 max-h-[520px] overflow-y-auto no-scrollbar">
            {(data.items || []).map((item, i) => (
                <div key={i} className="grid grid-cols-[54px_1fr] gap-2">
                    <div className="text-[11px] text-black/40 pt-2">{item.time}</div>
                    <div className={`rounded-lg p-2.5 border ${item.done ? 'bg-slate-50 text-black/45 border-black/5' : 'bg-[#eef5ff] border-[#cfe2ff]'}`}>
                        <div className="text-[13px] font-bold">{item.title}</div>
                        {(item.place || item.note) && <div className="text-[11px] text-black/45 mt-0.5">{[item.place, item.note].filter(Boolean).join(' · ')}</div>}
                    </div>
                </div>
            ))}
        </div>
    </div>
);

// ── 订单小票 ───────────────────────────────────────────────────────────────
export const ReceiptScreen: React.FC<{ data: FauxReceipt }> = ({ data }) => (
    <div className="rounded-xl overflow-hidden border border-black/10 bg-[#fbfaf7] text-[#202020]">
        <div className="p-4 text-center border-b border-dashed border-black/20">
            <div className="text-[18px] font-black">{data.shopName || '店铺'}</div>
            <div className="text-[11px] text-black/45 mt-0.5">订单号 {data.orderNo || '--'} · {data.status || '已完成'}</div>
        </div>
        <div className="p-4 space-y-3">
            <div className="space-y-1.5">
                {(data.items || []).map((item, i) => (
                    <div key={i} className="flex justify-between gap-3 text-[13px]">
                        <span className="min-w-0 truncate">{item.name} × {item.count ?? 1}</span>
                        <span>￥{Number(item.price ?? 0).toFixed(1)}</span>
                    </div>
                ))}
            </div>
            <div className="border-t border-dashed border-black/20 pt-2 flex justify-between font-black text-[15px]">
                <span>合计</span><span>￥{Number(data.total ?? 0).toFixed(1)}</span>
            </div>
            {(data.timeline || []).length > 0 && (
                <div className="border-t border-dashed border-black/20 pt-2 space-y-1">
                    {(data.timeline || []).map((t, i) => <div key={i} className="text-[11.5px] text-black/60">{t.time} · {t.text}</div>)}
                </div>
            )}
        </div>
    </div>
);

// ── 搜索页 ────────────────────────────────────────────────────────────────
export const BrowserResults: React.FC<{ data: FauxBrowser }> = ({ data }) => (
    <div className="rounded-xl overflow-hidden border border-black/10 bg-white text-[#202124]">
        <div className="px-4 py-3 bg-[#f8fafd] border-b border-black/10">
            <div className="rounded-full bg-white border border-black/10 px-3 py-2 text-[13px] text-black/70 truncate">{data.query || '搜索词'}</div>
        </div>
        <div className="p-3.5 space-y-3 max-h-[520px] overflow-y-auto no-scrollbar">
            <div className="rounded-xl bg-[#f1f5ff] p-3">
                <div className="text-[11px] font-bold text-[#3b63c6] mb-1">AI 摘要</div>
                <div className="text-[13px] leading-relaxed whitespace-pre-wrap">{data.summary}</div>
            </div>
            {(data.results || []).map((r, i) => (
                <div key={i} className="space-y-0.5">
                    <div className="text-[14px] text-[#1a0dab] font-medium leading-snug">{r.title}</div>
                    <div className="text-[10.5px] text-[#188038] truncate">{r.url || `example.com/${i + 1}`}</div>
                    <div className="text-[12px] text-black/70 leading-relaxed">{r.snippet}</div>
                </div>
            ))}
        </div>
    </div>
);
