// 当前会话的识别与切换。
import { state } from './state.js';
import { cancelJump } from './jump.js';

export function conversationId() {
    return location.pathname.match(/\/c\/([a-zA-Z0-9-]+)(?:\/|$)/)?.[1] || '';
}

export function syncConversation() {
    const key = location.pathname;
    if (state.conversation?.key === key) return;
    const previous = state.conversation;
    previous?.controller?.abort();
    cancelJump();
    const stale = previous?.observed || new Map();
    state.conversation = { key, id: conversationId(), entries: [], status: 'idle',
        controller: null, retryAt: 0, stale, observed: new Map(), error: '', failures: 0, unknown: '',
        nativeRevision: 0, nativePage: null, preferPagination: false, source: '', attempts: [], phase: '' };
    state.entries = [];
    state.signature = '';
    state.notice = '';
}
