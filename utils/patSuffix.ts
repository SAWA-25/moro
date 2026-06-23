/**
 * 拍一拍后缀（微信式「拍了拍 X 的<后缀>」）。
 *
 * - 用户拍角色：显示角色的后缀（`char.patSuffix`）。角色可用 `[[PAT_SUFFIX: 后缀]]` 自己改。
 * - 角色拍用户：用户在回复里输出 `[[PAT]]` 即可拍用户一下，显示用户的后缀（`userProfile.patSuffix`，
 *   用户在「文具盒 → 我」里自定义）。
 *
 * 纯解析 + 事件名，方便 vitest 覆盖，不依赖 React / DB。
 */

export const DEFAULT_PAT_SUFFIX = '脑袋';
export const CHAR_PAT_SUFFIX_EVENT = 'moro-char-pat-suffix'; // 角色改自己的拍一拍后缀
export const CHAR_PAT_EVENT = 'moro-char-pat';               // 角色拍用户一下

const SUFFIX_RE = /\[\[\s*PAT_SUFFIX\s*[:：]\s*([^\]]*?)\s*\]\]/i;
const SUFFIX_RE_G = /\[\[\s*PAT_SUFFIX\s*[:：][^\]]*\]\]/gi;
// 注意：PAT 后必须紧跟 ]]，不会误吃 PAT_SUFFIX（其后是 "_SUFFIX"）。
const PAT_RE = /\[\[\s*PAT\s*\]\]/i;
const PAT_RE_G = /\[\[\s*PAT\s*\]\]/gi;

/** 剥离 [[PAT_SUFFIX: 后缀]] 并返回新后缀（取第一个命中；可为空串＝清掉后缀）。 */
export const extractPatSuffixDirective = (content: string): { content: string; suffix: string | null } => {
    if (!content) return { content, suffix: null };
    const m = content.match(SUFFIX_RE);
    if (!m) return { content, suffix: null };
    const suffix = (m[1] || '').trim().slice(0, 20);
    return { content: content.replace(SUFFIX_RE_G, '').trim(), suffix };
};

/** 剥离 [[PAT]] 并返回是否命中（角色拍用户）。 */
export const extractPatDirective = (content: string): { content: string; pat: boolean } => {
    if (!content) return { content, pat: false };
    PAT_RE.lastIndex = 0;
    const pat = PAT_RE.test(content);
    if (!pat) return { content, pat: false };
    return { content: content.replace(PAT_RE_G, '').trim(), pat: true };
};
