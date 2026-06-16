/**
 * Thinking-chain prompt builder.
 *
 * Returns the system-prompt block that steers the model's thinking phase
 * (reasoning_content / <think> tags) into being {charName}'s in-character
 * mental activity rather than AI reasoning.
 *
 * Used by both the main chat flow (hooks/useChatAI.ts) and the proactive
 * message flow (context/OSContext.tsx) so the prompt stays in one place.
 *
 * The caller is responsible for the showThinkingChain gate and for
 * appending any user-supplied thinkingChainCustomPrompt.
 *
 * 文案集中在 `utils/laiwangPrompts.ts` 的 [5] 思考链 区段，改那里即可。
 */
import { thinkingChain } from './laiwangPrompts';

export function buildThinkingChainPrompt(charName: string, userName: string): string {
    return thinkingChain(charName, userName);
}
