import { describe, expect, it } from 'vitest';
import { buildChatLocationMap, resolveChatLocationMap, ChatLocationMapData } from './chatLocationMap';

const pointsOf = (map: ChatLocationMapData) => [
  map.anchor,
  map.user,
  ...map.landmarks.map(point => ({ x: point.x, y: point.y })),
];

describe('chatLocationMap', () => {
  it('generates a stable local map for the same location text', () => {
    const one = buildChatLocationMap('街角咖啡馆', '江汉路口二楼靠窗');
    const two = buildChatLocationMap('街角咖啡馆', '江汉路口二楼靠窗');

    expect(two).toEqual(one);
  });

  it('uses different seeds for different locations', () => {
    const cafe = buildChatLocationMap('街角咖啡馆', '江汉路口二楼靠窗');
    const plaza = buildChatLocationMap('老城记忆广场', '大槐树旁');

    expect(plaza.seed).not.toBe(cafe.seed);
    expect(plaza.anchor).not.toEqual(cafe.anchor);
  });

  it('keeps all generated coordinates inside the map bounds', () => {
    const map = buildChatLocationMap('很长很长的地方名字也要能放下', '三楼东侧靠近扶梯的位置');

    for (const point of pointsOf(map)) {
      expect(point.x).toBeGreaterThanOrEqual(0);
      expect(point.x).toBeLessThanOrEqual(100);
      expect(point.y).toBeGreaterThanOrEqual(0);
      expect(point.y).toBeLessThanOrEqual(100);
    }
  });

  it('falls back for old or malformed metadata without writing a migration', () => {
    const oldMessageMap = resolveChatLocationMap('便利店门口', '', undefined);
    const brokenMap = resolveChatLocationMap('便利店门口', '', { version: 1, mode: 'local', anchor: { x: 'bad' } });

    expect(oldMessageMap.mode).toBe('local');
    expect(oldMessageMap.landmarks.length).toBeGreaterThan(0);
    expect(brokenMap).toEqual(oldMessageMap);
  });
});
