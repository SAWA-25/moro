/**
 * 通用宏替换 —— SillyTavern substituteParams 的 Moro 子集。
 *
 * 在主聊天链路（buildChatRequestPayload）里对最终 system prompt、@Depth 世界书、
 * 预设提示词统一做一次替换，所以人设 / 世界观 / 世界书 / 用户档案 / 预设里写的
 * {{user}} / {{char}} 都会生效，与 ST 行为一致。
 *
 * 支持（大小写不敏感）：
 *  - {{char}} / {{user}}：角色名 / 用户名
 *  - <char> / <bot> / <user>：ST 旧版角色卡的遗留标记
 *  - {{date}} {{time}} {{weekday}} {{newline}}
 * 未知宏原样保留（不吞掉用户内容）。
 */

export interface MacroContext {
    charName: string;
    userName: string;
}

export function substituteMacros(text: string, ctx: MacroContext): string {
    if (!text) return text;
    const now = new Date();
    const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    const pad = (n: number) => String(n).padStart(2, '0');
    return text
        .replace(/{{char}}/gi, ctx.charName)
        .replace(/{{user}}/gi, ctx.userName)
        .replace(/<char>/gi, ctx.charName)
        .replace(/<bot>/gi, ctx.charName)
        .replace(/<user>/gi, ctx.userName)
        .replace(/{{date}}/gi, `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`)
        .replace(/{{time}}/gi, `${pad(now.getHours())}:${pad(now.getMinutes())}`)
        .replace(/{{weekday}}/gi, weekdays[now.getDay()])
        .replace(/{{newline}}/gi, '\n');
}
