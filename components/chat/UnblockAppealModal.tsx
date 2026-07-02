import React from 'react';
import { EnvelopeOpen } from '@phosphor-icons/react';
import type { CharacterProfile, Message } from '../../types';
import Modal, { ScrapBtn, ScrapTextarea, ScrapLabel, ScrapNote, ScrapStamp, INK, INK_SOFT } from './ScrapModal';
import type { UnblockAppealDecision } from '../../utils/unblockAppealActions';

const formatAppealTime = (ts?: number) => {
    if (!ts) return '';
    const d = new Date(ts);
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    if (ts >= startOfToday) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (ts >= startOfToday - 24 * 60 * 60 * 1000) return '昨天';
    return `${d.getMonth() + 1}月${d.getDate()}日`;
};

interface UnblockAppealModalProps {
    char: CharacterProfile;
    message: Message;
    isOpen?: boolean;
    reply: string;
    busy?: UnblockAppealDecision | null;
    onReplyChange: (value: string) => void;
    onClose: () => void;
    onDecision: (decision: UnblockAppealDecision) => void;
}

const UnblockAppealModal: React.FC<UnblockAppealModalProps> = ({
    char,
    message,
    isOpen = true,
    reply,
    busy,
    onReplyChange,
    onClose,
    onDecision,
}) => {
    const displayName = char.convoSettings?.remarkName?.trim() || char.name;
    return (
        <Modal
            isOpen={isOpen}
            title="解除拉黑申请"
            en="NEW FRIENDS · VERIFY"
            icon={<ScrapStamp><EnvelopeOpen size={15} weight="bold" /></ScrapStamp>}
            onClose={onClose}
            footer={
                <>
                    <ScrapBtn variant="paper" onClick={onClose} disabled={!!busy}>稍后</ScrapBtn>
                    <ScrapBtn variant="danger" onClick={() => onDecision('reject')} disabled={!!busy}>
                        {busy === 'reject' ? '处理中' : '拒绝'}
                    </ScrapBtn>
                    <ScrapBtn onClick={() => onDecision('accept')} disabled={!!busy}>
                        {busy === 'accept' ? '放回中' : '同意'}
                    </ScrapBtn>
                </>
            }
        >
            <div className="space-y-4">
                <div className="flex items-center gap-3">
                    <img src={char.convoSettings?.charAvatarOverride || char.avatar} alt={displayName} className="w-11 h-11 rounded-xl object-cover shrink-0" />
                    <div className="min-w-0">
                        <div className="text-sm font-black truncate" style={{ color: INK }}>{displayName}</div>
                        <div className="text-[11px] font-bold" style={{ color: INK_SOFT }}>申请从黑名单里回来 · {formatAppealTime(message.timestamp)}</div>
                    </div>
                </div>

                <div className="space-y-2">
                    <ScrapLabel en="VERIFY">验证消息</ScrapLabel>
                    <div className="p-3.5 text-[13px] leading-relaxed whitespace-pre-wrap break-words" style={{ background: 'rgba(255,253,247,0.9)', border: `1px solid ${INK_SOFT}55`, borderRadius: 16, color: '#4f4850' }}>
                        {message.content}
                    </div>
                </div>

                <div className="space-y-2">
                    <ScrapLabel en="REPLY">留言</ScrapLabel>
                    <ScrapTextarea
                        value={reply}
                        onChange={e => onReplyChange(e.target.value)}
                        maxLength={500}
                        disabled={!!busy}
                        placeholder={`回 ${displayName} 一句…（可留空）`}
                        className="h-24"
                    />
                    <ScrapNote>同意会解除黑名单；拒绝会保留黑名单，TA 之后还可能再递验证。</ScrapNote>
                </div>
            </div>
        </Modal>
    );
};

export default UnblockAppealModal;
