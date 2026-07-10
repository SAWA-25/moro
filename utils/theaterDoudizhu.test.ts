import { describe, expect, it } from 'vitest';
import type { CharacterProfile, TheaterDoudizhuGame } from '../types';
import {
  analyzeDoudizhuCards,
  applyDoudizhuBid,
  applyDoudizhuPlay,
  canDoudizhuBeat,
  chooseDoudizhuMove,
  createDoudizhuDeck,
  createDoudizhuGame,
  dealDoudizhuCards,
  listDoudizhuLegalPlays,
  parseDoudizhuDifficultyResult,
} from './theaterDoudizhu';

const deck = createDoudizhuDeck();
const card = (id: string) => {
  const found = deck.find(c => c.id === id);
  if (!found) throw new Error(`missing card ${id}`);
  return found;
};
const cards = (...ids: string[]) => ids.map(card);
const char = (id: string, name: string) => ({ id, name } as CharacterProfile);

const makeGame = (overrides: Partial<TheaterDoudizhuGame> = {}) => ({
  id: 'ddz_test',
  title: '斗地主测试',
  userName: '用户',
  charIds: ['c1', 'c2'],
  players: [
    { role: 'user', name: '用户' },
    { role: 'charA', name: '甲', charId: 'c1' },
    { role: 'charB', name: '乙', charId: 'c2' },
  ],
  status: 'playing',
  difficultyMode: 'opening',
  difficultyLevels: { charA: 'steady', charB: 'steady' },
  currentTurn: 'user',
  bidStarter: 'user',
  bidHistory: [],
  baseScore: 1,
  multiplier: 1,
  landlord: 'user',
  bottomCards: cards('S3', 'H3', 'C3'),
  hands: {
    user: cards('S4', 'H4', 'C4', 'D4'),
    charA: cards('S5', 'H5', 'C5', 'D5'),
    charB: cards('S6', 'H6', 'C6', 'D6'),
  },
  moves: [],
  dialogue: [],
  passCount: 0,
  createdAt: 1,
  lastActiveAt: 1,
  ...overrides,
} as TheaterDoudizhuGame);

describe('theater doudizhu engine', () => {
  it('creates and deals a unique 54-card deck', () => {
    expect(deck).toHaveLength(54);
    expect(new Set(deck.map(c => c.id)).size).toBe(54);
    const dealt = dealDoudizhuCards(deck);
    expect(dealt.bottomCards).toHaveLength(3);
    expect(dealt.hands.user).toHaveLength(17);
    expect(dealt.hands.charA).toHaveLength(17);
    expect(dealt.hands.charB).toHaveLength(17);
    expect(new Set([...dealt.hands.user, ...dealt.hands.charA, ...dealt.hands.charB, ...dealt.bottomCards].map(c => c.id)).size).toBe(54);
  });

  it('recognizes classic hand types', () => {
    expect(analyzeDoudizhuCards(cards('S3'))?.type).toBe('single');
    expect(analyzeDoudizhuCards(cards('S3', 'H3'))?.type).toBe('pair');
    expect(analyzeDoudizhuCards(cards('S3', 'H3', 'C3'))?.type).toBe('trio');
    expect(analyzeDoudizhuCards(cards('S3', 'H3', 'C3', 'S4'))?.type).toBe('trio_single');
    expect(analyzeDoudizhuCards(cards('S3', 'H3', 'C3', 'S4', 'H4'))?.type).toBe('trio_pair');
    expect(analyzeDoudizhuCards(cards('S3', 'S4', 'S5', 'S6', 'S7'))?.type).toBe('straight');
    expect(analyzeDoudizhuCards(cards('S3', 'H3', 'S4', 'H4', 'S5', 'H5'))?.type).toBe('pair_straight');
    expect(analyzeDoudizhuCards(cards('S3', 'H3', 'C3', 'S4', 'H4', 'C4'))?.type).toBe('plane');
    expect(analyzeDoudizhuCards(cards('S3', 'H3', 'C3', 'S4', 'H4', 'C4', 'S5', 'S6'))?.type).toBe('plane_singles');
    expect(analyzeDoudizhuCards(cards('S3', 'H3', 'C3', 'S4', 'H4', 'C4', 'S5', 'H5', 'S6', 'H6'))?.type).toBe('plane_pairs');
    expect(analyzeDoudizhuCards(cards('S3', 'H3', 'C3', 'D3', 'S4', 'S5'))?.type).toBe('four_two_singles');
    expect(analyzeDoudizhuCards(cards('S3', 'H3', 'C3', 'D3', 'S4', 'H4', 'S5', 'H5'))?.type).toBe('four_two_pairs');
    expect(analyzeDoudizhuCards(cards('S3', 'H3', 'C3', 'D3'))?.type).toBe('bomb');
    expect(analyzeDoudizhuCards(cards('J16', 'J17'))?.type).toBe('rocket');
    expect(analyzeDoudizhuCards(cards('S3', 'S4', 'S5', 'S6', 'S7', 'S15'))).toBeNull();
  });

  it('compares normal hands, bombs and rocket', () => {
    expect(canDoudizhuBeat(analyzeDoudizhuCards(cards('S4')), analyzeDoudizhuCards(cards('S3')))).toBe(true);
    expect(canDoudizhuBeat(analyzeDoudizhuCards(cards('S3', 'H3', 'C3', 'D3')), analyzeDoudizhuCards(cards('S14')))).toBe(true);
    expect(canDoudizhuBeat(analyzeDoudizhuCards(cards('J16', 'J17')), analyzeDoudizhuCards(cards('S3', 'H3', 'C3', 'D3')))).toBe(true);
    expect(canDoudizhuBeat(analyzeDoudizhuCards(cards('S4', 'H4')), analyzeDoudizhuCards(cards('S3')))).toBe(false);
  });

  it('handles bidding, redeal and landlord bottom cards', () => {
    const g = createDoudizhuGame('用户', char('c1', '甲'), char('c2', '乙'), { rng: () => 0.42 });
    const b1 = applyDoudizhuBid(g, 'user', 0);
    expect(b1.ok && b1.game.currentTurn).toBe('charA');
    const b2 = b1.ok && applyDoudizhuBid(b1.game, 'charA', 0);
    const b3 = b2 && b2.ok && applyDoudizhuBid(b2.game, 'charB', 0);
    expect(b3 && b3.ok && b3.game.status).toBe('bidding');
    expect(b3 && b3.ok && b3.game.redealCount).toBe(1);

    const c1 = applyDoudizhuBid(g, 'user', 2);
    const c2 = c1.ok && applyDoudizhuBid(c1.game, 'charA', 0);
    const c3 = c2 && c2.ok && applyDoudizhuBid(c2.game, 'charB', 0);
    expect(c3 && c3.ok && c3.game.status).toBe('playing');
    expect(c3 && c3.ok && c3.game.landlord).toBe('user');
    expect(c3 && c3.ok && c3.game.hands.user).toHaveLength(20);
  });

  it('rejects illegal plays and resolves pass cycles', () => {
    const g = makeGame({
      hands: {
        user: cards('S3', 'H4'),
        charA: cards('S5'),
        charB: cards('S6'),
      },
    });
    const illegal = applyDoudizhuPlay(g, 'user', ['S3', 'H4']);
    expect(illegal.ok).toBe(false);
    const first = applyDoudizhuPlay(g, 'user', ['S3']);
    expect(first.ok && first.game.currentTurn).toBe('charA');
    const passA = first.ok && applyDoudizhuPlay(first.game, 'charA', []);
    expect(passA && passA.ok && passA.game.currentTurn).toBe('charB');
    const passB = passA && passA.ok && applyDoudizhuPlay(passA.game, 'charB', []);
    expect(passB && passB.ok && passB.game.currentTurn).toBe('user');
    expect(passB && passB.ok && passB.game.lastPlay).toBeUndefined();
  });

  it('settles win, spring and prevents playing after ending', () => {
    const g = makeGame({
      hands: {
        user: cards('S3'),
        charA: cards('S4', 'H4'),
        charB: cards('S5', 'H5'),
      },
      moves: [],
    });
    const win = applyDoudizhuPlay(g, 'user', ['S3']);
    expect(win.ok && win.game.status).toBe('ended');
    expect(win.ok && win.game.score?.spring).toBe(true);
    expect(win.ok && win.game.score?.deltas.user).toBeGreaterThan(0);
    const again = win.ok && applyDoudizhuPlay(win.game, 'user', []);
    expect(again && again.ok).toBe(false);
  });

  it('chooses legal moves across difficulties without using missing cards', () => {
    const g = makeGame({
      currentTurn: 'charA',
      hands: {
        user: cards('S3'),
        charA: cards('S4', 'H4', 'C4', 'S6', 'H6', 'J16', 'J17'),
        charB: cards('S5'),
      },
      lastPlay: {
        no: 1,
        by: 'user',
        at: 1,
        cards: cards('S3'),
        analysis: analyzeDoudizhuCards(cards('S3'))!,
      },
    });
    for (const level of ['novice', 'casual', 'steady', 'sharp', 'master'] as const) {
      const picked = chooseDoudizhuMove(g, 'charA', level, () => 0.2);
      if (picked.pass) continue;
      const ids = new Set(g.hands.charA.map(c => c.id));
      expect(picked.cards.every(c => ids.has(c.id))).toBe(true);
      expect(listDoudizhuLegalPlays(g.hands.charA, g.lastPlay?.analysis).some(play => play.map(c => c.id).join(',') === picked.cards.map(c => c.id).join(','))).toBe(true);
    }
  });

  it('falls back stable when LLM difficulty JSON is invalid', () => {
    expect(parseDoudizhuDifficultyResult('not json', 'casual').difficultyLevel).toBe('casual');
    expect(parseDoudizhuDifficultyResult({ difficultyLevel: 'wild' }, 'steady').difficultyLevel).toBe('steady');
    expect(parseDoudizhuDifficultyResult({ difficultyLevel: 'master', difficultyMode: 'per_move' }, 'steady').difficultyMode).toBe('per_move');
  });
});

