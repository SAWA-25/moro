/**
 * 消息内容规范化：把带特殊 type / metadata 的消息转成可读的单行文本。
 *
 * 适用所有"拼聊天上下文"的场景：
 *  - Chat.tsx / Character.tsx 手动归档
 *  - memoryPalace extraction / retrieval 提取上下文
 *  - 其它需要把 Message → prompt 文本的地方
 *
 * 历史问题：同样的 type-switch 逻辑在三个地方被复制粘贴过，差异演化后导致
 * palace 路径漏掉 score_card / system / transfer / interaction，总结里丢信息。
 * 抽到这里后单点维护。
 */

import type { Message } from '../types';
import { formatLifeSimResetCardForContext } from './lifeSimChatCard';

/** 仅返回内容体（不加 sender / timestamp）。调用方自行拼外层。 */
export function normalizeMessageContent(
    msg: Message,
    charName: string,
    userName: string,
): string {
    // 撤回的消息（QQ/微信语义）：归档 / 记忆 / 总结一律只留"撤回了一条消息"，不泄露原文。
    if (msg.metadata?.recalled) {
        return `[${msg.role === 'user' ? userName : charName}撤回了一条消息]`;
    }
    const type = msg.type as string;

    // 纯视觉/音频类：给个占位，别让 URL / base64 污染 LLM 上下文
    if (type === 'image') return '[图片]';
    if (type === 'emoji') return '[表情包]';
    if (type === 'voice') {
        // 用户录音消息带实时转写（Web Speech API）时把文字带上，否则只留占位
        const transcript = typeof msg.metadata?.transcript === 'string' ? msg.metadata.transcript.trim() : '';
        return transcript ? `[语音消息] ${transcript}` : '[语音]';
    }

    // 位置分享：content 是地点名，metadata.address 是补充描述
    if (type === 'location') {
        const address = typeof msg.metadata?.address === 'string' ? msg.metadata.address.trim() : '';
        return `[位置分享] ${msg.content || '未知地点'}${address ? `（${address}）` : ''}`;
    }

    // 系统交互事件
    if (type === 'interaction') return `[系统: ${userName}戳了${charName}一下]`;
    if (type === 'transfer') {
        const amt = msg.metadata?.amount;
        const isRedPacket = msg.metadata?.kind === 'redpacket';
        const note = typeof msg.metadata?.note === 'string' && msg.metadata.note.trim() ? `，附言「${msg.metadata.note.trim()}」` : '';
        if (isRedPacket) return `[系统: ${userName}发了一个红包${amt !== undefined ? ` ${amt}` : ''}${note}]`;
        return amt !== undefined ? `[系统: ${userName}转账 ${amt}${note}]` : `[系统: ${userName}转账${note}]`;
    }

    // 心意铺礼物卡：谁送了谁什么礼物（+ 赠言），供归档 / 总结 / 召回保留这份心意
    if (type === 'gift_card') {
        const g = msg.metadata?.gift || {};
        const note = typeof g.note === 'string' && g.note.trim() ? `，赠言「${g.note.trim()}」` : '';
        const giver = msg.role === 'user' ? userName : charName;
        const receiver = msg.role === 'user' ? charName : userName;
        return `[心意铺礼物] ${giver}送了${receiver} ${g.emoji || ''}${g.name || '一份礼物'}${note}`;
    }

    // 日常寄物：回形针里的轻量互寄，不走心意铺订单/背包/余额。
    if (type === 'parcel_card') {
        const p = msg.metadata?.parcel || {};
        const note = typeof p.note === 'string' && p.note.trim() ? `，附言「${p.note.trim()}」` : '';
        const method = typeof p.method === 'string' && p.method.trim() ? `，${p.method.trim()}` : '';
        const origin = typeof p.originLabel === 'string' && p.originLabel.trim() ? `，来自${p.originLabel.trim()}` : '';
        const travel = typeof p.travelSnippet === 'string' && p.travelSnippet.trim() ? `，路上见闻「${p.travelSnippet.trim()}」` : '';
        const giver = msg.role === 'user' ? userName : charName;
        const receiver = msg.role === 'user' ? charName : userName;
        const label = p.mode === 'travel_frog' ? '蛙游收件' : p.mode === 'proactive' ? '主动寄来' : '日常寄物';
        return `[${label}] ${giver}寄给${receiver} ${p.emoji || '📦'}${p.itemName || '一份小包裹'}${method}${origin}${travel}${note}`;
    }

    // 结算卡：几种 app 产生，用字段逐一翻成自然文本
    if (type === 'score_card') {
        try {
            const card = msg.metadata?.scoreCard || JSON.parse(msg.content);
            if (card?.type === 'lifesim_reset_card') {
                return formatLifeSimResetCardForContext(card, charName);
            }
            if (card?.type === 'guidebook_card') {
                const diff = (card.finalAffinity ?? 0) - (card.initialAffinity ?? 0);
                return `[攻略本游戏结算] ${charName}和${userName}玩了一局"攻略本"恋爱小游戏（${card.rounds || '?'}回合）。结局：「${card.title || '???'}」 好感度变化：${card.initialAffinity} → ${card.finalAffinity}（${diff >= 0 ? '+' : ''}${diff}） ${charName}的评语：${card.charVerdict || '无'} ${charName}对${userName}的新发现：${card.charNewInsight || '无'}`;
            }
            if (card?.type === 'whiteday_card') {
                const passedStr = card.passed ? `通过测验，解锁了DIY巧克力` : `未通过测验`;
                const questionsText = (card.questions as any[])?.map((q: any, i: number) =>
                    `第${i + 1}题"${q.question}"：${userName}选"${q.userAnswer}"（${q.isCorrect ? '✓' : '✗'}）${q.review ? `，${charName}评语：${q.review}` : ''}`
                ).join('；') || '';
                return `[白色情人节默契测验] ${userName}完成了${charName}出的白色情人节测验，答对${card.score}/${card.total}题，${passedStr}。${questionsText}${card.finalDialogue ? `。${charName}最终评价：${card.finalDialogue}` : ''}`;
            }
            if (card?.type === 'diary_card') {
                const uName = card.userName || userName;
                const userTextPart = (card.userText || '').trim();
                const charTextPart = (card.charText || '').trim();
                const userBlock = userTextPart ? `${uName}写道：「${userTextPart}」` : `${uName}那页是空的`;
                const charBlock = charTextPart ? `${charName}回道：「${charTextPart}」` : `${charName}那页是空的`;
                return `[交换日记 ${card.date || ''}] ${uName}和${charName}今天通过【交换日记】交换了一篇日记。${userBlock} ${charBlock}`;
            }
            if (card?.type === 'like520_card') {
                // 520 特别活动：那个"小小的下午"+ char 给 user 的信。信的内容是这次活动的母题落点，
                // 归档 / 月度总结 / 长期记忆召回都应该读到它，否则只是一个"[系统卡片]"占位会让前后文断层。
                const letter = (typeof card.letter === 'string' && card.letter.trim()) ? card.letter.trim() : '';
                const titlePart = card.title ? `结局「${card.title}」。` : '';
                const descPart = card.description ? `${card.description} ` : '';
                const letterPart = letter ? ` ${charName}写给${userName}的信原文：${letter}` : '';
                return `[520 特别活动] ${charName}和${userName}一起度过了"小小的下午"——${charName}"变小了"的版本被${userName}照顾着，最后${charName}对${userName}说了真心话，并写了一封信。${titlePart}${descPart}${letterPart}`;
            }
            // 其它结算卡类型（songwriting/study/lifesim 日常 等）：如果有 summary/content 字段优先用
            if (typeof card?.summary === 'string' && card.summary.trim()) return `[系统卡片] ${card.summary.trim()}`;
            return '[系统卡片]';
        } catch {
            return '[系统卡片]';
        }
    }

    // 系统消息（通话结束标记等）
    if (type === 'system' && msg.content) {
        return `[系统] ${msg.content}`;
    }

    // HTML 卡片：上下文 / 归档 / palace 都只看到剥离 HTML 后的纯文字摘要，
    // 避免 270px 的视觉 div 把上下文 token 全占了 + LLM 误把 HTML 当正经分析对象。
    if (type === 'html_card') {
        const meta: any = msg.metadata || {};
        const preview = (typeof meta.htmlTextPreview === 'string' && meta.htmlTextPreview)
            ? meta.htmlTextPreview
            : (typeof msg.content === 'string' ? msg.content.replace(/^\[HTML卡片\]\s*/, '') : '');
        return preview ? `[HTML卡片] ${preview}` : '[HTML卡片]';
    }

    // 音乐卡片：把 metadata.song + intent 翻成自然文本，否则归档/palace 只看到
    // "[音乐卡片]" 这种没信息量的占位，丢掉"谁因为什么歌做了什么"的语义
    if (type === 'music_card') {
        const song = msg.metadata?.song as { name?: string; artists?: string } | undefined;
        const intent = msg.metadata?.intent as 'join' | 'add' | 'join_and_add' | 'share' | undefined;
        const addedTo = msg.metadata?.addedToPlaylistTitle as string | undefined;
        if (song?.name) {
            const songDesc = song.artists ? `《${song.name}》— ${song.artists}` : `《${song.name}》`;
            if (intent === 'share' && msg.role === 'user') {
                return `[音乐卡片] ${userName}把${songDesc}分享给${charName}`;
            }
            const action =
                intent === 'join' ? `决定和${userName}一起听这首`
                : intent === 'add' ? `把这首收进了自己的歌单${addedTo ? `《${addedTo}》` : ''}`
                : intent === 'join_and_add' ? `决定和${userName}一起听，也收进了自己的歌单${addedTo ? `《${addedTo}》` : ''}`
                : intent === 'share' ? `主动分享给${userName}一首歌`
                : `对这首有了反应`;
            return `[音乐卡片] ${charName}${action}：${songDesc}`;
        }
        return '[音乐卡片]';
    }

    // TRPG 跑团片段：从 TRPG 游戏里多选转发到聊天的剧情。必须翻成完整可读文本，
    // 让上下文 / 归档 / palace 都能读到"和用户一起玩游戏时发生了什么"，并标明来自 TRPG。
    if (type === 'trpg_card') {
        const t = msg.metadata?.trpg as {
            gameTitle?: string;
            userName?: string;
            partyNames?: string[];
            excerpt?: Array<{ speaker?: string; text?: string }>;
        } | undefined;
        if (t) {
            const others = (t.partyNames || []).filter(n => n && n !== charName);
            const withPart = others.length ? `（和${others.join('、')}）` : '';
            const lines = (t.excerpt || [])
                .map(e => `${e.speaker || ''}: ${(e.text || '').replace(/\s*\n+\s*/g, ' ').trim()}`)
                .filter(s => s.trim() !== ':')
                .join('\n');
            return `[TRPG游戏片段] 这是${charName}和${t.userName || userName}${withPart}一起玩《${t.gameTitle || 'TRPG'}》跑团时的一段剧情（从游戏里转发到聊天，相当于你们一起玩游戏的共同回忆）：\n${lines}`;
        }
        return '[TRPG游戏片段]';
    }

    // 默认：text / 未知类型 → 用 content
    return msg.content || '';
}

/** 完整的"[发送者]: 内容"格式，用于 LLM prompt 里的对话拼接 */
export function formatMessageForPrompt(
    msg: Message,
    charName: string,
    userName: string,
): string {
    const sender = msg.role === 'user' ? userName
        : msg.role === 'system' ? '[系统]'
        : charName;
    return `[${sender}]: ${normalizeMessageContent(msg, charName, userName)}`;
}

/** 带时间戳的版本（归档常用）：`[HH:MM] 发送者: 内容` */
export function formatMessageWithTime(
    msg: Message,
    charName: string,
    userName: string,
    timeFormatter: (ts: number) => string,
): string {
    const sender = msg.role === 'user' ? userName
        : msg.role === 'system' ? '[系统]'
        : charName;
    const time = msg.timestamp > 0 ? timeFormatter(msg.timestamp) : '';
    const prefix = time ? `[${time}] ` : '';
    return `${prefix}${sender}: ${normalizeMessageContent(msg, charName, userName)}`;
}

/**
 * 判断一条消息是否"对 palace / archive 有语义价值"。
 *
 * pipeline 以前的过滤是 `type === 'text'`，这会漏掉 score_card / system /
 * transfer / interaction 等有内容的事件；纯二进制类型（image/emoji/voice）
 * 通过 normalize 会变成短占位符，LLM 看到也没帮助，直接过滤掉。
 */
export function isMessageSemanticallyRelevant(msg: Message): boolean {
    const type = msg.type as string;
    if (type === 'image' || type === 'emoji') return false;
    // 语音：只有带转写文字的（用户录音）才有语义价值
    if (type === 'voice') return !!(typeof msg.metadata?.transcript === 'string' && msg.metadata.transcript.trim());
    // 有内容或有结构化 metadata 才算
    return !!(msg.content?.trim() || msg.metadata?.scoreCard || msg.metadata?.amount || msg.metadata?.song || msg.metadata?.trpg || msg.metadata?.parcel);
}
