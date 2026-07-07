import React, { useEffect, useMemo, useState } from 'react';
import {
    Briefcase,
    Buildings,
    CaretRight,
    ChatCircleText,
    Clock,
    DotsThree,
    FunnelSimple,
    GraduationCap,
    MagnifyingGlass,
    MapPin,
    ShareFat,
    Sparkle,
    Star,
    UserCircle,
    WarningCircle,
} from '@phosphor-icons/react';
import type { BankJobApplication, BankJobApplicationStage, BankJobPosting, BankLifeState, BankResumeProfile } from '../../types';
import { BANK_JOB_STAGE_LABELS } from '../../utils/bankLife';
import { HAND_FONT } from '../../apps/almanac/handbookKit';
import { INK, INK_SOFT, PaperCard, SectionTag } from '../../apps/ui/insScrapKit';

type JobAiBusy = 'day' | 'jobs' | 'resume' | 'recruiter' | 'stage' | 'market' | 'loan' | 'dashboard' | 'shop' | 'invest' | 'company' | 'ledger' | null;
type JobView = 'jobs' | 'pipeline' | 'resume';

interface BankJobCenterProps {
    life: BankLifeState;
    walletBalance: number;
    jobPostings: BankJobPosting[];
    jobCategories: string[];
    jobCategory: string;
    onJobCategoryChange: (category: string) => void;
    selectedJobId: string;
    onSelectJob: (id: string) => void;
    selectedApplicationId: string;
    onSelectApplication: (id: string) => void;
    jobSearchQuery: string;
    onJobSearchQueryChange: (value: string) => void;
    resumeDraft: Partial<BankResumeProfile>;
    onResumeDraftChange: React.Dispatch<React.SetStateAction<Partial<BankResumeProfile>>>;
    aiBusy: JobAiBusy;
    onSaveResume: () => Promise<void> | void;
    onGenerateAiJobs: () => Promise<void> | void;
    onStartApplication: (posting: BankJobPosting) => Promise<void> | void;
    onAdvanceApplication: (applicationId: string, answer: string) => Promise<void> | void;
    onSendRecruiterMessage: (applicationId: string, message: string) => Promise<void> | void;
    onDeclineApplication: (applicationId: string, reason: string) => Promise<void> | void;
    onLeaveJob: () => Promise<void> | void;
}

const TEAL = '#18b7b4';
const PAGE_BG = '#f7f8f8';
const LINE = 'rgba(15,23,42,0.08)';

const hbInputStyle: React.CSSProperties = {
    background: '#fff',
    borderRadius: 14,
    color: INK,
    border: `1px solid ${LINE}`,
    boxShadow: 'inset 0 1px 2px rgba(43,41,51,0.04)',
};

const cleanCardStyle: React.CSSProperties = {
    background: '#fff',
    border: `1px solid ${LINE}`,
    borderRadius: 16,
    boxShadow: '0 1px 2px rgba(38,38,38,0.04), 0 14px 32px -26px rgba(38,38,38,0.28)',
};

const terminalStages = new Set<BankJobApplicationStage>(['hired', 'trial', 'rejected', 'scammed', 'declined']);

const toneStyle: Record<string, React.CSSProperties> = {
    default: { background: '#f4f5f5', color: '#5f6368' },
    good: { background: '#dcfce7', color: '#15803d' },
    warn: { background: '#fef3c7', color: '#92400e' },
    bad: { background: '#ffe4e6', color: '#be123c' },
    info: { background: '#e0f2fe', color: '#0369a1' },
};

const Badge: React.FC<{ children: React.ReactNode; tone?: 'default' | 'good' | 'warn' | 'bad' | 'info'; className?: string }> = ({ children, tone = 'default', className = '' }) => (
    <span className={`inline-flex min-w-0 items-center rounded-[4px] px-2 py-1 text-[10px] font-bold leading-none ${className}`} style={toneStyle[tone]}>{children}</span>
);

const IconButton: React.FC<{ title: string; children: React.ReactNode; onClick?: () => void; className?: string }> = ({ title, children, onClick, className = '' }) => (
    <button type="button" title={title} aria-label={title} onClick={onClick} className={`h-9 w-9 shrink-0 rounded-full flex items-center justify-center active:scale-95 transition-transform ${className}`} style={{ color: INK }}>
        {children}
    </button>
);

const JobModal: React.FC<{ open: boolean; title: string; sub?: string; onClose: () => void; footer?: React.ReactNode; children: React.ReactNode }> = ({ open, title, sub, onClose, footer, children }) => {
    if (!open) return null;
    return (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-5" onClick={onClose}>
            <div className="absolute inset-0 bg-black/40 animate-fade-in" style={{ backdropFilter: 'blur(6px)' }} />
            <div className="relative w-full max-w-sm animate-slide-up flex flex-col" style={{ background: '#fff', borderRadius: 24, boxShadow: '0 34px 80px -32px rgba(20,18,16,0.58)', maxHeight: '86vh' }} onClick={e => e.stopPropagation()}>
                <div className="p-5 overflow-y-auto no-scrollbar">
                    <div className="text-[21px] font-black leading-tight" style={{ color: INK }}>{title}</div>
                    {sub && <div className="text-[11px] mt-1 mb-4" style={{ color: INK_SOFT }}>{sub}</div>}
                    {!sub && <div className="mb-4" />}
                    {children}
                </div>
                {footer && <div className="px-5 pb-5">{footer}</div>}
            </div>
        </div>
    );
};

const trimK = (n: number) => {
    const k = n / 1000;
    return Number.isInteger(k) ? String(k) : k.toFixed(1).replace(/\.0$/, '');
};

const formatSalaryShort = (job: BankJobPosting) => {
    if (job.payCycle === 'daily') return `¥${job.salaryMin}-${job.salaryMax}/天`;
    if (job.salaryMin >= 1000 && job.salaryMax >= 1000) return `${trimK(job.salaryMin)}-${trimK(job.salaryMax)}K`;
    return `¥${job.salaryMin}-${job.salaryMax}/月`;
};

const formatSalaryFull = (job: BankJobPosting) => `${job.salaryMin}-${job.salaryMax}元/${job.payCycle === 'daily' ? '天' : '月'}`;

const jobMeta = (job: BankJobPosting) => [job.location || '本市', job.experienceRequired || '经验不限', job.education || '学历不限'].filter(Boolean);

const jobTags = (job: BankJobPosting) => Array.from(new Set([
    ...(job.tags || []),
    ...(job.requirements || []),
    ...(job.employeeBenefits || job.benefits || []),
    ...(job.riskTags || []),
])).filter(Boolean);

const scoreResume = (resume?: BankResumeProfile, draft?: Partial<BankResumeProfile>) => {
    const headline = String(draft?.headline ?? resume?.headline ?? '').trim();
    const selfIntro = String(draft?.selfIntro ?? resume?.selfIntro ?? '').trim();
    const skills = Array.isArray(draft?.skills) ? draft?.skills : typeof draft?.skills === 'string' ? String(draft.skills).split(/[，,]/).map(s => s.trim()).filter(Boolean) : resume?.skills || [];
    const expected = Array.isArray(draft?.expectedCategories) ? draft?.expectedCategories : typeof draft?.expectedCategories === 'string' ? String(draft.expectedCategories).split(/[，,]/).map(s => s.trim()).filter(Boolean) : resume?.expectedCategories || [];
    let score = 0;
    if (headline) score += 22;
    score += Math.min(28, skills.length * 7);
    if (selfIntro.length >= 20) score += 24;
    if ((resume?.experience?.length || 0) > 0) score += 14;
    if (expected.length > 0) score += 12;
    return Math.min(100, score);
};

const stageTone = (stage?: BankJobApplicationStage): 'good' | 'warn' | 'bad' | 'info' => {
    if (stage === 'hired' || stage === 'trial' || stage === 'offer') return 'good';
    if (stage === 'scammed') return 'bad';
    if (stage === 'rejected' || stage === 'declined' || stage === 'negotiation' || stage === 'assessment') return 'warn';
    return 'info';
};

const actionLabel = (app: BankJobApplication) => {
    if (app.stageResult?.nextActionLabel) return app.stageResult.nextActionLabel;
    if (app.stage === 'offer') return '接受 Offer';
    if (app.stage === 'submitted') return '查看筛选结果';
    if (app.stage === 'screening') return '进入 HR 沟通';
    if (app.stage === 'recruiter_chat') return '提交沟通印象';
    if (app.stage === 'assessment') return '提交测评';
    if (app.stage === 'interview') return '提交面试';
    if (app.stage === 'negotiation') return '确认谈判';
    return '继续下一步';
};

const applicationSortScore = (app: BankJobApplication) => {
    if (app.status === 'active') return 0;
    if (app.stage === 'offer' || app.stage === 'trial') return 1;
    return 2;
};

const detailSection = (title: string, children: React.ReactNode) => (
    <section className="border-t pt-5" style={{ borderColor: LINE }}>
        <h3 className="text-[17px] font-black mb-3" style={{ color: INK }}>{title}</h3>
        {children}
    </section>
);

const BankJobCenter: React.FC<BankJobCenterProps> = ({
    life,
    walletBalance,
    jobPostings,
    jobCategories,
    jobCategory,
    onJobCategoryChange,
    selectedJobId,
    onSelectJob,
    selectedApplicationId,
    onSelectApplication,
    jobSearchQuery,
    onJobSearchQueryChange,
    resumeDraft,
    onResumeDraftChange,
    aiBusy,
    onSaveResume,
    onGenerateAiJobs,
    onStartApplication,
    onAdvanceApplication,
    onSendRecruiterMessage,
    onDeclineApplication,
    onLeaveJob,
}) => {
    const [view, setView] = useState<JobView>('jobs');
    const [jobModalId, setJobModalId] = useState<string | null>(null);
    const [chatAppId, setChatAppId] = useState<string | null>(null);
    const [chatDraft, setChatDraft] = useState('');
    const [stageInput, setStageInput] = useState('');
    const [resultOpenId, setResultOpenId] = useState<string | null>(null);
    const [seenResultId, setSeenResultId] = useState('');
    const [declineAppId, setDeclineAppId] = useState<string | null>(null);
    const [declineReason, setDeclineReason] = useState('');

    const search = jobSearchQuery.trim().toLowerCase();
    const filteredJobs = useMemo(
        () => jobPostings.filter(j => {
            const categoryMatch = !jobCategory || jobCategory === '全部' || j.category === jobCategory;
            if (!categoryMatch) return false;
            if (!search) return true;
            const haystack = [j.title, j.employer, j.category, j.location, j.companyIndustry, j.description, ...(j.tags || []), ...(j.requirements || [])].join(' ').toLowerCase();
            return haystack.includes(search);
        }),
        [jobCategory, jobPostings, search],
    );
    const selectedJob = jobPostings.find(j => j.id === selectedJobId) || filteredJobs[0] || jobPostings[0];
    const jobModal = jobModalId ? jobPostings.find(j => j.id === jobModalId) : null;
    const applications = useMemo(
        () => [...life.jobHistory].sort((a, b) => applicationSortScore(a) - applicationSortScore(b)),
        [life.jobHistory],
    );
    const selectedApplication = selectedApplicationId
        ? applications.find(a => a.id === selectedApplicationId) || applications[0]
        : applications[0];
    const chatApplication = chatAppId ? applications.find(a => a.id === chatAppId) : null;
    const resultApplication = selectedApplication?.stageResult?.id === resultOpenId ? selectedApplication : applications.find(a => a.stageResult?.id === resultOpenId);
    const resumeScore = scoreResume(life.resume, resumeDraft);
    const activeStage = selectedApplication?.stage || selectedApplication?.status as BankJobApplicationStage | undefined;
    const canAdvance = selectedApplication && !terminalStages.has(activeStage || 'declined');
    const currentQuestion = selectedApplication?.questions?.find(q => !q.answer) || selectedApplication?.questions?.[0];

    useEffect(() => {
        const id = selectedApplication?.stageResult?.id;
        if (id && id !== seenResultId) {
            setSeenResultId(id);
            setResultOpenId(id);
        }
    }, [selectedApplication?.stageResult?.id, seenResultId]);

    const openJob = (job: BankJobPosting) => {
        onSelectJob(job.id);
        setJobModalId(job.id);
    };

    const applySelectedJob = async (job: BankJobPosting) => {
        await onStartApplication(job);
        setJobModalId(null);
        setView('pipeline');
    };

    const advanceSelected = async () => {
        if (!selectedApplication) return;
        await onAdvanceApplication(selectedApplication.id, stageInput);
        setStageInput('');
    };

    const sendChat = async () => {
        if (!chatApplication || !chatDraft.trim()) return;
        await onSendRecruiterMessage(chatApplication.id, chatDraft.trim());
        setChatDraft('');
    };

    const declineSelected = async () => {
        if (!declineAppId) return;
        await onDeclineApplication(declineAppId, declineReason || '这份机会先不继续了。');
        setDeclineReason('');
        setDeclineAppId(null);
    };

    const activeApplicationForModal = jobModal ? applications.find(app => app.postingId === jobModal.id && !terminalStages.has(app.stage || 'declined')) : undefined;

    const renderCurrentJob = () => life.currentJob ? (
        <PaperCard className="p-3.5">
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <Badge tone="good">当前在职</Badge>
                    <div className="text-[16px] font-black mt-1 truncate" style={{ color: INK }}>{life.currentJob.title}</div>
                    <div className="text-[11px] truncate" style={{ color: INK_SOFT }}>{life.currentJob.employer} · 已工作 {life.currentJob.daysWorked} 天 · 待发 ¥{Math.round(life.currentJob.accruedWage)}</div>
                </div>
                <button onClick={onLeaveJob} className="px-3 py-2 text-[12px] font-black active:scale-95 transition-transform shrink-0" style={{ background: '#f4f5f5', color: INK_SOFT, borderRadius: 999 }}>离职</button>
            </div>
        </PaperCard>
    ) : null;

    const renderJobsView = () => (
        <div className="space-y-3">
            <div className="sticky z-20 -mx-3.5 px-3.5 pt-3 pb-3" style={{ background: PAGE_BG, top: 56 }}>
                <div className="flex items-center gap-2">
                    <div className="flex min-w-0 flex-1 items-center gap-2 rounded-[14px] px-3 py-2" style={{ background: '#fff', border: `1px solid ${LINE}` }}>
                        <MagnifyingGlass size={16} weight="bold" color={INK_SOFT} />
                        <input value={jobSearchQuery} onChange={e => onJobSearchQueryChange(e.target.value)} placeholder="搜索职位、公司、技能" className="min-w-0 flex-1 bg-transparent text-[13px] outline-none" style={{ color: INK }} />
                    </div>
                    <button onClick={onGenerateAiJobs} disabled={aiBusy === 'jobs'} className="h-10 px-3 rounded-[14px] text-[12px] font-black flex items-center gap-1.5 active:scale-95 transition-transform disabled:opacity-60" style={{ background: TEAL, color: '#fff' }}>
                        <Sparkle size={14} weight="fill" />
                        {aiBusy === 'jobs' ? '生成中' : 'AI 找'}
                    </button>
                </div>
                <div className="mt-3 flex items-center gap-4 overflow-x-auto no-scrollbar text-[13px] font-bold" style={{ color: INK_SOFT }}>
                    <button className="shrink-0 flex items-center gap-1" style={{ color: INK }}><span>本市</span><CaretRight size={12} weight="bold" /></button>
                    <button className="shrink-0 flex items-center gap-1" style={{ color: TEAL }}><span>综合排序</span><CaretRight size={12} weight="bold" /></button>
                    <button className="shrink-0 flex items-center gap-1"><FunnelSimple size={14} weight="bold" /><span>筛选</span></button>
                    <button className="shrink-0 flex items-center gap-1"><Briefcase size={14} weight="bold" /><span>职位</span></button>
                </div>
                <div className="mt-3 flex gap-2 overflow-x-auto no-scrollbar">
                    {jobCategories.map(c => (
                        <button key={c} onClick={() => { onJobCategoryChange(c); const first = jobPostings.find(j => c === '全部' || j.category === c); if (first) onSelectJob(first.id); }} className="shrink-0 px-3 py-1.5 text-[12px] font-bold active:scale-95 transition-transform" style={{ background: jobCategory === c ? '#e6f8f7' : '#fff', color: jobCategory === c ? TEAL : '#3f4247', borderRadius: 4, border: `1px solid ${jobCategory === c ? 'rgba(24,183,180,0.28)' : LINE}` }}>{c}</button>
                    ))}
                </div>
            </div>

            {renderCurrentJob()}

            <div className="space-y-2.5">
                {filteredJobs.map(job => (
                    <button key={job.id} onClick={() => openJob(job)} className="w-full text-left p-4 active:scale-[0.99] transition-transform" style={{ ...cleanCardStyle, borderColor: selectedJob?.id === job.id ? 'rgba(24,183,180,0.48)' : LINE }}>
                        <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                                <div className="flex items-center gap-1.5 min-w-0">
                                    <div className="text-[18px] font-black leading-tight truncate" style={{ color: INK }}>{job.title}</div>
                                    {job.black && <Badge tone="bad" className="shrink-0">谨慎</Badge>}
                                </div>
                                <div className="mt-1 text-[13px] truncate" style={{ color: '#60646b' }}>{job.employer} · {job.companySize || '规模未披露'} · {job.companyIndustry || job.category}</div>
                            </div>
                            <div className="shrink-0 text-right text-[17px] font-black leading-tight" style={{ color: TEAL }}>{formatSalaryShort(job)}</div>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-1.5">
                            {jobMeta(job).map(item => <Badge key={item}>{item}</Badge>)}
                            {jobTags(job).slice(0, 4).map(tag => <Badge key={tag} tone={job.riskTags.includes(tag) ? 'warn' : 'default'}>{tag}</Badge>)}
                        </div>
                        <p className="mt-3 line-clamp-2 text-[13px] leading-relaxed" style={{ color: '#5a5f66' }}>{job.description}</p>
                        <div className="mt-3 flex items-center justify-between gap-3 text-[12px]" style={{ color: INK_SOFT }}>
                            <div className="min-w-0 flex items-center gap-2">
                                <span className="h-7 w-7 rounded-full flex items-center justify-center shrink-0" style={{ background: '#eefafa', color: TEAL }}><UserCircle size={17} weight="fill" /></span>
                                <span className="truncate">{job.bossName || '招聘负责人'} · {job.bossTitle || 'HR'}</span>
                            </div>
                            <span className="shrink-0 flex items-center gap-1"><MapPin size={13} weight="fill" />{job.location || '本市'}</span>
                        </div>
                    </button>
                ))}
                {!filteredJobs.length && (
                    <PaperCard className="p-6 text-center">
                        <div className="text-[14px] font-black" style={{ color: INK }}>暂无匹配岗位</div>
                        <div className="mt-1 text-[12px]" style={{ color: INK_SOFT }}>换个关键词，或让 AI 帮你多翻几条。</div>
                    </PaperCard>
                )}
            </div>
        </div>
    );

    const renderResumeView = () => (
        <PaperCard className="p-4 space-y-3">
            <div className="flex items-start justify-between gap-3">
                <div>
                    <SectionTag en="resume">求职档案</SectionTag>
                    <div className="text-[11px] mt-1" style={{ color: INK_SOFT }}>完整度 {resumeScore}% · 钱包 ¥{Math.round(walletBalance)}</div>
                </div>
                <Badge tone={resumeScore >= 70 ? 'good' : resumeScore >= 45 ? 'warn' : 'info'}>{resumeScore >= 70 ? '可投递' : '待补充'}</Badge>
            </div>
            <div className="h-2 rounded-full overflow-hidden" style={{ background: '#f1f3f4' }}>
                <div className="h-full rounded-full transition-all" style={{ width: `${resumeScore}%`, background: resumeScore >= 70 ? TEAL : '#f43f5e' }} />
            </div>
            <div className="grid grid-cols-2 gap-2 max-[420px]:grid-cols-1">
                <input value={String(resumeDraft.headline ?? life.resume?.headline ?? '')} onChange={e => onResumeDraftChange(prev => ({ ...prev, headline: e.target.value }))} placeholder="一句话定位" className="px-3 py-2 text-[12px] outline-none" style={hbInputStyle} />
                <input value={Array.isArray(resumeDraft.skills) ? resumeDraft.skills.join('，') : String(resumeDraft.skills ?? life.resume?.skills?.join('，') ?? '')} onChange={e => onResumeDraftChange(prev => ({ ...prev, skills: e.target.value as any }))} placeholder="技能，用逗号分隔" className="px-3 py-2 text-[12px] outline-none" style={hbInputStyle} />
                <input value={Array.isArray(resumeDraft.expectedCategories) ? resumeDraft.expectedCategories.join('，') : String(resumeDraft.expectedCategories ?? life.resume?.expectedCategories?.join('，') ?? '')} onChange={e => onResumeDraftChange(prev => ({ ...prev, expectedCategories: e.target.value as any }))} placeholder="期望方向，用逗号分隔" className="px-3 py-2 text-[12px] outline-none" style={hbInputStyle} />
                <input value={`${life.resume?.experience?.length || 0} 段经历`} readOnly className="px-3 py-2 text-[12px] outline-none" style={{ ...hbInputStyle, color: INK_SOFT, background: '#fafafa' }} />
            </div>
            <textarea value={String(resumeDraft.selfIntro ?? life.resume?.selfIntro ?? '')} onChange={e => onResumeDraftChange(prev => ({ ...prev, selfIntro: e.target.value }))} rows={4} placeholder="自我介绍、排班偏好、稳定性、期望薪资" className="w-full px-3 py-2 text-[12px] outline-none resize-none" style={hbInputStyle} />
            <button onClick={onSaveResume} className="w-full py-3 text-[14px] font-black active:scale-[0.98] transition-transform" style={{ background: TEAL, color: '#fff', borderRadius: 14 }}>保存简历</button>
        </PaperCard>
    );

    const renderPipelineView = () => (
        <PaperCard className="p-4 space-y-3">
            <div className="flex items-start justify-between gap-3">
                <div>
                    <SectionTag en="pipeline">求职进展</SectionTag>
                    <div className="text-[11px] mt-1" style={{ color: INK_SOFT }}>{applications.length ? `${applications.length} 个申请` : '还没有投递记录'}</div>
                </div>
                {selectedApplication && <Badge tone={stageTone(activeStage)}>{BANK_JOB_STAGE_LABELS[activeStage || 'submitted'] || '求职中'}</Badge>}
            </div>

            {applications.length > 0 && (
                <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
                    {applications.map(app => (
                        <button key={app.id} onClick={() => onSelectApplication(app.id)} className="shrink-0 min-w-[150px] text-left p-2.5" style={{ ...cleanCardStyle, borderColor: selectedApplication?.id === app.id ? 'rgba(24,183,180,0.58)' : LINE, borderRadius: 14 }}>
                            <div className="text-[12px] font-black truncate" style={{ color: INK }}>{app.title}</div>
                            <div className="text-[10px] truncate mt-0.5" style={{ color: INK_SOFT }}>{app.employer}</div>
                            <div className="mt-1"><Badge tone={stageTone(app.stage)}>{BANK_JOB_STAGE_LABELS[app.stage || 'submitted'] || app.status}</Badge></div>
                        </button>
                    ))}
                </div>
            )}

            {selectedApplication ? (
                <div className="space-y-3">
                    <div className="rounded-[16px] p-3 text-[12px] leading-relaxed" style={{ background: '#f7f8f8', color: '#4a4750' }}>{selectedApplication.message}</div>
                    {selectedApplication.aiReview && (
                        <div className="rounded-[16px] p-3 text-[12px] leading-relaxed" style={{ background: '#eefafa', color: '#0f766e' }}>
                            <b>简历匹配 {selectedApplication.aiReview.score} 分：</b>{selectedApplication.aiReview.suggestion}
                        </div>
                    )}
                    {!selectedApplication.aiReview && activeStage === 'submitted' && (
                        <div className="rounded-[16px] p-3 text-[12px] leading-relaxed" style={{ background: '#eefafa', color: '#0f766e' }}>
                            简历已经递出，匹配评估会稍后补到这条进展里。
                        </div>
                    )}

                    <div className="grid grid-cols-2 gap-2 max-[420px]:grid-cols-1">
                        {(selectedApplication.todos || []).slice(0, 4).map(todo => (
                            <div key={todo.id} className="rounded-[14px] p-3 text-[11px]" style={{ background: todo.done ? '#f0fdf4' : '#fff', border: `1px solid ${LINE}` }}>
                                <div className="font-black" style={{ color: INK }}>{todo.label}</div>
                                <div className="mt-1 leading-relaxed" style={{ color: INK_SOFT }}>{todo.detail}</div>
                            </div>
                        ))}
                    </div>

                    {(selectedApplication.stageHistory || []).length > 0 && (
                        <div className="space-y-2">
                            {(selectedApplication.stageHistory || []).slice(0, 5).map(item => (
                                <button key={item.id} onClick={() => selectedApplication.stageResult?.id === item.id && setResultOpenId(item.id)} className="w-full text-left rounded-[14px] p-3" style={{ background: '#fff', border: `1px solid ${LINE}` }}>
                                    <div className="flex items-center justify-between gap-2">
                                        <div className="font-black text-[12px] truncate" style={{ color: INK }}>{item.title}</div>
                                        <span className="text-[10px] shrink-0" style={{ color: INK_SOFT }}>{item.at}</span>
                                    </div>
                                    <div className="text-[11px] leading-relaxed mt-1" style={{ color: INK_SOFT }}>{item.detail}</div>
                                </button>
                            ))}
                        </div>
                    )}

                    {(activeStage === 'recruiter_chat') && (
                        <button onClick={() => setChatAppId(selectedApplication.id)} className="w-full py-2.5 text-[13px] font-black active:scale-95 transition-transform flex items-center justify-center gap-1.5" style={{ background: TEAL, color: '#fff', borderRadius: 14 }}>
                            <ChatCircleText size={16} weight="bold" />
                            打开招聘沟通
                        </button>
                    )}

                    {(activeStage === 'assessment' || activeStage === 'interview') && currentQuestion && (
                        <div className="rounded-[16px] p-3" style={{ background: '#fff', border: `1px solid ${LINE}` }}>
                            <div className="text-[11px] font-black mb-1" style={{ color: INK }}>{activeStage === 'assessment' ? '测评题 / 试岗记录' : '面试问题'}</div>
                            <div className="text-[12px] leading-relaxed" style={{ color: '#4a4750' }}>{currentQuestion.question}</div>
                        </div>
                    )}

                    {canAdvance && (
                        <>
                            {activeStage !== 'offer' && (
                                <textarea value={stageInput} onChange={e => setStageInput(e.target.value)} rows={3} placeholder={activeStage === 'recruiter_chat' ? '记录这轮沟通：薪资结构、社保、排班、试用期、结算和到岗前费用是否说清楚' : activeStage === 'negotiation' ? '写下你的谈薪诉求、可接受底线和希望确认的条款' : '写下面试回答、测评表现或试岗记录'} className="w-full px-3 py-2 text-[12px] outline-none resize-none" style={hbInputStyle} />
                            )}
                            <div className="flex gap-2">
                                <button onClick={advanceSelected} disabled={aiBusy === 'stage'} className="flex-1 py-2.5 text-[13px] font-black active:scale-95 transition-transform disabled:opacity-60" style={{ background: TEAL, color: '#fff', borderRadius: 14 }}>
                                    {aiBusy === 'stage' ? '判定中…' : actionLabel(selectedApplication)}
                                </button>
                                <button onClick={() => setDeclineAppId(selectedApplication.id)} className="px-3 py-2.5 text-[12px] font-black active:scale-95 transition-transform" style={{ background: '#f4f5f5', color: INK_SOFT, borderRadius: 14 }}>
                                    放弃
                                </button>
                            </div>
                        </>
                    )}
                </div>
            ) : (
                <div className="py-8 text-center text-[12px]" style={{ color: INK_SOFT }}>先挑一个岗位投递，求职进展会在这里展开。</div>
            )}
        </PaperCard>
    );

    return (
        <div className="flex-1 overflow-y-auto no-scrollbar px-3.5 pb-4" style={{ background: PAGE_BG }}>
            <div className="sticky top-0 z-30 -mx-3.5 px-3.5 pt-3 pb-2" style={{ background: PAGE_BG }}>
                <div className="flex items-center justify-between gap-2">
                    <div className="flex rounded-full p-1" style={{ background: '#fff', border: `1px solid ${LINE}` }}>
                        {[
                            ['jobs', '职位'],
                            ['pipeline', '进展'],
                            ['resume', '简历'],
                        ].map(([key, label]) => (
                            <button key={key} onClick={() => setView(key as JobView)} className="px-3 py-1.5 text-[12px] font-black rounded-full transition-colors" style={{ background: view === key ? TEAL : 'transparent', color: view === key ? '#fff' : INK_SOFT }}>{label}</button>
                        ))}
                    </div>
                    <div className="flex items-center">
                        <IconButton title="收藏"><Star size={20} weight="bold" /></IconButton>
                        <IconButton title="分享"><ShareFat size={20} weight="bold" /></IconButton>
                        <IconButton title="更多"><DotsThree size={22} weight="bold" /></IconButton>
                    </div>
                </div>
            </div>

            {view === 'jobs' && renderJobsView()}
            {view === 'pipeline' && <div className="pt-2 space-y-3">{renderCurrentJob()}{renderPipelineView()}</div>}
            {view === 'resume' && <div className="pt-2">{renderResumeView()}</div>}

            {jobModal && (
                <div className="fixed inset-0 z-[9999] flex items-end justify-center sm:items-center p-0 sm:p-5" onClick={() => setJobModalId(null)}>
                    <div className="absolute inset-0 bg-black/35 animate-fade-in" style={{ backdropFilter: 'blur(6px)' }} />
                    <div className="relative w-full max-w-md animate-slide-up flex flex-col" style={{ background: '#fff', borderRadius: '22px 22px 0 0', boxShadow: '0 -20px 70px -34px rgba(15,23,42,0.55)', maxHeight: '92vh' }} onClick={e => e.stopPropagation()}>
                        <div className="overflow-y-auto no-scrollbar px-5 pt-5 pb-4 space-y-5">
                            <div className="flex items-start justify-between gap-3">
                                <button onClick={() => setJobModalId(null)} className="h-9 w-9 rounded-full flex items-center justify-center shrink-0 active:scale-95" aria-label="关闭" style={{ color: INK }}>
                                    <CaretRight size={21} weight="bold" style={{ transform: 'rotate(180deg)' }} />
                                </button>
                                <div className="flex items-center gap-1">
                                    <IconButton title="收藏"><Star size={20} weight="bold" /></IconButton>
                                    <IconButton title="分享"><ShareFat size={20} weight="bold" /></IconButton>
                                    <IconButton title="更多"><DotsThree size={22} weight="bold" /></IconButton>
                                </div>
                            </div>

                            <section>
                                <div className="flex items-start justify-between gap-3">
                                    <h2 className="min-w-0 text-[25px] font-black leading-tight" style={{ color: INK }}>{jobModal.title}</h2>
                                    <div className="shrink-0 text-right text-[20px] font-black leading-tight" style={{ color: TEAL }}>{formatSalaryShort(jobModal)}</div>
                                </div>
                                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-[13px]" style={{ color: INK_SOFT }}>
                                    <span className="flex items-center gap-1"><MapPin size={14} weight="fill" />{jobModal.location || '本市'}</span>
                                    <span className="flex items-center gap-1"><Briefcase size={14} weight="fill" />{jobModal.experienceRequired || '经验不限'}</span>
                                    <span className="flex items-center gap-1"><GraduationCap size={14} weight="fill" />{jobModal.education || '学历不限'}</span>
                                </div>
                                <div className="mt-2 text-[11px]" style={{ color: '#adb0b5' }}>{jobModal.publishNote || '该职位近期活跃'}</div>
                            </section>

                            <div className="w-full flex items-center justify-between gap-3 rounded-[16px] py-3 text-left" style={{ borderTop: `1px solid ${LINE}`, borderBottom: `1px solid ${LINE}` }}>
                                <div className="min-w-0 flex items-center gap-3">
                                    <span className="h-12 w-12 rounded-full flex items-center justify-center shrink-0" style={{ background: '#eefafa', color: TEAL }}>
                                        <UserCircle size={30} weight="fill" />
                                    </span>
                                    <div className="min-w-0">
                                        <div className="text-[16px] font-black truncate" style={{ color: INK }}>{jobModal.bossName || '招聘负责人'}</div>
                                        <div className="text-[12px] truncate" style={{ color: INK_SOFT }}>{jobModal.employer} · {jobModal.bossTitle || 'HR'}</div>
                                        <div className="mt-1 text-[11px]" style={{ color: '#adb0b5' }}>
                                            {[jobModal.recruiterStats?.responseTime, jobModal.recruiterStats?.todayReplies, jobModal.recruiterStats?.replyRate].filter(Boolean).join(' · ')}
                                        </div>
                                    </div>
                                </div>
                                <CaretRight size={18} weight="bold" color={INK_SOFT} />
                            </div>

                            {detailSection('薪资详情', (
                                <div className="space-y-2 text-[14px] leading-relaxed" style={{ color: '#565b62' }}>
                                    <div>薪资范围：{formatSalaryFull(jobModal)}</div>
                                    {jobModal.salaryDetail?.baseSalary && <div>职位底薪：{jobModal.salaryDetail.baseSalary}元/月</div>}
                                    <div>社保类型：{jobModal.salaryDetail?.socialInsurance || (jobModal.payCycle === 'monthly' ? '五险一金' : '灵活结算')}</div>
                                    {!!(jobModal.salaryDetail?.bonusSubsidies || jobModal.benefits)?.length && <div>奖金补贴：{(jobModal.salaryDetail?.bonusSubsidies || jobModal.benefits).join('、')}</div>}
                                    {jobModal.salaryDetail?.note && <div>{jobModal.salaryDetail.note}</div>}
                                </div>
                            ))}

                            {detailSection('职位详情', (
                                <div className="space-y-3">
                                    <div className="flex flex-wrap gap-2">
                                        {jobTags(jobModal).slice(0, 10).map(tag => <Badge key={tag} tone={jobModal.riskTags.includes(tag) ? 'warn' : 'default'}>{tag}</Badge>)}
                                    </div>
                                    <p className="text-[14px] leading-relaxed" style={{ color: '#565b62' }}>{jobModal.description}</p>
                                    <div className="space-y-1.5 text-[14px] leading-relaxed" style={{ color: '#565b62' }}>
                                        {(jobModal.responsibilities?.length ? jobModal.responsibilities : [jobModal.companyIntro || jobModal.description]).map(item => <div key={item}>· {item}</div>)}
                                    </div>
                                    {!!jobModal.requirementDetails?.length && (
                                        <div className="space-y-1.5 text-[14px] leading-relaxed" style={{ color: '#565b62' }}>
                                            {jobModal.requirementDetails.map(item => <div key={item}>· {item}</div>)}
                                        </div>
                                    )}
                                </div>
                            ))}

                            {detailSection('员工福利', (
                                <div className="flex flex-wrap gap-2">
                                    {(jobModal.employeeBenefits?.length ? jobModal.employeeBenefits : jobModal.benefits).map(item => <Badge key={item}>{item}</Badge>)}
                                </div>
                            ))}

                            {detailSection('公司介绍', (
                                <div className="space-y-3 text-[14px] leading-relaxed" style={{ color: '#565b62' }}>
                                    <div className="flex items-center gap-2 text-[13px]" style={{ color: INK_SOFT }}>
                                        <Buildings size={16} weight="fill" />
                                        <span>{jobModal.employer} · {jobModal.companyIndustry || jobModal.category} · {jobModal.companySize || '规模未披露'} · {jobModal.companyStage || '资料待补充'}</span>
                                    </div>
                                    <p>{jobModal.companyIntro || `${jobModal.employer} 正在招聘「${jobModal.title}」，岗位信息以沟通确认的条款为准。`}</p>
                                </div>
                            ))}

                            {!!jobModal.riskTags.length && detailSection(jobModal.black ? '细节留意' : '注意事项', (
                                <div className="rounded-[16px] p-3 text-[13px] leading-relaxed flex gap-2" style={{ background: jobModal.black ? '#fff1f2' : '#fff7ed', color: jobModal.black ? '#be123c' : '#9a3412' }}>
                                    <WarningCircle size={18} weight="fill" className="shrink-0 mt-0.5" />
                                    <div>
                                        <b>{jobModal.riskTags.join('、')}</b>
                                        <div className="mt-1">这些细节先问清：费用名目、试岗是否计薪、到账时间、合同主体和上班地址。关键条件尽量留在文字里。</div>
                                    </div>
                                </div>
                            ))}
                        </div>
                        <div className="px-5 py-4" style={{ borderTop: `1px solid ${LINE}`, background: '#fff' }}>
                            {activeApplicationForModal ? (
                                <button onClick={() => { setJobModalId(null); setView('pipeline'); onSelectApplication(activeApplicationForModal.id); }} className="w-full py-3 text-[15px] font-black active:scale-[0.98] transition-transform flex items-center justify-center gap-1.5" style={{ background: TEAL, color: '#fff', borderRadius: 14 }}>
                                    查看求职进展
                                </button>
                            ) : (
                                <button onClick={() => applySelectedJob(jobModal)} disabled={aiBusy === 'resume'} className="w-full py-3 text-[15px] font-black active:scale-[0.98] transition-transform disabled:opacity-60 flex items-center justify-center gap-1.5" style={{ background: jobModal.black ? '#f43f5e' : TEAL, color: '#fff', borderRadius: 14 }}>
                                    <ChatCircleText size={18} weight="bold" />
                                    {aiBusy === 'resume' ? '匹配评估中…' : jobModal.black ? '继续沟通' : '立即沟通'}
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            )}

            <JobModal
                open={!!resultApplication}
                title={resultApplication?.stageResult?.title || '阶段结果'}
                sub={resultApplication ? `${resultApplication.employer} · ${resultApplication.title}` : undefined}
                onClose={() => setResultOpenId(null)}
                footer={resultApplication?.stage === 'offer' && (
                    <button onClick={async () => { await onAdvanceApplication(resultApplication.id, '接受 Offer'); setResultOpenId(null); }} disabled={aiBusy === 'stage'} className="w-full py-3 text-[15px] font-black active:scale-[0.98] transition-transform disabled:opacity-60" style={{ background: TEAL, color: '#fff', borderRadius: 14 }}>
                        {aiBusy === 'stage' ? '办理中…' : '接受 Offer'}
                    </button>
                )}
            >
                {resultApplication?.stageResult && (
                    <div className="space-y-3 text-[12px] leading-relaxed" style={{ color: '#4a4750' }}>
                        <Badge tone={resultApplication.stageResult.tone}>{BANK_JOB_STAGE_LABELS[resultApplication.stageResult.stage] || '进展'}</Badge>
                        <div>{resultApplication.stageResult.summary}</div>
                        <div className="space-y-1.5">
                            {resultApplication.stageResult.highlights.map(h => <div key={h} className="rounded-[12px] px-3 py-2" style={{ background: '#f7f8f8' }}>{h}</div>)}
                        </div>
                        {!!resultApplication.stageResult.riskFlags?.length && (
                            <div className="rounded-[16px] p-3" style={{ background: '#fff1f2', color: '#be123c' }}>
                                <b>需要复盘：</b>{resultApplication.stageResult.riskFlags.join('、')}
                            </div>
                        )}
                        {resultApplication.offerTerms && (
                            <div className="grid grid-cols-2 gap-2 text-[11px]">
                                <div className="rounded-[14px] p-3" style={{ background: '#f0fdf4' }}><b>薪资</b><div>¥{resultApplication.offerTerms.salary}{resultApplication.offerTerms.payCycle === 'daily' ? '/天' : '/月'}</div></div>
                                <div className="rounded-[14px] p-3" style={{ background: '#f0fdf4' }}><b>结算</b><div>{resultApplication.offerTerms.payCycle === 'daily' ? '日结' : `${resultApplication.offerTerms.payDay || 10} 号`}</div></div>
                                <div className="rounded-[14px] p-3" style={{ background: '#f7f8f8' }}><b>时间</b><div>{resultApplication.offerTerms.workTime || '排班制'}</div></div>
                                <div className="rounded-[14px] p-3" style={{ background: '#f7f8f8' }}><b>试用</b><div>{resultApplication.offerTerms.trialDays ? `${resultApplication.offerTerms.trialDays} 天` : '无'}</div></div>
                            </div>
                        )}
                    </div>
                )}
            </JobModal>

            <JobModal
                open={!!chatApplication}
                title="招聘沟通"
                sub={chatApplication ? `${chatApplication.employer} · ${chatApplication.title}` : undefined}
                onClose={() => setChatAppId(null)}
                footer={(
                    <div className="space-y-2">
                        <div className="flex gap-1.5 overflow-x-auto no-scrollbar">
                            {['薪资结构怎么构成？', '社保和试用期怎么算？', '排班和结算能说清楚吗？'].map(q => (
                                <button key={q} onClick={() => setChatDraft(q)} className="shrink-0 px-2.5 py-1.5 text-[11px] font-bold rounded-full" style={{ background: '#eefafa', color: '#0f766e' }}>{q}</button>
                            ))}
                        </div>
                        <div className="flex gap-2">
                            <input value={chatDraft} onChange={e => setChatDraft(e.target.value)} placeholder="问薪资、社保、排班、试用期、结算或到岗费用" className="min-w-0 flex-1 px-3 py-2 text-[12px] outline-none" style={hbInputStyle} />
                            <button onClick={sendChat} disabled={aiBusy === 'recruiter'} className="px-3 py-2 text-[12px] font-black active:scale-95 transition-transform disabled:opacity-60" style={{ background: TEAL, color: '#fff', borderRadius: 14 }}>{aiBusy === 'recruiter' ? '等…' : '发送'}</button>
                        </div>
                    </div>
                )}
            >
                <div className="space-y-2 max-h-[48vh] overflow-y-auto no-scrollbar pr-1">
                    {(chatApplication?.chatMessages || []).map((m, idx) => (
                        <div key={`${m.at}-${idx}`} className={`rounded-[14px] p-3 text-[12px] leading-relaxed ${m.role === 'user' ? 'ml-8' : 'mr-8'}`} style={{ background: m.role === 'user' ? '#e0f2fe' : '#f7f8f8', color: m.role === 'user' ? '#075985' : '#4a4750' }}>
                            <b>{m.role === 'boss' ? '招聘方' : m.role === 'user' ? '我' : '系统'}：</b>{m.content}
                        </div>
                    ))}
                </div>
            </JobModal>

            <JobModal
                open={!!declineAppId}
                title="放弃这份机会"
                sub="这不会删除历史，只会把申请收尾"
                onClose={() => setDeclineAppId(null)}
                footer={<button onClick={declineSelected} className="w-full py-3 text-[15px] font-black active:scale-[0.98] transition-transform" style={{ background: '#f43f5e', color: '#fff', borderRadius: 14 }}>确认放弃</button>}
            >
                <textarea value={declineReason} onChange={e => setDeclineReason(e.target.value)} rows={3} placeholder="原因，比如排班不合适、薪资没谈拢、条款没说透" className="w-full px-3 py-2 text-[12px] outline-none resize-none" style={hbInputStyle} />
            </JobModal>
        </div>
    );
};

export default BankJobCenter;
