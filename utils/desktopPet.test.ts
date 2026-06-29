import { describe, expect, it } from 'vitest';
import type { DesktopPetManifest } from './desktopPet';
import {
  DESKTOP_PET_DIALOGUE_LIMIT,
  DESKTOP_PET_FALL_SPEED_DEFAULT,
  DESKTOP_PET_FALL_SPEED_MAX,
  DESKTOP_PET_PROMPT_LIMIT,
  advanceDesktopPetFallOverlay,
  advanceDesktopPetWalkOverlay,
  appendDesktopPetDialogue,
  buildDesktopPetFallbackSpeech,
  canDesktopPetAutoWalkDuringAction,
  clampDesktopPetOverlay,
  clearDesktopPetDialogue,
  createDefaultDesktopPetState,
  createDesktopPetTalkMessage,
  dockDesktopPetOverlay,
  ensureDesktopPetState,
  feedDesktopPet,
  getDesktopPetFallTargetY,
  markDueDesktopPetRemindersFired,
  setDesktopPetRolePrompt,
  shouldPlaceDesktopPetControlsOnLeft,
  sortFrameNames,
} from './desktopPet';

const manifest: DesktopPetManifest = {
  version: 1,
  generatedAt: '2026-06-30T00:00:00.000Z',
  source: 'test',
  roles: {
    流浪者: {
      id: '流浪者',
      name: '流浪者',
      width: 300,
      height: 320,
      scale: 1,
      refresh: 5,
      interactSpeed: 0.02,
      defaultAction: 'default',
      patAction: 'patpat',
      randomActs: [],
      favorites: { 真味茶泡饭: 2 },
      dislikes: { 枣椰蜜糖: 0.25 },
      messageDict: {},
      actions: {
        default: { id: 'default', images: 'stand', actNum: 1, frameRefresh: 0.08, frames: [] },
        feed_1: { id: 'feed_1', images: 'happy', actNum: 1, frameRefresh: 0.08, frames: [] },
        feed_2: { id: 'feed_2', images: 'pat', actNum: 1, frameRefresh: 0.08, frames: [] },
        feed_3: { id: 'feed_3', images: 'mad', actNum: 1, frameRefresh: 0.08, frames: [] },
      },
    },
  },
  items: {
    真味茶泡饭: { id: '真味茶泡饭', name: '真味茶泡饭', effectHP: 50, effectFV: 35, dropRate: 1, fvLock: 4, fvReward: 5, type: 'consumable', description: '', image: '' },
    枣椰蜜糖: { id: '枣椰蜜糖', name: '枣椰蜜糖', effectHP: 25, effectFV: 20, dropRate: 1, fvLock: 3, type: 'consumable', description: '', image: '' },
    派蒙: { id: '派蒙', name: '派蒙', effectHP: 0, effectFV: 0, dropRate: 0, fvLock: 2, type: 'collection', description: '', image: '' },
  },
};

describe('desktop pet core', () => {
  it('sorts manifest frames by numeric suffix', () => {
    expect(sortFrameNames(['stand_10.png', 'stand_2.png', 'stand_1.png'])).toEqual([
      'stand_1.png',
      'stand_2.png',
      'stand_10.png',
    ]);
  });

  it('feeds with clamped stats and favorite/dislike reactions', () => {
    const base = createDefaultDesktopPetState(1);
    const favorite = feedDesktopPet(base, manifest, '流浪者', '真味茶泡饭', 2);
    expect(favorite.actionId).toBe('feed_1');
    expect(favorite.hpDelta).toBe(100);
    expect(favorite.fvDelta).toBe(80);
    expect(favorite.state.roleStates['流浪者'].hp).toBe(180);

    const disliked = feedDesktopPet(favorite.state, manifest, '流浪者', '枣椰蜜糖', 3);
    expect(disliked.actionId).toBe('feed_3');
    expect(disliked.hpDelta).toBe(6);
    expect(disliked.fvDelta).toBe(5);
    expect(disliked.state.roleStates['流浪者'].fv).toBe(85);

    const clamped = feedDesktopPet(disliked.state, manifest, '流浪者', '真味茶泡饭', 4);
    expect(clamped.state.roleStates['流浪者'].hp).toBe(200);
  });

  it('fires due reminders and advances daily reminders', () => {
    const state = {
      ...createDefaultDesktopPetState(1),
      reminders: [
        { id: 'a', title: '喝水', dueAt: 1000, repeat: 'none' as const, enabled: true, createdAt: 1 },
        { id: 'b', title: '起床', dueAt: 1000, repeat: 'daily' as const, enabled: true, createdAt: 1 },
        { id: 'c', title: '关闭', dueAt: 1000, repeat: 'none' as const, enabled: false, createdAt: 1 },
      ],
    };
    const result = markDueDesktopPetRemindersFired(state, 2000);
    expect(result.due.map(item => item.id)).toEqual(['a', 'b']);
    expect(result.state.reminders.find(item => item.id === 'a')?.enabled).toBe(false);
    expect(result.state.reminders.find(item => item.id === 'b')?.enabled).toBe(true);
    expect(result.state.reminders.find(item => item.id === 'b')?.dueAt).toBeGreaterThan(2000);
  });

  it('appends, trims and clears pet dialogue', () => {
    let state = createDefaultDesktopPetState(1);
    const messages = Array.from({ length: DESKTOP_PET_DIALOGUE_LIMIT + 5 }, (_, index) => (
      createDesktopPetTalkMessage({
        role: index % 2 === 0 ? 'user' : 'pet',
        text: `msg-${index}`,
        source: 'chat',
        id: `m-${index}`,
        createdAt: index,
      }, index)
    ));
    state = appendDesktopPetDialogue(state, messages, 100);
    expect(state.dialogueLog).toHaveLength(DESKTOP_PET_DIALOGUE_LIMIT);
    expect(state.dialogueLog?.[0].text).toBe('msg-5');
    expect(state.lastSpeech?.role).toBe('pet');

    const cleared = clearDesktopPetDialogue(state, 101);
    expect(cleared.dialogueLog).toEqual([]);
    expect(cleared.lastSpeech).toBeUndefined();
  });

  it('builds deterministic fallback food responses', () => {
    expect(buildDesktopPetFallbackSpeech('纳西妲', 'feed', { itemName: '枣椰蜜糖', multiplier: 0.2 }))
      .toContain('枣椰蜜糖');
    expect(buildDesktopPetFallbackSpeech('流浪者', 'feed', { itemName: '真味茶泡饭', multiplier: 2 }))
      .toContain('合心意');
    expect(buildDesktopPetFallbackSpeech('流浪者', 'chat', { userText: '陪我聊聊今天的事情' }))
      .toContain('陪我聊聊');
  });

  it('stores custom prompts per pet role and clears empty prompts', () => {
    const base = createDefaultDesktopPetState(1);
    const updated = setDesktopPetRolePrompt(base, '流浪者', '  说话更冷淡一点。  ', 2);
    expect(updated.rolePrompts?.['流浪者']).toBe('说话更冷淡一点。');
    expect(updated.updatedAt).toBe(2);

    const otherRole = setDesktopPetRolePrompt(updated, '纳西妲', '多用温柔的比喻。', 3);
    expect(otherRole.rolePrompts?.['流浪者']).toBe('说话更冷淡一点。');
    expect(otherRole.rolePrompts?.['纳西妲']).toBe('多用温柔的比喻。');

    const cleared = setDesktopPetRolePrompt(otherRole, '流浪者', '   ', 4);
    expect(cleared.rolePrompts?.['流浪者']).toBeUndefined();
    expect(cleared.rolePrompts?.['纳西妲']).toBe('多用温柔的比喻。');
  });

  it('normalizes stored custom prompts and clamps prompt length', () => {
    const longPrompt = 'a'.repeat(DESKTOP_PET_PROMPT_LIMIT + 10);
    const state = ensureDesktopPetState({
      ...createDefaultDesktopPetState(1),
      rolePrompts: {
        流浪者: longPrompt,
        纳西妲: ' \r\n 多提世界树。 \r\n ',
        空白: '   ',
      },
    });
    expect(state.rolePrompts?.['流浪者']).toHaveLength(DESKTOP_PET_PROMPT_LIMIT);
    expect(state.rolePrompts?.['纳西妲']).toBe('多提世界树。');
    expect(state.rolePrompts?.['空白']).toBeUndefined();
  });

  it('clamps and docks overlay coordinates', () => {
    const clamped = clampDesktopPetOverlay(
      { x: 999, y: -20, scale: 2 },
      { width: 400, height: 600 },
      { width: 120, height: 180 },
    );
    expect(clamped.x).toBe(280);
    expect(clamped.y).toBe(0);
    expect(clamped.scale).toBe(1.35);

    const middle = dockDesktopPetOverlay({ x: 80, y: 200, scale: 0.7 }, { width: 400, height: 600 }, { width: 120, height: 180 });
    expect(middle.dockSide).toBe('none');
    expect(middle.x).toBe(80);

    expect(dockDesktopPetOverlay({ x: 12, y: 200, scale: 0.7 }, { width: 400, height: 600 }, { width: 120, height: 180 }).dockSide)
      .toBe('left');
    const right = dockDesktopPetOverlay({ x: 300, y: 200, scale: 0.7 }, { width: 400, height: 600 }, { width: 120, height: 180 });
    expect(right.dockSide).toBe('right');
    expect(right.x).toBe(280);
  });

  it('walks overlay and turns around at screen edges', () => {
    const middle = advanceDesktopPetWalkOverlay(
      { x: 100, y: 200, scale: 0.7 },
      'right',
      { width: 400, height: 600 },
      { width: 120, height: 180 },
      3,
    );
    expect(middle.overlay.x).toBe(103);
    expect(middle.direction).toBe('right');
    expect(middle.actionId).toBe('right_walk');

    const edge = advanceDesktopPetWalkOverlay(
      { x: 275, y: 200, scale: 0.7 },
      'right',
      { width: 400, height: 600 },
      { width: 120, height: 180 },
      8,
    );
    expect(edge.overlay.x).toBe(280);
    expect(edge.direction).toBe('left');
    expect(edge.actionId).toBe('left_walk');
  });

  it('normalizes default and stored fall speed', () => {
    expect(createDefaultDesktopPetState(1).fallSpeed).toBe(DESKTOP_PET_FALL_SPEED_DEFAULT);
    expect(createDefaultDesktopPetState(1).fallSpeed).toBe(150);
    expect(createDefaultDesktopPetState(1).fallSpeed).toBeLessThan(DESKTOP_PET_FALL_SPEED_MAX);
    expect(ensureDesktopPetState({ ...createDefaultDesktopPetState(1), fallSpeed: 999 }).fallSpeed).toBe(DESKTOP_PET_FALL_SPEED_MAX);
  });

  it('falls overlay downward for a short target distance only', () => {
    const targetY = getDesktopPetFallTargetY(
      { x: 100, y: 120, scale: 0.7 },
      { width: 400, height: 600 },
      { width: 120, height: 180 },
      36,
    );
    expect(targetY).toBe(156);

    const falling = advanceDesktopPetFallOverlay(
      { x: 100, y: 120, scale: 0.7 },
      { width: 400, height: 600 },
      { width: 120, height: 180 },
      0.1,
      120,
      targetY,
    );
    expect(falling.overlay.x).toBe(100);
    expect(falling.overlay.y).toBeGreaterThan(120);
    expect(falling.overlay.y).toBeLessThan(targetY);
    expect(falling.landed).toBe(false);

    const landed = advanceDesktopPetFallOverlay(
      { x: 100, y: 150, scale: 0.7 },
      { width: 400, height: 600 },
      { width: 120, height: 180 },
      0.1,
      120,
      targetY,
    );
    expect(landed.overlay.y).toBe(156);
    expect(landed.landed).toBe(true);
  });

  it('places overlay controls on the side with enough horizontal room', () => {
    expect(shouldPlaceDesktopPetControlsOnLeft(
      { x: 60, y: 100, scale: 0.7 },
      400,
      { width: 120, height: 180 },
    )).toBe(false);
    expect(shouldPlaceDesktopPetControlsOnLeft(
      { x: 260, y: 100, scale: 0.7 },
      400,
      { width: 120, height: 180 },
    )).toBe(true);
  });

  it('only allows automatic walking during idle or walk actions', () => {
    expect(canDesktopPetAutoWalkDuringAction('default')).toBe(true);
    expect(canDesktopPetAutoWalkDuringAction('stand')).toBe(false);
    expect(canDesktopPetAutoWalkDuringAction('stand', 'stand')).toBe(true);
    expect(canDesktopPetAutoWalkDuringAction('left_walk')).toBe(true);
    expect(canDesktopPetAutoWalkDuringAction('right_walk')).toBe(true);
    expect(canDesktopPetAutoWalkDuringAction('left')).toBe(true);
    expect(canDesktopPetAutoWalkDuringAction('right')).toBe(true);

    expect(canDesktopPetAutoWalkDuringAction('drag')).toBe(false);
    expect(canDesktopPetAutoWalkDuringAction('fall')).toBe(false);
    expect(canDesktopPetAutoWalkDuringAction('onfloor')).toBe(false);
    expect(canDesktopPetAutoWalkDuringAction('patpat')).toBe(false);
    expect(canDesktopPetAutoWalkDuringAction('feed_1')).toBe(false);
    expect(canDesktopPetAutoWalkDuringAction('feed_2')).toBe(false);
    expect(canDesktopPetAutoWalkDuringAction('feed_3')).toBe(false);
    expect(canDesktopPetAutoWalkDuringAction('sleep')).toBe(false);
  });
});
