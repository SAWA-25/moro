import type { GroupProfile, Message, MessageType } from '../types';

export type GroupChatArchiveSource = 'moro' | 'sillytavern';

export interface GroupChatArchiveOptions {
    memberNames?: Record<string, string>;
    exportedAt?: number;
}

export interface GroupChatParseOptions {
    characterNameMap?: Record<string, string>;
    userName?: string;
}

export interface ParsedGroupChatArchive {
    source: GroupChatArchiveSource;
    title: string;
    group: Partial<GroupProfile>;
    messages: Message[];
}

interface MoroGroupChatArchive {
    type: 'moro_group_chat_v1';
    version: 1;
    exportedAt: number;
    title: string;
    group: Partial<GroupProfile>;
    members?: Record<string, string>;
    messages: Array<Omit<Message, 'id'> & { id?: number; speakerName?: string }>;
}

const isRecord = (value: unknown): value is Record<string, any> =>
    !!value && typeof value === 'object' && !Array.isArray(value);

const coerceTimestamp = (value: unknown, fallback: number): number => {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim()) {
        const parsed = Date.parse(value);
        if (Number.isFinite(parsed)) return parsed;
    }
    return fallback;
};

const normalizeMessageType = (value: unknown): MessageType => {
    const type = typeof value === 'string' ? value : 'text';
    return type as MessageType;
};

const messageWithoutIndexedDbId = (message: Message, groupId: string, speakerName?: string): Message => ({
    id: 0,
    charId: message.charId || 'system',
    groupId,
    role: message.role || (message.charId === 'user' ? 'user' : 'assistant'),
    type: normalizeMessageType(message.type),
    content: typeof message.content === 'string' ? message.content : String(message.content ?? ''),
    timestamp: coerceTimestamp(message.timestamp, Date.now()),
    metadata: {
        ...(message.metadata || {}),
        ...(speakerName ? { speakerName } : {}),
    },
    ...(message.replyTo ? { replyTo: message.replyTo } : {}),
});

export const groupChatTitle = (group: Pick<GroupProfile, 'name' | 'chatArchiveTitle'>): string => {
    const title = group.chatArchiveTitle?.trim();
    return title || group.name || '群聊记录';
};

export const exportGroupChatArchive = (
    group: GroupProfile,
    messages: Message[],
    options: GroupChatArchiveOptions = {},
): string => {
    const memberNames = options.memberNames || {};
    const archive: MoroGroupChatArchive = {
        type: 'moro_group_chat_v1',
        version: 1,
        exportedAt: options.exportedAt ?? Date.now(),
        title: groupChatTitle(group),
        group: {
            id: group.id,
            name: group.name,
            members: group.members,
            avatar: group.avatar,
            createdAt: group.createdAt,
            ownerId: group.ownerId,
            adminIds: group.adminIds,
            memberNicknames: group.memberNicknames,
            memberTitles: group.memberTitles,
            announcement: group.announcement,
            privateContextCap: group.privateContextCap,
            chatArchiveTitle: group.chatArchiveTitle,
        },
        members: memberNames,
        messages: messages.map(message => {
            const { id: _id, ...rest } = message;
            return {
                ...rest,
                speakerName: memberNames[message.charId],
            };
        }),
    };
    return JSON.stringify(archive, null, 2);
};

export const serializeGroupChatJsonl = (
    group: GroupProfile,
    messages: Message[],
    options: GroupChatArchiveOptions = {},
): string => {
    const memberNames = options.memberNames || {};
    const header = {
        user_name: memberNames.user || 'User',
        character_name: group.name,
        create_date: new Date(options.exportedAt ?? Date.now()).toISOString(),
        chat_metadata: {
            source: 'moro',
            groupId: group.id,
            title: groupChatTitle(group),
            groupName: group.name,
            members: group.members,
        },
    };
    const lines = [header, ...messages.map(message => ({
        name: memberNames[message.charId] || (message.role === 'user' ? (memberNames.user || 'User') : message.charId),
        is_user: message.role === 'user',
        send_date: new Date(coerceTimestamp(message.timestamp, Date.now())).toISOString(),
        mes: message.content,
        extra: {
            character_id: message.charId,
            role: message.role,
            type: message.type,
            metadata: message.metadata,
        },
    }))];
    return lines.map(line => JSON.stringify(line)).join('\n');
};

const parseJsonLines = (raw: string): any[] => raw
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => JSON.parse(line));

const parseMoroArchive = (parsed: MoroGroupChatArchive, targetGroupId: string): ParsedGroupChatArchive => {
    if (!Array.isArray(parsed.messages)) throw new Error('Moro 群聊记录缺少 messages');
    const messages = parsed.messages.map((message, index) => {
        const raw = message as Message & { speakerName?: string };
        return messageWithoutIndexedDbId(
            {
                ...raw,
                id: 0,
                groupId: targetGroupId,
                timestamp: coerceTimestamp(raw.timestamp, Date.now() + index),
            },
            targetGroupId,
            raw.speakerName || parsed.members?.[raw.charId],
        );
    });
    return {
        source: 'moro',
        title: parsed.title || String(parsed.group?.chatArchiveTitle || parsed.group?.name || '导入的群聊记录'),
        group: parsed.group || {},
        messages,
    };
};

const parseSillyTavernJsonl = (
    raw: string,
    targetGroupId: string,
    options: GroupChatParseOptions = {},
): ParsedGroupChatArchive => {
    const lines = parseJsonLines(raw);
    if (lines.length === 0) throw new Error('聊天记录为空');
    const header = isRecord(lines[0]) && isRecord(lines[0].chat_metadata) ? lines[0] : null;
    const body = header ? lines.slice(1) : lines;
    const metadata = header?.chat_metadata || {};
    const fallbackTitle = metadata.title || metadata.name || metadata.groupName || header?.character_name || '导入的群聊记录';
    const userName = options.userName || header?.user_name || 'User';
    const characterNameMap = options.characterNameMap || {};

    const messages = body
        .filter(isRecord)
        .map((line, index) => {
            const speakerName = String(line.name || line.character_name || '').trim();
            const extra = isRecord(line.extra) ? line.extra : {};
            const isUser = line.is_user === true || (!!userName && speakerName === userName);
            const charId = isUser
                ? 'user'
                : String(extra.character_id || characterNameMap[speakerName] || speakerName || `st-speaker-${index + 1}`);
            const role: Message['role'] = isUser ? 'user' : 'assistant';
            return messageWithoutIndexedDbId({
                id: 0,
                charId,
                groupId: targetGroupId,
                role,
                type: normalizeMessageType(extra.type || 'text'),
                content: typeof line.mes === 'string' ? line.mes : String(line.mes ?? ''),
                timestamp: coerceTimestamp(line.send_date, Date.now() + index),
                metadata: {
                    ...(isRecord(extra.metadata) ? extra.metadata : {}),
                    importedFrom: 'sillytavern',
                    speakerName,
                },
            }, targetGroupId, speakerName || undefined);
        });

    return {
        source: 'sillytavern',
        title: String(fallbackTitle),
        group: { chatArchiveTitle: String(fallbackTitle) },
        messages,
    };
};

export const parseGroupChatArchive = (
    raw: string,
    targetGroupId: string,
    options: GroupChatParseOptions = {},
): ParsedGroupChatArchive => {
    const text = raw.trim();
    if (!text) throw new Error('聊天记录为空');
    try {
        const parsed = JSON.parse(text);
        if (isRecord(parsed) && parsed.type === 'moro_group_chat_v1') {
            return parseMoroArchive(parsed as MoroGroupChatArchive, targetGroupId);
        }
        if (Array.isArray(parsed)) {
            return parseSillyTavernJsonl(parsed.map(item => JSON.stringify(item)).join('\n'), targetGroupId, options);
        }
    } catch (error) {
        if (!text.includes('\n')) throw error;
    }
    return parseSillyTavernJsonl(text, targetGroupId, options);
};

const pad = (value: number): string => String(value).padStart(2, '0');

const safeFilenamePart = (value: string): string => {
    const cleaned = value
        .replace(/[\\/:*?"<>|]+/g, '_')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/^\.+|\.+$/g, '');
    return cleaned || '群聊记录';
};

export const buildGroupChatFilename = (
    group: Pick<GroupProfile, 'name' | 'chatArchiveTitle'>,
    timestamp = Date.now(),
): string => {
    const date = new Date(timestamp);
    const stamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
    return `${safeFilenamePart(groupChatTitle(group))}-${stamp}.moro-group-chat.json`;
};
