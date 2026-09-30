// 全局运行状态与用户保存的导航模式。

function readMode() {
    const value = typeof GM_getValue === 'function' ? GM_getValue('navigationMode', 'auto') : 'auto';
    return ['auto', 'always', 'off'].includes(value) ? value : 'auto';
}

export const state = {
    startup: true, owned: false, pending: null, cooldown: 0,
    openTimer: null, closeTimer: null, refreshTimer: null,
    pointer: null, host: null, root: null, entries: [], signature: '',
    mode: readMode(), nativeSeenAt: 0, activeFrame: 0,
    conversation: null, jump: null, notice: '',
    closedSince: null,
    scriptClick: false, requestContext: null,
    fetch: null, captureInstalled: false,
    capturedResponses: 0, captureSummary: '尚未观察到当前会话响应',
    navigationCloseTimer: null, navigationExpanded: false, navigationHovered: false,
    lastJump: null, pointerFrame: 0,
};

export function isCurrentConversation(context) {
    return state.conversation === context && location.pathname === context.key;
}
