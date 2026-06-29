/**
 * 页外 chibi 立绘解析（单一来源）：vrState.chibi → date 皮肤/sprites → 头像兜底。
 * VRWorldApp 的房间站位、剧院的演出回放共用这套逻辑。
 */
import type { CharacterProfile } from '../../types';

export interface ChibiDisplay {
    img: string;
    scale: number;
    offsetY: number;
    offsetX: number;
    rotate: number;
    opacity: number;
    shadow: boolean;
    halo: 'none' | 'soft' | 'mint' | 'violet' | 'warm';
    flip: boolean;
    stickerX: number;
    stickerY: number;
    stickerSize: number;
    nameVisible: boolean;
    /** 是否走了兜底（没专属 chibi） */
    isFallback: boolean;
}

export const getChibi = (char: CharacterProfile): ChibiDisplay => {
    const c = char.vrState?.chibi;
    if (c?.img) return {
        img: c.img,
        scale: c.scale ?? 1,
        offsetY: c.offsetY ?? 0,
        offsetX: c.offsetX ?? 0,
        rotate: c.rotate ?? 0,
        opacity: c.opacity ?? 1,
        shadow: c.shadow ?? true,
        halo: c.halo ?? 'none',
        flip: !!c.flip,
        stickerX: c.stickerX ?? 0,
        stickerY: c.stickerY ?? 0,
        stickerSize: c.stickerSize ?? 1,
        nameVisible: c.nameVisible ?? true,
        isFallback: false,
    };
    const sprites = (char.activeSkinSetId && char.dateSkinSets?.find(s => s.id === char.activeSkinSetId)?.sprites)
        || char.sprites || {};
    const fb = sprites['happy'] || sprites['normal'] || sprites['smile'] || char.avatar || '';
    return {
        img: fb,
        scale: 1,
        offsetY: 0,
        offsetX: 0,
        rotate: 0,
        opacity: 1,
        shadow: true,
        halo: 'none',
        flip: false,
        stickerX: 0,
        stickerY: 0,
        stickerSize: 1,
        nameVisible: true,
        isFallback: true,
    };
};
