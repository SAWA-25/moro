import React from 'react';
import { AppConfig, AppID } from './types';
import {
  UserCircle,
  IdentificationCard,
  ChatTeardrop,
  UsersThree,
  Images,
  PaintBrush,
  Palette,
  Heart,
  BookOpenText,
  SealCheck,
  House,
  DeviceMobileCamera,
  Books,
  GameController,
  NewspaperClipping,
  PenNib,
  PiggyBank,
  Compass,
  Camera,
  Sparkle,
  GlobeSimple,
  MusicNotes,
  PhoneCall,
  Phone,
  EnvelopeSimpleOpen,
  Crosshair,
  Storefront,
  Brain,
  Notebook,
  Plugs,
  Newspaper,
  Planet,
  Wrench,
  Stamp,
  UserSwitch,
  Bandaids,
  Feather,
  PencilRuler,
  PushPin,
  MaskHappy,
  CalendarHeart,
  Scissors,
  Moped,
} from '@phosphor-icons/react';

// SVG 图标库 - Phosphor Icons
export const Icons: Record<string, React.FC<{ className?: string }>> = {
  Character: ({ className }) => <UserCircle className={className} weight="bold" />,
  User: ({ className }) => <IdentificationCard className={className} weight="bold" />,
  Chat: ({ className }) => <ChatTeardrop className={className} weight="bold" />,
  GroupChat: ({ className }) => <UsersThree className={className} weight="bold" />,
  Settings: ({ className }) => <PencilRuler className={className} weight="bold" />,
  Gallery: ({ className }) => <Images className={className} weight="bold" />,
  ThemeMaker: ({ className }) => <PaintBrush className={className} weight="bold" />,
  Appearance: ({ className }) => <Palette className={className} weight="bold" />,
  Date: ({ className }) => <Heart className={className} weight="bold" />,
  Journal: ({ className }) => <BookOpenText className={className} weight="bold" />,
  Schedule: ({ className }) => <SealCheck className={className} weight="bold" />,
  Room: ({ className }) => <House className={className} weight="bold" />,
  CheckPhone: ({ className }) => <DeviceMobileCamera className={className} weight="bold" />,
  Social: ({ className }) => <PushPin className={className} weight="bold" />,
  Study: ({ className }) => <Books className={className} weight="bold" />,
  Game: ({ className }) => <GameController className={className} weight="bold" />,
  Worldbook: ({ className }) => <NewspaperClipping className={className} weight="bold" />,
  Novel: ({ className }) => <PenNib className={className} weight="bold" />,
  Bank: ({ className }) => <PiggyBank className={className} weight="bold" />,
  XhsFreeRoam: ({ className }) => <Compass className={className} weight="bold" />,
  XhsStock: ({ className }) => <Camera className={className} weight="bold" />,
  SpecialMoments: ({ className }) => <Sparkle className={className} weight="bold" />,
  Browser: ({ className }) => <GlobeSimple className={className} weight="bold" />,
  Songwriting: ({ className }) => <MusicNotes className={className} weight="bold" />,
  Music: ({ className }) => <MusicNotes className={className} weight="fill" />,
  Call: ({ className }) => <PhoneCall className={className} weight="bold" />,
  Phone: ({ className }) => <Phone className={className} weight="bold" />,
  ExchangeDiary: ({ className }) => <EnvelopeSimpleOpen className={className} weight="bold" />,
  Guidebook: ({ className }) => <Crosshair className={className} weight="bold" />,
  LifeSim: ({ className }) => <Storefront className={className} weight="bold" />,
  MemoryPalace: ({ className }) => <Brain className={className} weight="bold" />,
  Handbook: ({ className }) => <Notebook className={className} weight="bold" />,
  QQBridge: ({ className }) => <Plugs className={className} weight="bold" />,
  HotNews: ({ className }) => <Newspaper className={className} weight="fill" />,
  VRWorld: ({ className }) => <Scissors className={className} weight="bold" />,
  CharCreatorDev: ({ className }) => <Wrench className={className} weight="fill" />,
  Presets: ({ className }) => <Stamp className={className} weight="bold" />,
  Personas: ({ className }) => <UserSwitch className={className} weight="bold" />,
  Regex: ({ className }) => <Bandaids className={className} weight="bold" />,
  Creative: ({ className }) => <Feather className={className} weight="bold" />,
  Theater: ({ className }) => <MaskHappy className={className} weight="bold" />,
  Almanac: ({ className }) => <CalendarHeart className={className} weight="bold" />,
  Takeout: ({ className }) => <Moped className={className} weight="bold" />,
};

// 顺序即默认桌面顺序：去掉 dock 应用后，前 8 个落在第一页（时钟 + 聊天卡下方）。
// 第一页放日常高频 App（相册 / 音乐 / 热点）+ 角色扮演工具链（剪影集 / 剪报夹 / 活字盘 / 补丁铺 / 主题），
// 其余按使用频率排在后续页。
export const INSTALLED_APPS: AppConfig[] = [
  // 神经链接（角色档案）已并入「剪影集」App：封面页 → 选「登场人物」或「扮相手账」
  // { id: AppID.Character, name: '神经链接', icon: 'Character', color: 'indigo' },
  // 絮语：单聊 + 群聊 + 名册 + 此刻 一站式入口（原独立「群聊」「Message」App 已合并于此）
  { id: AppID.GroupChat, name: '絮语', icon: 'Chat', color: 'green' },
  // ── 第一页（非 dock 的前 8 个）──
  { id: AppID.Gallery, name: '相册', icon: 'Gallery', color: 'orange' },
  { id: AppID.Music, name: '音乐', icon: 'Music', color: 'rose' },
  { id: AppID.HotNews, name: '热点', icon: 'HotNews', color: 'red' },
  { id: AppID.Personas, name: '剪影集', icon: 'Personas', color: 'violet' },
  { id: AppID.Worldbook, name: '剪报夹', icon: 'Worldbook', color: 'indigo' },
  { id: AppID.Presets, name: '活字盘', icon: 'Presets', color: 'sky' },
  { id: AppID.Regex, name: '补丁铺', icon: 'Regex', color: 'teal' },
  { id: AppID.Appearance, name: '拼贴册', icon: 'Appearance', color: 'slate' },
  // ── 后续页 ──
  { id: AppID.MemoryPalace, name: '回忆标本馆', icon: 'MemoryPalace', color: 'violet' },
  { id: AppID.Room, name: '栖居志', icon: 'Room', color: 'slate' },
  // 查手机已并入聊天 App：聊天界面底部 + 号面板 →「查手机」（不再是独立桌面 App）
  // { id: AppID.Browser, name: '浏览器', icon: 'Browser', color: 'blue' }, // Hidden
  // 见面已并入聊天 App：聊天界面底部 + 号面板 →「见面」（用户主动发起线下模式）
  // { id: AppID.Date, name: '见面', icon: 'Date', color: 'pink' },
  { id: AppID.Bank, name: '存钱罐', icon: 'Bank', color: 'lime' }, // Hidden
  { id: AppID.Journal, name: '日记', icon: 'Journal', color: 'amber' },
  // { id: AppID.Handbook, name: '手账', icon: 'Handbook', color: 'fuchsia' }, // Hidden temporarily, pending update
  // 原「朋友圈」独立 App 改造为小红书（朋友圈仍在聊天 App 的「朋友圈」标签页）
  { id: AppID.Social, name: '见闻簿', icon: 'Social', color: 'red' },
  { id: AppID.Study, name: '自习室', icon: 'Study', color: 'emerald' },
  // 「攻略本」(galgame 恋爱攻略) + 「TRPG」(跑团冒险) 合并为「小剧场」：一个图标，
  // 封面页选「攻略本 / TRPG」再进对应剧目（两个子模式各自保留玩法与名字）。
  { id: AppID.Theater, name: '小剧场', icon: 'Theater', color: 'orange' },
  // 笔友会（小说）+ 写歌 合并为「创作社」：一个图标，封面页选「笔友会 / 写歌」再进对应创作台
  { id: AppID.Creative, name: '创作社', icon: 'Creative', color: 'fuchsia' },
  { id: AppID.VRWorld, name: '页外', icon: 'VRWorld', color: 'indigo' },
  // 「时光契约」(日程/心愿单/纪念日倒数) + 「特别时光」(节日记忆活动) 合并为「岁时记」：
  // 一个图标，封面页选「时光契约 / 特别时光」再进对应页（两个子模式各自保留玩法与名字）。
  { id: AppID.Almanac, name: '岁时记', icon: 'Almanac', color: 'pink' },
  { id: AppID.Takeout, name: '外卖', icon: 'Takeout', color: 'orange' },
  { id: AppID.XhsFreeRoam, name: '自由活动', icon: 'XhsFreeRoam', color: 'rose' },
  { id: AppID.XhsStock, name: '拾光图库', icon: 'XhsStock', color: 'red' },
  { id: AppID.Phone, name: '回声亭', icon: 'Phone', color: 'green' },
  { id: AppID.Settings, name: '文具盒', icon: 'Settings', color: 'slate' },
  { id: AppID.LifeSim, name: '街角', icon: 'LifeSim', color: 'purple' },
  { id: AppID.CharCreatorDev, name: '捏脸·开发', icon: 'CharCreatorDev', color: 'amber' }, // 仅开发模式显示（Launcher 过滤）
  // { id: AppID.QQBridge, name: 'QQ 桥', icon: 'QQBridge', color: 'sky' }, // Hidden temporarily
];

// Dock 四枚：聊天 / 电话 / 小红书 / 文具盒（参考设计的四图标底栏）
export const DOCK_APPS = [AppID.GroupChat, AppID.Phone, AppID.Social, AppID.Settings];