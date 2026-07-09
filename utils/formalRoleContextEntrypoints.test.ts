import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('formal role LLM entrypoints keep complete context', () => {
    it('memory dive waits for the full async core context before generating or preloading room scripts and preserves preset macros', () => {
        const source = read('apps/pixelHome/MemoryDiveMode.tsx');
        const engine = read('apps/pixelHome/memoryDiveEngine.ts');
        expect(source).toContain('buildMemoryDiveFullContext');
        expect(source).toContain('ContextBuilder.buildFullCoreContext(charProfile, userProfile, true)');
        expect(source).not.toContain('ContextBuilder.buildCoreContext(charProfile, userProfile, true)');
        expect(source).toContain('apiConfig, await buildMemoryDiveFullContext()');
        expect(source).toContain('charId, charName, userName, room:');
        expect(engine).toContain("makeApiUsageMeta('pixelHome.memoryDive.script'");
        expect(engine).toContain('presetMacros: { charName: params.charName, userName: params.userName');
    });

    it('reverse phone check prompts include the full active user setting alongside the full character card', () => {
        const source = read('components/chat/CharPhoneCheckOverlay.tsx');
        expect(source).toContain('buildCharPhoneCheckRoleContext');
        expect(source).toContain('buildFullActiveUserSetting(userProfile');
        expect(source).toContain('buildFullCharacterSetting(char, { includeMemos: true })');
        expect(source).not.toContain('const personaBlock = useMemo(() => [');
    });

    it('divination roleplay passes full user setting and explicit usage metadata through the shared LLM client', () => {
        const source = read('utils/divination/interpret.ts');
        expect(source).toContain('buildFullActiveUserSetting');
        expect(source).toContain("makeApiUsageMeta('theater.divination'");
        expect(source).toContain('presetMacros');
    });

    it('date world engine builds a full core role context with worldbook scan context and preset macros', () => {
        const source = read('utils/dateEngine.ts');
        expect(source).toContain('buildDateScanMessages');
        expect(source).toContain('WorldbookRuntime.withContext');
        expect(source).toContain('ContextBuilder.buildFullCoreContext(char, user, true, undefined');
        expect(source).toContain("makeApiUsageMeta('date.worldEngine'");
        expect(source).toContain('presetMacros: { charName: char.name, userName }');
        expect(source).toContain("makeApiUsageMeta('date.summary'");
    });

    it('check phone role tasks keep full user context where needed and pass preset macros', () => {
        const source = read('apps/CheckPhone.tsx');
        expect(source).toContain('buildFullActiveUserSetting(userProfile');
        expect(source).toContain('根据下面的完整角色设定和完整用户设定');
        expect(source).toContain('ContextBuilder.buildFullCoreContext(targetChar, userProfile, true)');
        expect(source.match(/makeApiUsageMeta\('checkPhone\.generate'/g)?.length).toBe(4);
        expect(source.match(/presetMacros: \{ charName: targetChar\.name, userName: userProfile\.name \|\| '用户' \}/g)?.length).toBe(4);
    });

    it('daily parcel character-picked gifts use full core context and private chat preset macros', () => {
        const source = read('utils/dailyParcel.ts');
        expect(source).toContain('ContextBuilder.buildFullCoreContext(char, userProfile, true)');
        expect(source).toContain("makeApiUsageMeta('chat.privateReply'");
        expect(source).toContain("presetScope: 'chat.private'");
        expect(source).toContain('presetMacros: { charName: char.name, userName }');
    });
});
