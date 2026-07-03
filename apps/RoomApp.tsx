import React, { useState } from 'react';
import { useOS } from '../context/OSContext';
import PixelHomeView from './pixelHome/PixelHomeView';
import { PixelBadge, PixelButton, PixelPanel, PixelShell } from './pixelHome/PixelUi';

const RoomApp: React.FC = () => {
  const { closeApp, characters, activeCharacterId, setActiveCharacterId, userProfile } = useOS();
  const [selectedCharId, setSelectedCharId] = useState<string | null>(null);

  const currentChar = characters.find(c => c.id === (selectedCharId || activeCharacterId));

  if (selectedCharId && currentChar) {
    return (
      <PixelHomeView
        charId={currentChar.id}
        charName={currentChar.name}
        charAvatar={currentChar.avatar}
        userName={userProfile?.name || '用户'}
        onBack={() => setSelectedCharId(null)}
      />
    );
  }

  return (
    <PixelShell>
      <div className="flex h-full flex-col">
        <header className="shrink-0 border-b-4 border-[#3f3730] bg-[#c8a06a] px-4 pb-4 pt-12 text-[#302b26] shadow-[0_4px_0_#3f3730]">
          <div className="mb-4 flex items-center justify-between gap-3">
            <PixelButton onClick={closeApp} className="px-3 py-1.5">
              EXIT
            </PixelButton>
            <PixelBadge>栖居志</PixelBadge>
          </div>
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="mb-1 text-[10px] font-black uppercase text-[#6b5b4e]">Pixel Home Log</p>
              <h1 className="text-3xl font-black leading-none">今天去谁家？</h1>
            </div>
            <div className="hidden border-2 border-[#3f3730] bg-[#dccaa3] px-3 py-2 text-right text-[10px] font-black shadow-[3px_3px_0_#3f3730] sm:block">
              生活 / 房间 / 记忆
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-4 pb-8">
          {characters.length === 0 ? (
            <PixelPanel className="p-5 text-center">
              <p className="text-sm font-black">还没有可以拜访的角色。</p>
              <p className="mt-2 text-xs font-bold text-[#78695c]">先去登场人物里创建或导入角色，再回来布置像素家园。</p>
            </PixelPanel>
          ) : (
            <div className="grid grid-cols-2 gap-4">
              {characters.map((char, idx) => (
                <button
                  key={char.id}
                  onClick={() => {
                    setActiveCharacterId(char.id);
                    setSelectedCharId(char.id);
                  }}
                  className="group relative min-h-[174px] border-4 border-[#3f3730] bg-[#efe2c5] p-3 text-left shadow-[5px_5px_0_#3f3730] transition-transform active:translate-x-[3px] active:translate-y-[3px] active:shadow-[2px_2px_0_#3f3730]"
                >
                  <span className="absolute right-2 top-2 border-2 border-[#3f3730] bg-[#b9c7c1] px-1.5 py-0.5 text-[8px] font-black">
                    No.{String(idx + 1).padStart(2, '0')}
                  </span>
                  <div className="mx-auto mt-3 h-20 w-20 overflow-hidden border-4 border-[#3f3730] bg-[#5b5148] shadow-[3px_3px_0_#3f3730]">
                    {char.avatar ? (
                      <img src={char.avatar} alt={char.name} className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center bg-[#dccaa3] text-xl font-black">
                        {char.name.slice(0, 1)}
                      </div>
                    )}
                  </div>
                  <div className="mt-4 text-center">
                    <div className="truncate text-sm font-black">{char.name}</div>
                    <div className="mt-1 text-[9px] font-black uppercase text-[#76685d] group-hover:text-[#8f6864]">
                      ENTER PIXEL HOME
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </main>
      </div>
    </PixelShell>
  );
};

export default RoomApp;
