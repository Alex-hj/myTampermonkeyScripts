// 接收页面自身请求得到的完整/分页索引，取代主动读取。
import { CONFIG } from './config.js';
import { queueRefresh } from './scheduler.js';
import { indexMessages, pageCursor } from './history-api.js';

// 页面已提供的索引优先于正在进行的主动读取：中止旧请求并让其结果作废。
function supersedeActiveLoad(context) {
    context.controller?.abort();
    context.nativeRevision++;
}

export function acceptNativeIndex(context, entries, source) {
    supersedeActiveLoad(context);
    context.entries = entries;
    context.status = 'ready';
    context.error = '';
    context.attempts = [];
    context.source = source;
    context.retryAt = Date.now() + CONFIG.historyRefreshInterval;
    queueRefresh();
}

export function acceptNativePage(context, page) {
    const cursor = pageCursor(page);
    if (!page.messages.every(message => message && typeof message.id === 'string' && message.id)) {
        throw new Error('消息缺少 ID');
    }
    if (!cursor) {
        acceptNativeIndex(context, indexMessages(page.messages), '页面完整分页响应');
        return;
    }
    supersedeActiveLoad(context);
    context.nativePage = page;
    context.preferPagination = true;
    if (!context.entries.length) context.entries = indexMessages(page.messages);
    context.status = 'partial';
    context.error = '已读取页面消息，等待补齐更早历史';
    context.source = '页面分页响应（尚未完整）';
    context.retryAt = 0;
    queueRefresh();
}
