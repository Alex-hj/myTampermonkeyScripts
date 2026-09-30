// 主动读取历史索引，并处理会话切换、失败退避。
import { CONFIG } from './config.js';
import { isCurrentConversation, state } from './state.js';
import { syncConversation } from './conversation.js';
import { queueRefresh } from './scheduler.js';
import { fetchHistory } from './history-api.js';

// 会话已切换，或页面自带的索引已在读取期间取代了本次结果。
function loadSuperseded(context, revision) {
    return !isCurrentConversation(context) || revision !== context.nativeRevision;
}

async function loadHistory(context) {
    context.status = 'loading';
    context.controller = new AbortController();
    const revision = context.nativeRevision;
    try {
        const entries = await fetchHistory(context);
        if (loadSuperseded(context, revision)) return;
        context.entries = entries;
        context.source = '主动读取';
        context.status = 'ready';
        context.error = '';
        context.failures = 0;
        context.retryAt = Date.now() + CONFIG.historyRefreshInterval;
    } catch (error) {
        if (loadSuperseded(context, revision)) return;
        context.status = 'partial';
        const reason = error.name === 'AbortError' ? '请求超时' : error.message;
        context.error = `${context.phase || '历史索引'}：${reason}`;
        context.failures++;
        context.retryAt = Date.now()
            + Math.min(CONFIG.retryMaxDelay, CONFIG.retryBaseDelay * 2 ** (context.failures - 1));
    } finally {
        if (isCurrentConversation(context)) queueRefresh();
    }
}

export function maintainHistory() {
    syncConversation();
    const context = state.conversation;
    if (state.mode === 'off' || !context.id || context.status === 'loading') return;
    if (Date.now() >= context.retryAt) void loadHistory(context);
}
