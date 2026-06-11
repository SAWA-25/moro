import React from 'react';
import { useOS } from '../context/OSContext';
import MomentsFeed from '../components/moments/MomentsFeed';

/**
 * 朋友圈 App（独立入口）。
 * 全部逻辑在 components/moments/ 下；嵌入聊天 App 时请直接使用
 * <MomentsFeed embedded /> 而不是本组件。
 */
const SocialApp: React.FC = () => {
    const { closeApp } = useOS();
    return <MomentsFeed onBack={closeApp} />;
};

export default SocialApp;
