const ROLEPLAY_META_PATTERNS: RegExp[] = [
  /(?:以|按|根据).{0,12}(?:我|我的|TA|ta|他|她|这个角色|角色).{0,8}(?:性格|人设|设定|口吻|身份)/i,
  /(?:更自然|比较自然|自然的可能|更合适).{0,18}(?:可能是|是|：|:)/,
  /(?:这条|这句|这个)?(?:消息|回复|台词).{0,10}(?:可以|应该|会|要).{0,14}(?:是|写成|表达|继续)/,
  /(?:我|角色|模型|AI).{0,8}(?:应该|需要).{0,12}(?:输出|生成|回复|表达|扮演)/i,
  /(?:系统提示|系统指令|开发者指令|隐藏上下文|隐藏任务|后台规则|提示词|system prompt|prompt|角色ID|身份锚|modelId|charId)/i,
  /(?:API|JSON|Markdown|代码块|字段名).{0,18}(?:格式|规则|要求|输出|返回|对象|数组|字段|正文|回复|解释|解析)/i,
  /(?:只输出|不要输出|返回|生成|必须输出).{0,18}(?:API|JSON|Markdown|代码块|字段名|对象|数组)/i,
  /(?:角色卡|人设|世界书|记忆|设定).{0,12}(?:原文|字段|条目|内容|如下|写着|要求)/,
  /(?:根据|按照|依照|基于).{0,16}(?:系统提示|提示词|角色卡|人设|设定|世界书|隐藏上下文|身份锚)/,
  /(?:AI\s*)?模型.{0,10}(?:回复|生成|输出|扮演|分析)|(?:回复|生成|输出|扮演|分析).{0,10}(?:AI\s*)?模型/i,
  /(?:只输出|不要输出|生成|任务|要求).{0,18}(?:JSON|对象|字段|正文|短评|台词|回复)/,
  /(?:现在的时间是|当前时间是).{0,30}(?:我刚才|刚才|回复|消息)/,
  /(?:我刚才|刚刚).{0,16}发.{0,16}给(?:她|他|TA|ta|用户|user)/i,
  /(?:她|他|TA|ta|用户|user).{0,12}(?:还没|没有|没).{0,8}回复我/i,
  /(?:她|他|TA|ta|用户|user).{0,16}(?:先|又|还).{0,12}(?:发了?消息|聊天|回复)/i,
];

const sentenceChunks = (text: string): string[] =>
  text.match(/[^。！？!?；;\n]+[。！？!?；;]?/g) || [text];

export function hasRoleplayMetaLeak(text: unknown): boolean {
  const value = String(text ?? '').trim();
  if (!value) return false;
  return ROLEPLAY_META_PATTERNS.some(pattern => pattern.test(value));
}

export function stripRoleplayMetaLeaks(text: unknown): string {
  const value = String(text ?? '');
  if (!value.trim()) return '';
  let changed = false;
  const cleaned = value
    .split(/\r?\n/)
    .map(line => {
      const trimmed = line.trim();
      if (!trimmed) return '';
      if (hasRoleplayMetaLeak(trimmed)) {
        changed = true;
        const quotedSuggestion = trimmed.match(/(?:这条|这句|这个)?(?:消息|回复|台词).{0,10}(?:可以|应该|会|要).{0,14}(?:是|写成|表达|继续)\s*[：:]\s*(.+)$/)
          || trimmed.match(/(?:更自然|比较自然|自然的可能|更合适).{0,18}(?:可能是|是)\s*[：:]\s*(.+)$/);
        if (quotedSuggestion?.[1] && !hasRoleplayMetaLeak(quotedSuggestion[1])) return quotedSuggestion[1].trim();
        const kept = sentenceChunks(trimmed).filter(part => !hasRoleplayMetaLeak(part)).join('').trim();
        return kept;
      }
      return line;
    });
  if (!changed) return value.trim();
  return cleaned
    .filter(line => line.trim())
    .join('\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}
