import React from 'react';
import { useOS } from '../context/OSContext';
import StoryMode from './harem/StoryMode';

/**
 * 椒房记 —— AI 后宫恋爱文字互动游戏（文游模式）。
 * 进 App 直接进入文游；剧情由 AI 依当前 state 实时生成，玩家用选择影响好感/信任/嫉妒/记忆/结局。
 * 纯逻辑见 `utils/haremStory.ts`，玩法说明见 `docs/harem-story.md`。
 */
const HaremApp: React.FC = () => {
    const { closeApp } = useOS();
    return <StoryMode onBack={closeApp} />;
};

export default HaremApp;
