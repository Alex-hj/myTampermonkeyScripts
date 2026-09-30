// 刷新调度：合并高频 DOM 变化，统一延迟到一次刷新里处理。
import { CONFIG } from './config.js';
import { state } from './state.js';

// 由入口注册实际的刷新动作和变化监听；调度器不依赖任何业务模块，避免循环引用。
let refreshAction = () => {};
let mutationListener = () => {};

export function configureScheduler({ onRefresh, onMutations }) {
    refreshAction = onRefresh;
    mutationListener = onMutations;
}

export function queueRefresh(records) {
    if (!document?.body) return;
    if (records && records.every(record => record.target === state.host)) return;
    mutationListener(records);
    if (!state.refreshTimer) state.refreshTimer = setTimeout(() => refreshAction(), CONFIG.refreshDebounce);
}
