// 观察页面对当前会话的 fetch 请求。
import { state } from './state.js';
import { conversationId, syncConversation } from './conversation.js';
import { captureRequestHeaders } from './request-context.js';
import { activeBranch, indexMessages } from './history-api.js';
import { acceptNativeIndex, acceptNativePage } from './native-index.js';

function requestConversation(url) {
    try {
        const parsed = new URL(url, location.origin);
        if (parsed.origin !== location.origin) return '';
        return parsed.pathname.match(/^\/backend-api\/conversations?\/([a-zA-Z0-9-]+)(?:\/messages)?$/)?.[1] || '';
    } catch { return ''; }
}

async function captureConversationResponse(id, response, requestUrl) {
    if (id !== conversationId()) return;
    state.capturedResponses++;
    state.captureSummary = `HTTP ${response.status || (response.ok ? 200 : '未知')}`;
    if (!response.ok) return;
    try {
        const data = await response.clone().json();
        if (id !== conversationId()) return;
        syncConversation();
        const context = state.conversation;
        const page = data.conversation || data;
        if (Array.isArray(page.messages)) {
            state.captureSummary = `HTTP 200，分页消息 ${page.messages.length} 条`;
            // 只有当前会话第一页才能作为完整分页链的起点，不能把中间页当成全部。
            if (!new URL(requestUrl, location.origin).pathname.endsWith('/messages')) acceptNativePage(context, page);
        } else {
            state.captureSummary = 'HTTP 200，消息树';
            acceptNativeIndex(context, indexMessages(activeBranch(data)), '页面成功响应');
        }
    } catch { state.captureSummary += '（未通过完整性/格式检查）'; }
}

export function observePageRequests() {
    const page = typeof unsafeWindow === 'undefined' ? window : unsafeWindow;
    state.fetch = typeof fetch === 'function' ? fetch.bind(window) : null;
    if (typeof page.fetch !== 'function') return;
    const original = page.fetch;
    try {
        page.fetch = function (input, options) {
            const result = Reflect.apply(original, this, arguments);
            try {
                const url = typeof input === 'string' ? input : input?.url || String(input);
                const id = requestConversation(url);
                const method = options?.method || input?.method || 'GET';
                if (id && method.toUpperCase() === 'GET') {
                    captureRequestHeaders(id, input, options);
                    Promise.resolve(result).then(response => captureConversationResponse(id, response, url)).catch(() => {});
                }
            } catch { /* 观察失败不改变页面 fetch 的返回值和异常行为。 */ }
            return result;
        };
        state.captureInstalled = page.fetch !== original;
    } catch { state.captureInstalled = false; }
}
