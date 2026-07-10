import { describe, expect, it } from 'vitest';
import type { CharacterProfile, TheaterMahjongGame } from '../types';
import {
  analyzeMahjongHu,
  applyMahjongClaim,
  applyMahjongDiscard,
  applyMahjongDraw,
  applyMahjongSelfGang,
  applyMahjongSelfWin,
  canMahjongHu,
  chooseMahjongClaim,
  chooseMahjongDiscard,
  createMahjongDeck,
  createMahjongGame,
  dealMahjongTiles,
  getMahjongClaimActions,
  listMahjongChiOptions,
  parseMahjongDifficultyResult,
  scoreMahjongWin,
} from './theaterMahjong';

const deck = createMahjongDeck();
const tile = (code: string, copy = 0) => {
  const found = deck.find(t => t.code === code && t.copy === copy);
  if (!found) throw new Error(`missing tile ${code}_${copy}`);
  return found;
};
const tiles = (...codes: string[]) => {
  const seen = new Map<string, number>();
  return codes.map(code => {
    const copy = seen.get(code) || 0;
    seen.set(code, copy + 1);
    return tile(code, copy);
  });
};
const char = (id: string, name: string) => ({ id, name } as CharacterProfile);

const makeGame = (overrides: Partial<TheaterMahjongGame> = {}) => ({
  ...createMahjongGame('用户', [
    char('c1', '甲'),
    char('c2', '乙'),
    char('c3', '丙'),
  ], { rng: () => 0.42 }),
  ...overrides,
} as TheaterMahjongGame);

describe('theater mahjong engine', () => {
  it('creates and deals a unique 136-tile wall without flowers', () => {
    expect(deck).toHaveLength(136);
    expect(new Set(deck.map(t => t.id)).size).toBe(136);
    expect(new Set(deck.map(t => t.code)).size).toBe(34);
    for (const code of new Set(deck.map(t => t.code))) {
      expect(deck.filter(t => t.code === code)).toHaveLength(4);
    }

    const dealt = dealMahjongTiles(deck, 'user');
    expect(dealt.hands.user).toHaveLength(14);
    expect(dealt.hands.charA).toHaveLength(13);
    expect(dealt.hands.charB).toHaveLength(13);
    expect(dealt.hands.charC).toHaveLength(13);
    expect(dealt.wall.length + dealt.deadWall.length + 53).toBe(136);
  });

  it('recognizes standard hands, seven pairs and rejects illegal hands', () => {
    expect(canMahjongHu(tiles('W1', 'W2', 'W3', 'W4', 'W5', 'W6', 'W7', 'W8', 'W9', 'D2', 'D2', 'D2', 'H1', 'H1'))).toBe(true);
    const sevenPairs = analyzeMahjongHu(tiles('W1', 'W1', 'W2', 'W2', 'D3', 'D3', 'D4', 'D4', 'B5', 'B5', 'B6', 'B6', 'H5', 'H5'));
    expect(sevenPairs.ok).toBe(true);
    expect(sevenPairs.pattern).toBe('seven_pairs');
    expect(sevenPairs.fan).toBeGreaterThanOrEqual(2);
    expect(canMahjongHu(tiles('W1', 'W1', 'W1', 'W2', 'W3', 'W4', 'D5', 'D6', 'D7', 'B8', 'B8', 'H1', 'H2', 'H3'))).toBe(false);
  });

  it('handles draw, discard and claim windows', () => {
    let g = makeGame({
      phase: 'draw',
      currentTurn: 'charC',
      hands: {
        user: tiles('W2', 'W3', 'D1', 'D1', 'B1', 'B2', 'B3', 'H1', 'H1', 'H1', 'H2', 'H2', 'H2'),
        charA: tiles('W1', 'W1', 'W5', 'W6', 'W7', 'D2', 'D3', 'D4', 'B7', 'B8', 'B9', 'H3', 'H3'),
        charB: tiles('W9', 'W9', 'D5', 'D5', 'B5', 'B5', 'H4', 'H4', 'H5', 'H5', 'H6', 'H6', 'H7'),
        charC: tiles('W1', 'W4', 'D6', 'D6', 'B6', 'B6', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'H7'),
      },
      wall: tiles('W8', 'W9', 'D9'),
      deadWall: tiles('B9'),
    });
    const draw = applyMahjongDraw(g, 'charC');
    expect(draw.ok && draw.game.hands.charC).toHaveLength(14);
    g = draw.ok ? draw.game : g;
    const discard = applyMahjongDiscard(g, 'charC', g.hands.charC.find(t => t.code === 'W1')!.id);
    expect(discard.ok).toBe(true);
    expect(discard.ok && discard.game.pendingClaim).toBeTruthy();
    expect(discard.ok && getMahjongClaimActions(discard.game, 'user')).toContain('chi');
  });

  it('supports chi, peng and ming gang claims', () => {
    const base = makeGame({
      phase: 'discard',
      currentTurn: 'charC',
      hands: {
        user: tiles('W2', 'W3', 'D1', 'D1', 'B1', 'B2', 'B3', 'H1', 'H1', 'H1', 'H2', 'H2', 'H2'),
        charA: tiles('W1', 'W1', 'W1', 'W5', 'W6', 'W7', 'D2', 'D3', 'D4', 'B7', 'B8', 'B9', 'H3', 'H4'),
        charB: tiles('W1', 'W1', 'D5', 'D5', 'B5', 'B5', 'H4', 'H4', 'H5', 'H5', 'H6', 'H6', 'H7'),
        charC: tiles('W1', 'W1', 'W1', 'D6', 'D6', 'B6', 'B6', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'H7'),
      },
    });
    const discarded = applyMahjongDiscard(base, 'charC', base.hands.charC.find(t => t.code === 'W1')!.id);
    expect(discarded.ok && listMahjongChiOptions(discarded.game.hands.user, discarded.game.pendingClaim!.discard)).toHaveLength(1);
    const chi = discarded.ok && applyMahjongClaim(discarded.game, 'user', 'chi');
    expect(chi && chi.ok && chi.game.melds.user[0].type).toBe('chi');

    const pengBase = discarded.ok ? discarded.game : base;
    const peng = applyMahjongClaim(pengBase, 'charB', 'peng');
    expect(peng.ok && peng.game.melds.charB[0].type).toBe('peng');

    const gang = applyMahjongClaim(pengBase, 'charA', 'gang');
    expect(gang.ok && gang.game.melds.charA[0].type).toBe('ming_gang');
    expect(gang.ok && gang.game.hands.charA.length).toBeGreaterThan(10);
  });

  it('settles dianpao, zimo, draw game and prevents play after ending', () => {
    const g = makeGame({
      phase: 'claim',
      currentTurn: 'charA',
      hands: {
        user: tiles('W1', 'W2', 'W3', 'W4', 'W5', 'W6', 'W7', 'W8', 'W9', 'D2', 'D2', 'D2', 'H1'),
        charA: tiles('H1', 'D1', 'D1', 'B1', 'B1', 'H2', 'H2', 'H3', 'H3', 'H4', 'H4', 'H5', 'H5'),
        charB: tiles('W9', 'W9', 'D5', 'D5', 'B5', 'B5', 'H4', 'H4', 'H5', 'H5', 'H6', 'H6', 'H7'),
        charC: tiles('W4', 'W4', 'D6', 'D6', 'B6', 'B6', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'H7'),
      },
      pendingClaim: { discard: tile('H1', 1), from: 'charA', moveNo: 3, actions: { user: ['hu'] }, passed: [] },
    });
    const hu = applyMahjongClaim(g, 'user', 'hu');
    expect(hu.ok && hu.game.status).toBe('ended');
    expect(hu.ok && hu.game.score?.winType).toBe('dianpao');
    const again = hu.ok && applyMahjongDiscard(hu.game, 'user', hu.game.hands.user[0].id);
    expect(again && again.ok).toBe(false);

    const zimoGame = makeGame({
      phase: 'discard',
      currentTurn: 'user',
      hands: { ...makeGame().hands, user: tiles('W1', 'W2', 'W3', 'W4', 'W5', 'W6', 'W7', 'W8', 'W9', 'D2', 'D2', 'D2', 'H1', 'H1') },
    });
    const zimo = applyMahjongSelfWin(zimoGame, 'user');
    expect(zimo.ok && zimo.game.score?.winType).toBe('zimo');

    const drawn = applyMahjongDraw(makeGame({ phase: 'draw', currentTurn: 'user', wall: [] }), 'user');
    expect(drawn.ok && drawn.game.score?.draw).toBe(true);
  });

  it('handles concealed gang and scoring fan', () => {
    const g = makeGame({
      phase: 'discard',
      currentTurn: 'user',
      hands: { ...makeGame().hands, user: tiles('W1', 'W1', 'W1', 'W1', 'W2', 'W3', 'W4', 'D2', 'D3', 'D4', 'B5', 'B6', 'B7', 'H1') },
      deadWall: tiles('H1'),
    });
    const gang = applyMahjongSelfGang(g, 'user', 'W1');
    expect(gang.ok && gang.game.melds.user[0].type).toBe('an_gang');
    expect(gang.ok && gang.game.hands.user.some(t => t.code === 'H1')).toBe(true);

    const analysis = analyzeMahjongHu(tiles('W1', 'W2', 'W3', 'W4', 'W5', 'W6', 'W7', 'W8', 'W9', 'W2', 'W2', 'W2', 'W5', 'W5'));
    const score = scoreMahjongWin(g, 'user', undefined, 'zimo', analysis);
    expect(score.fanNames).toContain('清一色');
    expect(score.deltas.user).toBeGreaterThan(0);
  });

  it('chooses legal AI actions and falls back stable when LLM JSON is invalid', () => {
    const g = makeGame();
    for (const level of ['novice', 'casual', 'steady', 'sharp', 'master'] as const) {
      const picked = chooseMahjongDiscard(g, 'charA', level, () => 0.2);
      expect(picked && g.hands.charA.some(t => t.id === picked.id)).toBe(true);
    }
    const pending = applyMahjongDiscard(makeGame({ phase: 'discard', currentTurn: 'user' }), 'user', makeGame().hands.user[0].id);
    if (pending.ok && pending.game.pendingClaim?.actions.charA) {
      expect(['chi', 'peng', 'gang', 'hu', 'pass']).toContain(chooseMahjongClaim(pending.game, 'charA', 'steady', () => 0.2));
    }

    expect(parseMahjongDifficultyResult('not json', 'casual').difficultyLevel).toBe('casual');
    expect(parseMahjongDifficultyResult({ difficultyLevel: 'wild' }, 'steady').difficultyLevel).toBe('steady');
    expect(parseMahjongDifficultyResult({ difficultyLevel: 'master', difficultyMode: 'per_move' }, 'steady').difficultyMode).toBe('per_move');
  });
});
