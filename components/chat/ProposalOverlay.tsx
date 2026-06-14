import React from 'react';
import { Message } from '../../types';

/**
 * 浪漫求婚界面（全屏覆盖层）。
 * 点开聊天里的「求婚小卡」进入：
 *  - 角色求婚（from='char'）且待回应 → 用户在这里选择「答应 / 再想想」。
 *  - 用户求婚（from='user'）→ 展示「等待 TA 回应」，角色给出回应后展示结果与台词。
 *  - 已答应 / 已婉拒 → 展示结果。
 */
interface ProposalOverlayProps {
    message: Message;
    charName: string;
    charAvatar: string;
    userName: string;
    busy?: boolean;
    /** 用户回应「角色的求婚」 */
    onRespond: (accept: boolean) => void;
    onClose: () => void;
}

const FLOATING = ['💗', '💖', '💍', '🌹', '💞', '✨', '💐', '🤍'];

const ProposalOverlay: React.FC<ProposalOverlayProps> = ({ message, charName, charAvatar, userName, busy, onRespond, onClose }) => {
    const p: any = message.metadata?.proposal || {};
    const from: 'user' | 'char' = p.from === 'char' ? 'char' : 'user';
    const status: 'pending' | 'accepted' | 'declined' = p.status || 'pending';
    const vow: string = p.vow || '';
    const reply: string = p.reply || '';

    const proposerName = from === 'char' ? charName : userName;
    const userCanRespond = from === 'char' && status === 'pending';

    return (
        <div className="absolute inset-0 z-[500] overflow-hidden animate-fade-in" style={{ background: 'radial-gradient(120% 120% at 50% 0%, #ffd9e4 0%, #ffb9cf 38%, #e98aae 72%, #c2557a 100%)' }}>
            <style>{`
                @keyframes proposalFloat { 0% { transform: translateY(20px) scale(0.9); opacity: 0; } 15% { opacity: 0.9; } 100% { transform: translateY(-110vh) scale(1.1); opacity: 0; } }
                @keyframes ringPulse { 0%,100% { transform: scale(1); } 50% { transform: scale(1.08); } }
            `}</style>
            {/* 漂浮的爱心花瓣 */}
            {Array.from({ length: 14 }).map((_, i) => (
                <span key={i} className="absolute select-none pointer-events-none"
                    style={{
                        left: `${(i * 7 + 4) % 96}%`,
                        bottom: '-40px',
                        fontSize: `${16 + (i % 4) * 8}px`,
                        animation: `proposalFloat ${7 + (i % 5)}s linear ${(i % 6) * 0.8}s infinite`,
                        opacity: 0.85,
                    }}>{FLOATING[i % FLOATING.length]}</span>
            ))}

            <div className="relative h-full flex flex-col items-center justify-center px-8 text-center" style={{ paddingTop: 'var(--safe-top)', paddingBottom: 'var(--safe-bottom)' }}>
                <button onClick={onClose} className="absolute top-4 right-5 w-9 h-9 rounded-full bg-white/30 text-white text-lg font-bold active:scale-90 transition" style={{ top: 'calc(var(--safe-top) + 12px)' }}>×</button>

                {/* 头像 + 戒指 */}
                <div className="relative mb-6">
                    <div className="w-28 h-28 rounded-full p-1 bg-white/70 shadow-xl" style={{ animation: 'ringPulse 2.4s ease-in-out infinite' }}>
                        <img src={charAvatar} alt={charName} className="w-full h-full rounded-full object-cover border-4 border-white" />
                    </div>
                    <div className="absolute -bottom-2 -right-2 text-4xl drop-shadow-lg">💍</div>
                </div>

                <div className="text-white/80 text-[12px] font-mono tracking-[0.4em] uppercase mb-2">Will You Marry Me</div>

                {status === 'accepted' ? (
                    <>
                        <h2 className="text-white text-[28px] font-black drop-shadow mb-3">我们订婚啦 ❤️</h2>
                        {vow && <p className="text-white/90 text-[14px] leading-relaxed max-w-sm mb-3">「{vow}」</p>}
                        {reply && <p className="text-white text-[15px] leading-relaxed max-w-sm bg-white/20 rounded-2xl px-4 py-3 mb-6">{charName}：{reply}</p>}
                        <p className="text-white/80 text-[12px] mb-6">从今天起，奔赴一场婚姻的筹备 —— 这件喜事已记进岁时记。</p>
                        <button onClick={onClose} className="px-10 py-3 rounded-full bg-white text-[15px] font-black active:scale-95 transition" style={{ color: '#c2557a' }}>好的，一起走下去</button>
                    </>
                ) : status === 'declined' ? (
                    <>
                        <h2 className="text-white text-[24px] font-black drop-shadow mb-3">这一次，先放在心里</h2>
                        {reply && <p className="text-white text-[15px] leading-relaxed max-w-sm bg-white/20 rounded-2xl px-4 py-3 mb-6">{(from === 'char' ? userName : charName)}：{reply}</p>}
                        <p className="text-white/85 text-[13px] max-w-sm mb-6">感情的事急不来，慢慢来也很好。</p>
                        <button onClick={onClose} className="px-10 py-3 rounded-full bg-white text-[15px] font-black active:scale-95 transition" style={{ color: '#c2557a' }}>合上</button>
                    </>
                ) : (
                    <>
                        <h2 className="text-white text-[24px] font-black drop-shadow mb-4">{proposerName} 向{from === 'char' ? '你' : ' TA'}许下一生之约</h2>
                        {vow && <p className="text-white text-[16px] leading-relaxed max-w-sm bg-white/20 rounded-2xl px-5 py-4 mb-8">「{vow}」</p>}
                        {userCanRespond ? (
                            <div className="flex flex-col items-center gap-3 w-full max-w-xs">
                                <button disabled={busy} onClick={() => onRespond(true)} className="w-full py-3.5 rounded-full bg-white text-[16px] font-black active:scale-95 transition disabled:opacity-60" style={{ color: '#c2557a' }}>{busy ? '…' : '我愿意 💍'}</button>
                                <button disabled={busy} onClick={() => onRespond(false)} className="w-full py-3 rounded-full bg-white/25 text-white text-[14px] font-bold active:scale-95 transition disabled:opacity-60">再想想…</button>
                            </div>
                        ) : (
                            <div className="flex flex-col items-center gap-3 text-white/90">
                                <div className="w-7 h-7 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                                <p className="text-[13px]">求婚已送出，等待 {charName} 的回应…</p>
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    );
};

export default ProposalOverlay;
