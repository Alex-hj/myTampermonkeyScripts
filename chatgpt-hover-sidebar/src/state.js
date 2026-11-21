// 全局运行状态与用户保存的导航模式、左侧栏自动开关。
import { readSetting } from './storage.js';

function readMode() {
    const value = readSetting('navigationMode', 'auto');
    return ['auto', 'always', 'off'].includes(value) ? value : 'auto';
}

// 默认开启，只有明确保存为 false 才关闭。
const sidebarAuto = readSetting('sidebarAuto', true) !== false;

export const state = {
    // 关闭左侧栏自动功能时没有「启动收起」阶段，所以初值跟随开关。
    startup: sidebarAuto, sidebarAuto, owned: false, pending: null, cooldown: 0,
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
