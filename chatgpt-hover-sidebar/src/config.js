// 脚本常量：可调参数、DOM 选择器与按钮标签匹配规则。

export const CONFIG = Object.freeze({
    edgeWidth: 60,
    openDelay: 100,
    closeDelay: 250,
    sidebarPadding: 0,
    animationDelay: 650,
    minimumWidth: 768,
    nativeNavigationSelector: '', // DOM 更新后可填入已确认的原生导航选择器。
    requestTimeout: 15000,
    maxHistoryPages: 200,
    jumpTimeout: 45000,
    jumpTopInset: 72,
    jumpMaxStep: 16,
    jumpPollDelay: 320,
    jumpMutationDelay: 80,
    jumpSettleDelay: 160,
    jumpStableDuration: 400,
    jumpBoundaryDelay: 900,
    jumpEmptyWindowDelay: 900,
    startupStableDelay: 1000,
    historyRefreshInterval: 60000,
    retryBaseDelay: 30000,
    retryMaxDelay: 300000,
    refreshDebounce: 180,
    refreshPollInterval: 1200,
    nativeNavigationGrace: 2000,
    navigationCloseDelay: 160,
});

export const PREFIX = 'cghs-navigation';
export const MARKER_ID = `${PREFIX}-marker`;
export const DIAGNOSTICS_ID = `${PREFIX}-diagnostics`;

export const SIDEBARS = '#stage-slideover-sidebar, #stage-sidebar, #sidebar, '
    + '[data-testid="sidebar"], nav[aria-label="Chat history"], '
    + 'nav[aria-label="聊天历史记录"], nav[aria-label="聊天记录"]';

export const LABELS = {
    open: /(?:open|expand|show)\s+(?:the\s+)?sidebar|(?:打开|展开|显示|開啟|展開|顯示).*(?:侧栏|侧边栏|边栏|側欄|側邊欄)/i,
    close: /(?:close|collapse|hide)\s+(?:the\s+)?sidebar|(?:关闭|收起|折叠|隐藏|關閉|收合|隱藏).*(?:侧栏|侧边栏|边栏|側欄|側邊欄)/i,
};
