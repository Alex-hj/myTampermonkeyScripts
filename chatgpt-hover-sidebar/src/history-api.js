// 读取会话历史：消息树、分页接口与问题索引。
import { CONFIG } from './config.js';
import { state } from './state.js';
import { normalizeText } from './utils.js';
import { historyHeaders } from './request-context.js';

async function readJson(path, context, token = '') {
    const controller = new AbortController();
    const abort = () => controller.abort();
    const signal = context.controller.signal;
    signal.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, CONFIG.requestTimeout);
    try {
        if (signal.aborted) throw new Error('请求已取消');
        const headers = historyHeaders(context, token);
        const response = await state.fetch(new URL(path, location.origin).href, {
            credentials: 'include', cache: 'no-store', headers, signal: controller.signal,
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        try { return await response.json(); }
        catch { throw new Error('响应不是 JSON（可能是登录或验证页面）'); }
    } finally {
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
    }
}

export function activeBranch(data) {
    data = data.conversation || data;
    const mapping = data.mapping;
    let id = data.current_node || data.current_node_id;
    if (!mapping || !id) throw new Error('缺少完整消息树');
    const visited = new Set();
    const messages = [];
    while (id) {
        if (visited.has(id) || !Object.hasOwn(mapping, id)) throw new Error('消息树不完整');
        visited.add(id);
        const node = mapping[id];
        if (!Object.hasOwn(node, 'parent')) throw new Error('消息树缺少父节点信息');
        if (node.message) messages.push(node.message);
        id = node.parent;
    }
    return messages.reverse();
}

export function pageCursor(page) {
    const info = page.page_info || page.pageInfo;
    if (!info) throw new Error('缺少分页完整性信息');
    const previous = info.has_previous_page ?? info.hasPreviousPage;
    if (previous === false) return '';
    const cursor = info.start_cursor || info.startCursor;
    if (previous !== true || !cursor || typeof cursor !== 'string') throw new Error('分页游标无效');
    return cursor;
}

async function paginatedMessages(context, token) {
    const base = `/backend-api/conversations/${encodeURIComponent(context.id)}`;
    let cursor = '';
    let messages = [];
    const seen = new Set();
    const firstPage = context.nativePage;
    context.nativePage = null;
    for (let count = 0; count < CONFIG.maxHistoryPages; count++) {
        const path = cursor ? `${base}/messages?before=${encodeURIComponent(cursor)}&` : `${base}?`;
        const page = count === 0 && firstPage ? firstPage
            : await readJson(`${path}include_has_versions=true&num_turns=100`, context, token);
        if (!Array.isArray(page.messages)) throw new Error('历史消息格式变化');
        messages = [...page.messages, ...messages];
        cursor = pageCursor(page);
        if (!cursor) {
            const unique = new Map();
            messages.forEach(message => { if (message.id) unique.set(message.id, message); });
            if (messages.some(message => !message.id)) throw new Error('消息缺少 ID');
            return [...unique.values()];
        }
        if (seen.has(cursor)) throw new Error('历史分页没有前进');
        seen.add(cursor);
    }
    throw new Error('历史页数超过上限，索引未完成');
}

export function indexMessages(messages) {
    return messages.filter(message => message.author?.role === 'user'
        && !message.metadata?.is_visually_hidden_from_conversation
        && ['text', 'multimodal_text'].includes(message.content?.content_type)).map(message => {
        if (!message.id) throw new Error('消息缺少 ID');
        const parts = message.content.parts || [];
        const text = normalizeText(parts.filter(part => typeof part === 'string').join('\n'));
        return { id: message.id, text: text || '图片 / 附件消息', target: null };
    });
}

export async function fetchHistory(context) {
    // 登录令牌仅在这次同源请求链中使用，不持久化、不记录到日志。
    context.phase = '登录会话';
    const session = await readJson('/api/auth/session', context);
    if (!session.accessToken) throw new Error('未获得登录会话');
    const messages = await readHistoryFormats(context, session.accessToken);
    return indexMessages(messages);
}

async function readHistoryFormats(context, token) {
    if (context.preferPagination) {
        context.phase = '历史分页';
        return paginatedMessages(context, token);
    }
    const base = `/backend-api/conversation/${encodeURIComponent(context.id)}`;
    const candidates = [
        ['完整消息树', `${base}?include_full_conversation=true`],
        ['兼容消息树', base],
    ];
    context.attempts = [];
    for (const [phase, path] of candidates) {
        context.phase = phase;
        try { return activeBranch(await readJson(path, context, token)); }
        catch (error) {
            context.attempts.push(`${phase}：${error.message}`);
            if (context.controller.signal.aborted || /HTTP (401|429)/.test(error.message)) throw error;
            // 旧接口被拒绝不代表新版分页接口不可用；只尝试一次分页入口。
            if (/HTTP 403/.test(error.message)) break;
        }
    }
    context.phase = '历史分页';
    return paginatedMessages(context, token);
}
