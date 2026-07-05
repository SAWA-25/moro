export const getLocalDateKey = (date: Date = new Date()): string => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
};

export const getNextLocalMidnightDelay = (now: Date = new Date()): number => {
    const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    return Math.max(0, next.getTime() - now.getTime());
};
