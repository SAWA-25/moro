# 人生拟 AI 全面扩展 Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** 在已完成“人生拟”基础功能（时间/工资/求职/经营/投资/公司/借款/账本）的基础上，继续细化求职、投资、人生事件与借款仿真，并全面接入 AI：AI 生成今日事件、岗位/招聘方聊天、简历评估、股市随机行情/资讯、借款审核与风险评估等。

**Architecture:** 继续沿用现有 `AppID.Bank` / `apps/BankApp.tsx` 单页入口与 `utils/bankLife.ts` 纯逻辑层，但把“AI 调用”集中封装到新的 `utils/bankLifeAi.ts`，避免在 UI 里散落 fetch 逻辑。纯函数规则仍保留确定性 fallback，AI 失败时不阻塞玩法；AI 结果进入 `BankLifeState` 的事件、岗位、聊天、股市、借款审核等结构。后续如果 `BankApp.tsx` 继续膨胀，再按模块拆组件。

**Tech Stack:** React + TypeScript + Vite + IndexedDB；OpenAI-compatible Chat Completion（通过 `resolveAuxApi` + `safeResponseJson`/`safeFetchJson`）；Vitest；pnpm。

---

## 当前上下文 / 假设

- 工作目录：`C:\Users\Sss24\Desktop\moro\moro`
- 已有计划：`.hermes/plans/2026-06-29_055451-life-sim-app.md`
- 已实现并验证过的基础增强：
  - `pnpm run test:run`：52 files / 734 tests passed
  - `pnpm run build`：成功
- 当前关键文件：
  - `apps/BankApp.tsx`：人生拟 UI，已有 `life | jobs | shop | invest | company | loans | report` tab。
  - `utils/bankLife.ts`：人生拟核心纯函数，已有 `JOB_POSTINGS`、`advanceBankLifeDay`、求职、股票、公司、借款逻辑。
  - `types.ts:1728-1929`：BankLife 相关类型。
  - `utils/auxApi.ts`：副 API 解析。
  - `utils/safeApi.ts`：安全解析 OpenAI-compatible 响应。
  - `utils/bankLife.test.ts` / `utils/bankLedger.test.ts`：现有测试。
- 约束：
  - 本计划只规划，不执行代码。
  - AI 生成必须有 fallback，不能因为 API 失败导致“下一天/求职/借款/行情”卡死。
  - 不要复制 Boss 直聘/同花顺等品牌名、Logo 或受保护素材；模仿信息架构与交互即可。
  - 所有金融/借款/投资均为虚拟模拟，文案需避免真实金融建议。

---

## 总体设计

### 1. AI 接入边界

新增 `utils/bankLifeAi.ts`，只负责：

- 组装 prompt。
- 调用 OpenAI-compatible Chat Completion。
- 安全解析 JSON。
- 校验/裁剪 AI 输出。
- API 失败时返回本地 fallback。

UI 层只调用：

```ts
import {
  generateAiLifeDay,
  generateAiJobs,
  generateAiRecruiterReply,
  generateAiResumeReview,
  generateAiMarketPulse,
  generateAiLoanReview,
} from '../utils/bankLifeAi';
```

纯逻辑层 `utils/bankLife.ts` 继续保留确定性函数，AI 只作为“内容生成/评估增强”。

### 2. 数据流

```text
BankApp UI action
  → resolveAuxApi(auxApi, apiConfig)
  → utils/bankLifeAi.ts
  → AI JSON / fallback JSON
  → utils/bankLife.ts merge/apply helper
  → persistStateUpdate(...)
  → DB.saveBankState
```

### 3. AI 输出原则

- 所有 AI 输出必须是 JSON object，不接受散文。
- 每个 AI 输出 schema 都有 TypeScript 类型与 sanitizer。
- AI 不直接改余额；余额变化仍由 `utils/bankLife.ts` 的纯函数或 UI 调用 `adjustUserBalance` 完成。
- AI 可以生成事件、岗位、聊天回复、新闻、审核理由、风险提示、分数，但最终数值需要 clamp。

---

## Files likely to change

- Create: `utils/bankLifeAi.ts`
- Create: `utils/bankLifeAi.test.ts`
- Modify: `types.ts:1728-1929`
- Modify: `utils/bankLife.ts`
- Modify: `utils/bankLife.test.ts`
- Modify: `apps/BankApp.tsx`
- Optional later split if file becomes too large:
  - Create: `apps/bank/JobBoard.tsx`
  - Create: `apps/bank/RecruiterChatPanel.tsx`
  - Create: `apps/bank/ResumeEditor.tsx`
  - Create: `apps/bank/InvestBoard.tsx`
  - Create: `apps/bank/LoanCenter.tsx`

---

## Task 1: Add AI result types to `types.ts`

**Objective:** 给 AI 生成内容建立明确、可测试的数据结构。

**Files:**
- Modify: `types.ts:1728-1929`
- Test: no runtime test yet; type usage covered by later tests.

**Step 1: Add types after `BankLifeEvent`**

Add these interfaces near `BankLifeEvent`:

```ts
export interface BankLifeAiEvent extends BankLifeEvent {
    source?: 'ai' | 'system';
    category?: 'daily' | 'career' | 'market' | 'company' | 'loan' | 'shop';
    choices?: { id: string; label: string; effectHint: string }[];
}

export interface BankResumeProfile {
    name: string;
    headline: string;
    expectedSalaryMin?: number;
    expectedSalaryMax?: number;
    expectedCategories: string[];
    skills: string[];
    experience: { id: string; title: string; company: string; detail: string }[];
    education?: string;
    selfIntro: string;
    updatedAt: number;
}

export interface BankJobSearchSession {
    id: string;
    query: string;
    category: string;
    filters: {
        salaryMin?: number;
        payCycle?: BankJobPayCycle | 'any';
        risk?: 'any' | 'safe' | 'high-risk';
        location?: string;
    };
    generatedAt: string;
    source: 'preset' | 'ai';
}

export interface BankMarketPulse {
    id: string;
    dateStr: string;
    headline: string;
    summary: string;
    affectedSymbols: string[];
    sentiment: 'bullish' | 'neutral' | 'bearish';
    source: 'ai' | 'system';
}

export interface BankLoanCreditProfile {
    score: number;
    incomeStability: number;
    debtPressure: number;
    repaymentHistory: number;
    riskLevel: 'low' | 'medium' | 'high' | 'danger';
    reasons: string[];
    updatedAt: string;
}
```

**Step 2: Extend existing interfaces**

Modify `BankJobApplication`:

```ts
resumeSnapshot?: BankResumeProfile;
aiReview?: { score: number; strengths: string[]; weaknesses: string[]; suggestion: string };
```

Modify `BankStockQuote`:

```ts
aiReason?: string;
```

Modify `BankLoan`:

```ts
creditProfile?: BankLoanCreditProfile;
reviewReason?: string;
serviceFee?: number;
collectionRisk?: string;
```

Modify `BankLifeState`:

```ts
aiEvents?: BankLifeAiEvent[];
resume?: BankResumeProfile;
jobSearchSessions?: BankJobSearchSession[];
marketPulses?: BankMarketPulse[];
creditProfile?: BankLoanCreditProfile;
aiLastGeneratedAt?: Record<string, string>;
```

**Step 3: Verification**

Run after implementation:

```bash
pnpm run test:run -- utils/bankLife.test.ts
```

Expected: existing tests either pass or fail only because migration/defaults need updating in Task 2.

**Commit:**

```bash
git add types.ts
git commit -m "feat: add life sim AI data types"
```

---

## Task 2: Add default/migration support for new fields

**Objective:** 让旧存档安全升级到 AI 扩展字段，避免 undefined 访问。

**Files:**
- Modify: `utils/bankLife.ts`
- Test: `utils/bankLife.test.ts`

**Step 1: Write failing test**

Add to `utils/bankLife.test.ts`:

```ts
it('migrates AI extension fields with safe defaults', () => {
    const migrated = migrateBankLifeState({
        config: { dailyBudget: 100, currencySymbol: '¥' },
        shop: { actionPoints: 1, shopName: '旧店', shopLevel: 1, appeal: 100, background: '', staff: [], unlockedRecipes: [], totalRevenue: 0 },
        goals: [],
        todaySpent: 0,
        lastLoginDate: '2026-06-01',
    } as unknown as BankFullState);

    expect(migrated.life?.aiEvents).toEqual([]);
    expect(migrated.life?.jobSearchSessions).toEqual([]);
    expect(migrated.life?.marketPulses).toEqual([]);
    expect(migrated.life?.resume?.skills).toEqual([]);
    expect(migrated.life?.creditProfile?.score).toBeGreaterThan(0);
});
```

**Step 2: Run test to verify failure**

```bash
pnpm run test:run -- utils/bankLife.test.ts
```

Expected: FAIL because fields do not exist / are undefined.

**Step 3: Implement defaults**

In `utils/bankLife.ts`, add helpers:

```ts
function defaultResume(dateStr: string): BankResumeProfile {
    return {
        name: '我',
        headline: '正在探索人生拟机会',
        expectedCategories: [],
        skills: [],
        experience: [],
        education: '',
        selfIntro: '希望找到适合当前生活节奏的机会。',
        updatedAt: Date.now(),
    };
}

function defaultCreditProfile(): BankLoanCreditProfile {
    return {
        score: 620,
        incomeStability: 50,
        debtPressure: 20,
        repaymentHistory: 70,
        riskLevel: 'medium',
        reasons: ['暂无完整收入与还款记录，先按中等信用评估。'],
        updatedAt: todayStr(),
    };
}
```

Update `createDefaultBankLifeState()` and `migrateBankLifeState()` to set:

```ts
aiEvents: [],
resume: defaultResume(dateStr),
jobSearchSessions: [],
marketPulses: [],
creditProfile: defaultCreditProfile(),
aiLastGeneratedAt: {},
```

**Step 4: Run test to verify pass**

```bash
pnpm run test:run -- utils/bankLife.test.ts
```

Expected: PASS.

**Commit:**

```bash
git add utils/bankLife.ts utils/bankLife.test.ts
git commit -m "feat: migrate life sim AI fields"
```

---

## Task 3: Create `utils/bankLifeAi.ts` with safe OpenAI-compatible JSON helper

**Objective:** 集中封装人生拟 AI 调用、JSON 解析与 fallback。

**Files:**
- Create: `utils/bankLifeAi.ts`
- Create: `utils/bankLifeAi.test.ts`

**Step 1: Write failing tests**

Create `utils/bankLifeAi.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { parseAiJsonObject, sanitizeAiEvent } from './bankLifeAi';

vi.mock('./safeApi', () => ({
    safeResponseJson: vi.fn(),
}));

describe('bankLifeAi', () => {
    it('parses plain JSON content from chat completion', () => {
        const parsed = parseAiJsonObject('{"title":"今天有事","items":[1]}');
        expect(parsed).toEqual({ title: '今天有事', items: [1] });
    });

    it('parses fenced JSON content from chat completion', () => {
        const parsed = parseAiJsonObject('```json\n{"ok":true}\n```');
        expect(parsed).toEqual({ ok: true });
    });

    it('sanitizes AI event shape and clamps long text', () => {
        const event = sanitizeAiEvent({ title: '  面试邀约  ', detail: 'x'.repeat(600), tone: 'weird' }, '2026-06-01');
        expect(event.title).toBe('面试邀约');
        expect(event.detail.length).toBeLessThanOrEqual(240);
        expect(event.tone).toBe('info');
    });
});
```

**Step 2: Run test to verify failure**

```bash
pnpm run test:run -- utils/bankLifeAi.test.ts
```

Expected: FAIL — module/functions do not exist.

**Step 3: Implement minimal helper**

Create `utils/bankLifeAi.ts`:

```ts
import { safeResponseJson } from './safeApi';
import type { ResolvedApi } from './auxApi';
import type { BankLifeAiEvent, BankLifeState } from '../types';

export function parseAiJsonObject(raw: string): any {
    const trimmed = String(raw || '').trim();
    const unfenced = trimmed
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/```$/i, '')
        .trim();
    return JSON.parse(unfenced);
}

const clampText = (v: unknown, fallback: string, max = 240) => {
    const s = String(v || fallback).trim() || fallback;
    return s.length > max ? `${s.slice(0, max - 1)}…` : s;
};

const toneSet = new Set(['good', 'warn', 'bad', 'info']);

export function sanitizeAiEvent(input: any, dateStr: string): BankLifeAiEvent {
    const tone = toneSet.has(input?.tone) ? input.tone : 'info';
    return {
        id: `ai-life-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        dateStr,
        title: clampText(input?.title, '今日事件', 40),
        detail: clampText(input?.detail, '生活继续往前推进。', 240),
        tone,
        source: 'ai',
        category: input?.category || 'daily',
    };
}

export async function callBankLifeAiJson(api: ResolvedApi, messages: { role: 'system' | 'user'; content: string }[], fallback: any): Promise<any> {
    if (!api?.baseUrl || !api?.model) return fallback;
    try {
        const response = await fetch(`${api.baseUrl.replace(/\/$/, '')}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(api.apiKey ? { Authorization: `Bearer ${api.apiKey}` } : {}),
            },
            body: JSON.stringify({
                model: api.model,
                messages,
                temperature: 0.9,
                stream: false,
            }),
        });
        const json = await safeResponseJson(response);
        const content = json?.choices?.[0]?.message?.content || '';
        return parseAiJsonObject(content);
    } catch (error) {
        console.warn('[BankLifeAI] fallback', error);
        return fallback;
    }
}
```

**Step 4: Run test to verify pass**

```bash
pnpm run test:run -- utils/bankLifeAi.test.ts
```

Expected: PASS.

**Commit:**

```bash
git add utils/bankLifeAi.ts utils/bankLifeAi.test.ts
git commit -m "feat: add life sim AI helper"
```

---

## Task 4: AI-generate daily life events for “下一天”

**Objective:** 点击“下一天”时，除工资/贷款/股市/公司确定性结算外，AI 生成 1-3 条“今日事件”。

**Files:**
- Modify: `utils/bankLifeAi.ts`
- Modify: `apps/BankApp.tsx:1126-1133`, `apps/BankApp.tsx:1644-1713`
- Modify: `utils/bankLife.test.ts` only for pure merge helper if needed.

**Step 1: Add AI function contract**

In `utils/bankLifeAi.ts` add:

```ts
export async function generateAiLifeDay(api: ResolvedApi, life: BankLifeState): Promise<BankLifeAiEvent[]> {
    const fallback = [{ title: '平稳的一天', detail: '今天没有特别大的波澜，但你更清楚下一步要做什么。', tone: 'info', category: 'daily' }];
    const data = await callBankLifeAiJson(api, [
        { role: 'system', content: '你是人生拟模拟器事件导演。只输出 JSON：{"events":[{"title":"","detail":"","tone":"good|warn|bad|info","category":"daily|career|market|company|loan|shop"}]}' },
        { role: 'user', content: JSON.stringify({ dateStr: life.dateStr, dayIndex: life.dayIndex, job: life.currentJob?.title, fatigue: life.fatigue, energy: life.energy, company: life.company?.name, loans: life.loans.length, holdings: Object.keys(life.holdings) }) },
    ], { events: fallback });
    return (Array.isArray(data?.events) ? data.events : fallback).slice(0, 3).map((e: any) => sanitizeAiEvent(e, life.dateStr));
}
```

**Step 2: Wire into `handleAdvanceLifeDay`**

In `apps/BankApp.tsx`, after `advanceBankLifeDay(cur.life!)`:

```ts
const api = resolveAuxApi(auxApi, apiConfig);
const aiEvents = await generateAiLifeDay(api, result.life);
const lifeWithAi = {
    ...result.life,
    aiEvents: [...aiEvents, ...(result.life.aiEvents || [])].slice(0, 80),
    events: [...aiEvents, ...result.life.events].slice(0, 80),
    aiLastGeneratedAt: { ...(result.life.aiLastGeneratedAt || {}), lifeDay: result.life.dateStr },
};
await persistStateUpdate(prev => ({ ...migrateBankLifeState(prev), life: lifeWithAi }));
```

Keep fallback if AI fails.

**Step 3: UI display**

In `renderLifeHome()`, add a small badge to event rows when `ev.source === 'ai'`:

```tsx
{(ev as any).source === 'ai' && <CleanBadge tone="blue">AI事件</CleanBadge>}
```

**Step 4: Verification**

```bash
pnpm run test:run -- utils/bankLifeAi.test.ts utils/bankLife.test.ts
pnpm run build
```

Manual: open 人生拟 → 下一天 → 今日事件出现 AI/fallback 事件，不阻塞工资/贷款结算。

**Commit:**

```bash
git add apps/BankApp.tsx utils/bankLifeAi.ts
git commit -m "feat: generate AI daily life events"
```

---

## Task 5: Add resume editor data model and pure update helpers

**Objective:** 用户可以像 Boss 直聘一样编辑简历：求职意向、技能、经历、自我介绍。

**Files:**
- Modify: `utils/bankLife.ts`
- Modify: `utils/bankLife.test.ts`
- Later UI in Task 6.

**Step 1: Write failing test**

Add to `utils/bankLife.test.ts`:

```ts
it('updates resume profile without losing existing life state', () => {
    const life0 = createDefaultBankLifeState('2026-06-01');
    const life = updateResumeProfile(life0, {
        headline: '前端新人，想找稳定工作',
        skills: ['React', '沟通'],
        expectedCategories: ['技术', '文职'],
        selfIntro: '能稳定排班，也愿意学习。',
    });

    expect(life.resume?.headline).toContain('前端新人');
    expect(life.resume?.skills).toContain('React');
    expect(life.dateStr).toBe(life0.dateStr);
});
```

**Step 2: Verify RED**

```bash
pnpm run test:run -- utils/bankLife.test.ts
```

Expected: FAIL — `updateResumeProfile` missing.

**Step 3: Implement helper**

In `utils/bankLife.ts` export:

```ts
export function updateResumeProfile(life: BankLifeState, updates: Partial<BankResumeProfile>): BankLifeState {
    const current = life.resume || defaultResume(life.dateStr);
    return {
        ...life,
        resume: {
            ...current,
            ...updates,
            skills: (updates.skills || current.skills || []).map(s => s.trim()).filter(Boolean).slice(0, 12),
            expectedCategories: (updates.expectedCategories || current.expectedCategories || []).slice(0, 6),
            experience: (updates.experience || current.experience || []).slice(0, 8),
            updatedAt: Date.now(),
        },
    };
}
```

**Step 4: GREEN**

```bash
pnpm run test:run -- utils/bankLife.test.ts
```

Expected: PASS.

**Commit:**

```bash
git add utils/bankLife.ts utils/bankLife.test.ts
git commit -m "feat: add resume profile updater"
```

---

## Task 6: Build Boss-style resume editor UI

**Objective:** 求职页新增“我的简历”抽屉/卡片，可编辑并保存。

**Files:**
- Modify: `apps/BankApp.tsx:283-290` state area
- Modify: `apps/BankApp.tsx:1715-1817` `renderJobs()`

**Step 1: Add local form state**

Near job state:

```ts
const [showResumeEditor, setShowResumeEditor] = useState(false);
const [resumeDraft, setResumeDraft] = useState({ headline: '', skills: '', expectedCategories: '', selfIntro: '' });
```

When opening editor:

```ts
const openResumeEditor = () => {
    const resume = life.resume;
    setResumeDraft({
        headline: resume?.headline || '',
        skills: (resume?.skills || []).join('、'),
        expectedCategories: (resume?.expectedCategories || []).join('、'),
        selfIntro: resume?.selfIntro || '',
    });
    setShowResumeEditor(true);
};
```

**Step 2: Save handler**

```ts
const handleSaveResume = async () => {
    await updateLifeState(life => updateResumeProfile(life, {
        headline: resumeDraft.headline,
        skills: resumeDraft.skills.split(/[、,，\s]+/).filter(Boolean),
        expectedCategories: resumeDraft.expectedCategories.split(/[、,，\s]+/).filter(Boolean),
        selfIntro: resumeDraft.selfIntro,
    }));
    setShowResumeEditor(false);
    addToast('简历已更新', 'success');
};
```

Remember to import `updateResumeProfile` from `utils/bankLife`.

**Step 3: Add UI card**

At top of `renderJobs()`:

```tsx
<PaperCard className="p-4">
  <div className="flex items-start justify-between gap-3">
    <div>
      <SectionTag en="resume">我的简历</SectionTag>
      <div className="mt-2 text-[15px] font-black" style={{ color: INK }}>{life.resume?.headline || '还没有求职标题'}</div>
      <div className="mt-1 text-[11px]" style={{ color: INK_SOFT }}>{(life.resume?.skills || []).slice(0, 4).join(' · ') || '补充技能后，AI 会更准确评估岗位'}</div>
    </div>
    <button onClick={openResumeEditor} className="px-3 py-2 text-[12px] font-black" style={smallBtn('#f43f5e')}>编辑简历</button>
  </div>
</PaperCard>
```

**Step 4: Add editor overlay/modal**

Use existing card styles. Required fields:

- 求职标题 `headline`
- 期望方向 `expectedCategories`
- 技能标签 `skills`
- 自我介绍 `selfIntro`

**Step 5: Verification**

```bash
pnpm run build
```

Manual: 求职 → 我的简历 → 编辑 → 保存 → 重新打开仍显示。

**Commit:**

```bash
git add apps/BankApp.tsx
git commit -m "feat: add life sim resume editor"
```

---

## Task 7: AI resume review and job suitability scoring

**Objective:** 岗位详情页显示 AI 评估：“你适不适合这个岗位、为什么、怎么改简历”。

**Files:**
- Modify: `utils/bankLifeAi.ts`
- Modify: `apps/BankApp.tsx:1762-1785`
- Test: `utils/bankLifeAi.test.ts`

**Step 1: Add sanitizer test**

```ts
it('sanitizes AI resume review score and reasons', () => {
    const review = sanitizeResumeReview({ score: 999, strengths: ['会 React'], weaknesses: ['经验少'], suggestion: '补项目' });
    expect(review.score).toBe(100);
    expect(review.strengths).toEqual(['会 React']);
});
```

**Step 2: Implement in `bankLifeAi.ts`**

```ts
export function sanitizeResumeReview(input: any) {
    return {
        score: Math.max(0, Math.min(100, Math.round(Number(input?.score) || 50))),
        strengths: Array.isArray(input?.strengths) ? input.strengths.map(String).slice(0, 4) : [],
        weaknesses: Array.isArray(input?.weaknesses) ? input.weaknesses.map(String).slice(0, 4) : [],
        suggestion: clampText(input?.suggestion, '先补充简历与相关经历，再尝试投递。', 160),
    };
}

export async function generateAiResumeReview(api: ResolvedApi, life: BankLifeState, posting: BankJobPosting) {
    const fallback = { score: 55, strengths: ['有基础求职意愿'], weaknesses: ['简历信息还不够完整'], suggestion: '补充技能、经历和期望薪资后再投递。' };
    const data = await callBankLifeAiJson(api, [
        { role: 'system', content: '你是求职 APP 的岗位匹配评估器。只输出 JSON：{"score":0,"strengths":[],"weaknesses":[],"suggestion":""}' },
        { role: 'user', content: JSON.stringify({ resume: life.resume, posting, fatigue: life.fatigue, experience: life.experience }) },
    ], fallback);
    return sanitizeResumeReview(data);
}
```

**Step 3: UI handler**

In `BankApp.tsx` add state:

```ts
const [resumeReviewByJob, setResumeReviewByJob] = useState<Record<string, { score: number; strengths: string[]; weaknesses: string[]; suggestion: string }>>({});
const [isReviewingResume, setIsReviewingResume] = useState(false);
```

Add button in selected job detail:

```tsx
<button onClick={() => handleReviewJobFit(selectedJob)} ...>AI 评估匹配度</button>
```

Handler:

```ts
const handleReviewJobFit = async (posting: BankJobPosting) => {
    setIsReviewingResume(true);
    try {
        const api = resolveAuxApi(auxApi, apiConfig);
        const review = await generateAiResumeReview(api, life, posting);
        setResumeReviewByJob(prev => ({ ...prev, [posting.id]: review }));
    } finally {
        setIsReviewingResume(false);
    }
};
```

**Step 4: Verification**

```bash
pnpm run test:run -- utils/bankLifeAi.test.ts
pnpm run build
```

Manual: 岗位详情 → AI 评估匹配度 → 显示分数、优势、短板、建议；断网时显示 fallback。

**Commit:**

```bash
git add utils/bankLifeAi.ts utils/bankLifeAi.test.ts apps/BankApp.tsx
git commit -m "feat: add AI job fit review"
```

---

## Task 8: AI job search / refresh generated job postings

**Objective:** 求职界面可“刷新/查找工作”，AI 根据简历、日期、分类、搜索词生成真实感岗位。

**Files:**
- Modify: `types.ts` `BankLifeState`
- Modify: `utils/bankLifeAi.ts`
- Modify: `utils/bankLife.ts`
- Modify: `apps/BankApp.tsx:1715-1817`
- Test: `utils/bankLifeAi.test.ts`, `utils/bankLife.test.ts`

**Step 1: Extend state**

Add to `BankLifeState`:

```ts
aiJobPostings?: BankJobPosting[];
```

Migration default: `aiJobPostings: []`.

**Step 2: Add AI function**

```ts
export async function generateAiJobs(api: ResolvedApi, life: BankLifeState, query: string, category: string): Promise<BankJobPosting[]> {
    const fallback: BankJobPosting[] = [];
    const data = await callBankLifeAiJson(api, [
        { role: 'system', content: '你是虚拟招聘市场生成器。只输出 JSON：{"jobs":[岗位]}。岗位字段必须包含 id/category/title/employer/salaryMin/salaryMax/payCycle/intensity/requirements/benefits/riskTags/description/location/workTime/companySize/bossName/bossTitle/companyIntro/black。不要使用真实品牌。' },
        { role: 'user', content: JSON.stringify({ dateStr: life.dateStr, resume: life.resume, query, category, existingCategories: JOB_CATEGORIES }) },
    ], { jobs: fallback });
    return sanitizeAiJobs(data?.jobs, category);
}
```

**Step 3: Add `sanitizeAiJobs`**

Rules:
- max 8 jobs per refresh
- salary clamp 80-50000
- `payCycle` only `daily | monthly`
- `black` true if risk tags include 押金/培训费/无薪/拖欠/高风险
- id prefix: `ai-job-${Date.now()}-...`

**Step 4: Pure merge helper**

In `utils/bankLife.ts`:

```ts
export function mergeAiJobPostings(life: BankLifeState, jobs: BankJobPosting[], query: string, category: string): BankLifeState {
    return {
        ...life,
        aiJobPostings: [...jobs, ...(life.aiJobPostings || [])].slice(0, 40),
        jobSearchSessions: [{ id: genId('jobsearch'), query, category, filters: {}, generatedAt: life.dateStr, source: 'ai' }, ...(life.jobSearchSessions || [])].slice(0, 20),
    };
}
```

**Step 5: UI**

In `renderJobs()`:
- Add search input: `jobSearchQuery`
- Add “AI 刷新岗位” button
- Jobs list becomes:

```ts
const baseJobs = getJobsByCategory(jobCategory);
const aiJobs = (life.aiJobPostings || []).filter(j => jobCategory === '全部' || j.category === jobCategory);
const jobs = [...aiJobs, ...baseJobs].filter(matchesSearch);
```

**Step 6: Verification**

```bash
pnpm run test:run -- utils/bankLifeAi.test.ts utils/bankLife.test.ts
pnpm run build
```

Manual: 求职 → 输入关键词 → AI 刷新岗位 → 新岗位出现在列表顶部，可查看详情/投递。

**Commit:**

```bash
git add types.ts utils/bankLifeAi.ts utils/bankLife.ts apps/BankApp.tsx utils/bankLife*.test.ts
git commit -m "feat: add AI job search refresh"
```

---

## Task 9: Dedicated recruiter chat panel

**Objective:** 求职功能增加“和招聘方聊天”界面，用户可输入消息，AI 以 Boss/HR 身份回复，并影响投递进度。

**Files:**
- Modify: `utils/bankLifeAi.ts`
- Modify: `utils/bankLife.ts`
- Modify: `apps/BankApp.tsx:1788-1814`
- Test: `utils/bankLife.test.ts`

**Step 1: Add pure helper test**

```ts
it('appends recruiter chat messages to an application', () => {
    const life0 = createDefaultBankLifeState('2026-06-01');
    const started = startJobApplication(life0, JOB_POSTINGS[0]);
    const life = appendJobChatMessage(started.life, started.application.id, { role: 'user', content: '我想了解排班。', at: '2026-06-01 10:00' });
    expect(life.jobHistory[0].chatMessages?.at(-1)?.content).toContain('排班');
});
```

**Step 2: Implement helper**

```ts
export function appendJobChatMessage(life: BankLifeState, applicationId: string, message: { role: 'boss' | 'user' | 'system'; content: string; at: string }): BankLifeState {
    return {
        ...life,
        jobHistory: life.jobHistory.map(app => app.id === applicationId
            ? { ...app, chatMessages: [...(app.chatMessages || []), message].slice(-80) }
            : app),
    };
}
```

**Step 3: AI reply function**

```ts
export async function generateAiRecruiterReply(api: ResolvedApi, life: BankLifeState, application: BankJobApplication, userMessage: string) {
    const fallback = { content: '收到，我这边先看一下你的情况。可以再说说你的排班和相关经验吗？', stageHint: application.stage || 'screening' };
    const data = await callBankLifeAiJson(api, [
        { role: 'system', content: '你扮演招聘方 Boss/HR。只输出 JSON：{"content":"回复内容","stageHint":"submitted|screening|assessment|interview|offer|rejected|scammed"}。语气像真实招聘聊天，简短直接。黑心岗位可以露出押金/培训费等风险。' },
        { role: 'user', content: JSON.stringify({ resume: life.resume, application, userMessage }) },
    ], fallback);
    return { content: clampText(data?.content, fallback.content, 220), stageHint: data?.stageHint || fallback.stageHint };
}
```

**Step 4: UI panel**

In selected application card:
- Show chat bubble list.
- Add input `recruiterChatDraft`.
- Button “发送”。
- On send:
  1. append user message
  2. call AI reply
  3. append boss reply
  4. if `stageHint` changed to `scammed/rejected/offer`, call/merge appropriate application stage update.

**Step 5: Verification**

```bash
pnpm run test:run -- utils/bankLife.test.ts utils/bankLifeAi.test.ts
pnpm run build
```

Manual: 求职 → 投递 → 进入求职进展 → 聊天输入 → 招聘方回复。

**Commit:**

```bash
git add utils/bankLife.ts utils/bankLifeAi.ts apps/BankApp.tsx utils/bankLife.test.ts
git commit -m "feat: add recruiter chat for job applications"
```

---

## Task 10: AI market pulse and random stock news/events

**Objective:** 投资模块由 AI 生成每日市场脉冲、个股新闻与随机行情原因，让股市更像实时市场。

**Files:**
- Modify: `utils/bankLifeAi.ts`
- Modify: `utils/bankLife.ts`
- Modify: `apps/BankApp.tsx:1819-1885`
- Test: `utils/bankLifeAi.test.ts`, `utils/bankLife.test.ts`

**Step 1: Add `generateAiMarketPulse`**

```ts
export async function generateAiMarketPulse(api: ResolvedApi, life: BankLifeState): Promise<BankMarketPulse[]> {
    const fallback = [{ headline: '虚拟市场窄幅波动', summary: '消费与科技板块分化，适合观察自选股。', affectedSymbols: life.stockMarket.slice(0, 2).map(s => s.symbol), sentiment: 'neutral' }];
    const data = await callBankLifeAiJson(api, [
        { role: 'system', content: '你是虚拟股市资讯编辑。只输出 JSON：{"pulses":[{"headline":"","summary":"","affectedSymbols":[],"sentiment":"bullish|neutral|bearish"}]}。不要提供现实投资建议。' },
        { role: 'user', content: JSON.stringify({ dateStr: life.dateStr, quotes: life.stockMarket.map(q => ({ symbol: q.symbol, name: q.name, price: q.price, changePct: q.changePct, industry: q.industry })) }) },
    ], { pulses: fallback });
    return sanitizeMarketPulses(data?.pulses, life.dateStr, life.stockMarket.map(q => q.symbol));
}
```

**Step 2: Pure merge helper**

```ts
export function applyMarketPulses(life: BankLifeState, pulses: BankMarketPulse[]): BankLifeState {
    const quotes = life.stockMarket.map(q => {
        const pulse = pulses.find(p => p.affectedSymbols.includes(q.symbol));
        return pulse ? { ...q, aiReason: pulse.summary, newsList: [{ id: pulse.id, title: pulse.headline, source: 'AI 市场脉冲', dateStr: pulse.dateStr, tone: pulse.sentiment === 'bearish' ? 'warn' : pulse.sentiment === 'bullish' ? 'good' : 'info' }, ...(q.newsList || [])].slice(0, 8) } : q;
    });
    return { ...life, stockMarket: quotes, marketPulses: [...pulses, ...(life.marketPulses || [])].slice(0, 40) };
}
```

**Step 3: UI**

In `renderInvest()`:
- Add “AI 市场脉冲” card above selected stock.
- Add “刷新 AI 资讯” button.
- In stock detail show `q.aiReason` and `q.newsList`.

**Step 4: Verification**

```bash
pnpm run test:run -- utils/bankLifeAi.test.ts utils/bankLife.test.ts
pnpm run build
```

Manual: 投资 → 刷新 AI 资讯 → 市场脉冲和个股新闻更新；断网显示 fallback。

**Commit:**

```bash
git add utils/bankLife.ts utils/bankLifeAi.ts apps/BankApp.tsx utils/bankLife*.test.ts
git commit -m "feat: add AI market pulse"
```

---

## Task 11: AI loan credit evaluation before borrowing

**Objective:** 借款不是直接输入金额到账，而是先进行用户信用/收入/负债评估，再决定额度、利率、通过/拒绝/高风险条款。

**Files:**
- Modify: `utils/bankLifeAi.ts`
- Modify: `utils/bankLife.ts`
- Modify: `apps/BankApp.tsx:1954-2014`
- Test: `utils/bankLifeAi.test.ts`, `utils/bankLife.test.ts`

**Step 1: Add pure credit recompute helper**

In `utils/bankLife.ts`:

```ts
export function computeCreditProfile(life: BankLifeState): BankLoanCreditProfile {
    const income = life.currentJob ? 25 : 0;
    const debt = loanTotal(life);
    const debtPressure = clamp(Math.round(debt / 1000), 0, 100);
    const repaymentHistory = life.loans.some(l => l.overdueDays > 0) ? 35 : 75;
    const score = clamp(580 + income - Math.round(debtPressure * 1.5) + Math.round((repaymentHistory - 50) * 0.8), 300, 850);
    return {
        score,
        incomeStability: life.currentJob ? 70 : 35,
        debtPressure,
        repaymentHistory,
        riskLevel: score >= 720 ? 'low' : score >= 620 ? 'medium' : score >= 500 ? 'high' : 'danger',
        reasons: [life.currentJob ? '有当前工作收入记录' : '暂无稳定工作收入', debt > 0 ? `当前负债约 ¥${Math.round(debt)}` : '当前负债较低'],
        updatedAt: life.dateStr,
    };
}
```

**Step 2: Add tests**

```ts
it('computes loan credit profile from income and debt', () => {
    const life0 = createDefaultBankLifeState('2026-06-01');
    const profile = computeCreditProfile(life0);
    expect(profile.score).toBeGreaterThan(0);
    expect(profile.riskLevel).toMatch(/low|medium|high|danger/);
});
```

**Step 3: Add AI review**

In `bankLifeAi.ts`:

```ts
export async function generateAiLoanReview(api: ResolvedApi, life: BankLifeState, channel: BankLoanChannel, amount: number) {
    const fallback = { approved: true, approvedAmount: amount, reason: '按当前模拟信用资料可进入放款流程。', warnings: [] };
    const data = await callBankLifeAiJson(api, [
        { role: 'system', content: '你是虚拟借款审核员。只输出 JSON：{"approved":true,"approvedAmount":0,"reason":"","warnings":[],"suggestedDailyRateMultiplier":1}。银行更严格，高利贷更容易通过但风险警告更多。' },
        { role: 'user', content: JSON.stringify({ creditProfile: life.creditProfile, currentJob: life.currentJob?.title, debt: life.loans, channel, amount }) },
    ], fallback);
    return sanitizeLoanReview(data, amount, channel);
}
```

**Step 4: UI flow**

In loans tab:
- Add “先评估额度” button.
- Display credit score card: 分数、收入稳定、负债压力、还款记录、风险等级。
- Borrow button disabled until assessment exists for selected amount/channel, except high-interest channel can show risk confirmation.
- `handleBorrowLoan()` uses AI review result:
  - rejected → toast + event, no money.
  - approvedAmount < requested → ask user to use approved amount.
  - approved → call existing `borrowLoan()`.

**Step 5: Verification**

```bash
pnpm run test:run -- utils/bankLifeAi.test.ts utils/bankLife.test.ts
pnpm run build
```

Manual: 借款 → 选择银行/正规/高利贷 → 输入金额 → 评估 → 审核理由/风险/额度展示 → 放款或拒绝。

**Commit:**

```bash
git add utils/bankLife.ts utils/bankLifeAi.ts apps/BankApp.tsx utils/bankLife*.test.ts
git commit -m "feat: add AI loan credit review"
```

---

## Task 12: Make life homepage an AI-driven command center

**Objective:** 首页不仅显示事件，还显示 AI 今日建议、风险预警、下一步推荐路径。

**Files:**
- Modify: `utils/bankLife.ts`
- Modify: `apps/BankApp.tsx:1644-1713`

**Step 1: Add pure helper**

```ts
export function buildLifeSuggestions(life: BankLifeState, walletBalance: number): { id: string; title: string; detail: string; tab: 'jobs' | 'shop' | 'invest' | 'company' | 'loans'; tone: 'good' | 'warn' | 'info' | 'bad' }[] {
    const items = [];
    if (!life.currentJob) items.push({ id: 'find-job', title: '先找一份现金流', detail: '没有固定工作，求职能提供稳定工资。', tab: 'jobs', tone: 'info' as const });
    if (!life.shopUnlocked) items.push({ id: 'open-shop', title: `还差 ¥${Math.max(0, SHOP_UNLOCK_COST - walletBalance)} 可开店`, detail: '小店是人生拟里的经营赚钱模式。', tab: 'shop', tone: walletBalance >= SHOP_UNLOCK_COST ? 'good' as const : 'warn' as const });
    if (!life.company) items.push({ id: 'found-company', title: `公司启动金 ¥${COMPANY_FOUND_COST}`, detail: '资金充足后可选择方向创业。', tab: 'company', tone: walletBalance >= COMPANY_FOUND_COST ? 'good' as const : 'info' as const });
    if (loanTotal(life) > 0) items.push({ id: 'repay-loan', title: '关注借款还款', detail: '逾期会提高风险和利息。', tab: 'loans', tone: 'warn' as const });
    return items.slice(0, 4);
}
```

**Step 2: UI**

In `renderLifeHome()` add:
- AI 今日摘要 card: latest `aiEvents[0]`。
- “下一步建议” grid, clicking `setActiveTab(item.tab)`。
- “风险预警”：高疲劳、逾期贷款、公司现金为负、黑心岗位进行中。

**Step 3: Verification**

```bash
pnpm run build
```

Manual: 首页在 375px 宽度不溢出；建议卡可跳转 tab。

**Commit:**

```bash
git add apps/BankApp.tsx utils/bankLife.ts
git commit -m "feat: add AI life command center"
```

---

## Task 13: Optional refactor — split BankApp module components

**Objective:** 如果 `apps/BankApp.tsx` 继续超过 3000 行或 AI UI 变得难维护，将求职/投资/借款拆成子组件。

**Files:**
- Create: `apps/bank/JobBoard.tsx`
- Create: `apps/bank/RecruiterChatPanel.tsx`
- Create: `apps/bank/ResumeEditor.tsx`
- Create: `apps/bank/InvestBoard.tsx`
- Create: `apps/bank/LoanCenter.tsx`
- Modify: `apps/BankApp.tsx`

**Important:** 这是后续维护性任务，不要在功能未稳定前过早拆。拆分时不改变行为，先保证测试/构建绿。

**Verification:**

```bash
pnpm run build
pnpm run test:run
```

Expected: no behavior changes.

**Commit:**

```bash
git add apps/BankApp.tsx apps/bank/*.tsx
git commit -m "refactor: split life sim bank panels"
```

---

## Task 14: End-to-end validation checklist

**Objective:** 最终验证 AI 扩展功能不会破坏已有玩法。

**Commands:**

```bash
pnpm run test:run -- utils/bankLife.test.ts utils/bankLifeAi.test.ts utils/bankLedger.test.ts
pnpm run test:run
pnpm run build
```

Expected:

- all tests pass
- build succeeds

**Manual validation:**

1. 打开人生拟首页。
2. 点击“下一天”：
   - 工资/贷款/股市/公司仍结算。
   - 今日事件出现 AI 或 fallback 内容。
3. 求职：
   - 编辑简历并保存。
   - 搜索/刷新 AI 岗位。
   - 岗位详情显示 AI 匹配度。
   - 投递后能和招聘方聊天。
   - 黑心岗位风险明显。
4. 投资：
   - 刷新 AI 市场脉冲。
   - 个股详情显示 AI 新闻/原因。
   - 买卖仍按原有手续费与余额规则。
5. 借款：
   - 先做信用评估。
   - 银行/正规/高利贷审核差异明显。
   - 放款、还款、逾期仍进入事件/账本。
6. 断网/无副 API：
   - 所有 AI 按钮返回 fallback。
   - 不出现未捕获异常。

---

## Risks / Tradeoffs

- **范围风险：** “全面仿真现实 APP”很大，本计划优先做核心闭环：AI 生成、评估、聊天、审核、事件，而不是无限扩展页面。
- **API 成本：** 下一天、刷新岗位、聊天、行情、借款评估都会调用 AI。需要按钮触发、节流或缓存，不建议每次 render 自动调用。
- **稳定性：** AI JSON 可能格式不对，因此必须 sanitizer + fallback。
- **安全/合规：** 借款和投资是虚拟模拟，文案不得构成现实金融建议；高利贷要明确风险。
- **维护性：** `BankApp.tsx` 已很大。若继续增加 UI，建议执行 Task 13 拆组件。
- **测试边界：** 不测试真实模型输出，只测试 parser/sanitizer/fallback 和纯函数 merge。

---

## Suggested implementation order

1. Task 1-3：类型、迁移、AI helper。
2. Task 4：AI 今日事件，先打通 AI 接入主链路。
3. Task 5-9：求职 / 简历 / AI 岗位 / 招聘聊天。
4. Task 10：AI 股市资讯。
5. Task 11：AI 借款审核。
6. Task 12：首页总览。
7. Task 13：视文件复杂度决定是否拆组件。
8. Task 14：全量验证。

---

## Definition of Done

- `utils/bankLifeAi.ts` 存在，并封装全部人生拟 AI 调用。
- AI 失败时所有功能都有 fallback，不阻塞 UI。
- 求职具备简历编辑、AI 搜索岗位、岗位匹配评估、招聘方聊天。
- 首页下一天可生成 AI 今日事件。
- 投资有 AI 市场脉冲/个股新闻。
- 借款有信用评估、审核理由、渠道差异与风险提示。
- `pnpm run test:run` 通过。
- `pnpm run build` 通过。
