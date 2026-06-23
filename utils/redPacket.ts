/**
 * 拼手气红包拆分工具（群聊「抢红包」用）。
 *
 * 采用微信经典「二倍均值法」：把总额随机分成 N 份，每份 >= 最小额，
 * 且各份之和「恰好」等于总额（不会因四舍五入多分或少分）。
 * 全程用「分」做整数运算，避免浮点误差；传入 rng 即得到确定性结果，便于单元测试。
 *
 * 只放纯函数，不依赖 React / DB / 类型，方便 vitest 直接覆盖。
 */

/** 元 → 分（四舍五入到整数分）。 */
export const yuanToCents = (yuan: number): number => Math.round(yuan * 100);

/** 分 → 元（保留两位小数的数值）。 */
export const centsToYuan = (cents: number): number => Math.round(cents) / 100;

/**
 * 把 totalCents 分成 count 份的拼手气红包。
 * @param totalCents 总额（分，整数）
 * @param count      份数（>=1）
 * @param rng        随机源，默认 Math.random；测试可注入确定性序列
 * @param minCents   每份最小额（分），默认 1 分
 * @returns 长度为 count 的整数分数组，和恰好等于 totalCents，每份 >= minCents
 * @throws 当总额不足以让每份都拿到 minCents 时抛错
 */
export function splitRedPacket(
    totalCents: number,
    count: number,
    rng: () => number = Math.random,
    minCents = 1,
): number[] {
    const total = Math.floor(totalCents);
    const n = Math.floor(count);
    if (n <= 0) return [];
    if (n === 1) return [total];
    if (total < n * minCents) {
        throw new Error(`金额不足以分成 ${n} 份（每份至少 ${minCents} 分，共需 ${n * minCents} 分）`);
    }

    const result: number[] = [];
    let remaining = total;
    for (let i = 0; i < n; i++) {
        const left = n - i; // 还要分的份数（含当前这份）
        if (left === 1) {
            // 最后一份兜底，确保总和精确
            result.push(remaining);
            remaining = 0;
            break;
        }
        // 给后面 (left-1) 份各留至少 minCents，保证后续可分
        const maxForThis = remaining - (left - 1) * minCents;
        const mean = remaining / left;
        let amount = Math.floor(rng() * mean * 2); // 二倍均值
        if (amount < minCents) amount = minCents;
        if (amount > maxForThis) amount = maxForThis;
        result.push(amount);
        remaining -= amount;
    }
    return result;
}

/** 手气最佳：返回金额最大那一份的下标（并列取第一个）；空数组返回 -1。 */
export function bestLuckIndex(amounts: number[]): number {
    let best = -1;
    let bestVal = -Infinity;
    for (let i = 0; i < amounts.length; i++) {
        if (amounts[i] > bestVal) {
            bestVal = amounts[i];
            best = i;
        }
    }
    return best;
}

/** Fisher–Yates 洗牌（不改原数组）；传入 rng 可确定性。 */
export function shuffle<T>(arr: readonly T[], rng: () => number = Math.random): T[] {
    const out = arr.slice();
    for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
}
