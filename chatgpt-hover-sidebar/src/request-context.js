// 历史请求所需的设备、工作区等请求头。
import { state } from './state.js';
import { conversationId } from './conversation.js';
import { queueRefresh } from './scheduler.js';

export function deviceCookie() {
    const value = document.cookie.split(';').map(part => part.trim()).find(part => part.startsWith('oai-did='));
    try { return value ? decodeURIComponent(value.slice(8)) : ''; }
    catch { return ''; }
}

export function historyHeaders(context, token) {
    const headers = { Accept: 'application/json' };
    if (!token) return headers;
    headers.Authorization = `Bearer ${token}`;
    const captured = state.requestContext;
    if (captured?.id === context.id) Object.assign(headers, captured.headers);
    const device = deviceCookie();
    if (!headers['oai-device-id'] && device) headers['oai-device-id'] = device;
    return headers;
}

export function captureRequestHeaders(id, input, options) {
    if (id !== conversationId()) return;
    const source = new Headers(options?.headers || input?.headers || {});
    const headers = {};
    for (const name of ['chatgpt-account-id', 'oai-device-id']) {
        const value = source.get(name);
        if (value) headers[name] = value;
    }
    const previous = state.requestContext;
    if (previous?.id === id) Object.assign(headers, { ...previous.headers, ...headers });
    const changed = JSON.stringify(previous) !== JSON.stringify({ id, headers });
    state.requestContext = { id, headers };
    const context = state.conversation;
    if (changed && Object.keys(headers).length && context?.id === id && context.status === 'partial') {
        context.retryAt = 0;
        queueRefresh();
    }
}
