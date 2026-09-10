// ==UserScript==
// @name         ChatGPT 左侧悬停展开 + 原生导航保护
// @namespace    local.chatgpt-hover-sidebar
// @version      1.2.5
// @homepageURL  https://github.com/Alex-hj/myTampermonkeyScripts
// @updateURL    https://raw.githubusercontent.com/Alex-hj/myTampermonkeyScripts/main/chatgpt-hover-sidebar/chatgpt-hover-sidebar.user.js
// @downloadURL  https://raw.githubusercontent.com/Alex-hj/myTampermonkeyScripts/main/chatgpt-hover-sidebar/chatgpt-hover-sidebar.user.js
// @description  启动收起左侧栏，靠左悬停展开；保留原生导航，提供仿原生备用对话导航。
// @match        https://chatgpt.com/*
// @match        https://www.chatgpt.com/*
// @match        https://chat.openai.com/*
// @run-at       document-start
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_setClipboard
// @grant        unsafeWindow
// @noframes
// ==/UserScript==

'use strict';

// 块级作用域隔离脚本；安装时不需要构建，也不依赖外部资源。
{
    const CONFIG = Object.freeze({
        edgeWidth: 60,
        openDelay: 100,
        closeDelay: 250,
        sidebarPadding: 0,
        animationDelay: 650,
        minimumWidth: 768,
        nativeNavigationSelector: '', // DOM 更新后可填入已确认的原生导航选择器。
        requestTimeout: 15000,
        maxHistoryPages: 200,
        jumpTimeout: 45000,
        jumpTopInset: 72,
        jumpMaxStep: 16,
        jumpPollDelay: 320,
        jumpMutationDelay: 80,
        jumpSettleDelay: 160,
        jumpStableDuration: 400,
        startupStableDelay: 1000,
    });
    const PREFIX = 'cghs-navigation';
    const SIDEBARS = '#stage-slideover-sidebar, #stage-sidebar, #sidebar, '
        + '[data-testid="sidebar"], nav[aria-label="Chat history"], '
        + 'nav[aria-label="聊天历史记录"], nav[aria-label="聊天记录"]';
    const LABELS = {
        open: /(?:open|expand)\s+(?:the\s+)?sidebar|(?:打开|展开|開啟|展開).*(?:侧栏|侧边栏|边栏|側欄|側邊欄)/i,
        close: /(?:close|collapse)\s+(?:the\s+)?sidebar|(?:关闭|收起|折叠|關閉|收合).*(?:侧栏|侧边栏|边栏|側欄|側邊欄)/i,
    };
    const state = {
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
        lastJump: null,
    };

    function requestConversation(url) {
        try {
            const parsed = new URL(url, location.origin);
            if (parsed.origin !== location.origin) return '';
            return parsed.pathname.match(/^\/backend-api\/conversations?\/([a-zA-Z0-9-]+)(?:\/messages)?$/)?.[1] || '';
        } catch { return ''; }
    }

    function deviceCookie() {
        const value = document.cookie.split(';').map(part => part.trim()).find(part => part.startsWith('oai-did='));
        try { return value ? decodeURIComponent(value.slice(8)) : ''; }
        catch { return ''; }
    }

    function historyHeaders(context, token) {
        const headers = { Accept: 'application/json' };
        if (!token) return headers;
        headers.Authorization = `Bearer ${token}`;
        const captured = state.requestContext;
        if (captured?.id === context.id) Object.assign(headers, captured.headers);
        const device = deviceCookie();
        if (!headers['oai-device-id'] && device) headers['oai-device-id'] = device;
        return headers;
    }

    function captureRequestHeaders(id, input, options) {
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

    function acceptNativeIndex(context, entries, source) {
        context.controller?.abort();
        context.nativeRevision = (context.nativeRevision || 0) + 1;
        context.entries = entries;
        context.status = 'ready';
        context.error = '';
        context.attempts = [];
        context.source = source;
        context.retryAt = Date.now() + 60000;
        queueRefresh();
    }

    function acceptNativePage(context, page) {
        const cursor = pageCursor(page);
        if (!page.messages.every(message => message && typeof message.id === 'string' && message.id)) {
            throw new Error('消息缺少 ID');
        }
        if (!cursor) {
            acceptNativeIndex(context, indexMessages(page.messages), '页面完整分页响应');
            return;
        }
        context.controller?.abort();
        context.nativeRevision = (context.nativeRevision || 0) + 1;
        context.nativePage = page;
        context.preferPagination = true;
        if (!context.entries.length) context.entries = indexMessages(page.messages);
        context.status = 'partial';
        context.error = '已读取页面消息，等待补齐更早历史';
        context.source = '页面分页响应（尚未完整）';
        context.retryAt = 0;
        queueRefresh();
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

    function observePageRequests() {
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

    function conversationId() {
        return location.pathname.match(/\/c\/([a-zA-Z0-9-]+)(?:\/|$)/)?.[1] || '';
    }

    function syncConversation() {
        const key = location.pathname;
        if (state.conversation?.key === key) return;
        const previous = state.conversation;
        previous?.controller?.abort();
        cancelJump();
        const stale = previous?.observed || new Map();
        state.conversation = { key, id: conversationId(), entries: [], status: 'idle',
            controller: null, retryAt: 0, stale, observed: new Map(), error: '', failures: 0, unknown: '' };
        state.entries = [];
        state.signature = '';
        state.notice = '';
    }

    function rawMessages() {
        return [...document.querySelectorAll('main [data-message-author-role="user"]')];
    }

    function normalizeText(text) {
        return String(text || '').replace(/\s+/g, ' ').trim();
    }

    function messageFingerprint(node) {
        return `${node.getAttribute('data-message-id') || ''}:${node.textContent}`;
    }

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

    function activeBranch(data) {
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

    function pageCursor(page) {
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

    function indexMessages(messages) {
        return messages.filter(message => message.author?.role === 'user'
            && !message.metadata?.is_visually_hidden_from_conversation
            && ['text', 'multimodal_text'].includes(message.content?.content_type)).map(message => {
            if (!message.id) throw new Error('消息缺少 ID');
            const parts = message.content.parts || [];
            const text = normalizeText(parts.filter(part => typeof part === 'string').join('\n'));
            return { id: message.id, text: text || '图片 / 附件消息', target: null };
        });
    }

    async function fetchHistory(context) {
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

    async function loadHistory(context) {
        context.status = 'loading';
        context.controller = new AbortController();
        const revision = context.nativeRevision || 0;
        try {
            const entries = await fetchHistory(context);
            if (state.conversation !== context || location.pathname !== context.key) return;
            if (revision !== (context.nativeRevision || 0)) return;
            context.entries = entries;
            context.source = '主动读取';
            context.status = 'ready';
            context.error = '';
            context.failures = 0;
            context.retryAt = Date.now() + 60000;
        } catch (error) {
            if (state.conversation !== context || location.pathname !== context.key) return;
            if (revision !== (context.nativeRevision || 0)) return;
            context.status = 'partial';
            const reason = error.name === 'AbortError' ? '请求超时' : error.message;
            context.error = `${context.phase || '历史索引'}：${reason}`;
            context.failures++;
            context.retryAt = Date.now() + Math.min(300000, 30000 * 2 ** (context.failures - 1));
        } finally {
            if (state.conversation === context && location.pathname === context.key) queueRefresh();
        }
    }

    function maintainHistory() {
        syncConversation();
        const context = state.conversation;
        if (state.mode === 'off' || !context.id || context.status === 'loading') return;
        if (Date.now() >= context.retryAt) void loadHistory(context);
    }

    function readMode() {
        const value = typeof GM_getValue === 'function' ? GM_getValue('navigationMode', 'auto') : 'auto';
        return ['auto', 'always', 'off'].includes(value) ? value : 'auto';
    }

    function isVisible(element) {
        if (!element || element.closest('[hidden], [inert], [aria-hidden="true"]')) return false;
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && rect.right > 0 && rect.bottom > 0
            && rect.left < innerWidth && rect.top < innerHeight
            && style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0'
            && !clippedByAncestor(element, rect);
    }

    function clippedByAncestor(element, rect) {
        let parent = element.parentElement;
        while (parent && parent !== document.body && parent !== document.documentElement) {
            const style = getComputedStyle(parent);
            const bounds = parent.getBoundingClientRect();
            if (/hidden|clip|auto|scroll/.test(style.overflowX || style.overflow)) {
                if (bounds.width === 0 || rect.right <= bounds.left || rect.left >= bounds.right) return true;
            }
            if (/hidden|clip|auto|scroll/.test(style.overflowY || style.overflow)) {
                if (bounds.height === 0 || rect.bottom <= bounds.top || rect.top >= bounds.bottom) return true;
            }
            parent = parent.parentElement;
        }
        return false;
    }

    function sidebar() {
        return [...document.querySelectorAll(SIDEBARS)].find(element => {
            const rect = element.getBoundingClientRect();
            return isVisible(element) && rect.left < 80 && rect.width >= 160;
        }) || null;
    }

    function leftButton(element) {
        if (!isVisible(element) || element.disabled) return false;
        if (element.closest('[role="dialog"], [aria-modal="true"]')) return false;
        const rect = element.getBoundingClientRect();
        return rect.left < Math.min(420, innerWidth * 0.45) && rect.top < 180;
    }

    function toggleButton(action) {
        const exact = document.querySelectorAll(`[data-testid="${action}-sidebar-button"]`);
        const match = [...exact].find(leftButton);
        if (match) return match;
        return [...document.querySelectorAll('button, [role="button"]')].find(element => {
            if (!leftButton(element)) return false;
            const label = ['aria-label', 'title', 'data-tooltip-content']
                .map(name => element.getAttribute(name) || '').join(' ');
            if (LABELS[action].test(label)) return true;
            const controls = element.getAttribute('aria-controls');
            const target = controls && document.getElementById(controls);
            return target?.matches(SIDEBARS)
                && element.getAttribute('aria-expanded') === String(action === 'close');
        }) || null;
    }

    function sidebarState() {
        if (sidebar()) return 'open';
        if (toggleButton('close')) return 'open';
        if (toggleButton('open')) return 'closed';
        return 'unknown';
    }

    function desktop() {
        return innerWidth >= CONFIG.minimumWidth && (
            matchMedia('(hover: hover) and (pointer: fine)').matches
            || matchMedia('(any-hover: hover) and (any-pointer: fine)').matches);
    }

    function clickToggle(action) {
        if (state.pending || Date.now() < state.cooldown) return false;
        const button = toggleButton(action);
        if (!button) return false;
        state.pending = { action, deadline: Date.now() + CONFIG.animationDelay };
        state.cooldown = Date.now() + CONFIG.animationDelay;
        state.scriptClick = true;
        try { button.click(); }
        finally { state.scriptClick = false; }
        return true;
    }

    function settleToggle(current) {
        const pending = state.pending;
        if (!pending) return;
        const expected = pending.action === 'open' ? 'open' : 'closed';
        if (current !== expected && Date.now() < pending.deadline) return;
        state.pending = null;
        if (current !== expected) return; // 未成功时保留所有权，下次检查继续尝试。
        if (pending.action === 'close') state.owned = false;
    }

    function maintainSidebar() {
        if (!desktop()) return;
        const current = sidebarState();
        settleToggle(current);
        if (state.startup) {
            if (current === 'closed' && !state.pending) {
                state.closedSince ??= Date.now();
                if (Date.now() - state.closedSince >= CONFIG.startupStableDelay) state.startup = false;
            } else {
                state.closedSince = null;
                if (current === 'open') clickToggle('close');
            }
            return;
        }
        if (state.owned && current === 'closed' && !state.pending) state.owned = false;
        evaluatePointer();
    }

    function handleSidebarClick(event) {
        if (state.scriptClick) return;
        const button = event.target.closest?.('button, [role="button"]');
        if (!button) return;
        if (button === toggleButton('open')) {
            state.owned = false;
            state.startup = false;
        } else if (button === toggleButton('close')) {
            state.owned = false;
        }
    }

    function cancelTimer(name) {
        clearTimeout(state[name]);
        state[name] = null;
    }

    function interactionProtected() {
        if (document.getElementById(`${PREFIX}-diagnostics`)) return true;
        const panel = sidebar();
        if (panel?.contains(document.activeElement) && document.activeElement !== document.body) return true;
        return [...document.querySelectorAll('[role="menu"], [role="dialog"], [aria-modal="true"]')]
            .some(isVisible);
    }

    function openFromEdge() {
        state.openTimer = null;
        if (!desktop() || !state.pointer || state.pointer.x > CONFIG.edgeWidth) return;
        if (state.startup || interactionProtected() || sidebarState() !== 'closed') return;
        if (clickToggle('open')) state.owned = true;
    }

    function closeFromHover() {
        state.closeTimer = null;
        // 所有打开来源统一执行移出收起，焦点和菜单不再阻止关闭。
        if (!desktop() || pointerInside() || sidebarState() !== 'open') return;
        clickToggle('close');
    }

    function pointerInside() {
        if (!state.pointer) return false;
        const panel = sidebar();
        const rect = panel?.getBoundingClientRect()
            || { left: 0, right: 320, top: 0, bottom: innerHeight };
        return state.pointer.x >= rect.left && state.pointer.x <= rect.right + CONFIG.sidebarPadding
            && state.pointer.y >= rect.top && state.pointer.y <= rect.bottom;
    }

    function evaluatePointer() {
        if (!desktop()) return;
        const current = sidebarState();
        const atEdge = state.pointer && state.pointer.x <= CONFIG.edgeWidth;
        if (atEdge && current === 'closed' && !state.startup && !state.openTimer) {
            state.openTimer = setTimeout(openFromEdge, CONFIG.openDelay);
        }
        if (!atEdge) cancelTimer('openTimer');
        if (current !== 'open' || pointerInside()) {
            cancelTimer('closeTimer');
            return;
        }
        if (!state.closeTimer) state.closeTimer = setTimeout(closeFromHover, CONFIG.closeDelay);
    }

    function handlePointer(event) {
        if (event.pointerType && event.pointerType !== 'mouse') return;
        state.pointer = { x: event.clientX, y: event.clientY };
        // 每次移动仅更新坐标；DOM 查询限制为每帧一次。
        if (state.pointerFrame) return;
        state.pointerFrame = requestAnimationFrame(() => {
            state.pointerFrame = 0;
            evaluatePointer();
        });
    }

    function navigationCandidates() {
        const selectors = [
            '[data-testid="conversation-navigation"]', '[data-testid="conversation-turns-navigation"]',
            '[data-testid="conversation-timeline"]', 'nav[aria-label]', '[role="navigation"][aria-label]',
            '[aria-label*="timeline" i]', '[aria-label*="对话导航"]', '[aria-label*="對話導覽"]',
        ];
        if (CONFIG.nativeNavigationSelector) selectors.push(CONFIG.nativeNavigationSelector);
        try { return [...document.querySelectorAll(selectors.join(','))]; }
        catch { return []; }
    }

    function nativeNavigationVisible() {
        return navigationCandidates().some(element => {
            if (element === state.host || !isVisible(element)) return false;
            const rect = element.getBoundingClientRect();
            return rect.left > innerWidth * 0.65 && rect.width < innerWidth * 0.35;
        });
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
        const turn = element.closest('[data-testid^="conversation-turn-"], [data-turn-id-container]');
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
        return [...new Set(ids)];
    }

    function collectEntries() {
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

    function navigationStyles() {
        return `
            :host { all: initial; color-scheme: light dark; font: 13px system-ui, sans-serif; }
            :host([hidden]) { display: none !important; }
            * { box-sizing: border-box; }
            nav { position: fixed; right: 12px; top: 50%; transform: translateY(-50%);
                width: 38px; z-index: 1000; color: #171717; }
            .list { width: 100%; max-height: min(60vh, 600px); overflow-y: auto;
                scrollbar-width: none; overscroll-behavior: contain; padding: 6px 0; }
            nav:not([data-expanded="true"]) .list::-webkit-scrollbar { display: none; width: 0; }
            button { display: flex; align-items: center; justify-content: center; width: 100%;
                height: 12px; padding: 0; border: 0; background: transparent;
                cursor: pointer; color: inherit; font: inherit; text-align: left; }
            .tick { height: 2px; width: 22px; flex-shrink: 0; border-radius: 3px; background: #b9b9b9; }
            button[aria-current="true"] .tick { height: 3px; background: #171717; }
            button:focus-visible { outline: 2px solid #888; outline-offset: -2px; }
            .entry-label { display: none; min-width: 0; overflow: hidden;
                white-space: nowrap; text-overflow: ellipsis; }
            .status { position: absolute; right: 0; bottom: calc(100% + 8px); width: 210px;
                text-align: right; font-size: 11px; opacity: .8; pointer-events: none; }
            .status[hidden] { display: none; }
            :host([data-dark]) nav { color: #ddd; }
            :host([data-dark]) .tick { background: #626262; }
            :host([data-dark]) button[aria-current="true"] .tick { background: #ececec; }
            @media (max-width: 899px) { nav { display: none; } }
        ` + expandedNavigationStyles();
    }

    function expandedNavigationStyles() {
        return `
            nav[data-expanded="true"] { width: min(400px, calc(100vw - 32px)); }
            nav[data-expanded="true"] .list { max-height: min(70vh, 600px); padding: 7px;
                background: #fff; border: 1px solid #d4d4d4; border-radius: 20px;
                box-shadow: 0 6px 18px #00000014;
                scrollbar-width: thin; scrollbar-color: rgba(0, 0, 0, 0.25) transparent; }
            nav[data-expanded="true"] .list::-webkit-scrollbar { width: 6px; display: block; }
            nav[data-expanded="true"] .list::-webkit-scrollbar-track { background: transparent; }
            nav[data-expanded="true"] .list::-webkit-scrollbar-thumb { background: rgba(0, 0, 0, 0.2); border-radius: 10px; }
            nav[data-expanded="true"] .list::-webkit-scrollbar-thumb:hover { background: rgba(0, 0, 0, 0.35); }
            nav[data-expanded="true"] button { height: 44px; padding: 0 12px;
                justify-content: flex-start; border-radius: 12px; font-size: 16px; line-height: 1.5; }
            nav[data-expanded="true"] .tick { display: none; }
            nav[data-expanded="true"] .entry-label { display: block; }
            nav[data-expanded="true"] button[aria-current="true"] { background: #efefef; }
            nav[data-expanded="true"] button:hover { background: #f5f5f5; }
            :host([data-dark]) nav[data-expanded="true"] .list { background: #262626; border-color: #484848;
                scrollbar-color: rgba(255, 255, 255, 0.25) transparent; }
            :host([data-dark]) nav[data-expanded="true"] .list::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.2); }
            :host([data-dark]) nav[data-expanded="true"] .list::-webkit-scrollbar-thumb:hover { background: rgba(255, 255, 255, 0.35); }
            :host([data-dark]) nav[data-expanded="true"] button[aria-current="true"] { background: #3c3c3c; }
            :host([data-dark]) nav[data-expanded="true"] button:hover { background: #333; }
        `;
    }

    function createNavigation() {
        if (state.host?.isConnected) return;
        state.host = document.createElement('div');
        state.host.id = PREFIX;
        state.root = state.host.attachShadow({ mode: 'open' });
        const style = document.createElement('style');
        style.textContent = navigationStyles();
        const nav = document.createElement('nav');
        nav.setAttribute('aria-label', '对话问题导航（备用）');
        nav.dataset.expanded = 'false';
        const list = document.createElement('div');
        list.className = 'list';
        const status = document.createElement('div');
        status.className = 'status';
        status.setAttribute('role', 'status');
        status.setAttribute('aria-live', 'polite');
        nav.append(list, status);
        bindNavigationEvents(nav);
        state.root.append(style, nav);
        document.body.append(state.host);
        state.signature = '';
        state.navigationExpanded = false;
    }

    function centerActiveNavigationEntry() {
        const list = state.root?.querySelector('.list');
        const active = list?.querySelector('[aria-current="true"]');
        if (!active) return;
        // 只滚动导航自身，不使用 scrollIntoView，避免带动聊天正文。
        list.scrollTop = Math.max(0, active.offsetTop - list.offsetTop - (list.clientHeight - active.offsetHeight) / 2);
    }

    function setNavigationExpanded(expanded) {
        cancelTimer('navigationCloseTimer');
        if (state.navigationExpanded === expanded) return;
        state.navigationExpanded = expanded;
        const nav = state.root?.querySelector('nav');
        if (nav) nav.dataset.expanded = String(expanded);
        requestAnimationFrame(centerActiveNavigationEntry);
    }

    function scheduleNavigationClose() {
        cancelTimer('navigationCloseTimer');
        state.navigationCloseTimer = setTimeout(() => setNavigationExpanded(false), 160);
    }

    function bindNavigationEvents(nav) {
        nav.addEventListener('mouseenter', () => {
            state.navigationHovered = true;
            setNavigationExpanded(true);
        });
        nav.addEventListener('mouseleave', () => {
            state.navigationHovered = false;
            scheduleNavigationClose();
        });
        nav.addEventListener('focusin', () => setNavigationExpanded(true));
        nav.addEventListener('focusout', event => {
            if (!nav.contains(event.relatedTarget) && !state.navigationHovered) scheduleNavigationClose();
        });
    }

    function scrollToMessage(target) {
        const root = conversationScroller(target);
        if (root.clientHeight > 0 && root.scrollHeight > root.clientHeight) {
            const offset = target.getBoundingClientRect().top - scrollBounds(root).top - CONFIG.jumpTopInset;
            const top = Math.max(0, Math.min(root.scrollHeight - root.clientHeight, root.scrollTop + offset));
            root.scrollTo({ top, behavior: 'instant' });
        } else target.scrollIntoView({ behavior: 'instant', block: 'start' });
    }

    function cancelJump() {
        if (!state.jump) return;
        const job = state.jump;
        job.cancelled = true;
        job.result = '已取消';
        job.elapsed = Date.now() - job.startedAt;
        state.jump = null;
        job.resume?.();
        state.notice = '';
    }

    function conversationScroller(target) {
        const message = target || rawMessages()[0];
        let node = message?.parentElement || document.querySelector('main');
        while (node && node !== document.body) {
            if (node.scrollHeight > node.clientHeight + 20
                && /auto|scroll/.test(getComputedStyle(node).overflowY)) return node;
            node = node.parentElement;
        }
        const main = document.querySelector('main');
        const explicit = [...document.querySelectorAll('[data-scroll-root]')]
            .find(root => main && (root.contains(main) || main.contains(root)));
        return explicit || document.scrollingElement || document.documentElement;
    }

    function scrollBounds(root) {
        const documentRoot = root === document.scrollingElement || root === document.documentElement;
        const top = documentRoot ? 0 : root.getBoundingClientRect().top;
        return { top, bottom: top + (root.clientHeight || innerHeight) };
    }

    function targetIsAligned(target) {
        const root = conversationScroller(target);
        const rect = target.getBoundingClientRect();
        const bounds = scrollBounds(root);
        if (rect.width === 0 || rect.height === 0 || rect.top >= bounds.bottom - 24 || rect.bottom <= bounds.top) return false;
        if (Math.abs(rect.top - bounds.top - CONFIG.jumpTopInset) <= 12) return true;
        // 首尾受到滚动边界限制时，只要问题开头确实出现在正文可见区域即可。
        if (root.scrollTop <= 1) return rect.top >= bounds.top && rect.top <= bounds.top + CONFIG.jumpTopInset + 12;
        const atEnd = root.scrollHeight > root.clientHeight
            && root.scrollTop >= root.scrollHeight - root.clientHeight - 1;
        return atEnd && rect.top >= bounds.top && rect.top < bounds.bottom - 24;
    }

    function jumpStillActive(job) {
        return !job.cancelled && state.jump === job && state.conversation === job.context
            && location.pathname === job.context.key;
    }

    function jumpSearchDirection(job, entries) {
        const wanted = entries.findIndex(entry => entry.id === job.id);
        const mounted = entries.map((entry, index) => entry.target?.isConnected ? index : -1)
            .filter(index => index >= 0);
        if (!mounted.length || wanted < 0) return { direction: job.direction || -1, gap: null };
        const nearest = mounted.reduce((a, b) => Math.abs(a - wanted) < Math.abs(b - wanted) ? a : b);
        return { direction: wanted < nearest ? -1 : 1, gap: Math.abs(wanted - nearest) };
    }

    function updateJumpStep(job, direction, gap) {
        if (gap === null) return;
        if (job.direction && job.direction !== direction) {
            // 越过目标后保留缩小后的上限，避免再次加速导致来回跳过。
            job.stepLimit = Math.max(0.15, job.stepRatio / 2);
            job.stepRatio = job.stepLimit;
        } else {
            const limit = gap > 10 ? CONFIG.jumpMaxStep : gap > 3 ? 4 : 0.75;
            job.stepRatio = Math.min(limit, job.stepLimit, job.stepRatio * 2);
        }
        job.direction = direction;
    }

    function stepTowardsEntry(job, entries) {
        const root = conversationScroller();
        const { direction, gap } = jumpSearchDirection(job, entries);
        if (gap === null) {
            job.emptySince ??= Date.now();
            // 虚拟窗口暂时清空时先等挂载，避免连续滚动使异步渲染一直追不上。
            if (Date.now() - job.emptySince < 900) return;
        } else job.emptySince = null;
        const height = root.clientHeight || innerHeight;
        const max = Math.max(0, root.scrollHeight - height);
        updateJumpStep(job, direction, gap);
        const top = Math.max(0, Math.min(max, root.scrollTop + direction * height * job.stepRatio));
        job.atBoundary = direction < 0 ? top === 0 : top === max;
        // 根据已挂载消息的顺序粗找，再缩小步幅；不按问题数量推算像素位置。
        root.scrollTo({ top: top === root.scrollTop && max > 0 ? Math.max(0, Math.min(max, top - direction * 24)) : top,
            behavior: 'instant' });
        job.scrolls++;
    }

    function resolveJumpEntry(job, entries) {
        if (job.id) return entries.find(entry => entry.id === job.id);
        const candidates = entries.filter(entry => entry.text === job.text);
        return candidates.length === 1 ? candidates[0] : candidates.find(entry => entry.target === job.originalTarget);
    }

    function confirmJumpTarget(job, target) {
        const top = target.getBoundingClientRect().top;
        const aligned = targetIsAligned(target);
        const sameTarget = job.lastTarget === target;
        const stable = sameTarget && Math.abs(top - job.lastTop) <= 4 && aligned;
        job.stableFrames = stable ? job.stableFrames + 1 : 0;
        if (!stable) job.stableSince = Date.now();
        job.lastTarget = target;
        job.lastTop = top;
        if (job.stableFrames >= 2 && Date.now() - job.stableSince >= CONFIG.jumpStableDuration) return true;
        if (!sameTarget || !aligned) {
            scrollToMessage(target);
            job.scrolls++;
        }
        return false;
    }

    function waitForJumpProgress(job, deadline) {
        const delay = job.lastTarget ? CONFIG.jumpSettleDelay : job.atBoundary ? 900 : CONFIG.jumpPollDelay;
        const startedAt = Date.now();
        return new Promise(resolve => {
            let timer;
            let accelerated = false;
            job.resume = () => {
                clearTimeout(timer);
                job.resume = null;
                job.wake = null;
                resolve();
            };
            job.wake = () => {
                if (job.lastTarget || accelerated) return;
                accelerated = true;
                clearTimeout(timer);
                const remaining = Math.max(0, CONFIG.jumpMutationDelay - (Date.now() - startedAt));
                timer = setTimeout(job.resume, Math.min(remaining, Math.max(0, deadline - Date.now())));
            };
            timer = setTimeout(job.resume, Math.min(delay, Math.max(0, deadline - Date.now())));
        });
    }

    function wakeJumpForMessages(records) {
        const job = state.jump;
        if (!job?.wake || !records || !jumpStillActive(job)) return;
        const main = document.querySelector('main');
        if (main && records.some(record => main.contains(record.target)
            && (record.type === 'childList' || record.attributeName?.startsWith('data-')))) job.wake();
    }

    async function locateUnloaded(job) {
        const deadline = Date.now() + CONFIG.jumpTimeout;
        while (jumpStillActive(job) && Date.now() < deadline) {
            job.attempts++;
            const entries = collectEntries();
            const entry = resolveJumpEntry(job, entries);
            if (!entry) {
                state.notice = '会话分支已变化，请重新选择问题';
                job.result = '目标已变化';
                return;
            }
            const target = entry.target;
            if (target?.isConnected) {
                if (confirmJumpTarget(job, target)) {
                    state.notice = '';
                    job.result = '已确认定位';
                    return;
                }
            } else {
                job.stableFrames = 0;
                job.lastTarget = null;
                stepTowardsEntry(job, entries);
            }
            await waitForJumpProgress(job, deadline);
        }
        if (jumpStillActive(job)) {
            state.notice = '尚未定位到此问题，请重试或手动加载历史';
            job.result = '超时，未确认定位';
        }
    }

    async function jumpToEntry(index) {
        if (state.conversation?.key !== location.pathname) return;
        const entry = state.entries[index];
        if (!entry) return;
        cancelJump();
        // 使用点击时的消息身份重新查找节点，不能信任上一次渲染保留的 DOM 引用。
        const job = { id: entry.id, text: entry.text, originalTarget: entry.target,
            context: state.conversation, cancelled: false, attempts: 0, stableFrames: 0,
            stepRatio: 0.75, stepLimit: CONFIG.jumpMaxStep, scrolls: 0,
            startedAt: Date.now(), result: '定位中' };
        state.jump = job;
        state.lastJump = job;
        state.notice = '正在定位历史问题…（Esc 取消）';
        updateNavigationStatus();
        try { await locateUnloaded(job); }
        catch {
            if (jumpStillActive(job)) {
                state.notice = '页面暂不支持定位，请手动加载历史';
                job.result = '定位异常';
            }
        }
        finally {
            if (state.jump === job) state.jump = null;
            if (state.lastJump === job) state.lastJump = { result: job.result, attempts: job.attempts,
                scrolls: job.scrolls, elapsed: job.elapsed ?? Date.now() - job.startedAt };
            updateNavigationStatus();
        }
    }

    function updateNavigationStatus() {
        const status = state.root?.querySelector('.status');
        if (!status) return;
        const context = state.conversation;
        const labels = { idle: '已加载的问题', loading: '正在读取完整历史…',
            ready: `全部 ${state.entries.length} 个问题`, partial: `历史读取失败：${context?.error || '未知原因'}` };
        const incomplete = context?.status === 'ready' && state.entries.length !== context.entries.length;
        const text = state.notice || (incomplete ? '已发现新问题，正在同步索引…' : labels[context?.status]) || '';
        if (status.textContent !== text) status.textContent = text;
        status.hidden = !state.notice && context?.status !== 'partial';
    }

    function diagnosticText() {
        const context = state.conversation;
        const buttons = [...document.querySelectorAll('button, [role="button"]')]
            .filter(element => /sidebar|侧栏|侧边栏|边栏|側欄|側邊欄/i.test(
                `${element.getAttribute('data-testid')} ${element.getAttribute('aria-label')} ${element.title}`))
            .slice(0, 12).map(element => {
                const label = element.getAttribute('aria-label') || element.getAttribute('data-testid') || element.title;
                return `${label} [${isVisible(element) ? '可见' : '隐藏'}]`;
            });
        return `脚本版本：1.2.5\n启动自动收起：默认启用\n`
            + `桌面鼠标条件：${desktop() ? '满足' : '不满足（窄屏或未检测到鼠标）'}\n`
            + `左侧栏：${sidebarState()}\n启动收起：${state.startup ? '等待中' : '已完成'}\n`
            + `展开/收起按钮：${!!toggleButton('open')} / ${!!toggleButton('close')}\n`
            + `收起规则：鼠标移出后统一收起（包括手动打开）\n`
            + `页面请求观察：${state.captureInstalled ? '已启用' : '不可用'}\n`
            + `观察到的会话响应：${state.capturedResponses} 次\n最近响应：${state.captureSummary}\n`
            + `设备信息：${!!(deviceCookie() || state.requestContext?.headers['oai-device-id'])}\n`
            + `当前会话工作区信息：${state.requestContext?.id === context?.id && !!state.requestContext?.headers['chatgpt-account-id']}\n`
            + `索引来源：${context?.source || '暂无'}\n`
            + `最近定位：${state.lastJump?.result || '尚未点击'}，检查 ${state.lastJump?.attempts || 0} 次\n`
            + `定位滚动：${state.lastJump?.scrolls || 0} 次，耗时 ${state.lastJump?.elapsed
                ?? (state.jump ? Date.now() - state.jump.startedAt : 0)} ms\n`
            + `备用导航：${state.mode}\n完整索引：${context?.status}\n`
            + `${context?.error || ''}\n${(context?.attempts || []).join('\n')}\n`
            + `侧栏按钮：\n${buttons.join('\n') || '未找到语义标签'}`;
    }

    function diagnosticDialog(root, text) {
        const style = document.createElement('style');
        style.textContent = `
            :host { all: initial; color-scheme: light dark; }
            dialog { position: fixed; inset: 0; margin: auto; width: min(560px, 85vw);
                max-height: 85vh; overflow: auto; border: 1px solid #888; border-radius: 14px;
                padding: 20px; font: 14px system-ui; background: Canvas; color: CanvasText; }
            dialog::backdrop { background: #0006; }
            h2 { font-size: 18px; margin: 0 0 12px; }
            textarea { box-sizing: border-box; width: 100%; height: 300px; resize: vertical;
                padding: 10px; font: 13px/1.6 monospace; }
            button { margin: 12px 10px 0 0; padding: 8px 16px; cursor: pointer; }
        `;
        const dialog = document.createElement('dialog');
        dialog.setAttribute('aria-label', '脚本诊断信息');
        const title = document.createElement('h2');
        title.textContent = '脚本诊断信息';
        const textarea = document.createElement('textarea');
        textarea.readOnly = true;
        textarea.setAttribute('aria-label', '可复制的诊断信息');
        textarea.value = text;
        dialog.append(title, textarea);
        root.append(style, dialog);
        return { dialog, textarea };
    }

    async function copyDiagnostics(textarea, button) {
        try {
            if (typeof GM_setClipboard === 'function') GM_setClipboard(textarea.value, 'text');
            else await navigator.clipboard.writeText(textarea.value);
            button.textContent = '已复制';
        } catch {
            textarea.focus();
            textarea.select();
            button.textContent = '请按 Ctrl+C 复制';
        }
    }

    function showDiagnostics() {
        document.getElementById(`${PREFIX}-diagnostics`)?.remove();
        const host = document.createElement('div');
        host.id = `${PREFIX}-diagnostics`;
        const root = host.attachShadow({ mode: 'open' });
        const { dialog, textarea } = diagnosticDialog(root, diagnosticText());
        const previousFocus = document.activeElement;
        const close = () => { host.remove(); previousFocus?.focus(); };
        const copyButton = document.createElement('button');
        copyButton.textContent = '一键复制';
        copyButton.addEventListener('click', () => void copyDiagnostics(textarea, copyButton));
        const closeButton = document.createElement('button');
        closeButton.textContent = '关闭';
        closeButton.addEventListener('click', close);
        dialog.append(copyButton, closeButton);
        dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
        document.body.append(host);
        if (typeof dialog.showModal === 'function') dialog.showModal();
        else dialog.setAttribute('open', '');
        copyButton.focus();
    }

    function entryButton(entry, index) {
        const button = document.createElement('button');
        button.type = 'button';
        button.setAttribute('aria-label', `问题 ${index + 1}：${entry.text.slice(0, 240)}`);
        const tick = document.createElement('span');
        tick.className = 'tick';
        tick.setAttribute('aria-hidden', 'true');
        const label = document.createElement('span');
        label.className = 'entry-label';
        label.textContent = entry.text;
        button.title = entry.text.slice(0, 240);
        button.append(tick, label);
        button.addEventListener('click', () => jumpToEntry(index));
        button.addEventListener('keydown', event => moveNavigationFocus(event, index));
        return button;
    }

    function moveNavigationFocus(event, index) {
        if (event.key === 'Escape') {
            setNavigationExpanded(false);
            state.root.activeElement?.blur();
            return;
        }
        const buttons = [...state.root.querySelectorAll('button')];
        const destinations = { ArrowDown: index + 1, ArrowUp: index - 1, Home: 0, End: buttons.length - 1 };
        if (!(event.key in destinations)) return;
        event.preventDefault();
        buttons[Math.max(0, Math.min(buttons.length - 1, destinations[event.key]))]?.focus();
    }

    function updateActiveEntry() {
        state.activeFrame = 0;
        if (!state.host || state.host.hidden || !state.entries.length) return;
        let active = -1;
        const threshold = innerHeight * 0.3;
        state.entries.forEach((entry, index) => {
            if (!entry.target?.isConnected) return;
            if (active === -1 || entry.target.getBoundingClientRect().top <= threshold) active = index;
        });
        let changed = false;
        state.root.querySelectorAll('button').forEach((button, index) => {
            const value = String(index === active);
            if (button.getAttribute('aria-current') === value) return;
            button.setAttribute('aria-current', value);
            changed = true;
        });
        if (changed && !state.navigationExpanded) centerActiveNavigationEntry();
    }

    function queueActiveUpdate() {
        if (!state.activeFrame) state.activeFrame = requestAnimationFrame(updateActiveEntry);
    }

    function refreshNavigation() {
        if (state.mode === 'off') {
            if (state.host) state.host.hidden = true;
            return;
        }
        const nativeVisible = nativeNavigationVisible();
        if (nativeVisible) state.nativeSeenAt = Date.now();
        const hide = state.mode === 'auto' && (nativeVisible || Date.now() - state.nativeSeenAt < 2000);
        if (hide) {
            if (state.host) state.host.hidden = true;
            return;
        }
        const entries = collectEntries();
        if (!entries.length && !state.host) return;
        createNavigation();
        state.host.hidden = entries.length === 0;
        const dark = document.documentElement.classList.contains('dark')
            || getComputedStyle(document.documentElement).colorScheme === 'dark';
        if (state.host.hasAttribute('data-dark') !== dark) state.host.toggleAttribute('data-dark', dark);
        state.entries = entries;
        const signature = JSON.stringify(entries.map(entry => [entry.id, entry.text]));
        if (signature !== state.signature) {
            state.root.querySelector('.list').replaceChildren(...entries.map(entryButton));
            state.signature = signature;
        }
        queueActiveUpdate();
        updateNavigationStatus();
    }

    function refresh() {
        state.refreshTimer = null;
        maintainSidebar();
        maintainHistory();
        refreshNavigation();
    }

    function queueRefresh(records) {
        if (!document?.body) return;
        if (records && records.every(record => record.target === state.host)) return;
        wakeJumpForMessages(records);
        if (!state.refreshTimer) state.refreshTimer = setTimeout(refresh, 180);
    }

    function setMode(mode) {
        state.mode = mode;
        if (mode === 'off') cancelJump();
        if (typeof GM_setValue === 'function') GM_setValue('navigationMode', mode);
        registerModeMenus();
        maintainHistory();
        refreshNavigation();
    }

    function registerModeMenus() {
        if (typeof GM_registerMenuCommand !== 'function') return;
        const modes = [
            { id: 'cghs-mode-auto', key: 'auto', label: '自动（优先原生）' },
            { id: 'cghs-mode-always', key: 'always', label: '强制显示备用' },
            { id: 'cghs-mode-off', key: 'off', label: '关闭备用' },
        ];
        for (const { id, key, label } of modes) {
            const indicator = state.mode === key ? '✅' : '○';
            GM_registerMenuCommand(`${indicator} 右侧导航：${label}`, () => setMode(key), { id });
        }
    }

    function registerMenus() {
        if (typeof GM_registerMenuCommand !== 'function') return;
        registerModeMenus();
        GM_registerMenuCommand('重新读取完整会话索引', () => {
            syncConversation();
            if (state.conversation.status !== 'loading') state.conversation.retryAt = 0;
            maintainHistory();
        });
        GM_registerMenuCommand('立即收起左侧栏', () => {
            state.startup = true;
            state.closedSince = null;
            maintainSidebar();
        });
        GM_registerMenuCommand('查看脚本状态', showDiagnostics);
    }

    function start() {
        if (document.getElementById(`${PREFIX}-marker`)) return;
        const marker = document.createElement('meta');
        marker.id = `${PREFIX}-marker`;
        document.head.append(marker);
        registerMenus();
        document.addEventListener('click', handleSidebarClick, true);
        document.addEventListener('pointermove', handlePointer, { passive: true });
        document.documentElement.addEventListener('pointerleave', () => {
            state.pointer = null;
            evaluatePointer();
        });
        window.addEventListener('blur', () => {
            state.pointer = null;
            cancelTimer('openTimer');
            closeFromHover();
        });
        document.addEventListener('scroll', queueActiveUpdate, { passive: true, capture: true });
        window.addEventListener('resize', () => queueRefresh());
        window.addEventListener('popstate', () => queueRefresh());
        document.addEventListener('wheel', cancelJump, { passive: true, capture: true });
        document.addEventListener('touchstart', cancelJump, { passive: true, capture: true });
        document.addEventListener('pointerdown', cancelJump, { passive: true, capture: true });
        document.addEventListener('keydown', event => {
            if (['Escape', 'PageUp', 'PageDown', 'Home', 'End', 'ArrowUp', 'ArrowDown', ' '].includes(event.key)) cancelJump();
        }, true);
        const observer = new MutationObserver(queueRefresh);
        observer.observe(document.body, { childList: true, subtree: true, attributes: true,
            attributeFilter: ['class', 'style', 'aria-expanded', 'aria-hidden', 'data-testid',
                'data-message-id', 'data-message-author-role', 'data-turn-id', 'data-turn-id-container'] });
        // 低频补偿 SPA 替换、延迟 hydration、主题更新和点击未生效的情况。
        setInterval(refresh, 1200);
        refresh();
    }

    if (!document.getElementById(`${PREFIX}-marker`)) {
        observePageRequests();
        if (document.body) start();
        else document.addEventListener('DOMContentLoaded', start, { once: true });
    }
}
