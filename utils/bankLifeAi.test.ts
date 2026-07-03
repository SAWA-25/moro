import { describe, expect, it, vi } from 'vitest';
import {
    parseAiJsonObject,
    sanitizeBankActionAiDraft,
    sanitizeAiEvent,
    sanitizeAiJobs,
    sanitizeAiJobStageDraft,
    sanitizeLoanReview,
    sanitizeMarketPulses,
    sanitizeResumeReview,
} from './bankLifeAi';

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

    it('sanitizes generic bank action AI drafts', () => {
        const draft = sanitizeBankActionAiDraft({
            summary: 'x'.repeat(500),
            tone: 'weird',
            riskTags: ['高波动', '虚拟'],
            suggestions: ['先看风险', '再看余额'],
            metrics: [{ label: '风险', value: '5/5', tone: 'warn' }],
        });

        expect(draft.summary.length).toBeLessThanOrEqual(220);
        expect(draft.tone).toBe('info');
        expect(draft.riskTags).toEqual(['高波动', '虚拟']);
        expect(draft.metrics?.[0]).toMatchObject({ label: '风险', value: '5/5', tone: 'warn' });
    });

    it('sanitizes AI resume review score and reasons', () => {
        const review = sanitizeResumeReview({ score: 999, strengths: ['会 React'], weaknesses: ['经验少'], suggestion: '补项目' });
        expect(review.score).toBe(100);
        expect(review.strengths).toEqual(['会 React']);
    });

    it('sanitizes AI jobs and marks risky postings', () => {
        const jobs = sanitizeAiJobs([{
            title: '高薪助理',
            salaryMin: 1,
            salaryMax: 999999,
            payCycle: 'weekly',
            riskTags: ['押金'],
            description: '这是虚拟岗位，黑心岗位有押金风险。',
            salaryDetail: { baseSalary: 6000, socialInsurance: '五险一金', bonusSubsidies: ['绩效奖金'], note: '底薪加奖金' },
            responsibilities: ['整理资料', '对接招聘方'],
            requirementDetails: ['沟通清楚'],
            employeeBenefits: ['下午茶', '全勤奖'],
            recruiterStats: { responseTime: '3分钟内回复', replyRate: '回复率高', todayReplies: '今日回复10+次' },
            companyIndustry: '企业服务',
            companyStage: '虚拟雇主',
            publishNote: '该职位今日活跃',
        }], '文职');
        expect(jobs[0].salaryMin).toBe(80);
        expect(jobs[0].salaryMax).toBe(50000);
        expect(jobs[0].payCycle).toBe('monthly');
        expect(jobs[0].black).toBe(true);
        expect(jobs[0].riskTags).toEqual(['到岗前费用']);
        expect(jobs[0].description).not.toMatch(/虚拟|模拟|黑心|风险/);
        expect(jobs[0].salaryDetail?.socialInsurance).toBe('五险一金');
        expect(jobs[0].salaryDetail?.bonusSubsidies).toContain('绩效奖金');
        expect(jobs[0].responsibilities).toEqual(['整理资料', '对接招聘方']);
        expect(jobs[0].requirementDetails).toEqual(['沟通清楚']);
        expect(jobs[0].employeeBenefits).toContain('下午茶');
        expect(jobs[0].recruiterStats?.responseTime).toBe('3分钟内回复');
        expect(jobs[0].companyIndustry).toBe('企业服务');
        expect(jobs[0].companyStage).not.toMatch(/虚拟|模拟/);
        expect(jobs[0].publishNote).toBe('该职位今日活跃');
    });

    it('sanitizes AI job stage decisions and offer terms', () => {
        const draft = sanitizeAiJobStageDraft({
            nextStage: 'offer',
            scoreDelta: 999,
            summary: '通过',
            riskFlags: ['押金', ''],
            offerSalary: 999999,
            offerTerms: { payCycle: 'weekly', payDay: 99, trialDays: 99, benefits: ['双休'], risks: ['拖欠'], negotiable: false },
        }, 'screening');

        expect(draft.nextStage).toBe('offer');
        expect(draft.scoreDelta).toBe(30);
        expect(draft.offerSalary).toBe(50000);
        expect(draft.offerTerms?.payCycle).toBeUndefined();
        expect(draft.offerTerms?.payDay).toBe(28);
        expect(draft.offerTerms?.trialDays).toBe(30);
        expect(draft.offerTerms?.negotiable).toBe(false);
    });

    it('sanitizes market pulse symbols and sentiment', () => {
        const pulses = sanitizeMarketPulses([{ headline: 'AI热', affectedSymbols: ['MORO', 'BAD'], sentiment: 'moon' }], '2026-06-01', ['MORO']);
        expect(pulses[0].affectedSymbols).toEqual(['MORO']);
        expect(pulses[0].sentiment).toBe('neutral');
    });

    it('sanitizes loan review amount within product limits', () => {
        const review = sanitizeLoanReview({ approved: true, approvedAmount: 999999, warnings: ['高风险'] }, 5000, 'formal');
        expect(review.approvedAmount).toBe(5000);
        expect(review.warnings).toEqual(['高风险']);
    });
});
