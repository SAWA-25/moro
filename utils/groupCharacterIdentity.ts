import type { CharacterProfile, GroupProfile } from '../types';
import { getCharacterModelId } from './characterIdentity';

const MEMBER_LENS_MAX_LENGTH = 500;

const cleanGeneratedMemberLens = (value: unknown): string => String(value || '')
    .replace(/```(?:json)?/gi, '')
    .replace(/```/g, '')
    .replace(/^["'“”]+|["'“”]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MEMBER_LENS_MAX_LENGTH);

export const resolveGroupMemberStorageId = (
    group: Pick<GroupProfile, 'members'>,
    members: CharacterProfile[],
    rawId: unknown,
): string | undefined => {
    const id = String(rawId || '').trim();
    if (!id) return undefined;
    if (group.members.includes(id)) return id;
    const byModelId = members.find(member => getCharacterModelId(member) === id);
    return byModelId && group.members.includes(byModelId.id) ? byModelId.id : undefined;
};

export const parseGroupMemberLensMap = (
    raw: string,
    targets: CharacterProfile[],
): Record<string, string> => {
    const targetIds = targets.map(target => target.id);
    const group = { members: targetIds };
    const out: Record<string, string> = {};
    const cleaned = String(raw || '').replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
    const jsonText = (() => {
        const objStart = cleaned.indexOf('{');
        const objEnd = cleaned.lastIndexOf('}');
        if (objStart >= 0 && objEnd > objStart) return cleaned.slice(objStart, objEnd + 1);
        const arrStart = cleaned.indexOf('[');
        const arrEnd = cleaned.lastIndexOf(']');
        if (arrStart >= 0 && arrEnd > arrStart) return cleaned.slice(arrStart, arrEnd + 1);
        return cleaned;
    })();

    try {
        const parsed = JSON.parse(jsonText);
        const source = parsed?.relations || parsed?.lenses || parsed?.items || parsed;
        if (Array.isArray(source)) {
            source.forEach((item: any) => {
                const id = resolveGroupMemberStorageId(group, targets, item?.targetId || item?.charId || item?.id);
                if (!id) return;
                const text = cleanGeneratedMemberLens(item?.text ?? item?.relation ?? item?.summary ?? item?.note);
                if (text) out[id] = text;
            });
        } else if (source && typeof source === 'object') {
            Object.entries(source).forEach(([rawId, value]: [string, any]) => {
                const id = resolveGroupMemberStorageId(group, targets, rawId);
                if (!id) return;
                const text = typeof value === 'string'
                    ? cleanGeneratedMemberLens(value)
                    : cleanGeneratedMemberLens(value?.text ?? value?.relation ?? value?.summary ?? value?.note);
                if (text) out[id] = text;
            });
        }
    } catch {
        if (targets.length === 1) {
            const text = cleanGeneratedMemberLens(cleaned);
            if (text) out[targets[0].id] = text;
        }
    }
    return out;
};
