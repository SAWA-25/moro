import { describe, expect, it } from 'vitest';
import type { CharacterProfile, Message, UserProfile } from '../types';
import { ChatPrompts, isMessageBlockedByPromptSwitch } from './chatPrompts';
import { ContextBuilder } from './context';

const user: UserProfile = {
  name: 'User',
  avatar: '',
  bio: '',
};

const baseChar = {
  id: 'char-a',
  name: 'Moro',
  avatar: '',
  systemPrompt: 'Stay in character.',
} as CharacterProfile;

const msg = (id: number, type: Message['type'], content: string): Message => ({
  id,
  charId: 'char-a',
  role: 'assistant',
  type,
  content,
  timestamp: 1_700_000_000_000 + id,
});

describe('ChatPrompts prompt switch gates', () => {
  it('keeps disabled VR cards out of prompt history', () => {
    const history = [
      msg(1, 'text', '普通聊天'),
      msg(2, 'vr_card', '页外旧动态不该继续进模型'),
      msg(3, 'text', '继续聊天'),
    ];

    expect(isMessageBlockedByPromptSwitch(history[1], baseChar)).toBe(true);

    const { apiMessages } = ChatPrompts.buildMessageHistory(history, 10, baseChar, user, []);
    const text = apiMessages.map(m => String(m.content)).join('\n');

    expect(text).toContain('普通聊天');
    expect(text).toContain('继续聊天');
    expect(text).not.toContain('页外旧动态不该继续进模型');
    expect(text).not.toContain('《页外》');
  });

  it('keeps VR cards available when VR is enabled', () => {
    const enabledChar = {
      ...baseChar,
      vrState: { enabled: true, intervalMinutes: 120, currentRoom: 'library' },
    } as CharacterProfile;
    const history = [msg(1, 'vr_card', '页外动态可以进入模型')];

    expect(isMessageBlockedByPromptSwitch(history[0], enabledChar)).toBe(false);

    const { apiMessages } = ChatPrompts.buildMessageHistory(history, 10, enabledChar, user, []);
    const text = apiMessages.map(m => String(m.content)).join('\n');

    expect(text).toContain('页外动态可以进入模型');
    expect(text).toContain('你在《页外》里的动态');
  });

  it('keeps disabled HTML cards out of prompt history', () => {
    const htmlOffChar = { ...baseChar, htmlModeEnabled: false } as CharacterProfile;
    const history = [
      msg(1, 'text', '普通聊天'),
      msg(2, 'html_card', '[HTML卡片] secret layout'),
    ];

    expect(isMessageBlockedByPromptSwitch(history[1], htmlOffChar)).toBe(true);

    const { apiMessages } = ChatPrompts.buildMessageHistory(history, 10, htmlOffChar, user, []);
    const text = apiMessages.map(m => String(m.content)).join('\n');

    expect(text).toContain('普通聊天');
    expect(text).not.toContain('secret layout');
    expect(text).not.toContain('[html]');
    expect(text).not.toContain('HTML 卡片');
  });

  it('keeps HTML card summaries available when HTML mode is enabled', () => {
    const history = [msg(1, 'html_card', '[HTML卡片] visible layout')];

    expect(isMessageBlockedByPromptSwitch(history[0], baseChar)).toBe(false);

    const { apiMessages } = ChatPrompts.buildMessageHistory(history, 10, baseChar, user, []);
    const text = apiMessages.map(m => String(m.content)).join('\n');

    expect(text).toContain('visible layout');
    expect(text).toContain('HTML 卡片');
  });

  it('does not let unreadable user music trigger music prompt context', () => {
    const musicOffChar = {
      ...baseChar,
      musicProfile: {
        bio: '',
        genreTags: [],
        signatureArtists: [],
        playlists: [{
          id: 'pl-a',
          title: 'SecretMix',
          description: '',
          coverStyle: '',
          songs: [{
            id: 1,
            name: 'HiddenSong',
            artists: 'Someone',
            album: '',
            albumPic: '',
            duration: 180,
            fee: 0,
            addedAt: 1,
            source: 'user',
          }],
          createdAt: 1,
          updatedAt: 1,
        }],
        likedSongIds: [],
        recentPlays: [],
        canReadUserMusic: false,
        updatedAt: 1,
      },
    } as CharacterProfile;

    const block = ContextBuilder.buildMusicAtmosphere(
      musicOffChar,
      user.name,
      {
        songName: 'HiddenSong',
        artists: 'Someone',
        lyricWindow: ['secret lyric'],
        activeIdx: 0,
      },
      null,
      false,
    );

    expect(block.trim()).toBe('');
    expect(block).not.toContain('HiddenSong');
    expect(block).not.toContain('SecretMix');
    expect(block).not.toContain('secret lyric');
  });
});
