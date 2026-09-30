// 测试共用的夹具：jsdom 页面、假时钟、侧栏与消息 DOM 构造、聊天接口模拟。
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { JSDOM } = require('jsdom');

const source = readFileSync(join(__dirname, '..', 'chatgpt-hover-sidebar.user.js'), 'utf8');

async function settlePromises() {
    for (let i = 0; i < 30; i++) await Promise.resolve();
}

function fakeClock(window) {
    let now = 100000;
    let sequence = 0;
    const jobs = new Map();
    window.Date.now = () => now;
    window.setTimeout = (callback, delay = 0) => {
        jobs.set(++sequence, { callback, at: now + delay });
        return sequence;
    };
    window.clearTimeout = id => jobs.delete(id);
    window.setInterval = (callback, delay) => {
        function repeat() {
            callback();
            window.setTimeout(repeat, delay);
        }
        return window.setTimeout(repeat, delay);
    };
    window.requestAnimationFrame = callback => window.setTimeout(callback, 16);
    return async function advance(duration) {
        const end = now + duration;
        await settlePromises();
        for (let count = 0; count < 2000; count++) {
            const next = [...jobs].sort((a, b) => a[1].at - b[1].at)[0];
            if (!next || next[1].at > end) break;
            now = next[1].at;
            jobs.delete(next[0]);
            next[1].callback();
            await settlePromises();
            if (count === 1999) throw new Error('Timer loop');
        }
        now = end;
        await settlePromises();
    };
}

function installGeometry(window) {
    window.HTMLElement.prototype.getBoundingClientRect = function () {
        const hidden = this.closest('[hidden]');
        const left = Number(this.dataset.left || 0);
        const top = Number(this.dataset.top || 0);
        const width = hidden ? 0 : Number(this.dataset.width || 32);
        const height = hidden ? 0 : Number(this.dataset.height || 32);
        return { left, top, width, height, right: left + width, bottom: top + height };
    };
    window.HTMLElement.prototype.scrollIntoView = function (options) {
        this.scrollOptions = options;
    };
}

function fixture(t, options = {}) {
    const dom = new JSDOM('<!doctype html><html><head></head><body><main></main></body></html>', {
        url: 'https://chatgpt.com/c/test', runScripts: 'outside-only', pretendToBeVisual: true,
    });
    const { window } = dom;
    window.Headers = Headers;
    t.after(() => window.close());
    Object.defineProperty(window, 'innerWidth', { value: options.width || 1400, configurable: true });
    window.matchMedia = query => ({ matches: query.includes('hover') && options.touch !== true });
    const menus = new Map();
    const storage = new Map([['navigationMode', options.mode || 'auto']]);
    window.GM_getValue = (key, fallback) => storage.get(key) || fallback;
    window.GM_setValue = (key, value) => storage.set(key, value);
    window.GM_registerMenuCommand = (label, action, options) => menus.set(options?.id || label, action);
    installGeometry(window);
    const advance = fakeClock(window);
    return { window, document: window.document, advance, menus, storage,
        start: () => window.eval(source) };
}

function addSidebar(f, options = {}) {
    const panel = f.document.createElement('aside');
    panel.id = 'stage-slideover-sidebar';
    panel.dataset.width = '280';
    panel.dataset.height = '700';
    const open = f.document.createElement('button');
    open.dataset.testid = 'open-sidebar-button';
    const close = f.document.createElement('button');
    close.dataset.testid = 'close-sidebar-button';
    panel.append(close);
    f.document.body.prepend(open, panel);
    let closeClicks = 0;
    function setOpen(value) {
        panel.hidden = !value;
        open.hidden = value;
    }
    open.addEventListener('click', () => setOpen(true));
    close.addEventListener('click', () => {
        closeClicks++;
        if (closeClicks > (options.ignoreClicks || 0)) setOpen(false);
    });
    setOpen(options.open !== false);
    return { panel, open, close, setOpen, clicks: () => closeClicks };
}

function pointer(f, x, type = 'mouse', y = 300) {
    const event = new f.window.Event('pointermove', { bubbles: true });
    Object.assign(event, { clientX: x, clientY: y, pointerType: type });
    f.document.dispatchEvent(event);
}

function messages(f, texts) {
    const articles = texts.map((text, index) => {
        const article = f.document.createElement('article');
        article.dataset.top = String(index * 500);
        const message = f.document.createElement('div');
        message.dataset.messageAuthorRole = 'user';
        message.textContent = text;
        article.append(message);
        return article;
    });
    f.document.querySelector('main').replaceChildren(...articles);
    return articles;
}

function nativeNavigation(f) {
    const nav = f.document.createElement('nav');
    nav.setAttribute('aria-label', 'Conversation navigation');
    nav.dataset.left = '1350';
    f.document.body.append(nav);
    return nav;
}

function apiMessage(id, text, role = 'user') {
    return { id, author: { role }, content: { content_type: 'text', parts: [text] } };
}

function tree(messages) {
    const mapping = { root: { parent: null, message: null } };
    let parent = 'root';
    for (const message of messages) {
        mapping[message.id] = { parent, message };
        parent = message.id;
    }
    return { mapping, current_node: parent };
}

function mockApi(f, handler) {
    const requests = [];
    f.window.fetch = async (url, options) => {
        const parsed = new URL(url);
        assert.equal(parsed.origin, 'https://chatgpt.com');
        requests.push(parsed);
        if (parsed.pathname === '/api/auth/session') {
            return { ok: true, json: async () => ({ accessToken: 'test-token' }) };
        }
        assert.equal(options.headers.Authorization, 'Bearer test-token');
        assert.equal(options.credentials, 'include');
        const result = await handler(parsed, options);
        return { ok: true, json: async () => result };
    };
    return requests;
}

function navRoot(f) {
    return f.document.getElementById('cghs-navigation').shadowRoot;
}

function mountedMessage(f, id, text) {
    const [article] = messages(f, [text]);
    article.firstElementChild.dataset.messageId = id;
    return article;
}

function virtualScroller(f, onScroll) {
    const main = f.document.querySelector('main');
    main.setAttribute('data-scroll-root', '');
    main.style.overflowY = 'auto';
    Object.defineProperty(main, 'clientHeight', { value: 600 });
    Object.defineProperty(main, 'scrollHeight', { value: 6000 });
    main.scrollTop = 5400;
    main.scrollTo = options => {
        main.scrollTop = options.top;
        onScroll(options);
    };
    return main;
}

function responseData(data) {
    return { ok: true, json: async () => data, clone: () => ({ json: async () => data }) };
}

function geometricScroller(f, article) {
    const main = f.document.querySelector('main');
    main.style.overflowY = 'auto';
    Object.defineProperty(main, 'clientHeight', { value: 600 });
    Object.defineProperty(main, 'scrollHeight', { value: 6000 });
    main.scrollTop = 0;
    main.messageOffset = 3000;
    main.scrollCalls = [];
    main.getBoundingClientRect = () => ({ top: 100, bottom: 700, width: 900, height: 600 });
    article.getBoundingClientRect = () => {
        const top = 100 + main.messageOffset - main.scrollTop;
        return { top, bottom: top + 100, width: 700, height: 100 };
    };
    main.scrollTo = options => {
        main.scrollCalls.push(options.top);
        main.scrollTop = options.top;
    };
    return main;
}

function copiedDiagnostics(f) {
    let value;
    f.window.GM_setClipboard = text => { value = text; };
    f.menus.get('查看脚本状态')();
    const host = f.document.getElementById('cghs-navigation-diagnostics');
    host.shadowRoot.querySelector('button').click();
    host.remove();
    return value;
}

function renderVirtualMessages(f, main, items) {
    const current = Math.max(0, items.findLastIndex(item => item.offset <= main.scrollTop));
    const articles = items.slice(Math.max(0, current - 1), current + 3).map(item => {
        const article = f.document.createElement('article');
        const message = f.document.createElement('div');
        message.dataset.messageAuthorRole = 'user';
        message.dataset.messageId = item.id;
        message.textContent = item.text;
        article.append(message);
        article.getBoundingClientRect = () => {
            const top = 100 + item.offset - main.scrollTop;
            return { top, bottom: top + 100, width: 700, height: 100 };
        };
        return article;
    });
    // 保持同一窗口中的节点，模拟虚拟列表只在窗口变化时重新挂载。
    const ids = articles.map(article => article.firstElementChild.dataset.messageId).join(',');
    if (main.dataset.mounted !== ids) {
        main.dataset.mounted = ids;
        main.replaceChildren(...articles);
    }
}

function longConversation(f, options = {}) {
    let total = 0;
    const items = Array.from({ length: 300 }, (_, index) => {
        const item = { id: `u${index}`, text: `问题 ${index}`, offset: total };
        total += options.height?.(index) || 900;
        return item;
    });
    mockApi(f, () => tree(items.map(item => apiMessage(item.id, item.text))));
    const main = f.document.querySelector('main');
    main.dataset.scrollRoot = '';
    main.style.overflowY = 'auto';
    Object.defineProperty(main, 'clientHeight', { value: 600 });
    Object.defineProperty(main, 'scrollHeight', { get: () => total });
    main.scrollTop = options.fromStart ? 0 : total - 600;
    main.scrollCalls = [];
    main.getBoundingClientRect = () => ({ top: 100, bottom: 700, width: 900, height: 600 });
    main.scrollTo = ({ top }) => {
        main.scrollCalls.push(top);
        if (options.emptyWhileLoading && Math.abs(top - main.scrollTop) > 600) {
            main.replaceChildren();
            delete main.dataset.mounted;
        }
        main.scrollTop = top;
        if (options.renderDelay) {
            f.window.setTimeout(() => renderVirtualMessages(f, main, items), options.renderDelay);
        } else renderVirtualMessages(f, main, items);
    };
    renderVirtualMessages(f, main, items);
    return { main, items };
}

module.exports = {
    settlePromises,
    fakeClock,
    installGeometry,
    fixture,
    addSidebar,
    pointer,
    messages,
    nativeNavigation,
    apiMessage,
    tree,
    mockApi,
    navRoot,
    mountedMessage,
    virtualScroller,
    responseData,
    geometricScroller,
    copiedDiagnostics,
    renderVirtualMessages,
    longConversation,
};
