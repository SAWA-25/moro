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
