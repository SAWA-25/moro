/**
 * QQ 音乐连接面板
 * - 扫码登录 QQ 音乐网页登录态
 * - 登录成功后用于 QQ 音乐主页、歌单、最近播放、歌词播放和红心收藏
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useOS } from '../../context/OSContext';
import { QQMusicAccount, musicApi, useMusic } from '../../context/MusicContext';
import { BokehBg, C, MizuHeader, Sparkle } from './MusicUI';

interface Props {
  onBack: () => void;
  onConnected: (account: QQMusicAccount) => void;
}

const statusText: Record<string, string> = {
  idle: '准备二维码...',
  waiting: '请用 QQ 扫描二维码',
  scanned: '已扫描，请在手机上确认',
  expired: '二维码已过期，请刷新',
  done: '正在连接 QQ 音乐...',
  error: '二维码暂时不可用',
};

const QQMusicLoginPanel: React.FC<Props> = ({ onBack, onConnected }) => {
  const { addToast } = useOS();
  const { cfg } = useMusic();
  const [ticket, setTicket] = useState('');
  const [qrImg, setQrImg] = useState('');
  const [status, setStatus] = useState<'idle' | 'waiting' | 'scanned' | 'expired' | 'done' | 'error'>('idle');
  const [detail, setDetail] = useState('');
  const pollRef = useRef<number | null>(null);

  const stopPoll = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const checkOnce = useCallback(async (nextTicket: string) => {
    const r = await musicApi.qqLoginQrCheck(cfg, nextTicket);
    if (r.status === 'waiting') {
      setStatus('waiting');
      setDetail(r.message || '');
    } else if (r.status === 'scanned') {
      setStatus('scanned');
      setDetail(r.message || '');
    } else if (r.status === 'expired') {
      stopPoll();
      setStatus('expired');
      setDetail(r.message || '');
    } else if (r.status === 'success' && r.account) {
      stopPoll();
      setStatus('done');
      onConnected({
        uin: String(r.account.uin || ''),
        nickname: r.account.nickname || 'QQ 音乐用户',
        avatarUrl: r.account.avatarUrl || '',
        cookie: r.account.cookie || '',
        connectedAt: Date.now(),
      });
    } else if (r.status === 'error') {
      stopPoll();
      setStatus('error');
      setDetail(r.message || 'QQ 音乐登录接口暂时不可用');
    }
  }, [cfg, onConnected, stopPoll]);

  const startQr = useCallback(async () => {
    stopPoll();
    setStatus('idle');
    setDetail('');
    setQrImg('');
    setTicket('');
    try {
      const r = await musicApi.qqLoginQrCreate(cfg);
      const nextTicket = String(r.ticket || '').trim();
      const nextQrImg = r.qrImg || '';
      if (!nextTicket || !nextQrImg) {
        throw new Error(r.message || 'QQ 音乐登录代理没有返回二维码，请更新 Worker 后重试');
      }
      setTicket(nextTicket);
      setQrImg(nextQrImg);
      setStatus('waiting');
      pollRef.current = window.setInterval(() => {
        void checkOnce(nextTicket).catch((e: any) => {
          setDetail(e?.message || '轮询失败');
        });
      }, 2500);
    } catch (e: any) {
      setStatus('error');
      setDetail(e?.message || '二维码生成失败');
      addToast(`QQ 音乐二维码失败：${e?.message || '未知错误'}`, 'error');
    }
  }, [addToast, cfg, checkOnce, stopPoll]);

  useEffect(() => {
    startQr();
    return () => stopPoll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex flex-col h-full relative"
      style={{ background: `linear-gradient(180deg, #ffffff 0%, ${C.bg} 50%, ${C.bgDeep} 100%)` }}>
      <BokehBg />
      <MizuHeader title="连接 QQ 音乐" onBack={onBack} />

      <div className="flex-1 overflow-y-auto px-4 py-4 relative z-10 shizuku-scrollbar">
        <div className="flex flex-col items-center">
          <div className="relative rounded-3xl p-4 shizuku-glass-strong"
            style={{ boxShadow: `0 8px 40px ${C.glow}20` }}>
            {qrImg ? (
              <img src={qrImg} alt="QQ 音乐登录二维码" className="w-48 h-48 rounded-xl bg-white" />
            ) : (
              <div className="w-48 h-48 rounded-xl flex items-center justify-center"
                style={{ background: C.glass }}>
                <span className="w-5 h-5 border-2 rounded-full animate-spin"
                  style={{ borderColor: `${C.faint}40`, borderTopColor: C.primary }} />
              </div>
            )}
            <div className="absolute -top-1 -right-1"><Sparkle size={12} color={C.glow} delay={0} /></div>
            <div className="absolute -bottom-1 -left-1"><Sparkle size={10} color={C.sakura} delay={0.7} /></div>
          </div>

          <div className="mt-4 text-center">
            <div className="text-[11px] tracking-wide" style={{ color: C.primary }}>
              {statusText[status]}
            </div>
            {detail && (
              <div className="text-[9px] mt-1.5 max-w-[240px] mx-auto" style={{ color: C.faint }}>
                {detail}
              </div>
            )}
            {(status === 'expired' || status === 'error') && (
              <button onClick={startQr}
                className="mt-3 px-4 py-1.5 rounded-full text-[10px] text-white"
                style={{ background: `linear-gradient(135deg, ${C.primary}, ${C.accent})` }}>
                刷新二维码
              </button>
            )}
            <div className="text-[9px] mt-2 italic max-w-[240px] mx-auto" style={{ color: C.faint }}>
              连接会先确认你的 QQ 账号态，再用于 QQ 音乐主页、歌单、最近播放和红心收藏。
            </div>
            {ticket && (
              <div className="text-[8px] mt-2 font-mono opacity-60" style={{ color: C.faint }}>
                ticket {ticket.slice(0, 8)}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default QQMusicLoginPanel;
