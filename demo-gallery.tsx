import React from 'react';
import ReactDOM from 'react-dom/client';
import {
  InsShell, InsHeader, InsScroll, InsCard, Polaroid, StoryRing, IconCircle,
  InsButton, SectionLabel, Chip, accent, INK, INK_SOFT,
} from './components/ui/insKit';
import { Trash, ArrowsClockwise, ChatCircleText, PencilSimpleLine, Sparkle, CaretLeft, Images, Plus, X, TrendUp, WarningCircle, PaperPlaneTilt, ArrowSquareOut } from '@phosphor-icons/react';

/**
 * 临时演示页（非应用本体）：用真实 insKit 组件 + 仓库样片，逐个展示已换肤 App 的新设计，
 * 供 Netlify 预览部署直接打开查看满屏效果。审定方向后删除（不进正式发布）。
 * 打开： https://deploy-preview-197--smoro.netlify.app/demo-gallery.html
 */

const AC = 'orange' as const;
const chars = [
  { name: '林深', avatar: '/moro-avatars/calm.jpg', count: 12 },
  { name: '夏鸢', avatar: '/moro-avatars/coy.jpg', count: 7 },
  { name: '江予安', avatar: '/moro-avatars/pity.jpg', count: 23 },
  { name: '温野', avatar: '/moro-avatars/puzzled.jpg', count: 4 },
];
const photos = [0, 6, 14, 26, 28, 32, 42, 47, 52, 67, 69, 75].map(n => `/tarot/${n}.jpg`);

const Frame: React.FC<{ children: React.ReactNode; label: string }> = ({ children, label }) => (
  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
    <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '0.18em', color: '#8b8996', textTransform: 'uppercase' }}>{label}</div>
    <div style={{ position: 'relative', width: 380, height: 800, borderRadius: 40, overflow: 'hidden', background: '#fff', boxShadow: '0 50px 90px -34px rgba(0,0,0,0.45), 0 0 0 10px #1c1b22', ['--safe-top' as any]: '14px' }}>
      {children}
    </div>
  </div>
);

const Albums: React.FC = () => (
  <InsShell accent={AC}>
    <InsHeader accent={AC} title="相册" en="THE GALLERY" onBack={() => {}} />
    <div className="flex-1 overflow-y-auto no-scrollbar min-h-0">
      <div className="relative z-10 grid grid-cols-2 gap-x-5 gap-y-8 px-5 pt-3 pb-8">
        {chars.map((char, i) => {
          const tilt = i % 4 === 0 ? -2.5 : i % 4 === 1 ? 1.8 : i % 4 === 2 ? -1.2 : 2.4;
          return (
            <Polaroid key={char.name} src={char.avatar} caption={char.name} rotate={tilt} accent={AC} onClick={() => {}} style={{ animationDelay: `${i * 70}ms` }}>
              <span className="absolute top-1.5 left-1.5 text-[10px] font-black tabular-nums px-2 py-0.5 rounded-full" style={{ background: 'rgba(255,255,255,0.92)', color: accent(AC).ink, boxShadow: '0 2px 6px rgba(0,0,0,0.15)' }}>{char.count} 张</span>
            </Polaroid>
          );
        })}
      </div>
    </div>
  </InsShell>
);

const Grid: React.FC = () => (
  <InsShell accent={AC}>
    <InsHeader accent={AC} title="江予安" en="23 PHOTOS" onBack={() => {}} />
    <InsScroll className="px-0">
      <div className="flex items-center gap-4 px-5 pt-2 pb-4">
        <StoryRing src={chars[2].avatar} size={64} active spin={false} />
        <div className="min-w-0">
          <div className="text-[18px] font-extrabold truncate" style={{ color: INK }}>江予安</div>
          <div className="text-[12px] mt-0.5" style={{ color: INK_SOFT }}><span className="font-bold tabular-nums" style={{ color: INK }}>23</span> 张照片</div>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-[3px] px-[3px] pb-6">
        {[...photos, ...photos].slice(0, 18).map((p, i) => (
          <div key={i} className="aspect-square relative overflow-hidden" style={{ background: accent(AC).soft }}>
            <img src={p} className="w-full h-full object-cover animate-photo-develop" style={{ animationDelay: `${Math.min(i, 14) * 35}ms` }} />
            {i % 3 === 0 && <span className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full flex items-center justify-center" style={{ background: 'rgba(255,255,255,0.92)', boxShadow: '0 2px 5px rgba(0,0,0,0.2)' }}><ChatCircleText size={11} weight="fill" style={{ color: accent(AC).solid }} /></span>}
            {i % 2 === 0 && <div className="absolute bottom-1 left-1"><span className="text-[8px] px-1.5 py-0.5 rounded-md font-bold tabular-nums" style={{ background: 'rgba(0,0,0,0.42)', color: '#fff', fontFamily: 'var(--font-label)' }}>3月12日</span></div>}
          </div>
        ))}
      </div>
    </InsScroll>
  </InsShell>
);

const Detail: React.FC = () => (
  <div className="flex flex-col h-full relative" style={{ background: 'linear-gradient(180deg,#2a2723,#16140f)' }}>
    <div className="absolute top-0 left-0 w-full p-4 flex justify-between items-start z-50" style={{ paddingTop: 'calc(var(--safe-top) + 8px)' }}>
      <IconCircle tone="glass"><CaretLeft size={18} weight="bold" /></IconCircle>
      <span className="self-center text-[10px] px-3 py-1.5 rounded-full font-bold" style={{ background: 'rgba(255,255,255,0.16)', color: '#fff', fontFamily: 'var(--font-label)', backdropFilter: 'blur(8px)' }}>3月12日</span>
      <IconCircle tone="glass"><Trash size={17} weight="bold" /></IconCircle>
    </div>
    <div className="flex-1 min-h-0 w-full flex items-center justify-center relative overflow-hidden p-6">
      <div className="animate-develop" style={{ ['--pl-rot' as any]: '-1.2deg' }}>
        <div className="p-2.5 pb-7" style={{ background: '#fff', borderRadius: 8, boxShadow: '0 30px 60px -20px rgba(0,0,0,0.75)' }}>
          <img src={photos[2]} className="max-w-full object-contain" style={{ maxHeight: '46vh', borderRadius: 3, display: 'block' }} />
          <div className="absolute left-0 right-0 bottom-1.5 px-4 text-center"><span className="text-[12px] font-bold truncate block" style={{ color: '#8a857c', fontFamily: 'var(--font-hand)' }}>江予安 · 留言已写在背面</span></div>
        </div>
      </div>
    </div>
    <div className="shrink-0 w-full z-40" style={{ background: '#fff', borderTopLeftRadius: 26, borderTopRightRadius: 26, paddingBottom: 16, boxShadow: '0 -18px 40px -22px rgba(0,0,0,0.6)' }}>
      <div className="p-5">
        <div className="flex items-start gap-3 mb-2">
          <StoryRing src={chars[2].avatar} size={40} active />
          <div className="flex-1 min-w-0">
            <div className="text-[11px] font-bold mb-1 flex items-center gap-1" style={{ color: accent(AC).solid }}><PencilSimpleLine size={12} weight="bold" />江予安 写在背面</div>
            <p className="text-[17px] leading-relaxed" style={{ color: INK, fontFamily: 'var(--font-hand)' }}>“这张光线刚好落在你侧脸上，我看了很久舍不得划走。”</p>
          </div>
        </div>
        <div className="flex justify-between items-center pt-2.5 mt-1" style={{ borderTop: '1px solid rgba(0,0,0,0.06)' }}>
          <button className="text-[11px] flex items-center gap-1 px-2 py-1 font-bold" style={{ color: INK_SOFT }}><ChatCircleText size={13} weight="bold" />翻到那天的对话</button>
          <button className="text-[11px] flex items-center gap-1 px-2 py-1 ml-auto font-bold" style={{ color: accent(AC).solid }}><ArrowsClockwise size={13} weight="bold" />换句留言</button>
        </div>
      </div>
    </div>
  </div>
);

// 积木一览（顺便展示 insKit 的按钮 / 故事环 / 标签）
const KitRow: React.FC = () => (
  <div style={{ width: '100%', maxWidth: 1180, background: '#fff', borderRadius: 24, padding: '22px 26px', boxShadow: '0 18px 40px -28px rgba(0,0,0,0.3)' }}>
    <SectionLabel en="DESIGN KIT" accent={AC}>共用积木（各 App 复用，强调色各自不同）</SectionLabel>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18, alignItems: 'center', marginTop: 16 }}>
      <InsButton variant="solid" accent="orange" icon={<Sparkle size={15} weight="fill" />}>实色按钮</InsButton>
      <InsButton variant="gradient">IG 渐变</InsButton>
      <InsButton variant="soft" accent="violet">浅底</InsButton>
      <InsButton variant="ghost" accent="teal">幽灵</InsButton>
      <div style={{ display: 'flex', gap: 12 }}>
        {chars.map(c => <StoryRing key={c.name} src={c.avatar} size={48} active spin={false} />)}
      </div>
      <Chip active accent="rose">选中标签</Chip>
      <Chip accent="rose">未选标签</Chip>
    </div>
  </div>
);

// ───────────────────────── 拾光图库（XhsStock · red） ─────────────────────────
const STASH_TAGS = ['全部 · 18', '#穿搭 · 6', '#美食 · 5', '#风景 · 4', '#日常 · 3'];
const Stash: React.FC = () => {
  const C = 'red' as const;
  return (
    <InsShell accent={C}>
      <InsHeader accent={C} title="拾光图库" en="18 IN STASH" onBack={() => {}}
        right={<button className="w-9 h-9 rounded-full flex items-center justify-center text-white" style={{ background: accent(C).solid, boxShadow: `0 10px 20px -10px ${accent(C).solid}` }}><Plus size={19} weight="bold" /></button>} />
      <div className="flex-1 overflow-y-auto no-scrollbar min-h-0 relative z-10">
        <div className="flex gap-2 px-4 py-3 overflow-x-auto no-scrollbar">
          {STASH_TAGS.map((t, i) => <Chip key={t} active={i === 0} accent={C}>{t}</Chip>)}
        </div>
        <div className="grid grid-cols-3 gap-[3px] px-[3px] pb-6">
          {[...photos, ...photos].slice(0, 18).map((p, i) => (
            <div key={i} className="aspect-square relative overflow-hidden" style={{ background: accent(C).soft, borderRadius: 6 }}>
              <img src={p} className="w-full h-full object-cover animate-photo-develop" style={{ animationDelay: `${Math.min(i, 14) * 35}ms` }} />
              {i % 4 === 0 && <div className="absolute top-1.5 left-1.5 text-white text-[9px] px-1.5 py-0.5 rounded-full font-bold" style={{ background: accent(C).solid }}>×{i + 1}</div>}
              <div className="absolute bottom-0 left-0 right-0 px-1.5 pb-1 pt-4" style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.6), transparent)' }}>
                <span className="text-[9px] font-medium text-white/90">#{['穿搭', '美食', '风景', '日常'][i % 4]}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </InsShell>
  );
};

// ───────────────────────── 热点（HotNews · red） ─────────────────────────
const NEWS = [
  { source: '微博热搜', items: ['#这部电影票房破十亿#', '某顶流官宣新代言', '今晚有流星雨记得看', '城市夜骑成新风潮'] },
  { source: '知乎热榜', items: ['如何看待最近的 AI 新进展？', '年轻人为什么爱上City Walk', '一个人住是什么体验'] },
  { source: '抖音热点', items: ['这首歌又火回来了', '解压手工合集', '周末好去处盘点'] },
];
const News: React.FC = () => {
  const C = 'red' as const;
  return (
    <InsShell accent={C}>
      <InsHeader accent={C} title="热点" en="HOT NOW" onBack={() => {}}
        right={<IconCircle><ArrowsClockwise size={18} weight="bold" /></IconCircle>} />
      <div className="flex-1 overflow-y-auto no-scrollbar px-4 pb-20 relative z-10">
        <div className="text-center pt-3 pb-4">
          <p className="text-[10px] tracking-[0.4em] uppercase font-bold" style={{ fontFamily: 'var(--font-label)', color: INK_SOFT }}>Moro Daily</p>
          <h2 className="ins-gradient-text text-[30px] font-black tracking-tight mt-1">今日热点</h2>
          <p className="text-[11px] mt-1.5" style={{ color: INK_SOFT }}>03月12日 · 午间版（12:00–16:00） · 更新于 13:20</p>
        </div>
        <InsCard accent={C} edge className="px-3.5 py-3 mb-4 flex gap-2.5 items-start">
          <WarningCircle size={18} weight="fill" className="shrink-0 mt-0.5" style={{ color: accent(C).solid }} />
          <span className="text-[11.5px] leading-relaxed" style={{ color: '#5a5660' }}>这只是<b style={{ color: INK }}>热点可视化</b>。每次对话会随机抽几条注入给角色，偶尔主动<b style={{ color: INK }}>分享成新闻卡片</b>找你聊。</span>
        </InsCard>
        <div className="space-y-3.5">
          {NEWS.map(({ source, items }, gi) => (
            <InsCard key={source} accent={C} className="px-4 py-3.5 animate-ins-card" style={{ animationDelay: `${gi * 60}ms` }}>
              <h3 className="text-[14px] font-extrabold mb-2.5 flex items-center gap-2" style={{ color: INK }}>
                <span className="w-7 h-7 rounded-full flex items-center justify-center" style={{ background: accent(C).soft, color: accent(C).solid }}><TrendUp size={15} weight="bold" /></span>
                {source}
              </h3>
              <ol className="space-y-2.5">
                {items.map((t, i) => (
                  <li key={i} className="flex gap-2.5 text-[13px] leading-snug">
                    <span className="font-black w-5 shrink-0 text-center tabular-nums" style={{ color: i < 3 ? accent(C).solid : INK_SOFT }}>{i + 1}</span>
                    <span className="flex-1 min-w-0 inline-flex items-start gap-1" style={{ color: INK }}>{t}<ArrowSquareOut size={11} weight="bold" className="shrink-0 mt-1" style={{ color: INK_SOFT }} /></span>
                    <PaperPlaneTilt size={15} weight="bold" className="shrink-0 self-start mt-0.5" style={{ color: INK_SOFT }} />
                  </li>
                ))}
              </ol>
            </InsCard>
          ))}
        </div>
      </div>
    </InsShell>
  );
};

const Section: React.FC<{ title: string; sub: string; children: React.ReactNode }> = ({ title, sub, children }) => (
  <div style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 18 }}>
    <div style={{ textAlign: 'center' }}>
      <div className="ins-gradient-text" style={{ fontSize: 26, fontWeight: 900, letterSpacing: '-0.01em' }}>{title}</div>
      <div style={{ fontSize: 12.5, color: '#8b8996', marginTop: 5 }}>{sub}</div>
    </div>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 44, justifyContent: 'center', alignItems: 'flex-start' }}>{children}</div>
  </div>
);

const App: React.FC = () => (
  <div style={{ minHeight: '100vh', background: '#eceae6', padding: '44px 24px 80px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 56 }}>
    <div style={{ textAlign: 'center' }}>
      <div className="ins-gradient-text" style={{ fontSize: 34, fontWeight: 900, letterSpacing: '-0.02em' }}>Moro · Ins 风改造预览</div>
      <div style={{ fontSize: 13, color: '#8b8996', marginTop: 6 }}>已换肤 App 逐个登场 · 演示数据为仓库样片</div>
    </div>
    <Section title="① 相册" sub="彩色拍立得相册墙 / IG 主页式网格 / 灯箱题字">
      <Frame label="相册墙 · Polaroid"><Albums /></Frame>
      <Frame label="网格 · IG 主页"><Grid /></Frame>
      <Frame label="详情 · 灯箱题字"><Detail /></Frame>
    </Section>
    <Section title="② 拾光图库" sub="标签囤图库 · 瀑布显影网格 + 拍立得式入库预览">
      <Frame label="图库 · 标签网格"><Stash /></Frame>
    </Section>
    <Section title="③ 热点" sub="Moro Daily 杂志刊头 + 平台白卡榜单 + 转发">
      <Frame label="热点 · 杂志信息流"><News /></Frame>
    </Section>
    <KitRow />
  </div>
);

const root = ReactDOM.createRoot(document.getElementById('root')!);
root.render(<App />);
