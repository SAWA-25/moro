import { describe, expect, it, vi } from 'vitest';
import {
    parseAiJsonObject,
    sanitizeAiEvent,
    sanitizeAiJobs,
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

    it('sanitizes AI resume review score and reasons', () => {
        const review = sanitizeResumeReview({ score: 999, strengths: ['会 React'], weaknesses: ['经验少'], suggestion: '补项目' });
        expect(review.score).toBe(100);
        expect(review.strengths).toEqual(['会 React']);
    });

    it('sanitizes AI jobs and marks risky postings', () => {
        const jobs = sanitizeAiJobs([{ title: '高薪助理', salaryMin: 1, salaryMax: 999999, payCycle: 'weekly', riskTags: ['押金'] }], '文职');
        expect(jobs[0].salaryMin).toBe(80);
        expect(jobs[0].salaryMax).toBe(50000);
        expect(jobs[0].payCycle).toBe('monthly');
        expect(jobs[0].black).toBe(true);
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
