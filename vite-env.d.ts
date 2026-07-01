/// <reference types="vite/client" />

declare const __BUILD_BRANCH__: string;
declare const __BUILD_COMMIT__: string;
declare const __BUILD_BADGE_VISIBLE__: boolean;

interface ImportMetaEnv {
    readonly VITE_MORO_UPDATE_MANIFEST_URL?: string;
    readonly VITE_MORO_RELEASE_OWNER?: string;
    readonly VITE_MORO_RELEASE_REPO?: string;
    readonly VITE_MORO_RELEASE_API_URL?: string;
    readonly VITE_MORO_GITHUB_PROXY_URL?: string;
    readonly VITE_MORO_APPFLOW_ENABLED?: string;
    readonly VITE_MORO_APPFLOW_APP_ID?: string;
    readonly VITE_MORO_APPFLOW_CHANNEL?: string;
    readonly VITE_MORO_APPFLOW_AUTO_UPDATE_METHOD?: string;
    readonly VITE_MORO_APPFLOW_MAX_VERSIONS?: string;
}

// 运行时通过浏览器原生 ESM（esm.sh CDN）按 URL 直接动态加载的模块。
// TS 无法解析 URL 形式的 import specifier，这里声明类型让类型检查通过。
declare module 'https://esm.sh/html2canvas@1.4.1' {
    const html2canvas: (element: HTMLElement, options?: any) => Promise<HTMLCanvasElement>;
    export default html2canvas;
}

declare module 'katex' {
    export function renderToString(latex: string, options?: any): string;
}
