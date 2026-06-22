/**
 * 专属铃声：纯 WebAudio 合成的轻量提示音（无音频资源依赖）。
 * 会话设置里给每个角色选一种，新消息到达时由灵动岛播放。
 */

export const RINGTONE_PRESETS: Array<{ id: string; label: string }> = [
    { id: 'none', label: '静音' },
    { id: 'chime', label: '清铃' },
    { id: 'bubble', label: '气泡' },
    { id: 'bell', label: '风铃' },
    { id: 'retro', label: '复古' },
    { id: 'koto', label: '八音盒' },
];

let ctx: AudioContext | null = null;
const getCtx = (): AudioContext | null => {
    try {
        if (!ctx) ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
        if (ctx.state === 'suspended') void ctx.resume();
        return ctx;
    } catch { return null; }
};

/** 单音符：freq Hz，从 at 秒起持续 dur 秒 */
const tone = (ac: AudioContext, freq: number, at: number, dur: number, type: OscillatorType = 'sine', gain = 0.18) => {
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    g.gain.setValueAtTime(0, ac.currentTime + at);
    g.gain.linearRampToValueAtTime(gain, ac.currentTime + at + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + at + dur);
    osc.connect(g).connect(ac.destination);
    osc.start(ac.currentTime + at);
    osc.stop(ac.currentTime + at + dur + 0.05);
};

export const playRingtone = (preset?: string | null): void => {
    if (!preset || preset === 'none') return;
    const ac = getCtx();
    if (!ac) return;
    switch (preset) {
        case 'chime': // 上行双音
            tone(ac, 880, 0, 0.35);
            tone(ac, 1318.5, 0.12, 0.45);
            break;
        case 'bubble': // 短促气泡 pop
            tone(ac, 523.3, 0, 0.12, 'triangle', 0.22);
            tone(ac, 784, 0.08, 0.16, 'triangle', 0.18);
            break;
        case 'bell': // 风铃三连
            tone(ac, 1567.98, 0, 0.6, 'sine', 0.12);
            tone(ac, 2093, 0.15, 0.6, 'sine', 0.1);
            tone(ac, 1760, 0.3, 0.8, 'sine', 0.08);
            break;
        case 'retro': // 8-bit 方波
            tone(ac, 659.3, 0, 0.09, 'square', 0.08);
            tone(ac, 880, 0.1, 0.09, 'square', 0.08);
            tone(ac, 1108.7, 0.2, 0.18, 'square', 0.08);
            break;
        case 'koto': // 八音盒下行
            tone(ac, 1318.5, 0, 0.5, 'sine', 0.14);
            tone(ac, 1108.7, 0.18, 0.5, 'sine', 0.12);
            tone(ac, 880, 0.36, 0.7, 'sine', 0.1);
            break;
        default:
            tone(ac, 880, 0, 0.3);
    }
};

/* ───────────── 通话铃声 / 回铃音（循环，带 stop 句柄）─────────────
 * 用于电话 App：来电响铃（角色主动来电 / 模拟来电）和拨出回铃音（用户打过去等待接通）。
 * 同样纯 WebAudio 合成、无音频资源；返回 stop() 用于接听 / 挂断 / 接通 / 卸载时停掉。 */
export interface RingHandle { stop: () => void; }

/** 单声：attack–hold–release 包络（比 playRingtone 的指数衰减更「持续」，像电话铃 / 回铃）。 */
const ringTone = (ac: AudioContext, freq: number, at: number, dur: number, gain = 0.1, type: OscillatorType = 'sine') => {
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    const t0 = ac.currentTime + at;
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + 0.03);
    g.gain.setValueAtTime(gain, t0 + Math.max(0.06, dur - 0.05));
    g.gain.linearRampToValueAtTime(0, t0 + dur);
    osc.connect(g).connect(ac.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.04);
};

/** 立刻响一轮，之后每 periodMs 再响一轮，直到 stop()。getCtx 取不到（无 WebAudio）时返回空句柄。 */
const loopRing = (renderOnce: (ac: AudioContext) => void, periodMs: number): RingHandle => {
    const ac = getCtx();
    if (!ac) return { stop: () => {} };
    let stopped = false;
    let timer: number | null = null;
    const tick = () => {
        if (stopped) return;
        try { renderOnce(ac); } catch { /* 单轮失败不影响循环停止 */ }
        timer = window.setTimeout(tick, periodMs);
    };
    tick();
    return {
        stop: () => {
            stopped = true;
            if (timer != null) { window.clearTimeout(timer); timer = null; }
        },
    };
};

/**
 * 拨出回铃音「嘟——嘟——」：用户打过去、等待对方接通时循环播放，接通 / 挂断即 stop()。
 * 仿国内回铃：450Hz 正弦，约 1s 响、2s 停。
 */
export const startDialTone = (): RingHandle =>
    loopRing(ac => ringTone(ac, 450, 0, 1.0, 0.12), 3000);

/**
 * 来电铃声：经典双响铃（440+480Hz 同响产生 warble），循环到接听 / 挂断 / 超时。
 */
export const startIncomingRing = (): RingHandle =>
    loopRing(ac => {
        // 「叮铃—叮铃」双响
        ringTone(ac, 440, 0, 0.42, 0.1);
        ringTone(ac, 480, 0, 0.42, 0.1);
        ringTone(ac, 440, 0.6, 0.42, 0.1);
        ringTone(ac, 480, 0.6, 0.42, 0.1);
    }, 2400);
