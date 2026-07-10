import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    BankShopState, DollhouseState, DollhouseRoom, DollhouseSticker,
    ShopStaff, CharacterProfile, UserProfile, APIConfig, RoomLayout, BankLifeShopProduct
} from '../../types';
import {
    ROOM_LAYOUTS, WALLPAPER_PRESETS, FLOOR_PRESETS, STICKER_LIBRARY, INITIAL_DOLLHOUSE,
    CUSTOMER_QUIPS, STAFF_QUIPS, PET_QUIPS, getWeatherDef
} from './BankGameConstants';

// 天气给主店铺叠一层很淡的色调，烘托氛围（晴/周末不染色）
const WEATHER_TINT: Record<string, string> = {
    rain: 'linear-gradient(180deg, rgba(70,100,140,0.13), rgba(70,100,140,0.04))',
    snow: 'linear-gradient(180deg, rgba(180,200,220,0.17), rgba(180,200,220,0.05))',
    cloudy: 'linear-gradient(180deg, rgba(120,120,130,0.10), transparent)',
    festival: 'linear-gradient(180deg, rgba(255,160,120,0.10), rgba(255,200,150,0.04))',
};
import BankAssetIcon, { isBankAssetUrl } from './BankAssetIcon';
import {
    BANK_PIXEL_CUSTOMER_DEFS,
    bankPixelRef,
    bankPixelStyle,
    getBankPixelAssetMeta,
    resolveBankPixelSrc,
} from './bankPixelArt';
import { useOS } from '../../context/OSContext';
import { DB } from '../../utils/db';
import { processImage } from '../../utils/file';
import { Armchair, PaintBucket, SquaresFour, Image as ImageIcon, HouseSimple, PencilSimple, Trash, type Icon } from '@phosphor-icons/react';

const ROOM_UNLOCK_COSTS: Record<string, number> = {
    'room-1f-left': 0,
    'room-1f-right': 120,
    'room-2f-left': 200,
    'room-2f-right': 300,
};
const shopEnergyText = (value: number) => `${value} 点精力`;

const MAIN_ROOM_ID = 'room-1f-left';
const FLOOR_H_RATIO = 0.24;
const WALL_H_RATIO = 0.76;
const CUSTOM_FURNITURE_ASSET_KEY = 'bank_custom_furniture_assets_v1';

type DecorTab = 'layout' | 'rename' | 'wallpaper' | 'furniture' | 'floor' | 'roomTexture';

const DECOR_TAB_ICONS: Record<DecorTab, Icon> = {
    furniture: Armchair,
    wallpaper: PaintBucket,
    floor: SquaresFour,
    roomTexture: ImageIcon,
    layout: HouseSimple,
    rename: PencilSimple,
};

const DECOR_TABS: { id: DecorTab; label: string }[] = [
    { id: 'furniture', label: '家具' },
    { id: 'wallpaper', label: '墙纸' },
    { id: 'floor', label: '地板' },
    { id: 'roomTexture', label: '背景图' },
    { id: 'layout', label: '房型' },
    { id: 'rename', label: '改名' },
];

interface CustomFurnitureAsset {
    id: string;
    name: string;
    url: string;
}

type AmbientCustomerMood = 'browsing' | 'happy' | 'curious' | 'impatient' | 'photo' | 'buying';

interface AmbientShopCustomer {
    id: string;
    typeId: string;
    name: string;
    avatar: string;
    roomId: string;
    x: number;
    y: number;
    scale: number;
    mood: AmbientCustomerMood;
    reaction: string;
    leaveAt: number;
}

interface Props {
    shopState: BankShopState;
    dollhouseState: DollhouseState;
    onDollhouseChange: (updater: DollhouseState | ((prev: DollhouseState) => DollhouseState)) => Promise<void>;
    characters: CharacterProfile[];
    userProfile: UserProfile;
    apiConfig: APIConfig;
    updateState: (updater: (prev: BankShopState) => BankShopState) => Promise<void>;
    onConsumeDecorEnergy?: (cost: number, label: string) => Promise<boolean>;
    onStaffClick?: (staff: ShopStaff) => void;
    onOpenGuestbook: () => void;
    /** 擦吧台攒 AP：返回本次实得 AP（0 = 冷却中） */
    onWipeCounter?: () => Promise<number>;
    onRemoveShopProduct?: (productId: string) => Promise<void>;
    shopProducts?: BankLifeShopProduct[];
}

// 咖啡店「默认布景」——纯展示层，只在主店铺、且用户没自定义「全屋贴图」时渲染。
// 解决空房间问题（历史默认贴图是已失效的图床死链）。pointer-events-none，
// 不写任何存档、不挡装修操作、层级在演员/贴纸之下，用户随时可在其上继续装饰。
const CafeBackdrop = React.memo(() => (
    <div className="absolute inset-0 z-[2] pointer-events-none select-none overflow-hidden" aria-hidden>
        {/* 彩旗 */}
        <div className="absolute left-[6%] right-[6%]" style={{ top: '2%', height: 2, background: '#c9b08e', borderRadius: 2 }} />
        <div className="absolute left-0 right-0 flex justify-center gap-1" style={{ top: '2%' }}>
            {Array.from({ length: 13 }).map((_, i) => (
                <div key={i} style={{ width: 0, height: 0, borderLeft: '5px solid transparent', borderRight: '5px solid transparent', borderTop: `10px solid ${['#f3a6a0', '#f6c87a', '#9ccf9c', '#9bc4e0', '#caa6e0'][i % 5]}`, opacity: 0.9 }} />
            ))}
        </div>

        {/* 吊灯 */}
        {[38, 62].map(x => (
            <div key={x} className="absolute" style={{ left: `${x}%`, top: 0, transform: 'translateX(-50%)' }}>
                <div style={{ width: 2, height: 24, margin: '0 auto', background: '#bda483' }} />
                <div style={{ width: 22, height: 13, borderRadius: '0 0 13px 13px', background: 'linear-gradient(180deg,#f7cb80,#eaa64e)', boxShadow: '0 6px 16px rgba(240,180,90,0.5)' }} />
            </div>
        ))}

        {/* 吊篮绿植 */}
        {[20, 47].map(x => (
            <div key={x} className="absolute" style={{ left: `${x}%`, top: 0, transform: 'translateX(-50%)' }}>
                <div style={{ width: 1.5, height: 13, margin: '0 auto', background: '#c9b08e' }} />
                <div style={{ width: 20, height: 11, borderRadius: '4px 4px 9px 9px', background: 'linear-gradient(180deg,#d59e6c,#b07f50)' }} />
                <div style={{ display: 'flex', justifyContent: 'center', gap: 2, marginTop: -1 }}>
                    {[0, 1, 2].map(k => <div key={k} style={{ width: 5, height: 10 + (k % 2) * 4, borderRadius: '0 0 60% 60%', background: '#7bb274' }} />)}
                </div>
            </div>
        ))}

        {/* 墙上相框 */}
        <div className="absolute" style={{ left: '15%', top: '37%', transform: 'rotate(-2deg)' }}>
            <div style={{ width: 34, height: 28, borderRadius: 3, background: '#fff', boxShadow: '0 0 0 3px #b98e63, 0 4px 8px rgba(0,0,0,0.12)', padding: 3 }}>
                <div style={{ width: '100%', height: '100%', borderRadius: 2, background: 'linear-gradient(135deg,#ffe0b3,#f6b9a0)' }} />
            </div>
        </div>
        <div className="absolute" style={{ left: '40%', top: '43%', transform: 'rotate(2deg)' }}>
            <div style={{ width: 28, height: 24, borderRadius: 3, background: '#fff', boxShadow: '0 0 0 3px #b98e63, 0 4px 8px rgba(0,0,0,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13 }}>☕</div>
        </div>

        {/* 挂钟 */}
        <div className="absolute" style={{ left: '61%', top: '38%', transform: 'translateX(-50%)' }}>
            <div style={{ position: 'relative', width: 30, height: 30, borderRadius: '50%', background: '#fff', boxShadow: '0 0 0 3px #b98e63, 0 4px 8px rgba(0,0,0,0.12)' }}>
                <div style={{ position: 'absolute', top: '50%', left: '50%', width: 9, height: 1.5, background: '#6b4528', transformOrigin: 'left center', transform: 'translateY(-50%) rotate(-60deg)' }} />
                <div style={{ position: 'absolute', top: '50%', left: '50%', width: 7, height: 1.5, background: '#6b4528', transformOrigin: 'left center', transform: 'translateY(-50%) rotate(40deg)' }} />
                <div style={{ position: 'absolute', top: '50%', left: '50%', width: 3, height: 3, borderRadius: '50%', background: '#6b4528', transform: 'translate(-50%,-50%)' }} />
            </div>
        </div>

        {/* 营业中吊牌 */}
        <div className="absolute" style={{ left: '64%', top: '6%', transform: 'rotate(4deg)' }}>
            <div style={{ width: 2, height: 11, margin: '0 auto', background: '#bda483' }} />
            <div style={{ fontSize: 7, fontWeight: 900, color: '#fff', background: '#5a8a52', padding: '3px 6px', borderRadius: 6, letterSpacing: 1, boxShadow: '0 3px 6px rgba(0,0,0,0.15)' }}>营业中</div>
        </div>

        {/* 窗 + 遮阳棚 */}
        <div className="absolute" style={{ left: '50%', top: '14%', transform: 'translateX(-50%)' }}>
            <div style={{ position: 'absolute', left: -13, top: -14, width: 122, height: 17, borderRadius: '10px 10px 0 0', background: 'repeating-linear-gradient(90deg,#e8795f 0 12px,#fff3ec 12px 24px)', boxShadow: '0 3px 6px rgba(120,70,50,0.25)' }} />
            <div style={{ position: 'relative', width: 96, height: 66, borderRadius: 10, background: 'linear-gradient(180deg,#cfeafd,#eaf6ff)', boxShadow: 'inset 0 0 0 5px #fff, 0 0 0 7px #bd9163' }}>
                <div style={{ position: 'absolute', left: '50%', top: 6, bottom: 6, width: 3, background: '#bd9163', transform: 'translateX(-50%)' }} />
                <div style={{ position: 'absolute', top: '50%', left: 6, right: 6, height: 3, background: '#bd9163', transform: 'translateY(-50%)' }} />
                <div style={{ position: 'absolute', left: 13, top: 11, width: 22, height: 8, borderRadius: 8, background: 'rgba(255,255,255,0.85)' }} />
            </div>
        </div>

        {/* 黑板菜单 */}
        <div className="absolute" style={{ left: '11%', top: '20%', transform: 'rotate(-3deg)' }}>
            <div style={{ width: 60, height: 76, borderRadius: 8, background: '#3b4a3f', boxShadow: '0 0 0 5px #8b5e43, 0 6px 12px rgba(0,0,0,0.18)', padding: 8 }}>
                <div style={{ fontSize: 7, color: '#fff7e6', textAlign: 'center', fontWeight: 800, letterSpacing: 2, opacity: 0.9 }}>MENU</div>
                {['☕ 18', '🍰 32', '🧋 22'].map((t, i) => (
                    <div key={i} style={{ fontSize: 7.5, color: '#e7d9c4', marginTop: 5, opacity: 0.85 }}>{t}</div>
                ))}
            </div>
        </div>

        {/* 杯架 */}
        <div className="absolute" style={{ left: '31%', top: '17%' }}>
            <div style={{ width: 66, height: 7, background: '#9c6b43', borderRadius: 3, boxShadow: '0 3px 5px rgba(120,70,50,0.2)' }} />
            <div style={{ display: 'flex', gap: 5, marginTop: 3, paddingLeft: 5 }}>
                {['#f3ead7', '#f0d9c2', '#e8c6a8', '#f3ead7'].map((c, i) => (
                    <div key={i} style={{ width: 11, height: 13, borderRadius: '3px 3px 5px 5px', background: c, boxShadow: 'inset -2px 0 0 rgba(0,0,0,0.06)' }} />
                ))}
            </div>
        </div>

        {/* 吧台（横跨墙底，演员站在其前） */}
        <div className="absolute left-0 right-0" style={{ top: '60%', height: '16%' }}>
            <div className="absolute left-[4%] right-[4%]" style={{ top: 10, bottom: 0, background: 'linear-gradient(180deg,#c79a6d,#b07f50)' }}>
                <div className="absolute inset-0" style={{ opacity: 0.2, backgroundImage: 'repeating-linear-gradient(90deg,rgba(80,45,20,0.5) 0 1px,transparent 1px 16px)' }} />
            </div>
            <div className="absolute left-[4%] right-[4%]" style={{ top: 0, height: 12, borderRadius: 6, background: 'linear-gradient(180deg,#a9764f,#8a5e3d)', boxShadow: '0 4px 10px rgba(90,55,30,0.25)' }} />
            {/* 咖啡机 */}
            <div className="absolute" style={{ left: '28%', top: -22, transform: 'translateX(-50%)' }}>
                <div style={{ position: 'relative', width: 28, height: 22, borderRadius: 5, background: 'linear-gradient(180deg,#e2e6e9,#aab2b8)', boxShadow: '0 3px 6px rgba(0,0,0,0.18)' }}>
                    <div style={{ position: 'absolute', top: 3, left: 4, right: 4, height: 4, borderRadius: 2, background: '#828c93' }} />
                    <div style={{ position: 'absolute', bottom: 2, left: 6, width: 6, height: 5, background: '#6b7178', borderRadius: '0 0 2px 2px' }} />
                    <div style={{ position: 'absolute', bottom: 1, right: 6, width: 5, height: 6, background: '#3c4248', borderRadius: 1 }} />
                </div>
            </div>
            {/* 玻璃糕点柜 */}
            <div className="absolute" style={{ left: '50%', top: -14, transform: 'translateX(-50%)' }}>
                <div style={{ width: 36, height: 14, borderRadius: 4, background: 'rgba(220,240,250,0.55)', boxShadow: 'inset 0 0 0 1.5px rgba(255,255,255,0.7), 0 3px 6px rgba(0,0,0,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 2, fontSize: 9 }}>🍰🥐</div>
            </div>
            {/* 收银机 */}
            <div className="absolute" style={{ right: '24%', top: -15 }}>
                <div style={{ width: 22, height: 17, borderRadius: 4, background: 'linear-gradient(180deg,#f0e2cc,#d9c2a3)', boxShadow: '0 3px 6px rgba(0,0,0,0.15)' }} />
            </div>
        </div>

        {/* 地毯 */}
        <div className="absolute" style={{ left: '50%', top: '90%', transform: 'translate(-50%,-50%)', width: 128, height: 26, borderRadius: '50%', background: 'radial-gradient(ellipse at center,#eccaa2 0%,#dcb088 70%,#cda378 100%)', boxShadow: 'inset 0 0 0 3px rgba(255,255,255,0.22)', opacity: 0.8 }} />

        {/* 双人小桌（演员站在桌前，像坐着的客人） */}
        {[30, 70].map((x, i) => (
            <div key={x} className="absolute" style={{ left: `${x}%`, top: '82%', transform: 'translateX(-50%)' }}>
                <div style={{ position: 'absolute', left: -14, top: 2, width: 9, height: 14, borderRadius: '4px 4px 0 0', background: '#caa173' }} />
                <div style={{ position: 'absolute', right: -14, top: 2, width: 9, height: 14, borderRadius: '4px 4px 0 0', background: '#caa173' }} />
                <div style={{ position: 'relative', width: 30, height: 30, borderRadius: '50%', background: 'linear-gradient(180deg,#ead3b5,#d4b48c)', boxShadow: '0 4px 8px rgba(90,55,30,0.2)' }}>
                    <span style={{ position: 'absolute', top: 3, left: '50%', transform: 'translateX(-50%)', fontSize: 12 }}>{i === 0 ? '☕' : '🍰'}</span>
                </div>
            </div>
        ))}

        {/* 落地盆栽 */}
        {['7%', '91%'].map((x, i) => (
            <div key={i} className="absolute" style={{ left: x, top: '78%', transform: 'translateX(-50%)', fontSize: 26, lineHeight: 1, filter: 'drop-shadow(0 4px 4px rgba(80,55,30,0.2))' }}>🪴</div>
        ))}
    </div>
));

const PIXEL_WALL_BG = '#9bcac0';
const PIXEL_FLOOR_BG = '#5c7a62';
const PIXEL_PANEL = '#ffedc2';
const PIXEL_INK = '#221b1b';
const pixelated = bankPixelStyle();
const LEGACY_DEFAULT_WALLS = ['#FEF9F0', '#F5EBD8', '#FFF5E9', '#FDE5D8'];
const LEGACY_DEFAULT_FLOORS = ['#C4A77D', '#B8956E', '#D6B48C', '#C69767'];
const isLegacyDefaultSurface = (value: string | undefined, tokens: string[]) =>
    !!value && tokens.every(token => value.includes(token));

const PixelSceneAsset: React.FC<{
    id: string;
    size?: 64 | 96 | 128;
    className?: string;
    style?: React.CSSProperties;
}> = ({ id, size = 96, className = '', style }) => {
    const src = resolveBankPixelSrc(bankPixelRef(id, size), size);
    if (!src) return null;
    return <img src={src} alt="" draggable={false} className={`select-none ${className}`} style={{ ...pixelated, ...style }} />;
};

// 店铺默认像素布景：纯展示层，不写存档，用户可继续在上面摆家具。
const PixelCafeBackdrop = React.memo(({ isOpen }: { isOpen: boolean }) => (
    <div className="absolute inset-0 z-[2] pointer-events-none select-none overflow-hidden" aria-hidden>
        <div className="absolute left-0 right-0 top-0 h-[76%]" style={{
            backgroundColor: PIXEL_WALL_BG,
            backgroundImage: 'linear-gradient(90deg, rgba(20,40,38,0.16) 1px, transparent 1px), linear-gradient(0deg, rgba(255,255,255,0.16) 1px, transparent 1px)',
            backgroundSize: '16px 16px',
        }} />
        <div className="absolute left-0 right-0 bottom-0 h-[24%]" style={{
            backgroundColor: PIXEL_FLOOR_BG,
            backgroundImage: 'linear-gradient(90deg, rgba(10,22,18,0.35) 2px, transparent 2px), linear-gradient(0deg, rgba(255,255,255,0.12) 2px, transparent 2px)',
            backgroundSize: '24px 16px',
            borderTop: `4px solid ${PIXEL_INK}`,
        }} />
        <div className="absolute left-0 right-0 top-[74%] h-[4px]" style={{ background: '#2d3d37' }} />

        <PixelSceneAsset id="furniture/window-awning" size={128} className="absolute w-[128px] h-[128px]" style={{ left: '50%', top: '8%', transform: 'translateX(-50%)' }} />
        <PixelSceneAsset id="furniture/menu-board" size={96} className="absolute w-[88px] h-[88px]" style={{ left: '9%', top: '19%' }} />
        <PixelSceneAsset id="furniture/wall-sign" size={96} className="absolute w-[88px] h-[88px]" style={{ right: '9%', top: '12%' }} />
        <div className="absolute px-2 py-1 rounded-[6px] text-[8px] font-black text-white" style={{ right: '11.5%', top: '22%', background: isOpen ? '#5a8a52' : '#6b7280', boxShadow: '0 3px 0 rgba(32,27,24,0.22)', letterSpacing: 1 }}>
            {isOpen ? '营业中' : '已打烊'}
        </div>
        <PixelSceneAsset id="furniture/clock" size={64} className="absolute w-[64px] h-[64px]" style={{ right: '25%', top: '29%' }} />
        <PixelSceneAsset id="furniture/star-lights" size={96} className="absolute w-[116px] h-[116px]" style={{ left: '18%', top: '1%' }} />
        <PixelSceneAsset id="furniture/pendant-lamp" size={64} className="absolute w-[64px] h-[64px]" style={{ left: '37%', top: '-2%' }} />
        <PixelSceneAsset id="furniture/pendant-lamp" size={64} className="absolute w-[64px] h-[64px]" style={{ left: '59%', top: '-2%' }} />
        <PixelSceneAsset id="furniture/high-shelf" size={96} className="absolute w-[88px] h-[88px]" style={{ left: '31%', top: '20%' }} />
        <PixelSceneAsset id="furniture/counter" size={128} className="absolute w-[220px] h-[128px]" style={{ left: '50%', top: '48%', transform: 'translateX(-50%)' }} />
        <PixelSceneAsset id="furniture/coffee-machine" size={96} className="absolute w-[78px] h-[78px]" style={{ left: '31%', top: '45%' }} />
        <PixelSceneAsset id="furniture/display-case" size={128} className="absolute w-[118px] h-[118px]" style={{ left: '46%', top: '43%' }} />
        <PixelSceneAsset id="furniture/cashier" size={64} className="absolute w-[58px] h-[58px]" style={{ right: '25%', top: '49%' }} />
        <PixelSceneAsset id="furniture/rug-runner" size={128} className="absolute w-[170px] h-[128px]" style={{ left: '50%', bottom: '-7%', transform: 'translateX(-50%)' }} />
        <PixelSceneAsset id="furniture/round-table" size={96} className="absolute w-[86px] h-[86px]" style={{ left: '21%', bottom: '0%' }} />
        <PixelSceneAsset id="furniture/chair" size={64} className="absolute w-[58px] h-[58px]" style={{ left: '16%', bottom: '2%' }} />
        <PixelSceneAsset id="furniture/chair" size={64} className="absolute w-[58px] h-[58px]" style={{ left: '28%', bottom: '2%' }} />
        <PixelSceneAsset id="furniture/booth" size={128} className="absolute w-[128px] h-[128px]" style={{ right: '7%', bottom: '-2%' }} />
        <PixelSceneAsset id="furniture/plant" size={64} className="absolute w-[64px] h-[64px]" style={{ left: '3%', bottom: '4%' }} />
        <PixelSceneAsset id="furniture/cactus" size={64} className="absolute w-[64px] h-[64px]" style={{ right: '3%', bottom: '13%' }} />
    </div>
));

const BankDollhouse: React.FC<Props> = ({
    shopState, dollhouseState, onDollhouseChange, characters, updateState, onConsumeDecorEnergy, onStaffClick, onOpenGuestbook, onWipeCounter, onRemoveShopProduct, shopProducts = []
}) => {
    const { addToast } = useOS();

    // 「碎碎念」气泡：戳一戳演员 / 闲时随机冒泡，让店子像活的
    const [quips, setQuips] = useState<Record<string, string>>({});
    const quipTimersRef = useRef<Record<string, number>>({});
    const randOf = <T,>(a: T[]): T => a[Math.floor(Math.random() * a.length)];
    const staffQuip = (s: ShopStaff): string => s.isPet
        ? randOf(PET_QUIPS)
        : (s.personality && Math.random() < 0.5 ? `（${s.personality}）` : randOf(STAFF_QUIPS));
    const showQuip = (actorId: string, text: string) => {
        setQuips(prev => ({ ...prev, [actorId]: text }));
        if (quipTimersRef.current[actorId]) window.clearTimeout(quipTimersRef.current[actorId]);
        quipTimersRef.current[actorId] = window.setTimeout(() => {
            setQuips(prev => { const n = { ...prev }; delete n[actorId]; return n; });
        }, 2800);
    };

    // 擦吧台特效（飘字）
    const [wipeFx, setWipeFx] = useState<{ x: number; y: number; text: string } | null>(null);
    const wipeFxTimerRef = useRef<number | null>(null);
    const handleWipe = async (e: React.MouseEvent<HTMLDivElement>) => {
        if (!onWipeCounter) return;
        const host = e.currentTarget.parentElement as HTMLElement | null;
        const rect = host?.getBoundingClientRect();
        const x = rect ? ((e.clientX - rect.left) / rect.width) * 100 : 50;
        const y = rect ? ((e.clientY - rect.top) / rect.height) * 100 : 66;
        const ap = await onWipeCounter();
        setWipeFx({ x, y, text: ap > 0 ? `+${ap} 精力` : '擦干净啦' });
        if (wipeFxTimerRef.current) window.clearTimeout(wipeFxTimerRef.current);
        wipeFxTimerRef.current = window.setTimeout(() => setWipeFx(null), 1100);
    };

    // 店员闲时碎碎念：每隔几秒随机一位店员冒个想法泡泡
    useEffect(() => {
        const t = window.setInterval(() => {
            const staff = shopState.staff;
            if (!staff || staff.length === 0) return;
            if (Math.random() < 0.65) {
                const s = staff[Math.floor(Math.random() * staff.length)];
                showQuip(s.id, staffQuip(s));
            }
        }, 9000);
        return () => window.clearInterval(t);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [shopState.staff]);
    // 卸载时清掉所有气泡 / 飘字定时器
    useEffect(() => () => {
        Object.values(quipTimersRef.current).forEach(id => window.clearTimeout(id));
        if (wipeFxTimerRef.current) window.clearTimeout(wipeFxTimerRef.current);
    }, []);
    const [showUnlockConfirm, setShowUnlockConfirm] = useState<string | null>(null);
    const [renameTarget, setRenameTarget] = useState<DollhouseRoom | null>(null);
    const [renameValue, setRenameValue] = useState('');
    const [showDecorPanel, setShowDecorPanel] = useState(false);
    const [decorTab, setDecorTab] = useState<DecorTab>('furniture');
    const [editMode, setEditMode] = useState(false);
    const [draggingActorId, setDraggingActorId] = useState<string | null>(null);
    const [actorPositions, setActorPositions] = useState<Record<string, { x: number; y: number }>>({});
    const [ambientCustomers, setAmbientCustomers] = useState<AmbientShopCustomer[]>([]);

    const longPressTimerRef = useRef<number | null>(null);
    const dragStateRef = useRef<{ actorId: string; roomId: string; isVisitor: boolean } | null>(null);
    const suppressActorClickRef = useRef(false);
    const actorMovedRef = useRef(false);
    const suppressNextStaffOpenRef = useRef(false);

    const [customAssets, setCustomAssets] = useState<CustomFurnitureAsset[]>([]);
    const [showAssetModal, setShowAssetModal] = useState(false);
    const [assetName, setAssetName] = useState('');
    const [assetUrl, setAssetUrl] = useState('');
    const [assetUploadedData, setAssetUploadedData] = useState('');
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [showTextureModal, setShowTextureModal] = useState(false);
    const [textureTarget, setTextureTarget] = useState<'room' | 'wallpaper' | 'floor'>('room');
    const [textureUrl, setTextureUrl] = useState('');        // preview (low-res or external URL)
    const textureFullRef = useRef<string>('');               // full-res base64 for saving
    const [textureScale, setTextureScale] = useState(1);
    const textureInputRef = useRef<HTMLInputElement>(null);

    // Sticker drag state
    const [draggingStickerInfo, setDraggingStickerInfo] = useState<{ stickerId: string; roomId: string; surface: string } | null>(null);
    const [selectedStickerId, setSelectedStickerId] = useState<string | null>(null);
    const [resizingStickerInfo, setResizingStickerInfo] = useState<{ stickerId: string; roomId: string; startX: number; startY: number; startScale: number; baseSize: number } | null>(null);
    const stickerLongPressRef = useRef<number | null>(null);
    // Local sticker positions during drag (avoids rapid DB writes)
    const [localStickerPos, setLocalStickerPos] = useState<Record<string, { x: number; y: number }>>({});
    const [localStickerScale, setLocalStickerScale] = useState<Record<string, number>>({});
    const localStickerScaleRef = useRef<Record<string, number>>({});
    // Trash zone hover during sticker drag
    const [overTrash, setOverTrash] = useState(false);
    const trashRef = useRef<HTMLDivElement>(null);

    // --- Local scale for debounced slider ---
    const [localRoomScale, setLocalRoomScale] = useState<number | null>(null);

    useEffect(() => {
        localStickerScaleRef.current = localStickerScale;
    }, [localStickerScale]);

    // Convert base64 room textures to stable Blob URLs to prevent flickering on re-render.
    // When the parent re-renders (e.g. actor idle movement every 3.2s), a base64 src forces
    // the browser to re-decode the image, causing white flashes. Blob URLs are short stable
    // references that the browser caches the decoded bitmap for.
    const textureBlobUrls = useRef<Record<string, string>>({});
    const getStableSrc = useCallback((raw?: string): string | undefined => {
        if (!raw?.trim()) return undefined;
        const val = raw.trim();
        // Only convert data: URIs; external URLs are already stable
        if (!val.startsWith('data:')) return val;
        // Re-use existing blob URL for the same base64 source
        if (textureBlobUrls.current[val]) return textureBlobUrls.current[val];
        try {
            const [header, b64] = val.split(',');
            const mime = header.match(/data:([^;]+)/)?.[1] || 'image/png';
            const bin = atob(b64);
            const arr = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
            const url = URL.createObjectURL(new Blob([arr], { type: mime }));
            textureBlobUrls.current[val] = url;
            return url;
        } catch { return val; }
    }, []);
    // Clean up blob URLs on unmount
    useEffect(() => {
        return () => {
            Object.values(textureBlobUrls.current).forEach(u => URL.revokeObjectURL(u));
        };
    }, []);
    // --- Furniture placement mode ---
    const [placingFurniture, setPlacingFurniture] = useState<{ url: string; surface: 'floor' | 'leftWall'; name: string; isEmoji: boolean } | null>(null);
    const [furniturePreviewPos, setFurniturePreviewPos] = useState({ x: 50, y: 50 });

    const dh = dollhouseState;

    const clampActorPos = (x: number, y: number) => ({
        x: Math.max(8, Math.min(92, x)),
        y: Math.max(56, Math.min(92, y)),
    });
    const clampStickerScale = (scale: number) => Math.max(0.25, Math.min(4, scale));

    // Save dollhouse directly to its own DB record (same pattern as RoomApp's saveRoom)
    const saveDollhouse = async (updater: DollhouseState | ((prev: DollhouseState) => DollhouseState)) => {
        await onDollhouseChange(updater);
    };

    useEffect(() => {
        const loadAssets = async () => {
            try {
                const fromDb = await DB.getAsset(CUSTOM_FURNITURE_ASSET_KEY);
                if (fromDb) {
                    const parsed = JSON.parse(fromDb);
                    if (Array.isArray(parsed)) {
                        setCustomAssets(parsed);
                        return;
                    }
                }
                const legacy = localStorage.getItem(CUSTOM_FURNITURE_ASSET_KEY);
                if (!legacy) return;
                const parsed = JSON.parse(legacy);
                if (Array.isArray(parsed)) {
                    setCustomAssets(parsed);
                    await DB.saveAsset(CUSTOM_FURNITURE_ASSET_KEY, JSON.stringify(parsed));
                    localStorage.removeItem(CUSTOM_FURNITURE_ASSET_KEY);
                }
            } catch {
                setCustomAssets([]);
            }
        };
        loadAssets();
    }, []);

    // Migration: resolve any legacy bank-asset:// references to direct URLs on first load
    useEffect(() => {
        const migrateRefs = async () => {
            const roomsWithRefs = dh.rooms.filter(r => r.roomTextureUrl?.startsWith('bank-asset://'));
            if (roomsWithRefs.length === 0) return;

            let updated = false;
            const newRooms = await Promise.all(dh.rooms.map(async (r) => {
                if (!r.roomTextureUrl?.startsWith('bank-asset://')) return r;
                const key = r.roomTextureUrl.replace('bank-asset://', '');
                try {
                    const raw = await DB.getAssetRaw(key);
                    if (raw instanceof Blob) {
                        // Convert Blob to base64 (same as RoomApp stores images)
                        const base64 = await new Promise<string>((resolve) => {
                            const reader = new FileReader();
                            reader.onloadend = () => resolve(reader.result as string);
                            reader.readAsDataURL(raw);
                        });
                        updated = true;
                        return { ...r, roomTextureUrl: base64 };
                    }
                } catch { /* ignore migration errors */ }
                // If can't resolve, clear the broken reference
                updated = true;
                return { ...r, roomTextureUrl: undefined };
            }));

            if (updated) {
                await saveDollhouse(prev => ({ ...prev, rooms: newRooms }));
            }
        };
        migrateRefs();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        const mainRoom = dh.rooms.find(r => r.id === MAIN_ROOM_ID);
        if (!mainRoom || shopState.staff.length === 0) return;

        const mainHasStaff = mainRoom.staffIds.length > 0;
        const staffIdsInAnyRoom = dh.rooms.flatMap(r => r.staffIds);
        const missingStaff = shopState.staff.filter(s => !staffIdsInAnyRoom.includes(s.id)).map(s => s.id);

        if (mainHasStaff && missingStaff.length === 0) return;

        const allStaffIds = shopState.staff.map(s => s.id);
        const newRooms = dh.rooms.map(r => (
            r.id === MAIN_ROOM_ID
                ? { ...r, staffIds: Array.from(new Set([...allStaffIds, ...r.staffIds])) }
                : { ...r, staffIds: r.staffIds.filter(id => !allStaffIds.includes(id)) }
        ));
        saveDollhouse(prev => ({ ...prev, rooms: newRooms }));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [shopState.staff.length]);

    const normalizedRooms = useMemo(() => dh.rooms.map(room => (
        room.id === MAIN_ROOM_ID ? { ...room, name: '店铺' } : room
    )), [dh.rooms]);

    const roomOrder = ['room-2f-left', 'room-1f-left', 'room-1f-right', 'room-2f-right'];
    const orderedRooms = roomOrder
        .map(id => normalizedRooms.find(r => r.id === id))
        .filter((room): room is DollhouseRoom => Boolean(room));

    const [activeRoomId, setActiveRoomId] = useState<string>(MAIN_ROOM_ID);
    const activeRoom = orderedRooms.find(r => r.id === activeRoomId) || orderedRooms[0];
    const activeRoomIndex = orderedRooms.findIndex(r => r.id === activeRoom.id);

    const shopProductsById = useMemo(
        () => new Map(shopProducts.map(product => [product.id, product])),
        [shopProducts]
    );

    const pickAmbientCustomerReaction = (room: DollhouseRoom, customer: typeof BANK_PIXEL_CUSTOMER_DEFS[number]): { mood: AmbientCustomerMood; reaction: string } => {
        const productStickers = room.stickers.filter(sticker => sticker.kind === 'shop-product' && sticker.productId);
        const placedProducts = productStickers
            .map(sticker => shopProductsById.get(sticker.productId || ''))
            .filter((product): product is BankLifeShopProduct => Boolean(product));
        const stockedProducts = placedProducts.filter(product => !product.needsRestock && product.stock > 0);
        const restockProducts = placedProducts.filter(product => product.needsRestock || product.stock <= 0);
        const decorCount = room.stickers.filter(sticker => sticker.kind !== 'shop-product').length;
        const hasStaffNearby = room.staffIds.length > 0 || (room.id === MAIN_ROOM_ID && shopState.staff.length > 0);

        if (restockProducts.length > 0 && Math.random() < 0.4) {
            const product = randOf(restockProducts);
            return { mood: 'impatient', reaction: `想买${product.name}，但货架要先补货。` };
        }
        if (stockedProducts.length > 0 && Math.random() < 0.55) {
            const product = randOf(stockedProducts);
            return { mood: 'buying', reaction: `${product.name}摆得很顺手，我想拿一份。` };
        }
        if (productStickers.length === 0 && Math.random() < 0.65) {
            return { mood: 'curious', reaction: '货架还空着，我先看看装修和座位。' };
        }
        if (decorCount > 0 && Math.random() < 0.35) {
            return { mood: 'photo', reaction: '这个角落好适合拍照，摆件也很有记忆点。' };
        }
        if (hasStaffNearby && Math.random() < 0.35) {
            return { mood: 'happy', reaction: '店员招呼得很快，逛起来很舒服。' };
        }
        const fallback = [
            '我先绕一圈看看今天有什么新东西。',
            '店里的动线挺顺，货架一眼就能看到。',
            '这个小店有点像会呼吸的经营游戏现场。',
            `我是${customer.name}，${customer.trait}。`,
        ];
        return { mood: Math.random() < 0.5 ? 'browsing' : 'happy', reaction: randOf(fallback) };
    };

    useEffect(() => {
        if (!shopState.isBusinessOpen) {
            setAmbientCustomers([]);
            return;
        }

        const spawnOrRefreshCustomers = () => {
            const unlockedRooms = orderedRooms.filter(room => room.isUnlocked);
            setAmbientCustomers(prev => {
                const now = Date.now();
                if (unlockedRooms.length === 0) return [];
                const allowedRoomIds = new Set(unlockedRooms.map(room => room.id));
                const living = prev.filter(customer => customer.leaveAt > now && allowedRoomIds.has(customer.roomId));
                const maxCustomers = Math.min(8, 3 + Math.floor((shopState.shopLevel || 1) / 2) + (shopState.staff.length >= 3 ? 1 : 0));
                if (living.length >= maxCustomers) return living;
                if (living.length > 0 && Math.random() > 0.68) return living;

                const usedTypes = new Set(living.map(customer => customer.typeId));
                const availableDefs = BANK_PIXEL_CUSTOMER_DEFS.filter(customer => !usedTypes.has(customer.id));
                const def = randOf(availableDefs.length ? availableDefs : BANK_PIXEL_CUSTOMER_DEFS);
                const mainRoom = unlockedRooms.find(room => room.id === MAIN_ROOM_ID);
                const targetRoom = mainRoom && Math.random() < 0.68 ? mainRoom : randOf(unlockedRooms);
                const pos = clampActorPos(16 + Math.random() * 68, 68 + Math.random() * 18);
                const { mood, reaction } = pickAmbientCustomerReaction(targetRoom, def);
                return [
                    ...living,
                    {
                        id: `ambient-${def.id}-${now}-${Math.random().toString(36).slice(2, 5)}`,
                        typeId: def.id,
                        name: def.name,
                        avatar: bankPixelRef(def.assetId, 64),
                        roomId: targetRoom.id,
                        x: pos.x,
                        y: pos.y,
                        scale: 1.18 + Math.random() * 0.18,
                        mood,
                        reaction,
                        leaveAt: now + 26000 + Math.random() * 24000,
                    },
                ];
            });
        };

        const first = window.setTimeout(spawnOrRefreshCustomers, 700);
        const timer = window.setInterval(spawnOrRefreshCustomers, 5200);
        return () => {
            window.clearTimeout(first);
            window.clearInterval(timer);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [shopState.isBusinessOpen, shopState.shopLevel, shopState.staff.length, dh.rooms, shopProductsById]);

    useEffect(() => {
        if (ambientCustomers.length === 0) return;
        const timer = window.setInterval(() => {
            if (Math.random() > 0.58) return;
            const customer = randOf(ambientCustomers);
            showQuip(customer.id, customer.reaction);
        }, 7600);
        return () => window.clearInterval(timer);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [ambientCustomers]);

    useEffect(() => {
        const next: Record<string, { x: number; y: number }> = {};
        shopState.staff.forEach(staff => {
            next[staff.id] = clampActorPos(staff.x ?? 50, staff.y ?? 74);
        });
        if (shopState.activeVisitor?.charId) {
            next[shopState.activeVisitor.charId] = clampActorPos(shopState.activeVisitor.x ?? 55, shopState.activeVisitor.y ?? 76);
        }
        ambientCustomers.forEach(customer => {
            next[customer.id] = clampActorPos(customer.x, customer.y);
        });
        setActorPositions(next);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [shopState.staff, shopState.activeVisitor?.charId, shopState.activeVisitor?.x, shopState.activeVisitor?.y, ambientCustomers]);

    useEffect(() => {
        const timer = window.setInterval(() => {
            if (dragStateRef.current) return;
            setActorPositions(prev => {
                const updated: Record<string, { x: number; y: number }> = { ...prev };
                Object.entries(prev).forEach(([id, pos]) => {
                    if (Math.random() > 0.4) return;
                    const dx = (Math.random() - 0.5) * 3;
                    const dy = (Math.random() - 0.5) * 1.8;
                    updated[id] = clampActorPos(pos.x + dx, pos.y + dy);
                });
                return updated;
            });
        }, 3200);

        return () => {
            window.clearInterval(timer);
            cancelLongPress();
            cancelStickerLongPress();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const getLayout = (layoutId: string): RoomLayout | undefined => ROOM_LAYOUTS.find(l => l.id === layoutId);

    const consumeDecorEnergy = async (cost: number, label: string): Promise<boolean> => {
        if (!onConsumeDecorEnergy) return true;
        return onConsumeDecorEnergy(cost, label);
    };

    const handleUnlockRoom = async (roomId: string) => {
        const cost = ROOM_UNLOCK_COSTS[roomId] || 150;
        if (shopState.actionPoints < cost) {
            addToast(`店员精力不够（需要 ${cost} 点）`, 'error');
            return;
        }
        // Save dollhouse changes separately from AP deduction
        await saveDollhouse(prev => ({
            ...prev,
            rooms: prev.rooms.map(r =>
                r.id === roomId ? {
                    ...r,
                    isUnlocked: true,
                    wallpaperLeft: PIXEL_WALL_BG,
                    wallpaperRight: PIXEL_WALL_BG,
                    floorStyle: PIXEL_FLOOR_BG,
                } : r
            )
        }));
        await updateState(prev => ({
            ...prev,
            actionPoints: prev.actionPoints - cost,
        }));
        setShowUnlockConfirm(null);
        addToast(`房间已解锁，消耗${shopEnergyText(cost)}`, 'success');
    };

    const handleRenameRoom = (room: DollhouseRoom) => {
        if (room.id === MAIN_ROOM_ID) {
            addToast('第一间店铺不能改名', 'info');
            return;
        }
        setRenameValue(room.name);
        setRenameTarget(room);
    };

    const confirmRenameRoom = async () => {
        if (!renameTarget) return;
        const name = renameValue.trim().slice(0, 10);
        if (!name) return;
        await saveDollhouse(prev => ({
            ...prev,
            rooms: prev.rooms.map(r => r.id === renameTarget.id ? { ...r, name } : r)
        }));
        setRenameTarget(null);
        addToast('房间名已更新', 'success');
    };

    const persistActorPosition = async (actorId: string, x: number, y: number, isVisitor: boolean) => {
        const next = clampActorPos(x, y);
        if (isVisitor) {
            if (!shopState.activeVisitor || shopState.activeVisitor.charId !== actorId) return;
            await updateState(prev => ({
                ...prev,
                activeVisitor: prev.activeVisitor ? { ...prev.activeVisitor, x: next.x, y: next.y } : prev.activeVisitor,
            }));
            return;
        }
        await updateState(prev => ({
            ...prev,
            staff: prev.staff.map(s => s.id === actorId ? { ...s, x: next.x, y: next.y } : s)
        }));
    };

    const cancelLongPress = () => {
        if (longPressTimerRef.current !== null) {
            window.clearTimeout(longPressTimerRef.current);
            longPressTimerRef.current = null;
        }
    };

    const handleActorPressStart = (actorId: string, roomId: string, isVisitor: boolean) => {
        cancelLongPress();
        actorMovedRef.current = false;
        longPressTimerRef.current = window.setTimeout(() => {
            dragStateRef.current = { actorId, roomId, isVisitor };
            setDraggingActorId(actorId);
            suppressActorClickRef.current = true;
        }, 220);
    };

    const handleRoomPointerMove = (roomId: string, e: React.PointerEvent<HTMLDivElement>) => {
        const drag = dragStateRef.current;
        if (!drag || drag.roomId !== roomId) return;
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const xPct = ((e.clientX - rect.left) / rect.width) * 100;
        const yPct = ((e.clientY - rect.top) / rect.height) * 100;
        const next = clampActorPos(xPct, yPct);
        actorMovedRef.current = true;
        setActorPositions(prev => ({ ...prev, [drag.actorId]: next }));
    };

    const handleRoomPointerUp = async (): Promise<boolean> => {
        cancelLongPress();
        const drag = dragStateRef.current;
        if (!drag) {
            const moved = actorMovedRef.current;
            actorMovedRef.current = false;
            suppressActorClickRef.current = false;
            return moved;
        }

        const moved = actorMovedRef.current;
        const pos = actorPositions[drag.actorId];
        if (pos) {
            await persistActorPosition(drag.actorId, pos.x, pos.y, drag.isVisitor);
        }
        dragStateRef.current = null;
        setDraggingActorId(null);
        actorMovedRef.current = false;
        window.setTimeout(() => { suppressActorClickRef.current = false; }, 120);
        return moved;
    };

    const handleSetWallpaper = async (roomId: string, style: string, chargeEnergy = true) => {
        if (chargeEnergy && !(await consumeDecorEnergy(2, '更换墙纸'))) return;
        await saveDollhouse(prev => ({
            ...prev,
            rooms: prev.rooms.map(r => r.id === roomId ? { ...r, wallpaperLeft: style, wallpaperRight: style } : r)
        }));
        addToast('墙纸已更换', 'success');
    };

    const handleSetFloor = async (roomId: string, style: string, chargeEnergy = true) => {
        if (chargeEnergy && !(await consumeDecorEnergy(2, '更换地板'))) return;
        await saveDollhouse(prev => ({
            ...prev,
            rooms: prev.rooms.map(r => r.id === roomId ? { ...r, floorStyle: style } : r)
        }));
        addToast('地板已更换', 'success');
    };

    const handleAddFurniture = async (roomId: string, stickerUrl: string, surface: 'floor' | 'leftWall', pos?: { x: number; y: number }) => {
        if (!(await consumeDecorEnergy(1, '摆放家具'))) return;
        const newSticker: DollhouseSticker = {
            id: `stk-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
            url: stickerUrl,
            x: pos?.x ?? 50,
            y: pos?.y ?? (surface === 'leftWall' ? 45 : 55),
            scale: 1,
            rotation: 0,
            zIndex: 10,
            surface,
        };
        await saveDollhouse(prev => ({
            ...prev,
            rooms: prev.rooms.map(r => r.id === roomId ? { ...r, stickers: [...r.stickers, newSticker] } : r)
        }));
        addToast('已放置家具', 'success');
    };

    const handleDeleteSticker = async (roomId: string, stickerId: string) => {
        const sticker = dollhouseState.rooms.find(r => r.id === roomId)?.stickers.find(s => s.id === stickerId);
        await saveDollhouse(prev => ({
            ...prev,
            rooms: prev.rooms.map(r => r.id === roomId ? { ...r, stickers: r.stickers.filter(s => s.id !== stickerId) } : r)
        }));
        setSelectedStickerId(prev => prev === stickerId ? null : prev);
        if (sticker?.kind === 'shop-product' && sticker.productId) {
            await onRemoveShopProduct?.(sticker.productId);
        }
    };

    const cancelStickerLongPress = () => {
        if (stickerLongPressRef.current !== null) {
            window.clearTimeout(stickerLongPressRef.current);
            stickerLongPressRef.current = null;
        }
    };

    const handleStickerPressStart = (sticker: DollhouseSticker, roomId: string) => {
        cancelStickerLongPress();
        setSelectedStickerId(sticker.id);
        if (editMode) {
            setDraggingStickerInfo({ stickerId: sticker.id, roomId, surface: sticker.surface });
            setOverTrash(false);
            return;
        }
        stickerLongPressRef.current = window.setTimeout(() => {
            setDraggingStickerInfo({ stickerId: sticker.id, roomId, surface: sticker.surface });
        }, 280);
    };

    const handleStickerPointerMove = (roomId: string, surface: 'floor' | 'leftWall' | 'rightWall', e: React.PointerEvent<HTMLDivElement>) => {
        if (!draggingStickerInfo || draggingStickerInfo.roomId !== roomId) return;
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const xPct = ((e.clientX - rect.left) / rect.width) * 100;
        const yPct = ((e.clientY - rect.top) / rect.height) * 100;
        const clampedX = Math.max(5, Math.min(95, xPct));
        const clampedY = Math.max(5, Math.min(95, yPct));

        // Only update local visual state during drag (no DB writes)
        setLocalStickerPos(prev => ({ ...prev, [draggingStickerInfo.stickerId]: { x: clampedX, y: clampedY } }));

        // Check if pointer is over trash zone
        if (editMode && trashRef.current) {
            const trashRect = trashRef.current.getBoundingClientRect();
            const isOver = e.clientX >= trashRect.left && e.clientX <= trashRect.right && e.clientY >= trashRect.top && e.clientY <= trashRect.bottom;
            setOverTrash(isOver);
        }
    };

    const handleStickerPointerUp = async (e?: React.PointerEvent | PointerEvent) => {
        cancelStickerLongPress();
        if (draggingStickerInfo) {
            // Check if dropped on trash zone
            let droppedOnTrash = overTrash;
            if (!droppedOnTrash && e && trashRef.current) {
                const rect = trashRef.current.getBoundingClientRect();
                droppedOnTrash = e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom;
            }
            if (droppedOnTrash && editMode) {
                await handleDeleteSticker(draggingStickerInfo.roomId, draggingStickerInfo.stickerId);
                addToast('家具已删除', 'success');
            } else {
                // Persist final position to DB on pointer up
                const pos = localStickerPos[draggingStickerInfo.stickerId];
                if (pos) {
                    await saveDollhouse(prev => ({
                        ...prev,
                        rooms: prev.rooms.map(r => {
                            if (r.id !== draggingStickerInfo.roomId) return r;
                            return {
                                ...r,
                                stickers: r.stickers.map(s =>
                                    s.id === draggingStickerInfo.stickerId ? { ...s, x: pos.x, y: pos.y } : s
                                )
                            };
                        })
                    }));
                }
            }
            setLocalStickerPos(prev => {
                const next = { ...prev };
                delete next[draggingStickerInfo.stickerId];
                return next;
            });
            setOverTrash(false);
            setDraggingStickerInfo(null);
        }
    };

    const handleStickerResizeStart = (event: React.PointerEvent, roomId: string, sticker: DollhouseSticker, baseSize: number) => {
        event.preventDefault();
        event.stopPropagation();
        cancelStickerLongPress();
        setSelectedStickerId(sticker.id);
        setDraggingStickerInfo(null);
        setResizingStickerInfo({
            stickerId: sticker.id,
            roomId,
            startX: event.clientX,
            startY: event.clientY,
            startScale: localStickerScale[sticker.id] ?? sticker.scale,
            baseSize,
        });
    };

    useEffect(() => {
        if (!draggingStickerInfo) return;
        const finishDrag = (event: PointerEvent) => {
            void handleStickerPointerUp(event);
        };
        window.addEventListener('pointerup', finishDrag);
        window.addEventListener('pointercancel', finishDrag);
        return () => {
            window.removeEventListener('pointerup', finishDrag);
            window.removeEventListener('pointercancel', finishDrag);
        };
    }, [draggingStickerInfo, overTrash, localStickerPos]);

    useEffect(() => {
        if (!resizingStickerInfo) return;
        const info = resizingStickerInfo;
        const move = (event: PointerEvent) => {
            event.preventDefault();
            const delta = ((event.clientX - info.startX) + (event.clientY - info.startY)) / Math.max(40, info.baseSize);
            const nextScale = clampStickerScale(info.startScale + delta);
            localStickerScaleRef.current = { ...localStickerScaleRef.current, [info.stickerId]: nextScale };
            setLocalStickerScale(prev => ({ ...prev, [info.stickerId]: nextScale }));
        };
        const finish = async () => {
            const nextScale = localStickerScaleRef.current[info.stickerId];
            if (typeof nextScale === 'number') {
                await saveDollhouse(prev => ({
                    ...prev,
                    rooms: prev.rooms.map(r => r.id === info.roomId ? {
                        ...r,
                        stickers: r.stickers.map(s =>
                            s.id === info.stickerId ? { ...s, scale: clampStickerScale(nextScale) } : s
                        )
                    } : r)
                }));
            }
            setLocalStickerScale(prev => {
                const next = { ...prev };
                delete next[info.stickerId];
                return next;
            });
            setResizingStickerInfo(null);
        };
        window.addEventListener('pointermove', move, { passive: false });
        window.addEventListener('pointerup', finish);
        window.addEventListener('pointercancel', finish);
        return () => {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', finish);
            window.removeEventListener('pointercancel', finish);
        };
    }, [resizingStickerInfo]);

    const handleStickerScaleChange = async (roomId: string, stickerId: string, delta: number) => {
        await saveDollhouse(prev => ({
            ...prev,
            rooms: prev.rooms.map(r => r.id === roomId ? {
                ...r,
                stickers: r.stickers.map(s =>
                    s.id === stickerId ? { ...s, scale: clampStickerScale(s.scale + delta) } : s
                )
            } : r)
        }));
    };

    const handleStaffScaleChange = async (staffId: string, delta: number) => {
        await updateState(prev => ({
            ...prev,
            staff: prev.staff.map(s =>
                s.id === staffId ? { ...s, scale: Math.max(0.4, Math.min(4, (s.scale ?? 1) + delta)) } : s
            )
        }));
    };

    const handleVisitorScaleChange = async (delta: number) => {
        await updateState(prev => {
            if (!prev.activeVisitor) return prev;
            const nextScale = Math.max(0.4, Math.min(4, (prev.activeVisitor.scale ?? 2.5) + delta));
            return {
                ...prev,
                activeVisitor: { ...prev.activeVisitor, scale: nextScale },
            };
        });
    };


    const handleChangeLayout = async (roomId: string, layoutId: string) => {
        const layout = getLayout(layoutId);
        if (!layout) return;
        const room = dollhouseState.rooms.find(r => r.id === roomId);
        if (room?.layoutId === layoutId) {
            addToast('已经是这个房型了', 'info');
            return;
        }
        if (!(await consumeDecorEnergy(8, '切换房型'))) return;
        await saveDollhouse(prev => ({
            ...prev,
            rooms: prev.rooms.map(r => r.id === roomId ? { ...r, layoutId } : r)
        }));
        addToast('房型已更换！', 'success');
    };

    const goPrevRoom = () => {
        const prev = activeRoomIndex <= 0 ? orderedRooms.length - 1 : activeRoomIndex - 1;
        setActiveRoomId(orderedRooms[prev].id);
    };

    const goNextRoom = () => {
        const next = activeRoomIndex >= orderedRooms.length - 1 ? 0 : activeRoomIndex + 1;
        setActiveRoomId(orderedRooms[next].id);
    };

    const toCssBackground = (value?: string, fallback?: string) => {
        const source = (value || fallback || '').trim();
        if (!source) return fallback || 'transparent';
        if (/gradient\(|^#|^rgb\(|^hsl\(/i.test(source)) return source;
        // Convert base64 to stable blob URL to prevent flicker on re-render
        const stableSrc = getStableSrc(source) || source;
        return `url("${stableSrc}") center / cover no-repeat`;
    };

    const openTextureModal = (target: 'room' | 'wallpaper' | 'floor') => {
        setTextureTarget(target);
        setTextureUrl('');
        textureFullRef.current = '';
        setTextureScale(1);
        setShowTextureModal(true);
    };

    // Upload: high-res for saving, low-res for modal preview
    const handleTextureUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        e.target.value = '';
        try {
            const [full, preview] = await Promise.all([
                processImage(file, { maxWidth: 1200, quality: 0.85 }),
                processImage(file, { maxWidth: 400, quality: 0.6 }),
            ]);
            textureFullRef.current = full;
            setTextureUrl(preview);
            addToast('图片已载入', 'success');
        } catch {
            addToast('图片读取失败', 'error');
        }
    };

    const handleSaveCustomTexture = async () => {
        if (!textureUrl.trim()) {
            addToast('请填写图床 URL 或上传本地图片', 'error');
            return;
        }
        // Use full-res image if available (local upload), otherwise use the URL as-is
        const url = (textureFullRef.current || textureUrl).trim();
        if (!(await consumeDecorEnergy(6, '上传装修素材'))) return;
        if (textureTarget === 'room') {
            // Store base64 or URL directly in dollhouse state (same as RoomApp's roomConfig)
            await saveDollhouse(prev => ({
                ...prev,
                rooms: prev.rooms.map(r => r.id === activeRoom.id ? { ...r, roomTextureUrl: url, roomTextureScale: textureScale } : r)
            }));
            addToast('背景图已更新', 'success');
        } else if (textureTarget === 'wallpaper') {
            await handleSetWallpaper(activeRoom.id, url, false);
        } else {
            await handleSetFloor(activeRoom.id, url, false);
        }
        textureFullRef.current = '';
        setShowTextureModal(false);
    };

    const persistCustomAssets = async (nextAssets: CustomFurnitureAsset[]) => {
        setCustomAssets(nextAssets);
        await DB.saveAsset(CUSTOM_FURNITURE_ASSET_KEY, JSON.stringify(nextAssets));
    };

    const handleAddCustomAsset = async () => {
        const finalAssetUrl = assetUrl.trim() || assetUploadedData;
        if (!assetName.trim() || !finalAssetUrl) {
            addToast('请填写家具名称并提供图片（URL 或本地上传）', 'error');
            return;
        }
        const next = [...customAssets, { id: `custom-${Date.now()}`, name: assetName.trim(), url: finalAssetUrl }];
        await persistCustomAssets(next);
        setAssetName('');
        setAssetUrl('');
        setAssetUploadedData('');
        setShowAssetModal(false);
        addToast('自定义家具已保存', 'success');
    };

    const handleDeleteCustomAsset = (id: string) => {
        void persistCustomAssets(customAssets.filter(a => a.id !== id));
        addToast('已删除自定义家具', 'success');
    };

    const handleUploadCustomAsset = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        e.target.value = '';
        try {
            const base64 = await processImage(file, { maxWidth: 400, quality: 0.85 });
            setAssetUploadedData(base64);
            addToast('本地图片已载入（不会自动改写 URL 输入框）', 'success');
        } catch {
            addToast('图片读取失败', 'error');
        }
    };

    // --- NEW: Debounced scale save ---
    const handleScaleSliderChange = useCallback((value: number) => {
        setLocalRoomScale(value);
    }, []);

    const handleScaleSliderCommit = useCallback(async () => {
        if (localRoomScale === null) return;
        await saveDollhouse(prev => ({
            ...prev,
            rooms: prev.rooms.map(r => r.id === activeRoom.id ? { ...r, roomTextureScale: localRoomScale } : r)
        }));
        setLocalRoomScale(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [localRoomScale, activeRoom.id]);

    // Enter furniture placement mode - surface auto-detected from click position
    const startPlacingFurniture = (url: string, surface: 'floor' | 'leftWall', name: string) => {
        const isEmoji = !resolveBankPixelSrc(url) && !isBankAssetUrl(url);
        setPlacingFurniture({ url, surface, name, isEmoji });
        setFurniturePreviewPos({ x: 50, y: 50 });
        setShowDecorPanel(false);
    };

    const handlePlacementPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
        if (!placingFurniture) return;
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const xPct = ((e.clientX - rect.left) / rect.width) * 100;
        const yPct = ((e.clientY - rect.top) / rect.height) * 100;
        setFurniturePreviewPos({
            x: Math.max(5, Math.min(95, xPct)),
            y: Math.max(5, Math.min(95, yPct)),
        });
    };

    const handlePlacementConfirm = async () => {
        if (!placingFurniture) return;
        // Auto-detect surface from click Y position: top 76% = wall, bottom 24% = floor
        const surface = furniturePreviewPos.y < (WALL_H_RATIO * 100) ? 'leftWall' as const : 'floor' as const;
        // Remap position to be relative within the surface area
        const adjustedPos = surface === 'leftWall'
            ? { x: furniturePreviewPos.x, y: (furniturePreviewPos.y / (WALL_H_RATIO * 100)) * 100 }
            : { x: furniturePreviewPos.x, y: ((furniturePreviewPos.y - WALL_H_RATIO * 100) / (FLOOR_H_RATIO * 100)) * 100 };
        await handleAddFurniture(activeRoom.id, placingFurniture.url, surface, adjustedPos);
        setPlacingFurniture(null);
    };

    // Effective scale (use local slider value if dragging, else persisted)
    const getEffectiveScale = (room: DollhouseRoom) => {
        if (localRoomScale !== null && room.id === activeRoom.id) return localRoomScale;
        return room.roomTextureScale ?? 1;
    };

    // Resolve texture URL via stable blob reference (prevents flickering)
    const resolveTextureUrl = getStableSrc;
    const resolveDecorSrc = (value?: string, pixelSize?: 64 | 96 | 128): string | undefined =>
        resolveBankPixelSrc(value, pixelSize) || getStableSrc(value) || value;
    const decorPixelMeta = (value?: string) => getBankPixelAssetMeta(value);
    const renderDecorAsset = (
        value: string,
        alt: string,
        imgClassName: string,
        textClassName: string,
        pixelSize?: 64 | 96 | 128,
    ) => {
        const pixelSrc = resolveBankPixelSrc(value, pixelSize);
        const src = pixelSrc || getStableSrc(value);
        if (src && (pixelSrc || isBankAssetUrl(value))) {
            return <img src={src} alt={alt} className={imgClassName} draggable={false} style={pixelSrc ? pixelated : undefined} onError={(e) => { e.currentTarget.style.display = 'none'; }} />;
        }
        return <span className={textClassName}>{value}</span>;
    };

    const renderArrowButton = (direction: 'left' | 'right', onClick: () => void) => (
        <button
            onClick={onClick}
            className="w-10 h-10 border-4 shadow-[3px_3px_0_rgba(34,27,27,0.22)] flex items-center justify-center active:scale-90 transition-all"
            style={{ background: PIXEL_PANEL, borderColor: PIXEL_INK }}
            aria-label={direction === 'left' ? '上一房间' : '下一房间'}
        >
            <svg viewBox="0 0 24 24" className="w-4 h-4" style={{ color: PIXEL_INK }} fill="none" stroke="currentColor" strokeWidth="3">
                {direction === 'left'
                    ? <path strokeLinecap="round" strokeLinejoin="round" d="M15 4 7 12l8 8" />
                    : <path strokeLinecap="round" strokeLinejoin="round" d="m9 4 8 8-8 8" />}
            </svg>
        </button>
    );

    const renderRoom = (room: DollhouseRoom) => {
        const locked = !room.isUnlocked;
        const rawWall = room.wallpaperLeft || room.wallpaperRight;
        const rawFloor = room.floorStyle;
        const wallBg = toCssBackground(isLegacyDefaultSurface(rawWall, LEGACY_DEFAULT_WALLS) ? undefined : rawWall, PIXEL_WALL_BG);
        const floorBg = toCssBackground(isLegacyDefaultSurface(rawFloor, LEGACY_DEFAULT_FLOORS) ? undefined : rawFloor, PIXEL_FLOOR_BG);
        const roomTexture = resolveTextureUrl(room.roomTextureUrl);
        const roomTextureScale = Math.max(0.5, Math.min(2.5, getEffectiveScale(room)));

        const roomStaff = shopState.staff.filter(s => {
            const targetRoom = dh.rooms.find(rm => rm.staffIds.includes(s.id));
            if (targetRoom) return targetRoom.id === room.id;
            return room.id === MAIN_ROOM_ID;
        });

        const visitor = shopState.activeVisitor && shopState.activeVisitor.roomId === room.id
            ? characters.find(c => c.id === shopState.activeVisitor?.charId)
            : null;

        const wallStickers = room.stickers.filter(s => s.surface === 'leftWall' || s.surface === 'rightWall');
        const floorStickers = room.stickers.filter(s => s.surface === 'floor');

        const isPlacing = placingFurniture && room.id === activeRoom.id;
        const renderSticker = (sticker: DollhouseSticker) => {
            const isDraggingThis = draggingStickerInfo?.stickerId === sticker.id;
            const isResizingThis = resizingStickerInfo?.stickerId === sticker.id;
            const isSelected = selectedStickerId === sticker.id || isDraggingThis || isResizingThis;
            const pixelMeta = decorPixelMeta(sticker.url);
            const pixelSize = pixelMeta?.defaultSize;
            const pixelSrc = resolveBankPixelSrc(sticker.url, pixelSize);
            const stickerSrc = pixelSrc || resolveDecorSrc(sticker.url);
            const isImage = !!stickerSrc && (Boolean(pixelSrc) || isBankAssetUrl(sticker.url));
            const stkPos = localStickerPos[sticker.id] || { x: sticker.x, y: sticker.y };
            const baseSize = pixelSize || 64;
            const effectiveScale = localStickerScale[sticker.id] ?? sticker.scale;
            return (
                <div
                    key={sticker.id}
                    className={`absolute select-none group/sticker ${
                        isDraggingThis ? 'cursor-grabbing' : editMode ? 'cursor-grab' : 'cursor-pointer'
                    } ${isSelected ? 'ring-2 ring-[#FF8E6B] ring-offset-1 rounded-lg' : ''} transition-transform`}
                    style={{
                        left: `${stkPos.x}%`,
                        top: `${stkPos.y}%`,
                        transform: `translate(-50%, -50%) scale(${effectiveScale}) ${isDraggingThis ? 'scale(1.08)' : ''}`,
                        zIndex: isDraggingThis || isResizingThis ? 50 : isSelected ? Math.max(45, sticker.zIndex) : sticker.zIndex,
                        fontSize: '1.5rem',
                    }}
                    onClick={(e) => { e.stopPropagation(); setSelectedStickerId(sticker.id); }}
                    onPointerDown={(e) => { e.stopPropagation(); handleStickerPressStart(sticker, room.id); }}
                    onPointerUp={(e) => { e.stopPropagation(); void handleStickerPointerUp(e.nativeEvent); }}
                >
                    {isImage
                        ? <img
                            src={stickerSrc}
                            alt=""
                            className="object-contain drop-shadow-[3px_3px_0_rgba(34,27,27,0.25)]"
                            style={{
                                width: baseSize,
                                height: baseSize,
                                ...(pixelSrc ? pixelated : {}),
                            }}
                            draggable={false}
                            onError={(e) => { e.currentTarget.style.display = 'none'; }}
                        />
                        : <span className="block text-[64px] leading-none drop-shadow-[3px_3px_0_rgba(34,27,27,0.25)]">{sticker.url}</span>}
                    {editMode && isSelected && (
                        <>
                            <div
                                className="absolute -right-8 top-0 flex flex-col gap-0.5 z-40"
                                style={{ transform: `scale(${1 / Math.max(0.4, effectiveScale)})`, transformOrigin: 'top left' }}
                            >
                                <button
                                    onClick={(e) => { e.stopPropagation(); void handleStickerScaleChange(room.id, sticker.id, 0.15); }}
                                    onPointerDown={(e) => { e.stopPropagation(); cancelStickerLongPress(); }}
                                    className="w-5 h-5 rounded-full bg-white/90 border border-[#E0CBBA] shadow-sm flex items-center justify-center text-[10px] font-bold text-[#6B4528] active:scale-90 transition-transform"
                                >+</button>
                                <button
                                    onClick={(e) => { e.stopPropagation(); void handleStickerScaleChange(room.id, sticker.id, -0.15); }}
                                    onPointerDown={(e) => { e.stopPropagation(); cancelStickerLongPress(); }}
                                    className="w-5 h-5 rounded-full bg-white/90 border border-[#E0CBBA] shadow-sm flex items-center justify-center text-[10px] font-bold text-[#6B4528] active:scale-90 transition-transform"
                                >-</button>
                                <button
                                    title="删除家具"
                                    onClick={(e) => { e.stopPropagation(); void handleDeleteSticker(room.id, sticker.id).then(() => addToast('家具已删除', 'success')); }}
                                    onPointerDown={(e) => { e.stopPropagation(); cancelStickerLongPress(); }}
                                    className="w-5 h-5 rounded-full bg-white/90 border border-[#F2B8B5] shadow-sm flex items-center justify-center text-[#B42318] active:scale-90 transition-transform"
                                ><Trash size={12} weight="bold" /></button>
                            </div>
                            <button
                                type="button"
                                title="拖动调整大小"
                                aria-label="拖动调整家具大小"
                                className="absolute -right-3 -bottom-3 z-40 h-7 w-7 cursor-nwse-resize border-2 bg-[#FF8E6B] shadow-[2px_2px_0_rgba(34,27,27,0.35)] active:scale-95"
                                style={{
                                    borderColor: PIXEL_INK,
                                    transform: `scale(${1 / Math.max(0.4, effectiveScale)})`,
                                    transformOrigin: 'center',
                                }}
                                onPointerDown={(e) => handleStickerResizeStart(e, room.id, sticker, baseSize)}
                            >
                                <span className="absolute bottom-1 right-1 h-2.5 w-2.5 border-b-2 border-r-2 border-white" />
                            </button>
                        </>
                    )}
                </div>
            );
        };

        return (
            <div className="w-full h-full overflow-hidden border-4 shadow-[6px_6px_0_rgba(34,27,27,0.28)] bg-[#f7e7b7]" style={{ borderColor: PIXEL_INK }}>
                <div
                    className="relative w-full h-full min-h-[420px] touch-none"
                    onPointerMove={(e) => {
                        handleRoomPointerMove(room.id, e);
                        if (isPlacing) handlePlacementPointerMove(e);
                    }}
                    onPointerUp={handleRoomPointerUp}
                    onPointerCancel={handleRoomPointerUp}
                    onPointerLeave={handleRoomPointerUp}
                    onClick={() => {
                        if (isPlacing) handlePlacementConfirm();
                        else if (editMode) setSelectedStickerId(null);
                    }}
                >
                    {/* Wall */}
                    <div
                        className="absolute left-0 right-0 top-0"
                        style={{ height: `${WALL_H_RATIO * 100}%`, background: wallBg }}
                        onPointerMove={(e) => draggingStickerInfo && handleStickerPointerMove(room.id, 'leftWall', e)}
                        onPointerUp={(e) => { void handleStickerPointerUp(e.nativeEvent); }}
                        onPointerCancel={() => { void handleStickerPointerUp(); }}
                    >
                        <div className="absolute inset-0 opacity-[0.18]" style={{ backgroundImage: 'linear-gradient(90deg, rgba(34,27,27,0.22) 1px, transparent 1px), linear-gradient(0deg, rgba(255,255,255,0.20) 1px, transparent 1px)', backgroundSize: '16px 16px' }} />
                        {!locked && wallStickers.map(renderSticker)}
                    </div>

                    {/* Floor */}
                    <div
                        className="absolute left-0 right-0 bottom-0"
                        style={{ height: `${FLOOR_H_RATIO * 100}%`, background: floorBg, borderTop: `4px solid ${PIXEL_INK}` }}
                        onPointerMove={(e) => draggingStickerInfo && handleStickerPointerMove(room.id, 'floor', e)}
                        onPointerUp={(e) => { void handleStickerPointerUp(e.nativeEvent); }}
                        onPointerCancel={() => { void handleStickerPointerUp(); }}
                    >
                        <div className="absolute inset-0 opacity-[0.18]" style={{ backgroundImage: 'linear-gradient(0deg, rgba(34,27,27,0.32) 2px, transparent 2px),linear-gradient(90deg, rgba(255,255,255,0.15) 2px, transparent 2px)', backgroundSize: '24px 16px' }} />
                        {!locked && floorStickers.map(renderSticker)}
                    </div>

                    {/* 默认咖啡店布景：仅主店铺、且无自定义全屋贴图时显示（纯展示、不写存档） */}
                    {!locked && room.id === MAIN_ROOM_ID && !roomTexture && <PixelCafeBackdrop isOpen={shopState.isBusinessOpen === true} />}

                    {/* 天气色调（仅主店铺，很淡） */}
                    {!locked && room.id === MAIN_ROOM_ID && WEATHER_TINT[getWeatherDef(shopState.weather?.id).id] && (
                        <div className="absolute inset-0 z-[6] pointer-events-none" style={{ background: WEATHER_TINT[getWeatherDef(shopState.weather?.id).id] }} aria-hidden />
                    )}

                    {/* 擦吧台攒 AP：吧台一带的可点区域（演员在其上、装修/摆件不受影响） */}
                    {!locked && room.id === MAIN_ROOM_ID && !roomTexture && onWipeCounter && !editMode && !placingFurniture && (
                        <div className="absolute left-0 right-0 cursor-pointer" style={{ top: '58%', height: '20%', zIndex: 8 }} title="擦擦柜台，恢复一点精力" onClick={(e) => { e.stopPropagation(); void handleWipe(e); }} />
                    )}
                    {wipeFx && room.id === MAIN_ROOM_ID && (
                        <div className="absolute z-[46] pointer-events-none animate-fade-in" style={{ left: `${wipeFx.x}%`, top: `${wipeFx.y}%`, transform: 'translate(-50%,-120%)' }}>
                            <span className="text-[12px] font-black px-2 py-0.5 rounded-full" style={{ background: '#fff6e0', color: '#b9772a', boxShadow: '0 3px 8px rgba(200,150,40,0.35)' }}>{wipeFx.text}</span>
                        </div>
                    )}

                    {/* Room Texture Overlay - uses blob URL for stable rendering */}
                    {!locked && roomTexture && (
                        <div className="absolute inset-0 pointer-events-none z-[5]">
                            <img
                                src={roomTexture}
                                alt=""
                                draggable={false}
                                className="absolute inset-0 w-full h-full object-contain"
                                style={{
                                    transform: `scale(${roomTextureScale})`,
                                    transformOrigin: 'center center',
                                }}
                                onError={(e) => { e.currentTarget.style.display = 'none'; }}
                            />
                        </div>
                    )}

                    {/* Furniture Placement Ghost Preview */}
                    {isPlacing && (
                        <div
                            className="absolute z-[45] pointer-events-none"
                            style={{
                                left: `${furniturePreviewPos.x}%`,
                                top: `${furniturePreviewPos.y}%`,
                                transform: 'translate(-50%, -50%)',
                            }}
                        >
                            <div className="relative animate-pulse">
                                {placingFurniture.isEmoji ? (
                                    <span className="block text-[64px] leading-none opacity-70 drop-shadow-lg">{placingFurniture.url}</span>
                                ) : (
                                    <div className="opacity-70">
                                        {renderDecorAsset(placingFurniture.url, placingFurniture.name, 'w-16 h-16 object-contain drop-shadow-[3px_3px_0_rgba(34,27,27,0.25)]', 'text-[64px] leading-none drop-shadow-lg')}
                                    </div>
                                )}
                                <div className="absolute -bottom-5 left-1/2 -translate-x-1/2 whitespace-nowrap">
                                    <span className="text-[9px] bg-[#FF8E6B] text-white px-2 py-0.5 rounded-full font-bold shadow-sm">
                                        点击放置
                                    </span>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Staff Actors */}
                    {!locked && roomStaff.map(staff => {
                        const pos = actorPositions[staff.id] || clampActorPos(staff.x || 50, staff.y || 72);
                        const staffScale = staff.scale ?? 1;
                        const rolePixel = staff.isPet
                            ? bankPixelRef('staff/cat', 64)
                            : bankPixelRef(staff.role === 'chef' ? 'staff/chef' : staff.role === 'manager' ? 'staff/manager' : 'staff/waiter', 64);
                        const staffPixelSrc = resolveBankPixelSrc(staff.avatar, 64) || (!isBankAssetUrl(staff.avatar) ? resolveBankPixelSrc(rolePixel, 64) : undefined);
                        const customStaffSrc = staffPixelSrc ? undefined : getStableSrc(staff.avatar);
                        return (
                            <div
                                key={staff.id}
                                className={`absolute ${draggingActorId === staff.id ? 'cursor-grabbing' : 'cursor-pointer'} select-none group/staff transition-[left,top] ${draggingActorId === staff.id ? 'duration-0' : 'duration-200'} ease-out`}
                                style={{ left: `${pos.x}%`, top: `${pos.y}%`, transform: 'translate(-50%, -100%)', zIndex: 30 }}
                                onPointerDown={(e) => { e.stopPropagation(); handleActorPressStart(staff.id, room.id, false); }}
                                onPointerUp={async (e) => {
                                    e.stopPropagation();
                                    const hadDrag = await handleRoomPointerUp();
                                    if (suppressNextStaffOpenRef.current) {
                                        suppressNextStaffOpenRef.current = false;
                                        return;
                                    }
                                    if (!hadDrag && !suppressActorClickRef.current) showQuip(staff.id, staffQuip(staff));
                                }}
                            >
                                {quips[staff.id] && (
                                    <div className="absolute left-1/2 bottom-full mb-1 -translate-x-1/2 px-2 py-1 rounded-xl text-[10px] font-bold leading-snug animate-fade-in z-40" style={{ background: '#fffef9', color: '#6b4528', boxShadow: '0 3px 10px rgba(96,66,40,0.25)', border: '1px solid #efdcc4', maxWidth: 150, width: 'max-content' }}>
                                        {quips[staff.id]}
                                        <span className="absolute left-1/2 -translate-x-1/2 -bottom-1 w-2 h-2 rotate-45" style={{ background: '#fffef9', borderRight: '1px solid #efdcc4', borderBottom: '1px solid #efdcc4' }} />
                                    </div>
                                )}
                                {staff.fatigue > 80 && (
                                    <img
                                        src={resolveBankPixelSrc(bankPixelRef('effect/zzz', 64))}
                                        alt=""
                                        className="absolute -top-8 -right-4 w-10 h-10 animate-bounce"
                                        draggable={false}
                                        style={pixelated}
                                    />
                                )}
                                <div className="drop-shadow-[3px_3px_0_rgba(34,27,27,0.28)] origin-bottom" style={{ transform: `scale(${staffScale})` }}>
                                    {staffPixelSrc
                                        ? <img src={staffPixelSrc} className="w-16 h-16 object-contain" draggable={false} style={pixelated} onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                                        : customStaffSrc && isBankAssetUrl(staff.avatar)
                                            ? <img src={customStaffSrc} className="w-16 h-16 object-contain" draggable={false} onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                                            : <img src={resolveBankPixelSrc(bankPixelRef('staff/generic', 64))} className="w-16 h-16 object-contain" draggable={false} style={pixelated} />
                                    }
                                </div>
                                <div className="mt-0.5 px-2 py-0.5 border-2 text-[10px] font-black text-center shadow-[2px_2px_0_rgba(34,27,27,0.2)]" style={{ background: PIXEL_PANEL, borderColor: PIXEL_INK, color: PIXEL_INK }}>{staff.name}</div>
                                {/* Resize controls */}
                                <div className="absolute -right-8 top-0 flex flex-col gap-0.5 opacity-0 group-hover/staff:opacity-100 transition-opacity z-40">
                                    <button
                                        onClick={(e) => { e.stopPropagation(); suppressNextStaffOpenRef.current = true; void handleStaffScaleChange(staff.id, 0.15); }}
                                        onPointerDown={(e) => { e.stopPropagation(); suppressNextStaffOpenRef.current = true; }}
                                        className="w-5 h-5 rounded-full bg-white/90 border border-[#E0CBBA] shadow-sm flex items-center justify-center text-[10px] font-bold text-[#6B4528] active:scale-90 transition-transform"
                                    >+</button>
                                    <button
                                        onClick={(e) => { e.stopPropagation(); suppressNextStaffOpenRef.current = true; void handleStaffScaleChange(staff.id, -0.15); }}
                                        onPointerDown={(e) => { e.stopPropagation(); suppressNextStaffOpenRef.current = true; }}
                                        className="w-5 h-5 rounded-full bg-white/90 border border-[#E0CBBA] shadow-sm flex items-center justify-center text-[10px] font-bold text-[#6B4528] active:scale-90 transition-transform"
                                    >-</button>
                                </div>
                            </div>
                        );
                    })}

                    {/* Ambient Pixel Customers */}
                    {!locked && ambientCustomers.filter(customer => customer.roomId === room.id).map(customer => {
                        const pos = actorPositions[customer.id] || clampActorPos(customer.x, customer.y);
                        const customerSrc = resolveBankPixelSrc(customer.avatar, 64) || resolveBankPixelSrc(bankPixelRef('customer/office-runner', 64));
                        const effectId = customer.mood === 'impatient'
                            ? 'effect/zzz'
                            : customer.mood === 'happy' || customer.mood === 'buying'
                                ? 'effect/heart'
                                : customer.mood === 'photo' || customer.mood === 'curious'
                                    ? 'effect/sparkles'
                                    : '';
                        const effectSrc = effectId ? resolveBankPixelSrc(bankPixelRef(effectId, 64), 64) : undefined;
                        return (
                            <div
                                key={customer.id}
                                className="absolute cursor-pointer select-none group/customer transition-[left,top] duration-300 ease-out"
                                style={{ left: `${pos.x}%`, top: `${pos.y}%`, transform: 'translate(-50%, -100%)', zIndex: 33 }}
                                onPointerUp={(e) => { e.stopPropagation(); showQuip(customer.id, customer.reaction); }}
                            >
                                {quips[customer.id] && (
                                    <div className="absolute left-1/2 bottom-full mb-1 -translate-x-1/2 px-2 py-1 rounded-xl text-[10px] font-bold leading-snug animate-fade-in z-40" style={{ background: '#fffef9', color: '#6b4528', boxShadow: '0 3px 10px rgba(96,66,40,0.25)', border: '1px solid #efdcc4', maxWidth: 160, width: 'max-content' }}>
                                        {quips[customer.id]}
                                        <span className="absolute left-1/2 -translate-x-1/2 -bottom-1 w-2 h-2 rotate-45" style={{ background: '#fffef9', borderRight: '1px solid #efdcc4', borderBottom: '1px solid #efdcc4' }} />
                                    </div>
                                )}
                                {effectSrc && (
                                    <img
                                        src={effectSrc}
                                        alt=""
                                        className="absolute -top-7 -right-4 w-9 h-9 animate-bounce pointer-events-none"
                                        draggable={false}
                                        style={pixelated}
                                    />
                                )}
                                <div className="drop-shadow-[3px_3px_0_rgba(34,27,27,0.24)] origin-bottom" style={{ transform: `scale(${customer.scale})` }}>
                                    {customerSrc && <img src={customerSrc} className="w-14 h-14 object-contain" draggable={false} style={pixelated} onError={(e) => { e.currentTarget.style.display = 'none'; }} />}
                                </div>
                                <div className="mt-0.5 px-2 py-0.5 border-2 text-[10px] font-black text-center shadow-[2px_2px_0_rgba(34,27,27,0.18)] opacity-0 group-hover/customer:opacity-100 transition-opacity" style={{ background: '#fff4c7', borderColor: PIXEL_INK, color: PIXEL_INK }}>{customer.name}</div>
                            </div>
                        );
                    })}

                    {/* Visitor */}
                    {!locked && visitor && shopState.activeVisitor && (() => {
                        const visitorPos = actorPositions[visitor.id] || clampActorPos(shopState.activeVisitor.x ?? 55, shopState.activeVisitor.y ?? 76);
                        return (
                            <div
                                className={`absolute ${draggingActorId === visitor.id ? 'cursor-grabbing' : 'cursor-grab'} select-none group/staff transition-[left,top] ${draggingActorId === visitor.id ? 'duration-0' : 'duration-200'} ease-out`}
                                style={{ left: `${visitorPos.x}%`, top: `${visitorPos.y}%`, transform: 'translate(-50%, -100%)', zIndex: 35 }}
                                onPointerDown={(e) => { e.stopPropagation(); handleActorPressStart(visitor.id, room.id, true); }}
                                onPointerUp={async (e) => { e.stopPropagation(); const moved = await handleRoomPointerUp(); if (!moved && !suppressActorClickRef.current) showQuip(visitor.id, randOf(CUSTOMER_QUIPS)); }}
                            >
                                {quips[visitor.id] && (
                                    <div className="absolute left-1/2 bottom-full mb-1 -translate-x-1/2 px-2 py-1 rounded-xl text-[10px] font-bold leading-snug animate-fade-in z-40" style={{ background: '#fffef9', color: '#6b4528', boxShadow: '0 3px 10px rgba(96,66,40,0.25)', border: '1px solid #efdcc4', maxWidth: 150, width: 'max-content' }}>
                                        {quips[visitor.id]}
                                        <span className="absolute left-1/2 -translate-x-1/2 -bottom-1 w-2 h-2 rotate-45" style={{ background: '#fffef9', borderRight: '1px solid #efdcc4', borderBottom: '1px solid #efdcc4' }} />
                                    </div>
                                )}
                                <div className="drop-shadow-[3px_3px_0_rgba(34,27,27,0.28)] origin-bottom" style={{ transform: `scale(${shopState.activeVisitor?.scale ?? 2.5})` }}>
                                    <img src={visitor.sprites?.chibi || visitor.avatar} className="w-16 h-16 object-contain" draggable={false} style={{ imageRendering: 'pixelated' }} />
                                </div>
                                <div className="mt-0.5 px-2 py-0.5 border-2 text-[10px] font-black text-center shadow-[2px_2px_0_rgba(34,27,27,0.2)]" style={{ background: '#d8f0ff', borderColor: PIXEL_INK, color: PIXEL_INK }}>{visitor.name}</div>
                                <div className="absolute -right-8 top-0 flex flex-col gap-0.5 opacity-0 group-hover/staff:opacity-100 transition-opacity z-40">
                                    <button
                                        onClick={(e) => { e.stopPropagation(); void handleVisitorScaleChange(0.15); }}
                                        onPointerDown={(e) => e.stopPropagation()}
                                        className="w-5 h-5 rounded-full bg-white/90 border border-[#E0CBBA] shadow-sm flex items-center justify-center text-[10px] font-bold text-[#6B4528] active:scale-90 transition-transform"
                                    >+</button>
                                    <button
                                        onClick={(e) => { e.stopPropagation(); void handleVisitorScaleChange(-0.15); }}
                                        onPointerDown={(e) => e.stopPropagation()}
                                        className="w-5 h-5 rounded-full bg-white/90 border border-[#E0CBBA] shadow-sm flex items-center justify-center text-[10px] font-bold text-[#6B4528] active:scale-90 transition-transform"
                                    >-</button>
                                </div>
                            </div>
                        );
                    })()}

                    {/* Lock Overlay */}
                    {locked && (
                        <button
                            onClick={() => setShowUnlockConfirm(room.id)}
                            className="absolute inset-0 z-40 bg-black/20 backdrop-blur-[2px] flex items-center justify-center"
                        >
                            <div className="bg-white/90 backdrop-blur-sm px-5 py-4 rounded-2xl shadow-lg text-center">
                                <div className="text-2xl mb-1">🔒</div>
                                <div className="text-sm font-bold text-[#8A5A3D]">{shopEnergyText(ROOM_UNLOCK_COSTS[room.id] || 150)}</div>
                            </div>
                        </button>
                    )}
                </div>
            </div>
        );
    };

    const builtinFurniture = STICKER_LIBRARY.map(s => ({ id: s.id, name: s.name, url: s.url, category: s.category }));
    const furnitureCategories = [
        { id: 'all', label: '全部' },
        { id: 'furniture', label: '家具' },
        { id: 'daily', label: '日常' },
        { id: 'decor', label: '装饰' },
        { id: 'decor-set', label: '套装' },
        { id: 'wall', label: '挂饰' },
        { id: 'floor', label: '地面' },
        { id: 'food', label: '美食' },
        { id: 'pet', label: '宠物' },
    ];
    const [furnitureFilter, setFurnitureFilter] = useState('all');

    const filteredFurniture = furnitureFilter === 'all'
        ? builtinFurniture
        : builtinFurniture.filter(f =>
            furnitureFilter === 'decor'
                ? f.category === 'decor' || f.category === 'decor-set'
                : f.category === furnitureFilter
        );

    const displayScaleValue = localRoomScale ?? (activeRoom.roomTextureScale ?? 1);

    return (
        <div className="relative w-full h-full pt-2 pb-3 flex flex-col" style={{
            background: '#d7e7d0',
            backgroundImage: 'linear-gradient(90deg, rgba(34,27,27,0.10) 1px, transparent 1px), linear-gradient(0deg, rgba(255,255,255,0.18) 1px, transparent 1px)',
            backgroundSize: '12px 12px',
        }}>
            {/* Room Navigation Header */}
            <div className="flex items-center justify-between px-2 mb-2">
                {renderArrowButton('left', goPrevRoom)}
                <div className="text-center flex-1 mx-2">
                    <div className="text-[10px] font-black tracking-wider uppercase" style={{ color: '#37564d' }}>ROOM</div>
                    <div className="text-base font-black tracking-wide" style={{ color: PIXEL_INK }}>{activeRoom.name}</div>
                    <div className="flex justify-center gap-1 mt-1">
                        {orderedRooms.map((r, i) => (
                            <div key={r.id} className={`h-2 transition-all ${i === activeRoomIndex ? 'w-5' : 'w-2'}`} style={{ background: i === activeRoomIndex ? '#e45d6f' : '#fff3c7', border: `1px solid ${PIXEL_INK}` }} />
                        ))}
                    </div>
                </div>
                {renderArrowButton('right', goNextRoom)}
            </div>

            {/* Action Buttons */}
            <div className="absolute right-2.5 top-[76px] z-[40] flex flex-col gap-2">
                <button
                    onClick={() => { setShowDecorPanel(true); setDecorTab('furniture'); }}
                    className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#FF9A75] to-[#FF6B55] text-white text-base shadow-[0_3px_12px_rgba(255,107,85,0.35)] flex items-center justify-center active:scale-90 transition-transform"
                    aria-label="装修"
                >
                    <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M11.42 15.17 17.25 21A2.652 2.652 0 0 0 21 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 1 1-3.586-3.586l6.837-5.63m5.108-.233c.55-.164 1.163-.188 1.743-.14a4.5 4.5 0 0 0 4.486-6.336l-3.276 3.277a3.004 3.004 0 0 1-2.25-2.25l3.276-3.276a4.5 4.5 0 0 0-6.336 4.486c.049.58.025 1.193-.14 1.743" />
                    </svg>
                </button>
                {/* Edit Mode Toggle */}
                <button
                    onClick={() => setEditMode(prev => !prev)}
                    className={`w-10 h-10 rounded-xl border text-base shadow-sm flex items-center justify-center active:scale-90 transition-all ${
                        editMode
                            ? 'bg-gradient-to-br from-[#4CAF50] to-[#388E3C] text-white border-[#388E3C] shadow-[0_3px_12px_rgba(76,175,80,0.35)]'
                            : 'bg-white/90 border-[#E8D5C4] text-[#7A5238]'
                    }`}
                    aria-label="装修模式"
                >
                    <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                    </svg>
                </button>
                <button
                    onClick={onOpenGuestbook}
                    className="w-10 h-10 rounded-xl bg-white/90 border border-[#E8D5C4] text-[#7A5238] shadow-sm flex items-center justify-center active:scale-90 transition-transform"
                    aria-label="打开店里来信"
                >
                    <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25" />
                    </svg>
                </button>
            </div>

            {/* Edit Mode Banner */}
            {editMode && (
                <div className="mx-2 mb-1 px-3 py-1.5 rounded-xl bg-[#E8F5E9] border border-[#A5D6A7] flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-[#4CAF50] animate-pulse" />
                    <span className="text-[10px] font-bold text-[#2E7D32]">装修模式</span>
                    <span className="text-[10px] text-[#4CAF50]">自由移位 / 手柄缩放 / 拖到垃圾桶删除</span>
                </div>
            )}

            {/* Room View */}
            <div className="flex-1 min-h-0 px-1">
                {renderRoom(activeRoom)}
            </div>

            {/* Trash Zone - visible when dragging a sticker in edit mode */}
            {editMode && draggingStickerInfo && (
                <div
                    ref={trashRef}
                    onPointerEnter={() => setOverTrash(true)}
                    onPointerLeave={() => setOverTrash(false)}
                    onPointerUp={(e) => { void handleStickerPointerUp(e.nativeEvent); }}
                    className={`absolute bottom-3 left-1/2 -translate-x-1/2 z-[60] flex items-center gap-2 px-6 py-3 rounded-2xl border-2 border-dashed transition-all ${
                        overTrash
                            ? 'bg-[#FFEBEE] border-[#EF5350] scale-110'
                            : 'bg-white/95 border-[#E0CBBA] scale-100'
                    }`}
                >
                    <svg viewBox="0 0 24 24" className={`w-6 h-6 transition-colors ${overTrash ? 'text-[#EF5350]' : 'text-[#B8956E]'}`} fill="none" stroke="currentColor" strokeWidth="2">
                        <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                    </svg>
                    <span className={`text-xs font-bold transition-colors ${overTrash ? 'text-[#EF5350]' : 'text-[#B8956E]'}`}>
                        {overTrash ? '松手删除' : '拖到这里删除'}
                    </span>
                </div>
            )}

            {/* Placement Mode Bar */}
            {placingFurniture && (
                <div className="absolute bottom-0 left-0 right-0 z-[50] bg-gradient-to-t from-[#FFF5EB] via-[#FFF5EB] to-transparent pt-6 pb-4 px-4">
                    <div className="bg-white rounded-2xl shadow-lg border border-[#F2D5BE] p-3 flex items-center gap-3">
                        <div className="w-16 h-16 bg-[#fff3c7] border-4 flex items-center justify-center flex-shrink-0" style={{ borderColor: PIXEL_INK }}>
                            {placingFurniture.isEmoji ? placingFurniture.url : (
                                renderDecorAsset(placingFurniture.url, placingFurniture.name, 'w-16 h-16 object-contain', 'text-[64px] leading-none')
                            )}
                        </div>
                        <div className="flex-1 min-w-0">
                            <div className="text-xs font-bold text-[#6B4528]">{placingFurniture.name}</div>
                            <div className="text-[10px] text-[#B8956E]">在房间内点击或拖动选择位置</div>
                        </div>
                        <button
                            onClick={() => setPlacingFurniture(null)}
                            className="px-3 py-1.5 rounded-lg bg-[#F5E6DA] text-[#8A5A3D] text-xs font-bold flex-shrink-0"
                        >
                            取消
                        </button>
                    </div>
                </div>
            )}

            {/* Decor Panel */}
            {showDecorPanel && (
                <div className="absolute inset-0 z-[80] bg-black/30 flex items-end" onClick={() => setShowDecorPanel(false)}>
                    <div
                        className="w-full rounded-t-3xl bg-gradient-to-b from-white to-[#FFFCF7] max-h-[65vh] overflow-hidden flex flex-col"
                        onClick={(e) => e.stopPropagation()}
                        style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
                    >
                        {/* Panel Header */}
                        <div className="flex items-center justify-between px-4 pt-4 pb-2">
                            <div className="flex items-center gap-2">
                                <div className="w-1 h-5 rounded-full bg-gradient-to-b from-[#FF8E6B] to-[#FF6B55]" />
                                <span className="text-sm font-black text-[#6B4528]">装修面板</span>
                            </div>
                            <button
                                onClick={() => setShowDecorPanel(false)}
                                className="w-8 h-8 rounded-full bg-[#F5EDE0] text-[#8A5A3D] flex items-center justify-center active:scale-90 transition-transform"
                            >
                                <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.5">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                                </svg>
                            </button>
                        </div>

                        {/* Tabs - Scrollable pill style */}
                        <div className="px-3 pb-2">
                            <div className="flex gap-1.5 overflow-x-auto no-scrollbar">
                                {DECOR_TABS.map(tab => (
                                    <button
                                        key={tab.id}
                                        onClick={() => setDecorTab(tab.id)}
                                        className={`flex items-center gap-1 px-3 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-all flex-shrink-0 ${
                                            decorTab === tab.id
                                                ? 'bg-gradient-to-r from-[#6B4528] to-[#8B5E43] text-white shadow-sm'
                                                : 'bg-[#F5EDE0] text-[#8A5A3D] hover:bg-[#EDE1D2]'
                                        }`}
                                    >
                                        <span className="text-sm">{(() => { const Icon = DECOR_TAB_ICONS[tab.id]; return <Icon size={14} weight="bold" />; })()}</span>
                                        {tab.label}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Tab Content */}
                        <div className="flex-1 overflow-y-auto px-4 pb-3">
                            {decorTab === 'layout' && (
                                <div className="space-y-2">
                                    {ROOM_LAYOUTS.map(layout => {
                                        const isActive = activeRoom.layoutId === layout.id;
                                        return (
                                            <button
                                                key={layout.id}
                                                onClick={() => handleChangeLayout(activeRoom.id, layout.id)}
                                                className={`w-full p-3 rounded-2xl border flex items-center gap-3 text-left transition-all ${
                                                    isActive
                                                        ? 'border-[#FF8E6B] bg-[#FFF5EE] shadow-sm'
                                                        : 'border-[#F0E3D6] bg-white hover:border-[#E0CBBA]'
                                                }`}
                                            >
                                                <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-xl ${isActive ? 'bg-[#FF8E6B]/10' : 'bg-[#F8F0E6]'}`}>
                                                    <BankAssetIcon
                                                        value={layout.icon}
                                                        alt={layout.name}
                                                        imgClassName="w-6 h-6 object-contain"
                                                        textClassName="text-xl leading-none"
                                                    />
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <div className="text-xs font-bold text-[#6B4528]">{layout.name}</div>
                                                    <div className="text-[10px] text-[#B8956E] mt-0.5">{layout.description}</div>
                                                </div>
                                                <div className={`text-[10px] font-bold px-2 py-1 rounded-lg ${
                                                    isActive ? 'bg-[#FF8E6B] text-white' : 'bg-[#FFF4E8] text-[#C4956A]'
                                                }`}>
                                                    {isActive ? '当前' : '总部 8'}
                                                </div>
                                            </button>
                                        );
                                    })}
                                </div>
                            )}

                            {decorTab === 'rename' && (
                                <div className="flex flex-col items-center py-6">
                                    <div className="text-3xl mb-3">✏️</div>
                                    <div className="text-xs text-[#B8956E] mb-4 text-center">为「{activeRoom.name}」取一个新名字</div>
                                    <button
                                        onClick={() => handleRenameRoom(activeRoom)}
                                        className="px-6 py-3 rounded-2xl bg-gradient-to-r from-[#FF8E6B] to-[#FF7D5A] text-white text-sm font-bold shadow-md active:scale-95 transition-transform"
                                    >
                                        重命名房间
                                    </button>
                                </div>
                            )}

                            {decorTab === 'wallpaper' && (
                                <div className="space-y-3">
                                    <button
                                        onClick={() => openTextureModal('wallpaper')}
                                        className="w-full py-2.5 rounded-2xl bg-white border-2 border-dashed border-[#E0CBBA] text-[#8A5A3D] text-xs font-bold flex items-center justify-center gap-2 hover:border-[#FF8E6B] hover:text-[#FF8E6B] transition-colors"
                                    >
                                        <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2">
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
                                        </svg>
                                        上传自定义墙纸
                                    </button>
                                    <div className="grid grid-cols-2 gap-2">
                                        {WALLPAPER_PRESETS.map(wp => (
                                            <button
                                                key={wp.id}
                                                onClick={() => handleSetWallpaper(activeRoom.id, wp.style)}
                                                className="rounded-2xl border border-[#F0E3D6] p-2.5 text-left hover:border-[#FF8E6B] transition-colors bg-white group"
                                            >
                                                <div className="h-12 rounded-xl mb-1.5 border border-[#F0E3D6]/50" style={{ background: wp.style }} />
                                                <div className="text-[11px] font-bold text-[#6B4528] group-hover:text-[#FF8E6B] transition-colors">{wp.name}</div>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {decorTab === 'floor' && (
                                <div className="space-y-3">
                                    <button
                                        onClick={() => openTextureModal('floor')}
                                        className="w-full py-2.5 rounded-2xl bg-white border-2 border-dashed border-[#E0CBBA] text-[#8A5A3D] text-xs font-bold flex items-center justify-center gap-2 hover:border-[#FF8E6B] hover:text-[#FF8E6B] transition-colors"
                                    >
                                        <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2">
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
                                        </svg>
                                        上传自定义地板
                                    </button>
                                    <div className="grid grid-cols-2 gap-2">
                                        {FLOOR_PRESETS.map(fl => (
                                            <button
                                                key={fl.id}
                                                onClick={() => handleSetFloor(activeRoom.id, fl.style)}
                                                className="rounded-2xl border border-[#F0E3D6] p-2.5 text-left hover:border-[#FF8E6B] transition-colors bg-white group"
                                            >
                                                <div className="h-12 rounded-xl mb-1.5 border border-[#F0E3D6]/50" style={{ background: fl.style }} />
                                                <div className="text-[11px] font-bold text-[#6B4528] group-hover:text-[#FF8E6B] transition-colors">{fl.name}</div>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {decorTab === 'roomTexture' && (
                                <div className="space-y-3">
                                    <button
                                        onClick={() => openTextureModal('room')}
                                        className="w-full py-3 rounded-2xl bg-gradient-to-r from-[#FF8E6B] to-[#FF6B55] text-white text-xs font-bold shadow-[0_3px_12px_rgba(255,107,85,0.3)] flex items-center justify-center gap-2 active:scale-[0.98] transition-transform"
                                    >
                                        <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2">
                                            <path strokeLinecap="round" strokeLinejoin="round" d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0 0 22.5 18.75V5.25A2.25 2.25 0 0 0 20.25 3H3.75A2.25 2.25 0 0 0 1.5 5.25v13.5A2.25 2.25 0 0 0 3.75 21Z" />
                                        </svg>
                                        上传背景图
                                    </button>

                                    {activeRoom.roomTextureUrl ? (
                                        <div className="bg-white rounded-2xl p-3.5 border border-[#F0E3D6] space-y-3">
                                            <div className="flex items-center justify-between">
                                                <div className="flex items-center gap-2">
                                                    <div className="w-2 h-2 rounded-full bg-[#4CAF50]" />
                                                    <span className="text-[11px] text-[#6B4528] font-bold">当前背景</span>
                                                </div>
                                                <button
                                                    onClick={async () => {
                                                        await saveDollhouse(prev => ({ ...prev, rooms: prev.rooms.map(r => r.id === activeRoom.id ? { ...r, roomTextureUrl: undefined, roomTextureScale: 1 } : r) }));
                                                        addToast('已清除背景图', 'success');
                                                    }}
                                                    className="text-[10px] text-[#E53935] font-bold px-2 py-1 rounded-lg hover:bg-[#FFEBEE] transition-colors"
                                                >
                                                    清除
                                                </button>
                                            </div>

                                            {/* Preview */}
                                            <div className="rounded-xl overflow-hidden border border-[#E8DAC6] shadow-inner" style={{ aspectRatio: '16/10' }}>
                                                <div className="relative w-full h-full" style={{ background: toCssBackground(activeRoom.wallpaperLeft, PIXEL_WALL_BG) }}>
                                                    <div className="absolute left-0 right-0 bottom-0" style={{ height: `${FLOOR_H_RATIO * 100}%`, background: toCssBackground(activeRoom.floorStyle, PIXEL_FLOOR_BG) }} />
                                                    <img
                                                        src={resolveTextureUrl(activeRoom.roomTextureUrl) || ''}
                                                        alt="texture"
                                                        className="absolute inset-0 w-full h-full object-contain"
                                                        style={{ transform: `scale(${displayScaleValue})`, transformOrigin: 'center center' }}
                                                    />
                                                </div>
                                            </div>

                                            {/* Scale Slider - FIXED: debounced to prevent flickering */}
                                            <div className="bg-[#FDF8F2] rounded-xl p-3 border border-[#F5EDE0]">
                                                <div className="flex items-center justify-between mb-2">
                                                    <div className="text-[11px] text-[#8A5A3D] font-bold flex items-center gap-1.5">
                                                        <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                                                            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607ZM10.5 7.5v6m3-3h-6" />
                                                        </svg>
                                                        缩放
                                                    </div>
                                                    <div className="text-[11px] text-[#B8956E] font-mono bg-white px-2 py-0.5 rounded-md border border-[#F0E3D6]">
                                                        {displayScaleValue.toFixed(2)}x
                                                    </div>
                                                </div>
                                                <input
                                                    type="range" min={0.5} max={2.5} step={0.05}
                                                    value={displayScaleValue}
                                                    onChange={(e) => handleScaleSliderChange(parseFloat(e.target.value))}
                                                    onPointerUp={() => handleScaleSliderCommit()}
                                                    onTouchEnd={() => handleScaleSliderCommit()}
                                                    className="w-full accent-[#FF8E6B] h-2"
                                                />
                                                <div className="flex justify-between text-[9px] text-[#C4A882] mt-1">
                                                    <span>0.5x</span>
                                                    <span>1.0x</span>
                                                    <span>1.5x</span>
                                                    <span>2.0x</span>
                                                    <span>2.5x</span>
                                                </div>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="text-center py-8 bg-white rounded-2xl border border-[#F0E3D6]">
                                            <div className="text-3xl mb-2 opacity-30">🖼️</div>
                                            <div className="text-xs text-[#B8956E]">还没有背景图</div>
                                            <div className="text-[10px] text-[#D4B99A] mt-1">点击上方按钮上传图片</div>
                                        </div>
                                    )}
                                </div>
                            )}

                            {decorTab === 'furniture' && (
                                <div className="space-y-3">
                                    {/* Add custom furniture button */}
                                    <button
                                        onClick={() => setShowAssetModal(true)}
                                        className="w-full py-2.5 rounded-2xl bg-white border-2 border-dashed border-[#E0CBBA] text-[#8A5A3D] text-xs font-bold flex items-center justify-center gap-2 hover:border-[#FF8E6B] hover:text-[#FF8E6B] transition-colors"
                                    >
                                        <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2">
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                                        </svg>
                                        上传自定义家具
                                    </button>

                                    {/* Category filter pills */}
                                    <div className="flex gap-1.5 overflow-x-auto no-scrollbar">
                                        {furnitureCategories.map(cat => (
                                            <button
                                                key={cat.id}
                                                onClick={() => setFurnitureFilter(cat.id)}
                                                className={`px-3 py-1.5 rounded-full text-[10px] font-bold whitespace-nowrap transition-all flex-shrink-0 ${
                                                    furnitureFilter === cat.id
                                                        ? 'bg-[#6B4528] text-white'
                                                        : 'bg-[#F5EDE0] text-[#8A5A3D]'
                                                }`}
                                            >
                                                {cat.label}
                                            </button>
                                        ))}
                                    </div>

                                    {/* Furniture Grid - Improved: larger items with names */}
                                    <div className="grid grid-cols-3 gap-2">
                                        {filteredFurniture.map(sticker => (
                                            <button
                                                key={sticker.id}
                                                onClick={() => startPlacingFurniture(
                                                    sticker.url,
                                                    decorPixelMeta(sticker.url)?.surface || (sticker.category === 'wall' ? 'leftWall' : 'floor'),
                                                    sticker.name
                                                )}
                                                className="flex flex-col items-center gap-1 p-2 bg-white border-2 hover:shadow-[3px_3px_0_rgba(34,27,27,0.22)] transition-all active:scale-95 group"
                                                style={{ borderColor: PIXEL_INK }}
                                            >
                                                <div className="w-16 h-16 flex items-center justify-center overflow-hidden">
                                                    {renderDecorAsset(
                                                        sticker.url,
                                                        sticker.name,
                                                        'w-16 h-16 object-contain group-hover:scale-110 transition-transform',
                                                        'text-[64px] leading-none group-hover:scale-110 transition-transform',
                                                        decorPixelMeta(sticker.url)?.defaultSize,
                                                    )}
                                                </div>
                                                <span className="text-[10px] font-black leading-tight text-center min-h-[22px] flex items-center" style={{ color: PIXEL_INK }}>{sticker.name}</span>
                                            </button>
                                        ))}

                                        {/* Custom Assets */}
                                        {(furnitureFilter === 'all' || furnitureFilter === 'furniture') && customAssets.map(asset => (
                                            <div key={asset.id} className="relative group">
                                                <button
                                                    onClick={() => startPlacingFurniture(asset.url, 'floor', asset.name)}
                                                    className="w-full flex flex-col items-center gap-1 p-2 bg-white border-2 hover:shadow-[3px_3px_0_rgba(34,27,27,0.22)] transition-all active:scale-95"
                                                    style={{ borderColor: PIXEL_INK }}
                                                >
                                                    <div className="w-16 h-16 flex items-center justify-center">
                                                        <img src={asset.url} className="max-w-full max-h-full object-contain" alt={asset.name} />
                                                    </div>
                                                    <span className="text-[10px] font-black truncate w-full text-center" style={{ color: PIXEL_INK }}>{asset.name}</span>
                                                </button>
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); handleDeleteCustomAsset(asset.id); }}
                                                    className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-[#FF5252] text-white text-[10px] font-bold flex items-center justify-center shadow-sm opacity-0 group-hover:opacity-100 transition-opacity"
                                                >
                                                    ×
                                                </button>
                                            </div>
                                        ))}
                                    </div>

                                    <div className="flex items-start gap-2 bg-[#FFF8F0] rounded-xl p-2.5 border border-[#F5EDE0]">
                                        <svg viewBox="0 0 24 24" className="w-4 h-4 text-[#C4956A] flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" strokeWidth="2">
                                            <path strokeLinecap="round" strokeLinejoin="round" d="m11.25 11.25.041-.02a.75.75 0 0 1 1.063.852l-.708 2.836a.75.75 0 0 0 1.063.853l.041-.021M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-3.75h.008v.008H12V8.25Z" />
                                        </svg>
                                        <div className="text-[10px] text-[#A67E62] leading-relaxed">
                                            点击家具即可进入摆放模式，在房间内选择位置。开启右侧「装修模式」后，已放家具可直接拖动、拉右下角手柄缩放，或拖入垃圾桶删除。
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* Custom Asset Modal - Improved */}
            {showAssetModal && (
                <div className="absolute inset-0 z-[90] bg-black/30 flex items-center justify-center p-4" onClick={() => setShowAssetModal(false)}>
                    <div className="w-full max-w-sm bg-white rounded-3xl overflow-hidden shadow-xl" onClick={e => e.stopPropagation()}>
                        <div className="bg-gradient-to-r from-[#FF8E6B] to-[#FF6B55] px-5 py-4">
                            <div className="text-white font-bold text-sm">添加自定义家具</div>
                            <div className="text-white/70 text-[10px] mt-0.5">支持图床URL或本地上传</div>
                        </div>
                        <div className="p-4 space-y-3">
                            {/* Preview */}
                            <div className="w-full h-24 rounded-xl bg-[#F8F0E6] border border-[#F0E3D6] flex items-center justify-center overflow-hidden">
                                {(assetUploadedData || assetUrl) ? (
                                    <img src={assetUploadedData || assetUrl} alt="preview" className="max-w-full max-h-full object-contain" />
                                ) : (
                                    <div className="text-center">
                                        <div className="text-2xl opacity-20">🪑</div>
                                        <div className="text-[10px] text-[#C4A882] mt-1">上传图片后预览</div>
                                    </div>
                                )}
                            </div>

                            <div>
                                <label className="text-[10px] text-[#8A5A3D] font-bold mb-1 block">家具名称</label>
                                <input
                                    value={assetName}
                                    onChange={(e) => setAssetName(e.target.value)}
                                    placeholder="例如：可爱沙发"
                                    className="w-full px-3 py-2.5 rounded-xl border border-[#E9D0BD] text-sm bg-[#FDFAF5] focus:outline-none focus:border-[#FF8E6B] focus:ring-1 focus:ring-[#FF8E6B]/20 transition-all"
                                />
                            </div>
                            <div>
                                <label className="text-[10px] text-[#8A5A3D] font-bold mb-1 block">图片地址</label>
                                <input
                                    value={assetUrl}
                                    onChange={(e) => setAssetUrl(e.target.value)}
                                    placeholder="粘贴图床URL 或点击下方上传"
                                    className="w-full px-3 py-2.5 rounded-xl border border-[#E9D0BD] text-sm bg-[#FDFAF5] focus:outline-none focus:border-[#FF8E6B] focus:ring-1 focus:ring-[#FF8E6B]/20 transition-all"
                                />
                            </div>
                            <div className="flex gap-2 pt-1">
                                <button
                                    onClick={() => fileInputRef.current?.click()}
                                    className="flex-1 py-2.5 rounded-xl bg-[#F5EDE0] text-[#6B4528] text-xs font-bold flex items-center justify-center gap-1.5 active:scale-95 transition-transform"
                                >
                                    <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
                                    </svg>
                                    本地上传
                                </button>
                                <button
                                    onClick={handleAddCustomAsset}
                                    className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-[#FF8E6B] to-[#FF6B55] text-white text-xs font-bold shadow-sm active:scale-95 transition-transform"
                                >
                                    保存家具
                                </button>
                            </div>
                            <input ref={fileInputRef} type="file" accept="image/*" onChange={handleUploadCustomAsset} className="hidden" />
                        </div>
                    </div>
                </div>
            )}

            {/* Texture Upload Modal - Improved */}
            {showTextureModal && (
                <div className="absolute inset-0 z-[95] bg-black/30 flex items-center justify-center p-3" onClick={() => setShowTextureModal(false)}>
                    <div className="w-full max-w-sm max-h-[88vh] bg-white rounded-3xl overflow-hidden shadow-xl flex flex-col" onClick={e => e.stopPropagation()}>
                        {/* Header */}
                        <div className="bg-gradient-to-r from-[#FF8E6B] to-[#FF6B55] px-5 py-4 flex items-center justify-between flex-shrink-0">
                            <div>
                                <div className="text-white font-bold text-sm">
                                    {textureTarget === 'room' ? '背景图' : textureTarget === 'wallpaper' ? '自定义墙纸' : '自定义地板'}
                                </div>
                                <div className="text-white/70 text-[10px] mt-0.5">
                                    {textureTarget === 'room' ? '覆盖在整个房间上方的图层' : '替换当前墙面/地板样式'}
                                </div>
                            </div>
                            <button
                                onClick={() => setShowTextureModal(false)}
                                className="w-7 h-7 rounded-full bg-white/20 text-white flex items-center justify-center"
                            >
                                <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.5">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                                </svg>
                            </button>
                        </div>

                        <div className="flex-1 overflow-y-auto p-4 space-y-3">
                            {/* Live Preview */}
                            {textureTarget === 'room' && (
                                <div className="overflow-hidden border-4 shadow-inner" style={{ aspectRatio: '16/10', borderColor: PIXEL_INK }}>
                                    <div className="relative w-full h-full" style={{ background: toCssBackground(activeRoom.wallpaperLeft, PIXEL_WALL_BG) }}>
                                        <div className="absolute left-0 right-0 bottom-0" style={{ height: `${FLOOR_H_RATIO * 100}%`, background: toCssBackground(activeRoom.floorStyle, PIXEL_FLOOR_BG) }} />
                                        {textureUrl && (
                                            <img
                                                src={textureUrl}
                                                alt="preview"
                                                draggable={false}
                                                className="absolute inset-0 w-full h-full object-contain transition-transform duration-200"
                                                style={{ transform: `scale(${textureScale})`, transformOrigin: 'center center' }}
                                            />
                                        )}
                                        {!textureUrl && (
                                            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
                                                <svg viewBox="0 0 24 24" className="w-8 h-8 text-[#D4C0A8]" fill="none" stroke="currentColor" strokeWidth="1.5">
                                                    <path strokeLinecap="round" strokeLinejoin="round" d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0 0 22.5 18.75V5.25A2.25 2.25 0 0 0 20.25 3H3.75A2.25 2.25 0 0 0 1.5 5.25v13.5A2.25 2.25 0 0 0 3.75 21Z" />
                                                </svg>
                                                <span className="text-[11px] text-[#B8956E] font-medium">上传图片后实时预览</span>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}

                            {textureTarget !== 'room' && (
                                <div className="h-20 rounded-2xl overflow-hidden border border-[#E8DAC6]">
                                    {textureUrl ? (
                                        <div className="w-full h-full" style={{ background: toCssBackground(textureUrl) }} />
                                    ) : (
                                        <div className="w-full h-full bg-[#F8F0E6] flex items-center justify-center">
                                            <span className="text-[11px] text-[#B8956E]">上传后预览</span>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* URL Input */}
                            <div>
                                <label className="text-[10px] text-[#8A5A3D] font-bold mb-1 block">图片地址</label>
                                <input
                                    value={textureUrl}
                                    onChange={(e) => { textureFullRef.current = ''; setTextureUrl(e.target.value); }}
                                    placeholder="粘贴图床URL 或点击下方上传"
                                    className="w-full px-3 py-2.5 rounded-xl border border-[#E9D0BD] text-sm bg-[#FDFAF5] focus:outline-none focus:border-[#FF8E6B] focus:ring-1 focus:ring-[#FF8E6B]/20 transition-all"
                                />
                            </div>

                            {/* Scale Control - only for room texture */}
                            {textureTarget === 'room' && (
                                <div className="bg-[#FDF8F2] rounded-xl p-3 border border-[#F5EDE0]">
                                    <div className="flex items-center justify-between mb-2">
                                        <div className="text-[11px] text-[#8A5A3D] font-bold flex items-center gap-1.5">
                                            <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                                                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607ZM10.5 7.5v6m3-3h-6" />
                                            </svg>
                                            缩放比例
                                        </div>
                                        <div className="text-[11px] text-[#B8956E] font-mono bg-white px-2 py-0.5 rounded-md border border-[#F0E3D6]">
                                            {textureScale.toFixed(2)}x
                                        </div>
                                    </div>
                                    <input
                                        type="range" min={0.5} max={2.5} step={0.05}
                                        value={textureScale}
                                        onChange={(e) => setTextureScale(parseFloat(e.target.value))}
                                        className="w-full accent-[#FF8E6B] h-2"
                                    />
                                    <div className="flex justify-between text-[9px] text-[#C4A882] mt-1">
                                        <span>0.5x</span>
                                        <span>1.0x</span>
                                        <span>1.5x</span>
                                        <span>2.0x</span>
                                        <span>2.5x</span>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Footer Actions */}
                        <div className="flex gap-2 p-4 border-t border-[#F5EDE0] flex-shrink-0">
                            <button
                                onClick={() => textureInputRef.current?.click()}
                                className="flex-1 py-2.5 rounded-xl bg-[#F5EDE0] text-[#6B4528] text-xs font-bold flex items-center justify-center gap-1.5 active:scale-95 transition-transform"
                            >
                                <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
                                </svg>
                                本地上传
                            </button>
                            <button
                                onClick={handleSaveCustomTexture}
                                className={`flex-1 py-2.5 rounded-xl text-xs font-bold shadow-sm active:scale-95 transition-all ${
                                    textureUrl.trim()
                                        ? 'bg-gradient-to-r from-[#FF8E6B] to-[#FF6B55] text-white'
                                        : 'bg-[#E0D4C6] text-[#A89580] cursor-not-allowed'
                                }`}
                                disabled={!textureUrl.trim()}
                            >
                                确认保存
                            </button>
                        </div>
                        <input ref={textureInputRef} type="file" accept="image/*" onChange={handleTextureUpload} className="hidden" />
                    </div>
                </div>
            )}

            {/* Unlock Confirm Modal */}
            {showUnlockConfirm && (() => {
                const room = dh.rooms.find(r => r.id === showUnlockConfirm);
                const cost = ROOM_UNLOCK_COSTS[showUnlockConfirm] || 150;
                return (
                    <div className="absolute inset-0 z-[70] bg-black/30 flex items-center justify-center p-4" onClick={() => setShowUnlockConfirm(null)}>
                        <div className="w-full max-w-xs bg-white rounded-3xl p-5 shadow-xl" onClick={e => e.stopPropagation()}>
                            <div className="text-center mb-4">
                                <div className="text-3xl mb-2">🔓</div>
                                <div className="text-sm font-bold text-[#6B4528]">解锁「{room?.name || '房间'}」</div>
                                <div className="text-xs text-[#B8956E] mt-1">需要{shopEnergyText(cost)}</div>
                            </div>
                            <div className="flex gap-2">
                                <button
                                    className="flex-1 py-2.5 rounded-xl bg-[#F5EDE0] text-[#8A5A3D] text-xs font-bold active:scale-95 transition-transform"
                                    onClick={() => setShowUnlockConfirm(null)}
                                >
                                    取消
                                </button>
                                <button
                                    className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-[#FF8E6B] to-[#FF6B55] text-white text-xs font-bold shadow-sm active:scale-95 transition-transform"
                                    onClick={() => handleUnlockRoom(showUnlockConfirm)}
                                >
                                    解锁
                                </button>
                            </div>
                        </div>
                    </div>
                );
            })()}

            {/* Rename Room Modal */}
            {renameTarget && (
                <div className="absolute inset-0 z-[100] bg-black/40 flex items-center justify-center px-6">
                    <div className="w-full max-w-sm bg-white rounded-3xl p-5 shadow-2xl">
                        <div className="text-sm font-bold text-slate-700 mb-3">重命名房间</div>
                        <input
                            type="text"
                            value={renameValue}
                            onChange={e => setRenameValue(e.target.value)}
                            maxLength={10}
                            autoFocus
                            onKeyDown={e => { if (e.key === 'Enter') confirmRenameRoom(); if (e.key === 'Escape') setRenameTarget(null); }}
                            className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-primary/30 mb-4"
                            placeholder="最多10字"
                        />
                        <div className="flex gap-3">
                            <button onClick={() => setRenameTarget(null)} className="flex-1 py-2.5 rounded-2xl bg-slate-100 text-slate-600 font-bold text-sm">取消</button>
                            <button onClick={confirmRenameRoom} className="flex-1 py-2.5 rounded-2xl bg-primary text-white font-bold text-sm shadow-lg">确认</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default BankDollhouse;
