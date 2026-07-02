import { describe, expect, it } from 'vitest';
import { AppID } from '../../types';
import { buildAppAreaCssPrompt, buildAppCssPrompt, buildChatChromeCssPrompt, APP_CSS_AREAS } from './prompts';

describe('appearance prompts', () => {
  it('scopes app prompts to the selected app', () => {
    const prompt = buildAppCssPrompt('音乐', AppID.Music, 'complete');
    expect(prompt).toContain('[data-moro-app="music"]');
    expect(prompt).toContain('.moro-app-shell-music');
    expect(prompt).toContain('只改 Moro 的「音乐」');
  });

  it('includes area selectors for app local prompts', () => {
    const area = APP_CSS_AREAS.find(a => a.id === 'buttons');
    expect(area).toBeTruthy();
    const prompt = buildAppAreaCssPrompt('絮语', AppID.GroupChat, area!);
    expect(prompt).toContain('[data-moro-app="group_chat"] button');
    expect(prompt).toContain('按钮与工具条');
  });

  it('keeps chat chrome prompts away from bubble css', () => {
    const prompt = buildChatChromeCssPrompt('fix', '.moro-chat-back{display:none}');
    expect(prompt).toContain('.moro-chat-header');
    expect(prompt).toContain('.moro-chat-inputbar');
    expect(prompt).toContain('气泡本体不要在这里写');
    expect(prompt).toContain('.moro-chat-back{display:none}');
  });
});
