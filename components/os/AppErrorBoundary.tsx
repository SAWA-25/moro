import React, { Component, ErrorInfo } from 'react';

const ERROR_COPY_LABEL = '\u590d\u5236\u62a5\u9519\u4fe1\u606f';
const ERROR_COPIED_LABEL = '\u5df2\u590d\u5236';
const ERROR_MANUAL_COPY_LABEL = '\u8bf7\u624b\u52a8\u590d\u5236';
const ERROR_PROMPT_LABEL = '\u8bf7\u624b\u52a8\u590d\u5236\u62a5\u9519\u4fe1\u606f';
const ERROR_TITLE = '\u5e94\u7528\u8fd0\u884c\u9519\u8bef';
const ERROR_RETURN_LABEL = '\u8fd4\u56de\u684c\u9762';
const ERROR_RELOAD_LABEL = '\u5237\u65b0\u91cd\u8bd5';
const CHUNK_ERROR_TITLE = '\u5e94\u7528\u9700\u8981\u5237\u65b0';
const CHUNK_ERROR_HINT = '\u8fd9\u901a\u5e38\u662f\u7f51\u7edc\u77ac\u65ad\u6216\u7f13\u5b58\u91cc\u8fd8\u7559\u7740\u65e7\u7248\u672c\u4ee3\u7801\u3002\u5237\u65b0\u540e\u4f1a\u91cd\u65b0\u62c9\u53d6\u6700\u65b0\u6587\u4ef6\u3002';

type AppErrorBoundaryProps = {
    children: React.ReactNode;
    onCloseApp: () => void;
    resetKey: string;
};

type AppErrorBoundaryState = {
    hasError: boolean;
    error: Error | null;
    copyLabel: string;
};

class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
    private copyLabelTimer: number | null = null;

    constructor(props: AppErrorBoundaryProps) {
        super(props);
        this.state = {
            hasError: false,
            error: null,
            copyLabel: ERROR_COPY_LABEL,
        };
    }

    static getDerivedStateFromError(error: Error): Partial<AppErrorBoundaryState> {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        console.error('App Crash:', error, errorInfo);
    }

    componentDidUpdate(prevProps: AppErrorBoundaryProps) {
        if (prevProps.resetKey !== this.props.resetKey && this.state.hasError) {
            this.setState({
                hasError: false,
                error: null,
                copyLabel: ERROR_COPY_LABEL,
            });
        }
    }

    componentWillUnmount() {
        if (this.copyLabelTimer) {
            window.clearTimeout(this.copyLabelTimer);
        }
    }

    private updateCopyLabel = (label: string) => {
        if (this.copyLabelTimer) {
            window.clearTimeout(this.copyLabelTimer);
        }

        this.setState({ copyLabel: label });
        this.copyLabelTimer = window.setTimeout(() => {
            this.setState({ copyLabel: ERROR_COPY_LABEL });
            this.copyLabelTimer = null;
        }, 1800);
    };

    private handleCopy = async () => {
        const errText = this.state.error?.stack || this.state.error?.message || 'Unknown Error';

        try {
            if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(errText);
                this.updateCopyLabel(ERROR_COPIED_LABEL);
                return;
            }
        } catch {
            // Fall back to the hidden textarea path below.
        }

        try {
            const textarea = document.createElement('textarea');
            textarea.value = errText;
            textarea.setAttribute('readonly', 'true');
            textarea.style.position = 'fixed';
            textarea.style.opacity = '0';
            textarea.style.pointerEvents = 'none';
            document.body.appendChild(textarea);
            textarea.focus();
            textarea.select();
            const copied = document.execCommand('copy');
            document.body.removeChild(textarea);

            if (copied) {
                this.updateCopyLabel(ERROR_COPIED_LABEL);
                return;
            }
        } catch {
            // Fall back to manual copy prompt.
        }

        window.prompt(ERROR_PROMPT_LABEL, errText);
        this.updateCopyLabel(ERROR_MANUAL_COPY_LABEL);
    };

    private handleClose = () => {
        this.setState({
            hasError: false,
            error: null,
            copyLabel: ERROR_COPY_LABEL,
        });
        this.props.onCloseApp();
    };

    private handleReload = () => {
        window.location.reload();
    };

    private isChunkLoadError = () => {
        const text = `${this.state.error?.message || ''}\n${this.state.error?.stack || ''}`;
        return /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|ChunkLoadError/i.test(text);
    };

    render() {
        if (!this.state.hasError) {
            return this.props.children;
        }
        const isChunkLoadError = this.isChunkLoadError();

        return (
            <div className="relative isolate z-[120] w-full h-full flex flex-col items-center justify-center bg-slate-900/95 text-white p-6 text-center space-y-4 pointer-events-auto">
                <img
                    src="https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f635.png"
                    alt="error"
                    className="w-10 h-10"
                />
                <h2 className="text-lg font-bold">{isChunkLoadError ? CHUNK_ERROR_TITLE : ERROR_TITLE}</h2>
                {isChunkLoadError && (
                    <p className="max-w-xs text-xs leading-relaxed text-slate-300">
                        {CHUNK_ERROR_HINT}
                    </p>
                )}
                <p className="text-xs text-slate-300 font-mono bg-black/30 p-3 rounded-2xl max-w-full overflow-auto max-h-40 select-text break-all whitespace-pre-wrap">
                    {this.state.error?.message || 'Unknown Error'}
                </p>
                <div className="flex flex-col gap-3 w-full max-w-xs">
                    {isChunkLoadError && (
                        <button
                            type="button"
                            onClick={this.handleReload}
                            className="w-full px-6 py-3 bg-blue-600 rounded-full font-bold text-sm shadow-lg active:scale-95 transition-transform"
                        >
                            {ERROR_RELOAD_LABEL}
                        </button>
                    )}
                    <button
                        type="button"
                        onClick={this.handleCopy}
                        className="w-full px-4 py-2 bg-slate-700 rounded-full text-xs font-bold active:scale-95 transition-transform"
                    >
                        {this.state.copyLabel}
                    </button>
                    <button
                        type="button"
                        onClick={this.handleClose}
                        className="w-full px-6 py-3 bg-red-600 rounded-full font-bold text-sm shadow-lg active:scale-95 transition-transform"
                    >
                        {ERROR_RETURN_LABEL}
                    </button>
                </div>
            </div>
        );
    }
}

export default AppErrorBoundary;
