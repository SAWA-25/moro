import React, { useState } from 'react';
import { SimGender, SimNPC } from '../../types';
import { CheckCircle, X } from '@phosphor-icons/react';
import { NPCAvatar } from '../../utils/styledIcons';

const PERSONALITY_OPTIONS = [
    '社牛', '社恐', '卷王', '摸鱼', '文青', '话题女王', '职场精英', '暖男/暖女',
    '叛逆', '精致', '独立', '自恋', '佛系', '焦虑', '八卦', '高冷', '上进',
    '有品味', '消息灵通', '目标明确', '热心', '老好人', '不按常理出牌', '外貌协会',
];

const GENDER_OPTIONS: { value: SimGender; label: string }[] = [
    { value: 'male', label: '男' },
    { value: 'female', label: '女' },
    { value: 'nonbinary', label: '非二元' },
];

const INK = '#2b2933';

const NPCEditorPanel: React.FC<{
    npc: SimNPC;
    onSave: (updates: Partial<SimNPC>) => void;
    onClose: () => void;
}> = ({ npc, onSave, onClose }) => {
    const [name, setName] = useState(npc.name);
    const [gender, setGender] = useState<SimGender>(npc.gender || 'nonbinary');
    const [personality, setPersonality] = useState<string[]>(npc.personality || []);
    const [bio, setBio] = useState(npc.bio || '');
    const [backstory, setBackstory] = useState(npc.backstory || '');

    const togglePersonality = (value: string) => {
        setPersonality(current => current.includes(value) ? current.filter(item => item !== value) : [...current, value]);
    };

    const handleSave = () => {
        onSave({
            name: name.trim() || npc.name,
            gender,
            personality: personality.length > 0 ? personality : npc.personality,
            bio: bio.trim(),
            backstory: backstory.trim(),
        });
    };

    const inputStyle: React.CSSProperties = {
        width: '100%', padding: '8px 11px', fontSize: 12,
        background: '#fbfaf7', border: '1px solid rgba(236,233,226,0.95)',
        outline: '1px dashed rgba(167,162,151,0.4)', outlineOffset: -3,
        borderRadius: 10, color: '#2b2933', fontFamily: 'var(--font-hand)',
    };
    const chip = (sel: boolean): React.CSSProperties => ({
        padding: '3px 10px', fontSize: 12, borderRadius: 999,
        fontFamily: 'var(--font-hand)', fontWeight: 700,
        border: sel ? `1px solid ${INK}` : '1px solid rgba(236,233,226,0.95)',
        background: sel ? INK : 'rgba(255,255,255,0.95)',
        color: sel ? '#fbfaf7' : '#5c574f',
        outline: sel ? '1px dashed rgba(255,255,255,0.35)' : '1px dashed rgba(167,162,151,0.36)',
        outlineOffset: -3,
    });

    return (
        <div className="absolute inset-0 z-50 flex items-end justify-center"
            style={{ background: 'rgba(43,41,51,0.36)', animation: 'fadeIn 0.25s ease' }}
            onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
            <div className="scrap-card w-full mx-2 mb-2 relative" style={{
                maxHeight: '80vh', display: 'flex', flexDirection: 'column', borderRadius: 18,
                animation: 'slideUp 0.3s cubic-bezier(0.25,1,0.5,1)',
            }}>
                <span style={{
                    position: 'absolute', top: -11, left: '50%', transform: 'translateX(-50%) rotate(-2deg)',
                    width: 116, height: 20, background: 'rgba(255,255,255,0.6)',
                    borderLeft: '1px dashed rgba(160,156,146,0.5)', borderRight: '1px dashed rgba(160,156,146,0.5)',
                    pointerEvents: 'none',
                }} />
                <div className="flex items-center justify-between px-4 pt-4 pb-2">
                    <span className="font-hand" style={{ fontSize: 18, fontWeight: 700, color: '#2b2933' }}>改改这位街坊</span>
                    <button onClick={onClose} className="scrap-btn-paper flex items-center justify-center" style={{ width: 30, height: 30 }}>
                        <X size={14} weight="bold" />
                    </button>
                </div>
                <div className="lace-edge mx-4" />

                <div className="overflow-y-auto flex-1 no-scrollbar" style={{ padding: '12px 16px' }}>
                    <div className="flex items-center gap-3" style={{ padding: '9px 11px', marginBottom: 12, background: 'rgba(120,116,106,0.05)', borderRadius: 12, border: '1px dashed rgba(167,162,151,0.4)' }}>
                        <div style={{ padding: 3, background: '#fbfaf7', borderRadius: 12, outline: '1px dashed rgba(167,162,151,0.5)', outlineOffset: -2 }}>
                            <NPCAvatar name={name || npc.name} size={42} className="rounded-lg" />
                        </div>
                        <div>
                            <div className="font-hand" style={{ fontSize: 16, fontWeight: 700, color: '#2b2933' }}>{name || npc.name}</div>
                            <div className="font-hand" style={{ fontSize: 11, color: '#a79c8e', marginTop: 2 }}>长按街坊卡就能翻到这页</div>
                        </div>
                    </div>

                    <div className="drawer-tag" style={{ marginBottom: 6 }}><span>名字</span></div>
                    <input value={name} onChange={event => setName(event.target.value)} style={inputStyle} />

                    <div className="drawer-tag" style={{ margin: '12px 0 6px' }}><span>性别</span></div>
                    <div className="flex gap-1.5 flex-wrap">
                        {GENDER_OPTIONS.map(option => (
                            <button key={option.value} onClick={() => setGender(option.value)} style={chip(gender === option.value)}>
                                {option.label}
                            </button>
                        ))}
                    </div>

                    <div className="drawer-tag" style={{ margin: '12px 0 6px' }}><span>性格</span></div>
                    <div className="flex flex-wrap gap-1.5">
                        {PERSONALITY_OPTIONS.map(item => (
                            <button key={item} onClick={() => togglePersonality(item)} style={chip(personality.includes(item))}>
                                {item}
                            </button>
                        ))}
                    </div>

                    <div className="drawer-tag" style={{ margin: '12px 0 6px' }}><span>简介</span></div>
                    <textarea value={bio} onChange={event => setBio(event.target.value)} rows={3} style={{ ...inputStyle, resize: 'vertical' }} />

                    <div className="drawer-tag" style={{ margin: '12px 0 6px' }}><span>来历</span></div>
                    <textarea value={backstory} onChange={event => setBackstory(event.target.value)} rows={4} style={{ ...inputStyle, resize: 'vertical' }} />
                </div>

                <div style={{ padding: '10px 16px 14px' }}>
                    <button onClick={handleSave}
                        className="scrap-btn w-full flex items-center justify-center gap-1.5"
                        style={{ padding: '11px', fontFamily: 'var(--font-hand)', fontSize: 15, fontWeight: 700 }}>
                        <CheckCircle size={15} weight="bold" /> 记下这页设定
                    </button>
                </div>
            </div>
        </div>
    );
};

export default NPCEditorPanel;
