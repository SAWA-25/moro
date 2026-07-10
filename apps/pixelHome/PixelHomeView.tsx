import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useOS } from '../../context/OSContext';
import { resolveAuxApi } from '../../utils/auxApi';
import type { PixelAsset, PixelHomeState, PixelHomeViewMode, PlacedFurniture } from './types';
import type { MemoryRoom } from '../../utils/memoryPalace/types';
import { getOrCreateHomeState, PixelAssetDB, PixelLayoutDB } from './pixelHomeDb';
import { ROOM_META } from './roomTemplates';
import { downloadPreset, importPreset, readFileAsText } from './presetManager';
import { DB } from '../../utils/db';
import type { PixelCharConfig } from './pixelCharGenerator';
import { ensurePixelChar } from './pixelCharGenerator';
import PixelHomeMap from './PixelHomeMap';
import PixelRoomEditor from './PixelRoomEditor';
import PixelAssetGenerator from './PixelAssetGenerator';
import AssetLibrary from './AssetLibrary';
import PixelCharEditor from './PixelCharEditor';
import MemoryDiveMode from './MemoryDiveMode';
import type { DiveResult } from './memoryDiveTypes';
import PixelLifePanel from './PixelLifePanel';
import { PixelBadge, PixelButton, PixelPanel, PixelShell } from './PixelUi';
import { usePixelHomeLife } from './usePixelHomeLife';
import { mergePixelAssets } from './builtinFurnitureCatalog';

const DEFAULT_CHAR_SPRITES: Record<string, string> = {};

interface Props {
  charId: string;
  charName: string;
  charAvatar?: string;
  userName: string;
  onBack: () => void;
}

const PixelHomeView: React.FC<Props> = ({ charId, charName, charAvatar, userName, onBack }) => {
  const { addToast, apiConfig, auxApiConfig, characters, userProfile, updateCharacter } = useOS();
  const auxApi = useMemo(() => ({ ...apiConfig, ...resolveAuxApi(auxApiConfig, apiConfig) }), [apiConfig, auxApiConfig]);
  const char = characters.find(c => c.id === charId);

  const [viewMode, setViewMode] = useState<PixelHomeViewMode>('map');
  const [homeState, setHomeState] = useState<PixelHomeState | null>(null);
  const [assets, setAssets] = useState<PixelAsset[]>([]);
  const [selectedRoom, setSelectedRoom] = useState<MemoryRoom>('living_room');
  const [loading, setLoading] = useState(true);
  const [lifeOpen, setLifeOpen] = useState(true);

  const [pixelCharConfig, setPixelCharConfig] = useState<PixelCharConfig | null>(null);
  const [pixelCharSprite, setPixelCharSprite] = useState<string | null>(null);
  const [pixelUserConfig, setPixelUserConfig] = useState<PixelCharConfig | null>(null);
  const [pixelUserSprite, setPixelUserSprite] = useState<string | null>(null);
  const [editorTarget, setEditorTarget] = useState<'char' | 'user'>('char');

  const pendingSlotRef = useRef<string | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const addToastRef = useRef(addToast);
  const autoLifeKeyRef = useRef<string | null>(null);
  const allAssets = useMemo(() => mergePixelAssets(assets), [assets]);

  const life = usePixelHomeLife({
    char,
    userProfile,
    auxApi,
    homeState,
    assets: allAssets,
    updateCharacter,
    addToast,
  });

  const generateLifeRef = useRef(life.generateLife);

  useEffect(() => {
    addToastRef.current = addToast;
  }, [addToast]);

  useEffect(() => {
    generateLifeRef.current = life.generateLife;
  }, [life.generateLife]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [state, allAssets, savedChar, savedUser, savedTheme] = await Promise.all([
          getOrCreateHomeState(charId),
          PixelAssetDB.getAll(),
          DB.getAsset(`pixel_char_${charId}`),
          DB.getAsset('pixel_char_user'),
          DB.getAsset(`pixel_home_theme_${charId}`),
        ]);
        if (cancelled) return;
        if (savedTheme) {
          try { state.theme = JSON.parse(savedTheme); } catch {}
        }
        setHomeState(state);
        setAssets(allAssets);

        if (savedChar) {
          const cfg = JSON.parse(savedChar) as PixelCharConfig;
          setPixelCharConfig(cfg);
          ensurePixelChar(cfg).then(uri => { if (!cancelled) setPixelCharSprite(uri); }).catch(() => {});
        } else {
          const defaultSprite = DEFAULT_CHAR_SPRITES[charId];
          if (defaultSprite) setPixelCharSprite(defaultSprite);
        }
        if (savedUser) {
          const cfg = JSON.parse(savedUser) as PixelCharConfig;
          setPixelUserConfig(cfg);
          ensurePixelChar(cfg).then(uri => { if (!cancelled) setPixelUserSprite(uri); }).catch(() => {});
        }
      } catch (err) {
        console.error('[PixelHome] Failed to load:', err);
        addToastRef.current?.('加载像素家园失败', 'error');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [charId]);

  useEffect(() => {
    if (loading || !homeState || !char) return;
    if (!auxApi.baseUrl || !auxApi.model) return;
    if (life.generating) return;
    if (life.roomState) return;
    if (char.lastRoomDate === life.today && char.savedRoomState) return;
    const autoKey = `${char.id}:${life.today}`;
    if (autoLifeKeyRef.current === autoKey) return;
    autoLifeKeyRef.current = autoKey;
    generateLifeRef.current(false);
  }, [
    auxApi.baseUrl,
    auxApi.model,
    char?.id,
    char?.lastRoomDate,
    char?.savedRoomState,
    homeState,
    life.generating,
    life.roomState,
    life.today,
    loading,
  ]);

  const handleSaveChar = useCallback(async (cfg: PixelCharConfig, imageUri: string) => {
    if (editorTarget === 'user') {
      await DB.saveAsset('pixel_char_user', JSON.stringify(cfg));
      setPixelUserConfig(cfg);
      setPixelUserSprite(imageUri);
      addToast?.('你的像素形象已保存', 'success');
    } else {
      await DB.saveAsset(`pixel_char_${charId}`, JSON.stringify(cfg));
      setPixelCharConfig(cfg);
      setPixelCharSprite(imageUri);
      addToast?.(`${charName}的像素形象已保存`, 'success');
    }
    setViewMode('map');
  }, [addToast, charId, charName, editorTarget]);

  const handleEnterDive = useCallback(() => {
    if (!pixelUserConfig) {
      addToast?.('先捏一个你自己的像素形象，再一起潜入记忆', 'info');
      setEditorTarget('user');
      setViewMode('charEditor');
      return;
    }
    if (!pixelCharConfig) {
      addToast?.(`也给${charName}捏一个像素形象吧`, 'info');
      setEditorTarget('char');
      setViewMode('charEditor');
      return;
    }
    setViewMode('dive');
  }, [addToast, charName, pixelCharConfig, pixelUserConfig]);

  const handleDiveExit = useCallback((result: DiveResult | null) => {
    setViewMode('map');
    if (result?.buffs[0]) {
      addToast?.(`记忆潜行结束：${result.buffs[0].label} ${result.buffs[0].value}`, 'success');
    }
  }, [addToast]);

  const handleEnterRoom = useCallback((roomId: MemoryRoom) => {
    setSelectedRoom(roomId);
    setLifeOpen(false);
    life.clearInspection();
    setViewMode('room');
  }, [life.clearInspection]);

  const handleRoomUpdate = useCallback(async () => {
    const state = await getOrCreateHomeState(charId);
    const savedTheme = await DB.getAsset(`pixel_home_theme_${charId}`);
    if (savedTheme) {
      try { state.theme = JSON.parse(savedTheme); } catch {}
    }
    setHomeState(state);
  }, [charId]);

  const handleExport = useCallback(async () => {
    if (!homeState) return;
    await downloadPreset(homeState, allAssets, `${charName}的家`, userName, 'pixel_home');
    addToast?.('小屋 JSON 已导出', 'success');
  }, [addToast, allAssets, charName, homeState, userName]);

  const handleExportRoom = useCallback(async () => {
    if (!homeState) return;
    const layout = homeState.rooms.find(r => r.roomId === selectedRoom);
    if (!layout) return;
    const roomName = selectedRoom === 'user_room' ? `${userName}的房` : ROOM_META[selectedRoom].name;
    await downloadPreset(
      { ...homeState, rooms: [layout] },
      allAssets,
      `${charName}-${roomName}样板房`,
      userName,
      'pixel_room',
    );
    addToast?.('样板房 JSON 已导出', 'success');
  }, [addToast, allAssets, charName, homeState, selectedRoom, userName]);

  const handleImportFiles = useCallback(async (fileList: FileList | File[]) => {
    const files = Array.from(fileList).filter(file => file.name.toLowerCase().endsWith('.json'));
    if (files.length === 0) {
      addToast?.('请选择 JSON 文件', 'error');
      return;
    }
    if (files.length > 1 && !window.confirm(`确定批量导入 ${files.length} 个小屋 JSON 吗？相同房间会以后导入的文件为准。`)) {
      return;
    }
    try {
      let roomsImported = 0;
      let assetsImported = 0;
      const failed: string[] = [];
      for (const file of files) {
        const json = await readFileAsText(file);
        const result = await importPreset(json, charId);
        if (!result.success) {
          failed.push(`${file.name}: ${result.error || '导入失败'}`);
          continue;
        }
        roomsImported += result.roomsImported;
        assetsImported += result.assetsImported;
      }
      if (roomsImported === 0 && failed.length > 0) {
        addToast?.(`导入失败：${failed[0]}`, 'error');
        return;
      }
      await handleRoomUpdate();
      setAssets(await PixelAssetDB.getAll());
      const suffix = failed.length > 0 ? `，${failed.length} 个文件失败` : '';
      addToast?.(`导入成功：${files.length - failed.length} 个文件，${roomsImported} 个房间，${assetsImported} 个新素材${suffix}`, failed.length ? 'info' : 'success');
    } catch (err: any) {
      addToast?.(`导入失败：${err.message}`, 'error');
    }
  }, [addToast, charId, handleRoomUpdate]);

  const handleAssetsChanged = useCallback(async () => {
    setAssets(await PixelAssetDB.getAll());
  }, []);

  const handleOpenLibrary = useCallback((slotId: string | null) => {
    pendingSlotRef.current = slotId;
    setViewMode('library');
  }, []);

  const handleSelectAsset = useCallback(async (assetId: string) => {
    const slotId = pendingSlotRef.current;
    if (!homeState) {
      setViewMode('room');
      return;
    }
    const roomLayout = homeState.rooms.find(r => r.roomId === selectedRoom);
    if (!roomLayout) {
      setViewMode('room');
      return;
    }

    if (slotId === '__add__') {
      const asset = allAssets.find(a => a.id === assetId);
      const newFurniture: PlacedFurniture = {
        slotId: `user_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        assetId,
        x: 50,
        y: 60,
        scale: 1,
        rotation: 0,
        placedBy: 'user',
        isDefault: false,
        layer: asset?.tags?.includes('rug') ? 'carpet' : undefined,
      };
      await PixelLayoutDB.save({
        ...roomLayout,
        furniture: [...roomLayout.furniture, newFurniture],
        lastUpdatedAt: Date.now(),
        lastDecoratedBy: 'user',
      });
      addToast?.('家具已放进房间', 'success');
    } else if (slotId) {
      const asset = allAssets.find(a => a.id === assetId);
      await PixelLayoutDB.save({
        ...roomLayout,
        furniture: roomLayout.furniture.map(f => f.slotId === slotId ? { ...f, assetId, placedBy: 'user' as const, layer: asset?.tags?.includes('rug') ? 'carpet' : f.layer === 'carpet' ? undefined : f.layer } : f),
        lastUpdatedAt: Date.now(),
        lastDecoratedBy: 'user',
      });
      addToast?.('家具素材已替换', 'success');
    }

    pendingSlotRef.current = null;
    await handleRoomUpdate();
    setViewMode('room');
  }, [addToast, allAssets, handleRoomUpdate, homeState, selectedRoom]);

  const handleBack = useCallback(() => {
    if (viewMode === 'map') {
      onBack();
      return;
    }
    if (viewMode === 'library' && pendingSlotRef.current) {
      pendingSlotRef.current = null;
      setViewMode('room');
      return;
    }
    pendingSlotRef.current = null;
    setViewMode('map');
  }, [onBack, viewMode]);

  if (loading) {
    return (
      <PixelShell>
        <div className="flex h-full items-center justify-center p-6">
          <PixelPanel className="p-6 text-center">
            <div className="mx-auto mb-4 h-10 w-10 animate-pulse border-4 border-[#3f3730] bg-[#dccaa3]" />
            <p className="text-sm font-black">正在打开{charName}的像素家园...</p>
          </PixelPanel>
        </div>
      </PixelShell>
    );
  }

  if (!homeState) return null;

  const title =
    viewMode === 'map' ? `${charName}的家`
      : viewMode === 'room' ? (selectedRoom === 'user_room' ? `${userName}的房` : ROOM_META[selectedRoom].name)
        : viewMode === 'library' ? (pendingSlotRef.current ? '选择素材' : '仓库 / 工坊')
          : viewMode === 'generator' ? '像素工坊'
            : viewMode === 'charEditor' ? (editorTarget === 'user' ? '捏我自己' : `捏${charName}`)
              : '记忆潜行';

  return (
    <PixelShell>
      <div className="flex h-full flex-col">
        {viewMode !== 'dive' && (
          <header className="shrink-0 border-b-4 border-[#3f3730] bg-[#c8a06a] px-3 pb-3 pt-11 shadow-[0_4px_0_#3f3730]">
            <div className="flex items-center justify-between gap-3">
              <PixelButton onClick={handleBack} className="px-3 py-1.5">BACK</PixelButton>
              <div className="min-w-0 flex-1 text-center">
                <p className="truncate text-sm font-black">{title}</p>
                {life.roomState?.actorStatus && viewMode === 'map' && (
                  <p className="mt-0.5 truncate text-[10px] font-bold text-[#6b5b4e]">{life.roomState.actorStatus}</p>
                )}
              </div>
              <PixelBadge>{viewMode.toUpperCase()}</PixelBadge>
            </div>
          </header>
        )}

        <main className="relative min-h-0 flex-1 overflow-hidden">
          {viewMode === 'map' && (
            <>
              <PixelHomeMap
                homeState={homeState}
                assets={allAssets}
                charSprite={pixelCharSprite || charAvatar}
                userName={userName}
                onEnterRoom={handleEnterRoom}
                onUpdateTheme={async theme => {
                  setHomeState(prev => prev ? { ...prev, theme } : prev);
                  try { await DB.saveAsset(`pixel_home_theme_${charId}`, JSON.stringify(theme)); } catch {}
                }}
              />
              {lifeOpen && (
                <PixelLifePanel
                  charName={charName}
                  today={life.today}
                  roomState={life.roomState}
                  todo={life.todo}
                  notes={life.notes}
                  schedule={life.schedule}
                  loading={life.loading}
                  generating={life.generating}
                  onRefresh={() => life.generateLife(true)}
                  onClose={() => setLifeOpen(false)}
                  onAddTodo={life.addTodo}
                  onToggleTodo={life.toggleTodo}
                  onDeleteTodo={life.deleteTodo}
                  onAddNote={life.addNote}
                  onDeleteNote={life.deleteNote}
                />
              )}
            </>
          )}

          {viewMode === 'room' && (
            <PixelRoomEditor
              charId={charId}
              charName={charName}
              charSprite={pixelCharSprite || charAvatar}
              userName={userName}
              roomId={selectedRoom}
              layout={homeState.rooms.find(r => r.roomId === selectedRoom)!}
              assets={allAssets}
              onUpdate={handleRoomUpdate}
              onOpenLibrary={handleOpenLibrary}
              onExportRoom={handleExportRoom}
              onInspectFurniture={(roomId, furniture) => life.inspectFurniture({ roomId, furniture })}
              onDecorationInteraction={life.clearInspection}
            />
          )}

          {viewMode === 'charEditor' && (
            <PixelCharEditor
              key={editorTarget}
              target={editorTarget}
              targetLabel={editorTarget === 'user' ? '你自己' : charName}
              initial={editorTarget === 'user' ? pixelUserConfig : pixelCharConfig}
              onSave={handleSaveChar}
              onCancel={() => setViewMode('map')}
            />
          )}

          {viewMode === 'generator' && <PixelAssetGenerator onGenerated={handleAssetsChanged} />}

          {viewMode === 'library' && (
            <AssetLibrary
              assets={allAssets}
              onChanged={handleAssetsChanged}
              onSelectAsset={handleSelectAsset}
              isSelecting={!!pendingSlotRef.current}
            />
          )}

          {viewMode === 'dive' && homeState && char && (
            <MemoryDiveMode
              charId={charId}
              charName={charName}
              charProfile={char}
              userProfile={userProfile}
              charSprite={pixelCharSprite || charAvatar}
              playerSprite={pixelUserSprite || undefined}
              userName={userName}
              homeState={homeState}
              assets={allAssets}
              apiConfig={auxApi}
              onExit={handleDiveExit}
            />
          )}

          {life.inspection && viewMode === 'room' && (
            <PixelPanel
              title={life.inspection.title}
              className="absolute inset-x-3 bottom-3 z-50"
              right={<button onClick={life.clearInspection} className="text-xs font-black">X</button>}
            >
              <div className="space-y-2 p-3">
                <p className="text-xs font-bold leading-relaxed">{life.inspection.description}</p>
                <div className="border-2 border-[#3f3730] bg-[#b9c7c1] px-3 py-2 text-xs font-black leading-relaxed">
                  {life.inspection.reaction}
                </div>
              </div>
            </PixelPanel>
          )}
        </main>

        {viewMode === 'map' && (
          <footer className="shrink-0 overflow-x-auto border-t-4 border-[#3f3730] bg-[#5b5148] px-3 py-3">
            <div className="flex min-w-max gap-2">
              <PixelButton active={lifeOpen} onClick={() => setLifeOpen(v => !v)}>今日</PixelButton>
              <PixelButton onClick={handleEnterDive}>潜行</PixelButton>
              <PixelButton onClick={() => { pendingSlotRef.current = null; setViewMode('library'); }}>仓库</PixelButton>
              <PixelButton onClick={handleExport}>导出小屋</PixelButton>
              <PixelButton onClick={() => { setEditorTarget('char'); setViewMode('charEditor'); }}>捏TA</PixelButton>
              <PixelButton onClick={() => { setEditorTarget('user'); setViewMode('charEditor'); }}>捏我</PixelButton>
              <PixelButton onClick={() => importInputRef.current?.click()}>导入小屋</PixelButton>
            </div>
            <input
              ref={importInputRef}
              type="file"
              accept=".json"
              multiple
              className="hidden"
              onChange={e => {
                if (e.target.files?.length) handleImportFiles(e.target.files);
                e.currentTarget.value = '';
              }}
            />
          </footer>
        )}
      </div>
    </PixelShell>
  );
};

export default PixelHomeView;
