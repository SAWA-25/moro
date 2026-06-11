import React, { useEffect, useMemo, useState } from 'react';
import { MagnifyingGlass, ArrowClockwise, Compass, Camera, Heart, CaretLeft } from '@phosphor-icons/react';
import { useOS } from '../context/OSContext';
import { AppID } from '../types';
import { XhsMcpClient, extractNotesFromMcpData, normalizeNote } from '../utils/xhsMcpClient';

/**
 * 小红书 App（原「朋友圈」独立入口改造）。
 * 朋友圈功能不在这里——聊天 App 的「朋友圈」标签页（<MomentsFeed embedded />）原样保留。
 *
 * 通过小红书 MCP（设置 → 实时感知 → 小红书）提供：
 *  - 发现页：推荐流瀑布卡片
 *  - 搜索：关键词搜笔记
 *  - 笔记详情：正文 + 图片
 * 并提供「自由活动」（角色自主刷小红书）与「图库」的快捷入口。
 */

type XhsNoteLite = ReturnType<typeof normalizeNote>;

/** 从 MCP 返回的任意结构里捞图片 URL（防御式：不同后端字段名不一） */
const collectImageUrls = (data: any, cap = 9): string[] => {
    const urls: string[] = [];
    const seen = new Set<string>();
    const visit = (node: any, depth: number) => {
        if (!node || urls.length >= cap || depth > 6) return;
        if (typeof node === 'string') {
            if (/^https?:\/\/[^\s"']+/.test(node) && /(sns-img|xhscdn|picasso|\.jpg|\.jpeg|\.png|\.webp)/i.test(node)) {
                const u = node.replace(/^http:\/\//, 'https://');
                if (!seen.has(u)) { seen.add(u); urls.push(u); }
            }
            return;
        }
        if (Array.isArray(node)) { node.forEach(item => visit(item, depth + 1)); return; }
        if (typeof node === 'object') {
            for (const key of ['urlDefault', 'url_default', 'url', 'urlPre', 'imageList', 'image_list', 'images', 'cover', 'infoList', 'info_list']) {
                if (node[key] !== undefined) visit(node[key], depth + 1);
            }
        }
    };
    visit(data, 0);
    return urls;
};

const NoteCard: React.FC<{ note: XhsNoteLite; onClick: () => void }> = ({ note, onClick }) => (
    <button onClick={onClick} className="w-full text-left rounded-xl overflow-hidden bg-white shadow-sm border border-slate-100 active:scale-[0.98] transition-transform mb-3 break-inside-avoid">
        {note.coverUrl ? (
            <img src={note.coverUrl} className="w-full object-cover" referrerPolicy="no-referrer" loading="lazy"
                onError={(e: any) => { e.target.style.display = 'none'; }} />
        ) : (
            <div className="w-full aspect-[3/4] bg-gradient-to-br from-red-50 to-rose-100 flex items-center justify-center text-red-200 text-3xl font-black select-none">小红书</div>
        )}
        <div className="px-2.5 pt-2 pb-2.5">
            <div className="text-[12px] font-bold text-slate-800 leading-snug line-clamp-2">{note.title || note.desc?.slice(0, 40) || '（无标题）'}</div>
            <div className="flex items-center justify-between mt-1.5">
                <span className="text-[10px] text-slate-400 truncate flex-1">{note.author || '小红薯'}</span>
                <span className="inline-flex items-center gap-0.5 text-[10px] text-slate-400 shrink-0">
                    <Heart className="w-3 h-3" weight="regular" />{note.likes > 0 ? note.likes : ''}
                </span>
            </div>
        </div>
    </button>
);

const SocialApp: React.FC = () => {
    const { closeApp, openApp, addToast, realtimeConfig } = useOS();
    const mcpUrl = realtimeConfig?.xhsMcpConfig?.serverUrl || '';
    const mcpEnabled = !!realtimeConfig?.xhsMcpConfig?.enabled && !!mcpUrl;

    const [notes, setNotes] = useState<XhsNoteLite[]>([]);
    const [loading, setLoading] = useState(false);
    const [searchInput, setSearchInput] = useState('');
    const [activeKeyword, setActiveKeyword] = useState(''); // 空 = 发现页推荐流
    const [detail, setDetail] = useState<{ note: XhsNoteLite; text: string; images: string[] } | null>(null);
    const [detailLoading, setDetailLoading] = useState(false);

    const loadFeed = async (keyword?: string) => {
        if (!mcpEnabled || loading) return;
        setLoading(true);
        try {
            const result = keyword
                ? await XhsMcpClient.search(mcpUrl, keyword)
                : await XhsMcpClient.getRecommend(mcpUrl);
            if (!result.success) throw new Error(result.error || 'MCP 返回失败');
            const list = extractNotesFromMcpData(result.data).map(normalizeNote).filter(n => n.noteId);
            setNotes(list);
            if (list.length === 0) addToast(keyword ? '没搜到相关笔记' : '推荐流为空，稍后再刷', 'info');
        } catch (e: any) {
            addToast(`小红书加载失败：${e?.message || '未知错误'}`, 'error');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (mcpEnabled) void loadFeed();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [mcpEnabled]);

    const handleSearch = () => {
        const kw = searchInput.trim();
        setActiveKeyword(kw);
        void loadFeed(kw || undefined);
    };

    const openDetail = async (note: XhsNoteLite) => {
        setDetail({ note, text: '', images: note.coverUrl ? [note.coverUrl] : [] });
        setDetailLoading(true);
        try {
            const noteUrl = `https://www.xiaohongshu.com/explore/${note.noteId}`;
            const result = await XhsMcpClient.getNoteDetail(mcpUrl, noteUrl, note.xsecToken);
            if (result.success && result.data) {
                const d: any = result.data;
                const inner = d.note || d.data?.note || d.data || d;
                const text = String(inner?.desc || inner?.description || inner?.content || note.desc || '').trim();
                const images = collectImageUrls(inner);
                setDetail({ note, text: text || note.desc || '', images: images.length ? images : (note.coverUrl ? [note.coverUrl] : []) });
            } else {
                setDetail(prev => prev ? { ...prev, text: note.desc || '（详情加载失败）' } : prev);
            }
        } catch {
            setDetail(prev => prev ? { ...prev, text: note.desc || '（详情加载失败）' } : prev);
        } finally {
            setDetailLoading(false);
        }
    };

    // 瀑布流分两列（简单交替分配）
    const [colA, colB] = useMemo(() => {
        const a: XhsNoteLite[] = []; const b: XhsNoteLite[] = [];
        notes.forEach((n, i) => (i % 2 === 0 ? a : b).push(n));
        return [a, b];
    }, [notes]);

    // ── 笔记详情页 ──
    if (detail) {
        return (
            <div className="absolute inset-0 flex flex-col bg-white animate-fade-in" style={{ paddingTop: 'var(--safe-top)' }}>
                <div className="flex items-center gap-2 px-3 py-2.5 border-b border-slate-100 shrink-0">
                    <button onClick={() => setDetail(null)} className="p-1.5 -ml-1 rounded-full active:bg-slate-100">
                        <CaretLeft className="w-5 h-5 text-slate-600" weight="bold" />
                    </button>
                    <span className="text-[13px] font-bold text-slate-700 truncate flex-1">{detail.note.author || '小红薯'}</span>
                    <span className="text-[10px] font-bold text-red-400 border border-red-200 rounded-full px-2.5 py-1">小红书</span>
                </div>
                <div className="flex-1 overflow-y-auto no-scrollbar pb-10">
                    {detail.images.map((src, i) => (
                        <img key={i} src={src} className="w-full object-cover" referrerPolicy="no-referrer"
                            onError={(e: any) => { e.target.style.display = 'none'; }} />
                    ))}
                    <div className="px-4 pt-3">
                        <div className="text-[16px] font-bold text-slate-800 leading-snug">{detail.note.title}</div>
                        <div className="text-[13px] text-slate-600 leading-relaxed whitespace-pre-wrap mt-2">
                            {detailLoading ? '加载详情中…' : (detail.text || '（无正文）')}
                        </div>
                        <div className="flex items-center gap-1 text-[11px] text-slate-400 mt-4">
                            <Heart className="w-3.5 h-3.5" weight="regular" />{detail.note.likes || 0} 赞
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="absolute inset-0 flex flex-col bg-[#f7f7f7]" style={{ paddingTop: 'var(--safe-top)' }}>
            {/* 顶栏：返回 + 标题 + 自由活动/图库快捷入口 */}
            <div className="flex items-center gap-2 px-3 py-2.5 bg-white border-b border-slate-100 shrink-0">
                <button onClick={closeApp} className="p-1.5 -ml-1 rounded-full active:bg-slate-100">
                    <CaretLeft className="w-5 h-5 text-slate-600" weight="bold" />
                </button>
                <span className="text-[16px] font-black text-red-500 select-none">小红书</span>
                <div className="flex-1" />
                <button onClick={() => openApp(AppID.XhsFreeRoam)} title="自由活动（角色自主刷小红书）"
                    className="p-2 rounded-full active:bg-slate-100 text-slate-500">
                    <Compass className="w-5 h-5" weight="bold" />
                </button>
                <button onClick={() => openApp(AppID.XhsStock)} title="图库（发贴囤图）"
                    className="p-2 rounded-full active:bg-slate-100 text-slate-500">
                    <Camera className="w-5 h-5" weight="bold" />
                </button>
            </div>

            {/* 搜索栏 */}
            <div className="flex items-center gap-2 px-3 py-2 bg-white shrink-0">
                <div className="flex-1 flex items-center gap-2 bg-slate-100 rounded-full px-3.5 py-2">
                    <MagnifyingGlass className="w-4 h-4 text-slate-400 shrink-0" weight="bold" />
                    <input
                        value={searchInput}
                        onChange={e => setSearchInput(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') handleSearch(); }}
                        placeholder="搜索笔记…"
                        className="flex-1 bg-transparent text-[13px] outline-none min-w-0"
                    />
                </div>
                <button onClick={handleSearch} className="text-[12px] font-bold text-red-500 px-1.5 shrink-0">搜索</button>
                <button onClick={() => { setSearchInput(''); setActiveKeyword(''); void loadFeed(); }}
                    className={`p-1.5 rounded-full active:bg-slate-100 text-slate-500 shrink-0 ${loading ? 'animate-spin' : ''}`} title="刷新推荐">
                    <ArrowClockwise className="w-4 h-4" weight="bold" />
                </button>
            </div>

            <div className="flex-1 overflow-y-auto no-scrollbar px-3 pt-3 pb-10">
                {!mcpEnabled ? (
                    <div className="mt-10 mx-2 rounded-2xl bg-white border border-slate-100 shadow-sm p-6 text-center">
                        <div className="text-3xl mb-3">📕</div>
                        <div className="text-[14px] font-bold text-slate-700 mb-2">还没连接小红书</div>
                        <div className="text-[12px] text-slate-400 leading-relaxed mb-4">
                            到 设置 → 实时感知 → 小红书 启用并填入 MCP 服务地址后，这里就能刷推荐、搜笔记了。
                        </div>
                        <button onClick={() => openApp(AppID.Settings)} className="px-5 py-2.5 rounded-full bg-red-500 text-white text-[12px] font-bold active:scale-95 transition-transform">去设置</button>
                    </div>
                ) : loading && notes.length === 0 ? (
                    <div className="mt-16 text-center text-[12px] text-slate-400">{activeKeyword ? `搜索「${activeKeyword}」中…` : '加载推荐流…'}</div>
                ) : (
                    <div className="flex gap-3 items-start">
                        <div className="flex-1 min-w-0">{colA.map(n => <NoteCard key={n.noteId} note={n} onClick={() => void openDetail(n)} />)}</div>
                        <div className="flex-1 min-w-0">{colB.map(n => <NoteCard key={n.noteId} note={n} onClick={() => void openDetail(n)} />)}</div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default SocialApp;
