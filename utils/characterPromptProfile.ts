import type { AmbientSocialEntry, CharacterProfile, Persona, UserProfile } from '../types';
import { PersonaRuntime } from './personas';
import { WorldbookRuntime } from './worldbookRuntime';

type CharacterSettingLike = Pick<CharacterProfile, 'name'> & Partial<Pick<CharacterProfile,
    'description' | 'systemPrompt' | 'worldview' | 'lifeProfile' | 'selfInsights' | 'socialProfile' | 'memos' | 'mountedWorldbooks' | 'appearanceTags' | 'writerPersona'
>>;

const clean = (value: unknown): string => String(value || '').replace(/\r\n/g, '\n').trim();

const bulletLines = (values: unknown[] | undefined): string => {
    const lines = (values || []).map(clean).filter(Boolean).map(x => `- ${x}`);
    return lines.join('\n');
};

const ambientSocialLine = (entry: AmbientSocialEntry): string => {
    if (entry.kind === 'group') {
        const members = entry.memberNames?.length ? `，成员：${entry.memberNames.join('、')}` : '';
        const note = clean(entry.note);
        return `- 群聊「${entry.name}」：${entry.relationLabel}${members}${note ? `；${note}` : ''}`;
    }
    const note = clean(entry.note);
    return `- ${entry.name}：${entry.relationLabel}${note ? `；${note}` : ''}`;
};

const mountedWorldbookBlock = (char: CharacterSettingLike): string => {
    const live = WorldbookRuntime.buildFullMountedWorldbookBlock(char as CharacterProfile, { includeGlobal: true });
    if (live) return live;
    const books = (char.mountedWorldbooks || [])
        .filter(wb => wb && wb.enabled !== false && clean(wb.content))
        .map(wb => {
            const category = clean(wb.category) || '未分类设定';
            const title = clean(wb.title) || '未命名条目';
            return `#### [${category}]\n**Title: ${title}**\n${clean(wb.content)}`;
        });
    return books.join('\n---\n');
};

export function buildFullCharacterSetting(
    char: CharacterSettingLike,
    options: {
        heading?: string;
        fallback?: string;
        includeName?: boolean;
        includeMemos?: boolean;
    } = {},
): string {
    const heading = options.heading || '完整角色设定';
    const selfInsights = bulletLines(char.selfInsights);
    const memos = bulletLines((char.memos || []).filter(m => !m.done && clean(m.text)).map(m => m.text));
    const worldbooks = mountedWorldbookBlock(char);
    const sections = [
        options.includeName === false ? '' : `角色名：${clean(char.name) || '角色'}`,
        clean(char.description) ? `【剪影集列表备注】\n${clean(char.description)}` : '',
        clean(char.systemPrompt) ? `【核心人设】\n${clean(char.systemPrompt)}` : '',
        clean(char.worldview) ? `【世界观/背景】\n${clean(char.worldview)}` : '',
        worldbooks ? `【角色挂载世界书】\n${worldbooks}` : '',
        clean(char.appearanceTags) ? `【外貌标签】\n${clean(char.appearanceTags)}` : '',
        clean(char.lifeProfile?.content) ? `【生活侧写】\n${clean(char.lifeProfile?.content)}` : '',
        clean(char.writerPersona) ? `【创作/表达侧写】\n${clean(char.writerPersona)}` : '',
        selfInsights ? `【自我领悟】\n${selfInsights}` : '',
        char.socialProfile ? [
            clean(char.socialProfile.handle) ? `昵称/账号：${clean(char.socialProfile.handle)}` : '',
            clean(char.socialProfile.bio) ? `社交简介：${clean(char.socialProfile.bio)}` : '',
            clean(char.socialProfile.region) ? `地区：${clean(char.socialProfile.region)}` : '',
        ].filter(Boolean).join('\n') : '',
        options.includeMemos && memos ? `【未完成备忘】\n${memos}` : '',
    ].filter(Boolean);

    if (!sections.length) return options.fallback || '（无额外设定）';
    return `【${heading}】\n${sections.join('\n\n')}`;
}

export function buildFullCharacterSettingFromParts(parts: {
    name?: string;
    description?: string;
    systemPrompt?: string;
    worldview?: string;
    lifeProfile?: string;
    selfInsights?: string[];
    socialHandle?: string;
    socialBio?: string;
    socialRegion?: string;
}, options?: Parameters<typeof buildFullCharacterSetting>[1]): string {
    return buildFullCharacterSetting({
        name: parts.name || '角色',
        description: parts.description || '',
        systemPrompt: parts.systemPrompt || '',
        worldview: parts.worldview || '',
        lifeProfile: parts.lifeProfile ? { content: parts.lifeProfile, generatedAt: 0 } : undefined,
        selfInsights: parts.selfInsights,
        socialProfile: (parts.socialHandle || parts.socialBio || parts.socialRegion) ? {
            handle: parts.socialHandle || '',
            bio: parts.socialBio,
            region: parts.socialRegion,
        } : undefined,
        memos: [],
    }, options);
}

export function buildFullUserSetting(
    user: Pick<UserProfile, 'name' | 'bio' | 'vrState' | 'ambientSocial' | 'patSuffix'> | null | undefined,
    options: {
        heading?: string;
        fallback?: string;
        includeName?: boolean;
        includeRuntime?: boolean;
        includeAmbientSocial?: boolean;
        persona?: Persona | null;
    } = {},
): string {
    const heading = options.heading || '完整用户设定';
    const persona = options.persona || null;
    const name = clean(persona?.name) || clean(user?.name) || '用户';
    const description = clean(persona?.description) || clean(user?.bio);
    const personaWorldbook = persona?.lorebookCategory
        ? WorldbookRuntime.buildFullCategoryWorldbookBlock(persona.lorebookCategory)
        : '';
    const sections = [
        options.includeName === false ? '' : `用户名：${name}`,
        clean(persona?.title) ? `【扮相手账页角备注】\n${clean(persona?.title)}` : '',
        description ? `【扮相手账自述】\n${description}` : '',
        personaWorldbook ? `【扮相手账绑定世界书】\n${personaWorldbook}` : '',
        clean(user?.patSuffix) ? `【拍一拍后缀】\n${clean(user?.patSuffix)}` : '',
        options.includeRuntime !== false && user?.vrState?.enabled ? [
            clean(user.vrState.currentRoom) ? `页外房间：${clean(user.vrState.currentRoom)}` : '',
            clean(user.vrState.activity) ? `页外状态：${clean(user.vrState.activity)}` : '',
        ].filter(Boolean).join('\n') : '',
        options.includeAmbientSocial !== false && user?.ambientSocial?.entries?.length
            ? `【用户社交关系】\n${user.ambientSocial.entries.map(ambientSocialLine).join('\n')}`
            : '',
    ].filter(Boolean);

    if (!sections.length) return options.fallback || '（无额外用户设定）';
    return `【${heading}】\n${sections.join('\n\n')}`;
}

export async function buildFullActiveUserSetting(
    user: Pick<UserProfile, 'name' | 'bio' | 'vrState' | 'ambientSocial' | 'patSuffix'> | null | undefined,
    options: Omit<Parameters<typeof buildFullUserSetting>[1], 'persona'> = {},
): Promise<string> {
    const persona = await PersonaRuntime.getActivePersona();
    return buildFullUserSetting(user, { ...options, persona });
}
