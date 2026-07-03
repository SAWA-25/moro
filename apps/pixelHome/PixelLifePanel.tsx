import React, { useState } from 'react';
import type { DailySchedule, RoomGeneratedState, RoomNote, RoomTodo } from '../../types';
import { PixelBadge, PixelButton, PixelInput, PixelPanel, PixelTextarea } from './PixelUi';

interface Props {
  charName: string;
  today: string;
  roomState: RoomGeneratedState | null;
  todo: RoomTodo | null;
  notes: RoomNote[];
  schedule: DailySchedule | null;
  loading: boolean;
  generating: boolean;
  onRefresh: () => void;
  onClose: () => void;
  onAddTodo: (text: string) => void;
  onToggleTodo: (index: number) => void;
  onDeleteTodo: (index: number) => void;
  onAddNote: (content: string) => void;
  onDeleteNote: (id: string) => void;
}

const noteTypeLabel: Record<string, string> = {
  thought: '随笔',
  lyric: '歌词',
  doodle: '涂鸦',
  search: '查找',
  gossip: '闲话',
};

const PixelLifePanel: React.FC<Props> = ({
  charName,
  today,
  roomState,
  todo,
  notes,
  schedule,
  loading,
  generating,
  onRefresh,
  onClose,
  onAddTodo,
  onToggleTodo,
  onDeleteTodo,
  onAddNote,
  onDeleteNote,
}) => {
  const [text, setText] = useState('');
  const [noteText, setNoteText] = useState('');

  const submitTodo = () => {
    const value = text.trim();
    if (!value) return;
    onAddTodo(value);
    setText('');
  };

  const submitNote = () => {
    const value = noteText.trim();
    if (!value) return;
    onAddNote(value);
    setNoteText('');
  };

  return (
    <PixelPanel
      title="今日生活"
      className="absolute inset-x-3 top-3 z-50 max-h-[72%] overflow-hidden"
      right={<button onClick={onClose} className="text-xs font-black">X</button>}
    >
      <div className="max-h-[calc(72vh-96px)] space-y-3 overflow-y-auto p-3">
        <div className="border-2 border-[#3f3730] bg-[#f7efda] p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <PixelBadge>{today}</PixelBadge>
            <PixelButton onClick={onRefresh} disabled={generating} className="px-2 py-1">
              {generating ? '刷新中' : '重整今日'}
            </PixelButton>
          </div>
          <p className="text-xs font-black leading-relaxed">{roomState?.actorStatus || `${charName}还没整理今天的状态。`}</p>
          {roomState?.welcomeMessage && (
            <div className="mt-2 border-2 border-[#3f3730] bg-[#b9c7c1] px-3 py-2 text-xs font-bold leading-relaxed">
              {roomState.welcomeMessage}
            </div>
          )}
          {loading && <p className="mt-2 text-[10px] font-bold text-[#76685d]">读取本地生活记录中...</p>}
        </div>

        <section className="border-2 border-[#3f3730] bg-[#dccaa3]">
          <div className="flex items-center justify-between border-b-2 border-[#3f3730] px-3 py-2">
            <h4 className="text-xs font-black">今日清单</h4>
            <span className="text-[10px] font-black">{todo?.items.filter(i => i.done).length || 0}/{todo?.items.length || 0}</span>
          </div>
          <div className="space-y-2 bg-[#efe2c5] p-3">
            {todo?.items.length ? todo.items.map((item, index) => (
              <div key={`${item.text}-${index}`} className="flex items-start gap-2">
                <button
                  onClick={() => onToggleTodo(index)}
                  className={`mt-0.5 h-5 w-5 shrink-0 border-2 border-[#3f3730] text-[10px] font-black ${item.done ? 'bg-[#91aa8d]' : 'bg-[#f7efda]'}`}
                >
                  {item.done ? '✓' : ''}
                </button>
                <button
                  onClick={() => onToggleTodo(index)}
                  className={`flex-1 text-left text-xs font-bold leading-relaxed ${item.done ? 'text-[#76685d] line-through' : 'text-[#302b26]'}`}
                >
                  {item.text}
                </button>
                <button onClick={() => onDeleteTodo(index)} className="border-2 border-[#3f3730] bg-[#a86d6d] px-1.5 text-[10px] font-black text-white">
                  X
                </button>
              </div>
            )) : (
              <p className="text-xs font-bold text-[#76685d]">今天还没有清单。</p>
            )}
            <div className="flex gap-2">
              <PixelInput
                value={text}
                onChange={e => setText(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') submitTodo(); }}
                placeholder="给 TA 添一件小事"
              />
              <PixelButton onClick={submitTodo} className="shrink-0 px-3">加</PixelButton>
            </div>
          </div>
        </section>

        <section className="border-2 border-[#3f3730] bg-[#b9c7c1]">
          <div className="border-b-2 border-[#3f3730] px-3 py-2">
            <h4 className="text-xs font-black">作息</h4>
          </div>
          <div className="max-h-40 space-y-1 overflow-y-auto bg-[#efe2c5] p-3">
            {schedule?.slots?.length ? schedule.slots.slice(0, 8).map((slot, index) => (
              <div key={`${slot.startTime}-${index}`} className="grid grid-cols-[52px_1fr] gap-2 text-[11px] font-bold">
                <span className="text-[#76685d]">{slot.startTime}</span>
                <span>{slot.activity}</span>
              </div>
            )) : (
              <p className="text-xs font-bold text-[#76685d]">还没有同步到今日作息。</p>
            )}
          </div>
        </section>

        <section className="border-2 border-[#3f3730] bg-[#a86d6d]">
          <div className="border-b-2 border-[#3f3730] px-3 py-2 text-white">
            <h4 className="text-xs font-black">私房随笔</h4>
          </div>
          <div className="max-h-52 space-y-2 overflow-y-auto bg-[#efe2c5] p-3">
            <div className="space-y-2 border-2 border-[#3f3730] bg-[#f7efda] p-2">
              <PixelTextarea
                value={noteText}
                onChange={e => setNoteText(e.target.value)}
                placeholder="写一小段今天留在房间里的话"
                rows={3}
              />
              <div className="flex justify-end">
                <PixelButton onClick={submitNote} className="px-3 py-1">写入</PixelButton>
              </div>
            </div>
            {notes.length ? notes.slice(0, 5).map(note => (
              <article key={note.id} className="border-2 border-[#3f3730] bg-[#f7efda] p-2">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="text-[9px] font-black text-[#76685d]">{noteTypeLabel[note.type] || note.type}</span>
                  <button onClick={() => onDeleteNote(note.id)} className="text-[10px] font-black text-[#8f6864]">删除</button>
                </div>
                <p className="whitespace-pre-wrap text-xs font-bold leading-relaxed">{note.content}</p>
              </article>
            )) : (
              <p className="text-xs font-bold text-[#76685d]">还没有新的随笔。</p>
            )}
          </div>
        </section>
      </div>
    </PixelPanel>
  );
};

export default PixelLifePanel;
