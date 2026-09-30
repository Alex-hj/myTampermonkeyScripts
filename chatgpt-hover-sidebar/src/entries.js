// 页面已挂载问题与完整历史索引的合并。
import { state } from './state.js';
import { normalizeText } from './utils.js';

// 用户消息：当前页面以 data-chatgpt-search-unit-key 的 ":user" 后缀标记消息块，
// 旧页面使用 data-message-author-role。
const USER_MESSAGES = 'main [data-message-author-role="user"], [data-chatgpt-search-unit-key$=":user"]';

export function rawMessages() {
    return [...document.querySelectorAll(USER_MESSAGES)];
}

// 当前页面把消息 ID 放在 data-chatgpt-search-message-ids 中，多个 ID 以空白分隔。
function searchMessageIds(node) {
    return (node.getAttribute('data-chatgpt-search-message-ids') || '').split(/\s+/).filter(Boolean);
}

function messageFingerprint(node) {
    const id = node.getAttribute('data-message-id') || searchMessageIds(node)[0] || '';
    return `${id}:${node.textContent}`;
}

function loadedEntries() {
    const context = state.conversation;
    const nodes = rawMessages();
    const observed = new Map(nodes.map(node => [node, messageFingerprint(node)]));
    if (context) context.observed = observed;
    return nodes.filter(node => context?.stale.get(node) !== observed.get(node)).map(element => {
        const target = messageTarget(element);
        const text = normalizeText(element.innerText || element.textContent);
        const ids = messageIds(element, target);
        return { id: ids[0] || '', ids, target, text: text || '图片 / 附件消息' };
    });
}

function messageTarget(element) {
    const turn = element.closest('[data-testid^="conversation-turn-"], [data-turn-id-container], '
        + '[data-content-search-turn-key]');
    if (turn) return turn;
    const article = element.closest('article');
    return article?.querySelectorAll('[data-message-author-role="user"]').length === 1 ? article : element;
}

function messageIds(element, target) {
    const nodes = [element, element.closest('[data-message-id]'),
        ...element.querySelectorAll('[data-message-id]'), target];
    const ids = nodes.filter(Boolean).map(node => node.getAttribute('data-message-id')).filter(Boolean);
    for (const node of [element, target]) {
        for (const name of ['data-turn-id', 'data-turn-id-container']) {
            const value = node.getAttribute(name);
            if (value) ids.push(value);
        }
    }
    ids.push(...searchMessageIds(element));
    return [...new Set(ids)];
}

export function collectEntries() {
    const loaded = loadedEntries();
    const context = state.conversation;
    if (!context?.entries.length) return loaded;
    const byId = new Map();
    loaded.forEach(entry => entry.ids.forEach(id => byId.set(id, entry)));
    const matched = new Set();
    const counts = new Map();
    const byText = new Map();
    context.entries.forEach(entry => counts.set(entry.text, (counts.get(entry.text) || 0) + 1));
    loaded.filter(entry => !entry.id).forEach(entry => {
        if (!byText.has(entry.text)) byText.set(entry.text, entry);
        else byText.set(entry.text, null);
    });
    const entries = context.entries.map(entry => {
        let match = byId.get(entry.id);
        // 缺少 ID 时只允许唯一全文匹配，避免重复提问跳到错误位置。
        if (!match && counts.get(entry.text) === 1) match = byText.get(entry.text);
        if (match) matched.add(match);
        return { ...entry, target: match?.target || null };
    });
    const known = new Set(entries.map(entry => entry.id));
    const extra = loaded.filter(entry => entry.id && !known.has(entry.id) && !matched.has(entry));
    const signature = extra.map(entry => entry.id).join(',');
    if (signature && signature !== context.unknown && context.status !== 'loading') {
        context.unknown = signature;
        context.retryAt = Math.min(context.retryAt, Date.now() + 2000);
    }
    // 新问题可立即显示；随后重新拉取当前分支以处理编辑和重新生成。
    return entries.concat(extra);
}
