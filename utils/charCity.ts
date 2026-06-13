/**
 * 角色真实城市系统
 * ==================
 * 给角色一个「所在城市」：
 *  - 现实世界角色：直接选真实城市（上海、成都…），实时信息（天气）按真实城市取，
 *    本地生活细节（街区、小吃、外卖）由 LLM 基于真实城市知识接地。
 *  - 虚拟/架空角色：可选「原型城市」+ 虚拟程度（如 A 市 · 原型上海 · 虚拟程度 60%）。
 *    借用原型城市的真实风物，但按虚拟程度决定是直接挪用还是改写化用，对外只称虚拟名。
 *
 * 设计：纯提示词接地 + 复用现有实时天气基础设施（realtimeContext），不引入新外部 API。
 * 城市块由 ContextBuilder.buildCoreContext 注入 → 聊天、查手机(CheckPhone)、线下模式
 * 等所有读 coreContext 的地方都会自动带上城市真实感；外卖彩蛋即源于此。
 */

import type { CharacterProfile, CharCityConfig } from '../types';

export type { CharCityConfig };

export interface ResolvedCity {
    isVirtual: boolean;
    /** 角色对外称呼的城市名（真实城市 or 架空名） */
    displayCity: string;
    /** 拉真实数据 / 接地参考用的真实城市（真实城市 or 原型城市）；虚拟无原型时为空 */
    dataCity: string;
    prototypeCity?: string;
    fictionLevel: number;
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/** 解析角色的有效城市；未配置 / 信息不全返回 null。 */
export function resolveCity(char: CharacterProfile): ResolvedCity | null {
    const c = char.cityConfig;
    if (!c) return null;
    if (c.mode === 'real') {
        const city = (c.realCity || '').trim();
        if (!city) return null;
        return { isVirtual: false, displayCity: city, dataCity: city, fictionLevel: 0 };
    }
    // virtual
    const vname = (c.virtualName || '').trim();
    const proto = (c.prototypeCity || '').trim();
    if (!vname && !proto) return null;
    return {
        isVirtual: true,
        displayCity: vname || proto,
        dataCity: proto,
        prototypeCity: proto || undefined,
        fictionLevel: clamp(Math.round(c.fictionLevel ?? 50), 0, 100),
    };
}

/** 真实城市角色用来取实时天气的城市名；虚拟城市不暴露原型给天气块，返回 null。 */
export function getWeatherCity(char: CharacterProfile): string | null {
    const r = resolveCity(char);
    if (!r || r.isVirtual) return null;
    return r.dataCity || null;
}

/**
 * 城市提示词块（注入 coreContext）。让对话 / 查手机 / 线下都带上城市真实质感。
 */
export function buildCityPromptBlock(char: CharacterProfile): string {
    const r = resolveCity(char);
    if (!r) return '';

    if (!r.isVirtual) {
        return [
            `### 你所在的城市`,
            `你真实地生活在「${r.displayCity}」。让对话带上这座城市的真实质感——本地的街区、地标、` +
            `小吃与餐厅、方言习惯、通勤方式、天气与季节节奏，都按 ${r.displayCity} 的真实情况来。` +
            `提到吃喝玩乐 / 点外卖 / 逛街时，优先用 ${r.displayCity} 真实存在的店和地点，别用泛泛的「某餐厅」。`,
        ].join('\n');
    }

    const proto = r.prototypeCity;
    const lvl = r.fictionLevel;
    const protoLine = proto
        ? `它的原型参考是「${proto}」（虚拟程度 ${lvl}%）。`
        : `（虚拟程度 ${lvl}%）。`;
    const calibration = proto
        ? (lvl <= 33
            ? `虚拟程度较低：可以比较直接地挪用 ${proto} 的真实风物、地名、店名与生活细节，只把城市名换成「${r.displayCity}」。`
            : lvl >= 67
                ? `虚拟程度较高：借 ${proto} 的城市气质与神韵即可，真实地名/店名要改写化用成「${r.displayCity}」自己的名字与设定，别直接搬原名。`
                : `虚拟程度中等：可借用 ${proto} 的真实风物与节奏，但具体地名/店名适度改写成「${r.displayCity}」自己的版本。`)
        : `没有给定原型城市，请凭人设为「${r.displayCity}」自洽地虚构本地风物，并保持前后一致。`;

    return [
        `### 你所在的城市`,
        `你生活在架空城市「${r.displayCity}」。${protoLine}`,
        `- ${calibration}`,
        proto ? `- 你可以借 ${proto} 的真实气候、饮食、通勤与城市性格来填充「${r.displayCity}」的细节，让它有真实质感。` : '',
        `- 始终用「${r.displayCity}」称呼你所在的城市，不要直接说出原型城市名。`,
    ].filter(Boolean).join('\n');
}

/**
 * 查手机·外卖彩蛋用的城市强化指令：拼到 CheckPhone 的外卖/购物 prompt 后面，
 * 让生成的订单落到角色城市真实存在的店与本地特色上。
 */
export function buildPhoneCityHint(char: CharacterProfile): string {
    const r = resolveCity(char);
    if (!r) return '';
    if (!r.isVirtual) {
        return `（机主生活在 ${r.displayCity}，外卖/购物请用 ${r.displayCity} 真实存在的餐厅、商家与本地特色菜，店名要具体真实。）`;
    }
    if (r.prototypeCity) {
        return `（机主生活在架空城市 ${r.displayCity}（原型 ${r.prototypeCity}，虚拟程度 ${r.fictionLevel}%），外卖/购物可参考 ${r.prototypeCity} 的真实餐饮特色，按虚拟程度把店名改写化用成 ${r.displayCity} 自己的版本。）`;
    }
    return `（机主生活在架空城市 ${r.displayCity}，外卖/购物请自洽虚构本地店家并保持一致。）`;
}
