import React, { useEffect, useState } from 'react';
import Modal from '../os/Modal';
import { CharacterProfile } from '../../types';
import { useOS } from '../../context/OSContext';
import { DB } from '../../utils/db';
import { safeResponseJson, extractContent } from '../../utils/safeApi';

/**
 * 好友验证（被角色拉黑后重新申请加好友）。
 * 入口：加好友页（ChatHub「添加好友」）选中拉黑你的角色 / 聊天页被拉黑横幅。
 * 用户写一条验证消息 → 角色按人设 + 拉黑前的聊天语境决定是否拉回，并在验证里回复。
 */

interface FriendVerifyModalProps {
    char: CharacterProfile;
    isOpen: boolean;
    onClose: () => void;
    /** 验证通过（角色把用户拉回）后回调：宿主刷新消息 / 进入会话 */
    onAccepted?: () => void;
}

const safeParseObject = (input: string): any => {
    const clean = (input || '').replace(/```json/g, '').replace(/```/g, '').trim();
    try { return JSON.parse(clean); } catch { /* fallthrough */ }
    const start = clean.indexOf('{');
    const end = clean.lastIndexOf('}');
    if (start >= 0 && end > start) {
        try { return JSON.parse(clean.substring(start, end + 1)); } catch { /* fallthrough */ }
    }
    return null;
};

const FriendVerifyModal: React.FC<FriendVerifyModalProps> = ({ char, isOpen, onClose, onAccepted }) => {
    const { apiConfig, userProfile, updateCharacter, addToast } = useOS();
    const [text, setText] = useState('');
    const [phase, setPhase] = useState<'input' | 'sending' | 'accepted' | 'rejected'>('input');
    const [reply, setReply] = useState('');

    useEffect(() => {
        if (isOpen) { setText(''); setPhase('input'); setReply(''); }
    }, [isOpen, char.id]);

    const handleSend = async () => {
        const verifyText = text.trim();
        if (!verifyText) { addToast('先写一句验证消息吧', 'info'); return; }
        if (!apiConfig?.baseUrl) { addToast('请先在设置中配置 API', 'error'); return; }
        setPhase('sending');
        try {
            const userName = userProfile?.name || '用户';
            const recent = await DB.getRecentMessagesByCharId(char.id, 30);
            const historyText = recent
                .filter(m => m.type === 'text' && !m.metadata?.hidden && m.role !== 'system')
                .slice(-20)
                .map(m => `${m.role === 'user' ? userName : char.name}: ${String(m.content).slice(0, 120)}`)
                .join('\n');
            const blockedAgo = char.charBlock?.blockedAt
                ? `${Math.max(1, Math.round((Date.now() - char.charBlock.blockedAt) / 60000))} 分钟前`
                : '不久前';

            const prompt = `你正在扮演「${char.name}」。
人设：${String(char.description || '').slice(0, 800)}

情境：你在 ${blockedAgo} 因为不愉快把 ${userName} 拉黑了。拉黑前你们最近的聊天片段：
${historyText || '（没有可用的聊天记录）'}

现在 ${userName} 通过好友验证重新申请加你为好友，验证消息是：
「${verifyText}」

请完全按你的性格和当时拉黑的原因，决定是否通过这次好友验证（把对方拉回）。气还没消可以拒绝；被打动了、心软了、本来就只是赌气，都可以通过。
只输出一个 JSON 对象，不要任何其它文字：
{"accept": true 或 false, "reply": "你想对对方说的一句话（拒绝时也可以说，或留空字符串表示沉默）"}`;

            const response = await fetch(`${apiConfig.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiConfig.apiKey}` },
                body: JSON.stringify({
                    model: apiConfig.model,
                    messages: [{ role: 'user', content: prompt }],
                    temperature: 0.85,
                    max_tokens: 300,
                }),
            });
            if (!response.ok) throw new Error(`API Error (${response.status})`);
            const data = await safeResponseJson(response);
            const parsed = safeParseObject(extractContent(data));
            if (!parsed || typeof parsed.accept !== 'boolean') throw new Error('验证结果解析失败');

            const replyText = String(parsed.reply || '').trim();
            setReply(replyText);

            if (parsed.accept) {
                if (char.charBlock) {
                    updateCharacter(char.id, { charBlock: { ...char.charBlock, active: false } });
                }
                const now = Date.now();
                await DB.saveMessage({ charId: char.id, role: 'user', type: 'text', content: `[好友验证] ${verifyText}`, timestamp: now, metadata: { friendVerify: true } });
                await DB.saveMessage({ charId: char.id, role: 'system', type: 'text', content: `「${char.name}」通过了你的好友验证，你们可以继续聊天了`, timestamp: now + 1 });
                if (replyText) {
                    await DB.saveMessage({ charId: char.id, role: 'assistant', type: 'text', content: replyText, timestamp: now + 2 });
                }
                setPhase('accepted');
                onAccepted?.();
            } else {
                setPhase('rejected');
            }
        } catch (e: any) {
            console.warn('[FriendVerify] failed:', e);
            addToast(`好友验证发送失败：${e?.message || e}`, 'error');
            setPhase('input');
        }
    };

    return (
        <Modal isOpen={isOpen} title="好友验证" onClose={onClose} footer={
            phase === 'input' || phase === 'sending' ? (
                <>
                    <button onClick={onClose} className="flex-1 py-3 bg-slate-100 text-slate-500 font-bold rounded-2xl active:scale-95 transition-transform">取消</button>
                    <button
                        onClick={handleSend}
                        disabled={phase === 'sending'}
                        className="flex-1 py-3 bg-violet-500 text-white font-bold rounded-2xl active:scale-95 transition-transform shadow-lg disabled:opacity-50"
                    >
                        {phase === 'sending' ? '等待对方处理…' : '发送验证'}
                    </button>
                </>
            ) : (
                <button onClick={onClose} className="flex-1 py-3 bg-violet-500 text-white font-bold rounded-2xl active:scale-95 transition-transform shadow-lg">
                    {phase === 'accepted' ? '去聊天' : '知道了'}
                </button>
            )
        }>
            <div className="space-y-4">
                <div className="flex items-center gap-3">
                    <img src={char.avatar} alt={char.name} className="w-11 h-11 rounded-xl object-cover shrink-0" />
                    <div className="min-w-0">
                        <div className="text-sm font-bold text-slate-700 truncate">{char.name}</div>
                        <div className="text-[11px] text-red-400">对方把你拉黑了，需要发送好友验证</div>
                    </div>
                </div>

                {(phase === 'input' || phase === 'sending') && (
                    <textarea
                        value={text}
                        onChange={e => setText(e.target.value)}
                        disabled={phase === 'sending'}
                        placeholder={`和 ${char.name} 说点什么…（解释、道歉、撒娇都行，能不能拉回就看 TA 的心情了）`}
                        className="w-full h-24 bg-slate-50 rounded-2xl p-3 text-sm resize-none border border-slate-200 focus:border-violet-300 focus:outline-none transition-colors"
                    />
                )}

                {phase === 'accepted' && (
                    <div className="bg-emerald-50 border border-emerald-100 rounded-2xl p-4 space-y-1.5">
                        <div className="text-sm font-bold text-emerald-600">✓ {char.name} 通过了你的好友验证</div>
                        {reply && <div className="text-[12px] text-slate-600 leading-relaxed">{char.name}：{reply}</div>}
                    </div>
                )}

                {phase === 'rejected' && (
                    <div className="bg-red-50 border border-red-100 rounded-2xl p-4 space-y-1.5">
                        <div className="text-sm font-bold text-red-500">对方拒绝了你的好友验证</div>
                        <div className="text-[12px] text-slate-600 leading-relaxed">
                            {reply ? `${char.name}：${reply}` : `${char.name} 没有任何回应…`}
                        </div>
                        <div className="text-[10px] text-slate-400">TA 也可能在某个时刻自己想通把你拉回，再等等吧。</div>
                    </div>
                )}
            </div>
        </Modal>
    );
};

export default FriendVerifyModal;
