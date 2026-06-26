import React from 'react';
import ReactDOM from 'react-dom/client';
import {
  InsShell, InsHeader, InsScroll, Polaroid, StoryRing, IconCircle,
  InsButton, SectionLabel, Chip, accent, INK, INK_SOFT,
} from './components/ui/insKit';
import { Trash, ArrowsClockwise, ChatCircleText, PencilSimpleLine, Sparkle, CaretLeft, Images } from '@phosphor-icons/react';

/**
 * 临时演示页（非应用本体）：用真实 insKit 组件 + 仓库样片，渲染「相册」新设计的三个视图，
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

const App: React.FC = () => (
  <div style={{ minHeight: '100vh', background: '#eceae6', padding: '44px 24px 64px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 36 }}>
    <div style={{ textAlign: 'center' }}>
      <div className="ins-gradient-text" style={{ fontSize: 30, fontWeight: 900, letterSpacing: '-0.01em' }}>相册 · Ins 风 + 拍立得 新设计</div>
      <div style={{ fontSize: 13, color: '#8b8996', marginTop: 6 }}>演示数据 · 头像与照片为仓库样片 · 这是逐 App 换肤的第一个</div>
    </div>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 44, justifyContent: 'center', alignItems: 'flex-start' }}>
      <Frame label="相册墙 · Polaroid"><Albums /></Frame>
      <Frame label="网格 · IG 主页"><Grid /></Frame>
      <Frame label="详情 · 灯箱题字"><Detail /></Frame>
    </div>
    <KitRow />
  </div>
);

const root = ReactDOM.createRoot(document.getElementById('root')!);
root.render(<App />);
