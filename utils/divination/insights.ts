/**
 * 占卜本地速读 —— 不调用 API，根据已经抽出的牌 / 卦象给用户一个可先看的提要。
 * 角色解读仍走 interpret.ts；这里专注于本地 UI 的“先看懂一点”。
 */

import type { DrawnLenormand, DrawnTarot, LiuyaoResult, MeihuaResult } from './engines';

export interface LocalReadingInsight {
    title: string;
    items: string[];
    prompts: string[];
}

const TAROT_SUIT: Record<DrawnTarot['card']['suit'], { label: string; theme: string }> = {
    major: { label: '大阿卡纳', theme: '大课题、命运转折和核心心理动因' },
    wands: { label: '权杖', theme: '行动力、热情、事业和创造' },
    cups: { label: '圣杯', theme: '情绪、关系、直觉和亲密' },
    swords: { label: '宝剑', theme: '沟通、判断、冲突和真相' },
    pentacles: { label: '星币', theme: '现实资源、身体、金钱和稳定' },
};

function topCount<T extends string>(values: T[]): { key: T; count: number } | null {
    const counts = new Map<T, number>();
    values.forEach(v => counts.set(v, (counts.get(v) || 0) + 1));
    let best: { key: T; count: number } | null = null;
    counts.forEach((count, key) => {
        if (!best || count > best.count) best = { key, count };
    });
    return best;
}

export function tarotLocalInsight(draws: DrawnTarot[]): LocalReadingInsight {
    const majorCount = draws.filter(d => d.card.suit === 'major').length;
    const reversed = draws.filter(d => d.reversed);
    const dominant = topCount(draws.map(d => d.card.suit));
    const last = draws[draws.length - 1];
    const first = draws[0];
    const items = [
        majorCount
            ? `大阿卡纳出现 ${majorCount} 张：这次更像核心课题，不只是日常小波动。`
            : '小阿卡纳为主：答案更贴近日常行动、沟通和资源调配。',
        dominant
            ? `主色调是${TAROT_SUIT[dominant.key].label}：重点落在${TAROT_SUIT[dominant.key].theme}。`
            : '牌面能量较分散，需要看每个位置各自说什么。',
        reversed.length
            ? `逆位 ${reversed.length} 张：先看卡住、延迟、没有说出口或需要调整的部分。`
            : '没有逆位：这组牌的讯号相对直接，适合顺着牌阵推进。',
        last
            ? `落点看「${last.position}」的${last.card.name}：${last.reversed ? last.card.reversed : last.card.upright}`
            : '',
    ].filter(Boolean);
    return {
        title: `${first?.card.name || '塔罗'}起势`,
        items,
        prompts: [
            '这组牌最想让我先承认什么？',
            reversed.length ? '哪张逆位牌代表我正在逃避的部分？' : '哪张牌可以作为今天先做的一步？',
            last ? `「${last.position}」这张牌给我的具体提醒是什么？` : '我现在最该留意哪个位置？',
        ],
    };
}

const LENO_KEY_CARDS = new Set(['心', '戒指', '钥匙', '山', '棺材', '老鼠', '岔路', '信', '太阳', '月亮']);

export function lenormandLocalInsight(draws: DrawnLenormand[]): LocalReadingInsight {
    const names = draws.map(d => d.card.name);
    const center = draws.find(d => d.position === '中心') || draws[Math.floor(draws.length / 2)];
    const notable = draws.filter(d => LENO_KEY_CARDS.has(d.card.name)).map(d => `${d.card.name}（${d.position}）`);
    const items = [
        `线索从「${names[0]}」走向「${names[names.length - 1]}」：雷诺曼适合按事件链串读，不必只盯单张。`,
        center ? `核心落在「${center.card.name}」：${center.card.meaning}` : '',
        notable.length ? `关键牌：${notable.join('、')}。这些牌通常提示关系、阻碍、转折或答案所在。` : '没有特别强的关键牌扎堆，适合看相邻牌之间的现实线索。',
        draws.length >= 5 ? '牌数较多：先读中心，再读左右相邻，最后看首尾如何收束。' : '小牌阵：三张可直接读成“起因 → 发展 → 结果”。',
    ].filter(Boolean);
    return {
        title: `${center?.card.name || names[0] || '雷诺曼'}为轴`,
        items,
        prompts: [
            center ? `围绕「${center.card.name}」，最近最明显的现实线索是什么？` : '这组牌里哪张最像现实里的线索？',
            '首尾两张牌像不像一条已经发生的事件链？',
            notable.length ? '这些关键牌里，哪一张最需要我马上处理？' : '哪两张相邻牌组合最有信息量？',
        ],
    };
}

const LINE_ZONE = (pos: number) => (pos <= 2 ? '根基/起因' : pos <= 4 ? '过程/人事' : '结果/外部');

export function liuyaoLocalInsight(r: LiuyaoResult): LocalReadingInsight {
    const movingCount = r.movingPositions.length;
    const coins = r.lines
        .map((line, i) => `${i + 1}爻${line.coins.map(c => (c === 3 ? '字' : '背')).join('')}`)
        .reverse()
        .join('；');
    const movingZones = r.movingPositions.map(pos => `${pos}爻（${LINE_ZONE(pos)}）`);
    return {
        title: r.primary?.name || '六爻金钱卦',
        items: [
            `铜钱轨迹：${coins}。`,
            movingCount
                ? `动爻在 ${movingZones.join('、')}：这次重点看变化发生在哪一层。`
                : '静卦无动爻：局面暂时更偏稳定，重点看本卦本身的提示。',
            r.changed ? `本卦 ${r.primary?.name || '—'} 之 ${r.changed.name}：先看当下，再看变化后的去向。` : `本卦 ${r.primary?.name || '—'}：没有变卦时，建议不要急着换策略。`,
            r.primary?.judgement ? `卦辞简注：${r.primary.judgement}` : '',
        ].filter(Boolean),
        prompts: [
            movingCount ? '这些动爻分别对应现实里的哪几个变化点？' : '静卦是不是在提醒我先守住而不是推进？',
            '本卦最像我当下处境的哪一句？',
            r.changed ? '变卦提示的方向，是机会还是代价？' : '没有变卦时，我应该观察多久再行动？',
        ],
    };
}

const ELEMENT_BY_TRIGRAM: Record<string, '金' | '木' | '水' | '火' | '土'> = {
    乾: '金', 兑: '金', 离: '火', 震: '木', 巽: '木', 坎: '水', 艮: '土', 坤: '土',
};

const GENERATES: Record<string, string> = { 木: '火', 火: '土', 土: '金', 金: '水', 水: '木' };
const CONTROLS: Record<string, string> = { 木: '土', 土: '水', 水: '火', 火: '金', 金: '木' };

function relationOf(body: string, useful: string): string {
    if (body === useful) return '体用同气：自己与局面同频，成败常取决于稳定度和持续性。';
    if (GENERATES[body] === useful) return '体生用：你在向局面输出能量，能推进，但也会耗力。';
    if (GENERATES[useful] === body) return '用生体：外界条件反过来滋养你，适合借势。';
    if (CONTROLS[body] === useful) return '体克用：你有能力约束局面，但别用力过猛。';
    if (CONTROLS[useful] === body) return '用克体：局面对你施压，先避硬碰硬，找缓冲。';
    return '体用关系较平，需要结合互卦和变卦细看。';
}

export function meihuaLocalInsight(r: MeihuaResult): LocalReadingInsight {
    const bodyName = r.bodyTrigram === 'upper' ? r.upperName : r.lowerName;
    const usefulName = r.bodyTrigram === 'upper' ? r.lowerName : r.upperName;
    const bodyElement = ELEMENT_BY_TRIGRAM[bodyName] || '土';
    const usefulElement = ELEMENT_BY_TRIGRAM[usefulName] || '土';
    return {
        title: r.primary?.name || '梅花易数',
        items: [
            `本卦上${r.upperName}下${r.lowerName}，动爻第 ${r.movingYao} 爻。`,
            `体卦为${bodyName}（${bodyElement}），用卦为${usefulName}（${usefulElement}）：${relationOf(bodyElement, usefulElement)}`,
            `互卦 ${r.mutual?.name || '—'} 看中间过程，变卦 ${r.changed?.name || '—'} 看后续走向。`,
            r.primary?.judgement ? `卦辞简注：${r.primary.judgement}` : '',
        ].filter(Boolean),
        prompts: [
            '体用关系说明我该主动推进还是借势等待？',
            '互卦里藏着哪个过程问题？',
            '变卦更像结果、提醒，还是下一阶段的入口？',
        ],
    };
}
