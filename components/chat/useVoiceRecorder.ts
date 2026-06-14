import { useEffect, useRef, useState } from 'react';

/**
 * 语音录制（MediaRecorder + Web Speech API 实时转写）。
 * 从 ChatInputArea 的自包含录音逻辑抽出，供单聊 / 群聊复用：完成时回调 data URI + 时长 + 转写。
 */
export interface VoiceRecorderApi {
    isRecording: boolean;
    recordSecs: number;
    liveTranscript: string;
    startRecording: () => Promise<void>;
    stopRecording: (send: boolean) => void;
}

export function useVoiceRecorder(opts: {
    onComplete: (audio: string, durationSec: number, transcript: string) => void;
    onDenied?: () => void;
    maxSecs?: number;
}): VoiceRecorderApi {
    const { onDenied, maxSecs = 60 } = opts;
    const [isRecording, setIsRecording] = useState(false);
    const [recordSecs, setRecordSecs] = useState(0);
    const [liveTranscript, setLiveTranscript] = useState('');
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const recordChunksRef = useRef<Blob[]>([]);
    const recordTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const recognitionRef = useRef<any>(null);
    const transcriptRef = useRef('');
    const recordCancelledRef = useRef(false);
    const recordSecsRef = useRef(0);
    const onCompleteRef = useRef(opts.onComplete);
    onCompleteRef.current = opts.onComplete;

    const cleanup = () => {
        if (recordTimerRef.current) { clearInterval(recordTimerRef.current); recordTimerRef.current = null; }
        try { recognitionRef.current?.stop(); } catch { /* ignore */ }
        recognitionRef.current = null;
        const rec = mediaRecorderRef.current;
        if (rec) { try { rec.stream.getTracks().forEach(t => t.stop()); } catch { /* ignore */ } }
        mediaRecorderRef.current = null;
        setIsRecording(false);
        setRecordSecs(0);
        setLiveTranscript('');
    };

    // 组件卸载时确保麦克风被释放
    useEffect(() => () => cleanup(), []);

    const stopRecording = (send: boolean) => {
        const rec = mediaRecorderRef.current;
        if (!rec) { cleanup(); return; }
        recordCancelledRef.current = !send;
        if (recordTimerRef.current) { clearInterval(recordTimerRef.current); recordTimerRef.current = null; }
        try { recognitionRef.current?.stop(); } catch { /* ignore */ }
        if (rec.state !== 'inactive') {
            try { rec.stop(); return; } catch { /* fallthrough */ }
        }
        cleanup();
    };

    const startRecording = async () => {
        if (isRecording) return;
        let stream: MediaStream;
        try {
            stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        } catch {
            onDenied?.();
            return;
        }
        recordChunksRef.current = [];
        transcriptRef.current = '';
        recordCancelledRef.current = false;
        const recorder = new MediaRecorder(stream);
        mediaRecorderRef.current = recorder;
        recorder.ondataavailable = (e) => { if (e.data.size > 0) recordChunksRef.current.push(e.data); };
        recorder.onstop = () => {
            const durationSec = Math.max(1, recordSecsRef.current);
            const cancelled = recordCancelledRef.current;
            const blob = new Blob(recordChunksRef.current, { type: recorder.mimeType || 'audio/webm' });
            stream.getTracks().forEach(t => t.stop());
            if (!cancelled && blob.size > 0) {
                const reader = new FileReader();
                reader.onloadend = () => {
                    if (typeof reader.result === 'string') {
                        onCompleteRef.current(reader.result, durationSec, transcriptRef.current.trim());
                    }
                };
                reader.readAsDataURL(blob);
            }
            cleanup();
        };

        // 实时转写：浏览器支持 SpeechRecognition 时同步识别，识别文字随消息一起发给 AI。
        const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
        if (SR) {
            try {
                const recognition = new SR();
                recognition.lang = 'zh-CN';
                recognition.continuous = true;
                recognition.interimResults = true;
                recognition.onresult = (event: any) => {
                    let finalText = '';
                    let interim = '';
                    for (let i = 0; i < event.results.length; i++) {
                        const r = event.results[i];
                        if (r.isFinal) finalText += r[0].transcript;
                        else interim += r[0].transcript;
                    }
                    transcriptRef.current = finalText + interim;
                    setLiveTranscript(transcriptRef.current);
                };
                recognition.onerror = () => { /* 转写失败不影响录音 */ };
                recognition.start();
                recognitionRef.current = recognition;
            } catch { /* ignore */ }
        }

        recorder.start();
        setIsRecording(true);
        setRecordSecs(0);
        recordSecsRef.current = 0;
        recordTimerRef.current = setInterval(() => {
            recordSecsRef.current += 1;
            setRecordSecs(recordSecsRef.current);
            if (recordSecsRef.current >= maxSecs) stopRecording(true);
        }, 1000);
    };

    return { isRecording, recordSecs, liveTranscript, startRecording, stopRecording };
}
