const { test } = require('node:test');
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
    window.GM_registerMenuCommand = (label, action) => menus.set(label, action);
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

test('启动收起并重试 hydration 之前无效的点击', async t => {
    const f = fixture(t);
    const bar = addSidebar(f, { ignoreClicks: 2 });
    f.start();
    await f.advance(4000);
    assert.equal(bar.panel.hidden, true);
    assert.equal(bar.clicks(), 3);
});

test('超过原脚本的 6 秒超时后出现侧栏仍会收起', async t => {
    const f = fixture(t);
    f.start();
    await f.advance(10000);
    const bar = addSidebar(f);
    await f.advance(1500);
    assert.equal(bar.panel.hidden, true);
});

test('边缘停留展开，离开收起，快速划过不展开', async t => {
    const f = fixture(t);
    const bar = addSidebar(f);
    f.start();
    await f.advance(1500);
    pointer(f, 5);
    await f.advance(30);
    pointer(f, 600);
    await f.advance(300);
    assert.equal(bar.panel.hidden, true);
    pointer(f, 5);
    await f.advance(200);
    assert.equal(bar.panel.hidden, false);
    pointer(f, 200);
    await f.advance(800);
    assert.equal(bar.panel.hidden, false);
    pointer(f, 600);
    await f.advance(1500);
    assert.equal(bar.panel.hidden, true);
});

test('手动打开的侧栏在鼠标移出后关闭', async t => {
    const f = fixture(t);
    const bar = addSidebar(f);
    f.start();
    await f.advance(1500);
    bar.open.click();
    pointer(f, 800);
    await f.advance(2500);
    assert.equal(bar.panel.hidden, true);
});

test('菜单打开也不会阻止鼠标移出后自动关闭', async t => {
    const f = fixture(t);
    const bar = addSidebar(f, { open: false });
    f.start();
    await f.advance(1500);
    pointer(f, 5);
    await f.advance(800);
    const menu = f.document.createElement('div');
    menu.setAttribute('role', 'menu');
    f.document.body.append(menu);
    pointer(f, 800);
    await f.advance(2000);
    assert.equal(bar.panel.hidden, true);
    menu.remove();
    await f.advance(1800);
    assert.equal(bar.panel.hidden, true);
});

test('窄屏和触摸设备不自动操作侧栏', async t => {
    for (const options of [{ width: 500 }, { touch: true }]) {
        const f = fixture(t, options);
        const bar = addSidebar(f);
        f.start();
        pointer(f, 5, 'touch');
        await f.advance(2500);
        assert.equal(bar.clicks(), 0);
    }
});

test('忽略屏幕外和右侧的同名按钮', async t => {
    const f = fixture(t);
    const bar = addSidebar(f);
    const wrongButtons = [-100, 1300].map(left => {
        const button = f.document.createElement('button');
        button.dataset.testid = 'close-sidebar-button';
        button.dataset.left = String(left);
        button.addEventListener('click', () => assert.fail('错误点击非左侧按钮'));
        f.document.body.prepend(button);
        return button;
    });
    f.start();
    await f.advance(1200);
    assert.equal(bar.panel.hidden, true);
    assert.equal(wrongButtons.length, 2);
});

test('保留原生导航，自动隐藏备用；强制模式可启用并保存', async t => {
    const f = fixture(t);
    messages(f, ['问题一', '问题二']);
    const native = nativeNavigation(f);
    const original = native.outerHTML;
    f.start();
    assert.equal(f.document.getElementById('cghs-navigation'), null);
    f.menus.get('右侧导航：强制显示备用')();
    const host = f.document.getElementById('cghs-navigation');
    assert.equal(host.hidden, false);
    assert.equal(host.shadowRoot.querySelectorAll('button').length, 2);
    assert.equal(native.outerHTML, original);
    assert.equal(f.storage.get('navigationMode'), 'always');
    f.menus.get('右侧导航：关闭备用')();
    assert.equal(host.hidden, true);
});

test('原生导航动态出现/消失会切换备用导航', async t => {
    const f = fixture(t);
    messages(f, ['问题']);
    f.start();
    const host = f.document.getElementById('cghs-navigation');
    assert.equal(host.hidden, false);
    const native = nativeNavigation(f);
    await f.advance(1300);
    assert.equal(host.hidden, true);
    native.remove();
    await f.advance(4000);
    assert.equal(host.hidden, false);
});

test('导航安全预览、点击定位、滚动高亮和键盘切换', async t => {
    const f = fixture(t);
    const articles = messages(f, ['<img src=x onerror=alert(1)>', '第二个问题']);
    f.start();
    await f.advance(30);
    const root = f.document.getElementById('cghs-navigation').shadowRoot;
    const buttons = root.querySelectorAll('button');
    assert.equal(buttons[0].getAttribute('aria-current'), 'true');
    root.querySelector('nav').dispatchEvent(new f.window.Event('mouseenter'));
    assert.equal(buttons[0].querySelector('.entry-label').textContent, '<img src=x onerror=alert(1)>');
    assert.equal(root.querySelector('img'), null);
    buttons[1].click();
    assert.equal(articles[1].scrollOptions.block, 'start');
    articles[1].dataset.top = '100';
    f.document.dispatchEvent(new f.window.Event('scroll'));
    await f.advance(30);
    assert.equal(buttons[1].getAttribute('aria-current'), 'true');
    buttons[0].dispatchEvent(new f.window.KeyboardEvent('keydown', { key: 'End' }));
    assert.equal(root.activeElement, buttons[1]);
});

test('SPA 替换相同文字的消息后导航仍定位新节点', async t => {
    const f = fixture(t);
    const previous = messages(f, ['相同文字']);
    f.start();
    const next = messages(f, ['相同文字']);
    await f.advance(1500);
    f.document.getElementById('cghs-navigation').shadowRoot.querySelector('button').click();
    assert.equal(previous[0].scrollOptions, undefined);
    assert.equal(next[0].scrollOptions.block, 'start');
    messages(f, []);
    await f.advance(1500);
    assert.equal(f.document.getElementById('cghs-navigation').hidden, true);
});

test('重复注入不会重复注册菜单或创建导航', t => {
    const f = fixture(t);
    messages(f, ['问题']);
    f.start();
    f.start();
    assert.equal(f.document.querySelectorAll('#cghs-navigation').length, 1);
    assert.equal(f.menus.size, 6);
});

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

test('进入会话即索引未挂载的全部问题，只保留当前分支', async t => {
    const f = fixture(t);
    const data = tree([apiMessage('u1', '很早的问题'), apiMessage('a1', '回答', 'assistant'), apiMessage('u2', '最新问题')]);
    data.mapping.other = { parent: 'u1', message: apiMessage('other', '另一分支') };
    mockApi(f, () => data);
    mountedMessage(f, 'u2', '最新问题');
    f.start();
    await f.advance(1500);
    const labels = [...navRoot(f).querySelectorAll('button')].map(button => button.getAttribute('aria-label'));
    assert.deepEqual(labels, ['问题 1：很早的问题', '问题 2：最新问题']);
    assert.match(navRoot(f).querySelector('.status').textContent, /全部 2/);
    f.document.querySelector('main').replaceChildren();
    await f.advance(1500);
    assert.equal(navRoot(f).querySelectorAll('button').length, 2);
});

test('不完整消息树使用分页接口，游标翻页并去重', async t => {
    const f = fixture(t);
    const requests = mockApi(f, url => {
        if (url.pathname.includes('/conversation/')) return { mapping: {}, current_node: 'missing' };
        if (url.searchParams.has('before')) return { messages: [apiMessage('u1', '早期'), apiMessage('u2', '近期')],
            page_info: { has_previous_page: false } };
        return { messages: [apiMessage('u2', '近期')],
            page_info: { has_previous_page: true, start_cursor: 'opaque+/=' } };
    });
    f.start();
    await f.advance(1500);
    assert.equal(navRoot(f).querySelectorAll('button').length, 2);
    assert.equal(requests.at(-1).searchParams.get('before'), 'opaque+/=');
    assert.match(navRoot(f).querySelector('.status').textContent, /全部/);
});

test('分页游标循环不会把残缺历史标记为完整', async t => {
    const f = fixture(t);
    messages(f, ['已加载']);
    const requests = mockApi(f, url => url.pathname.includes('/conversation/') ? {}
        : { messages: [apiMessage('u2', '近期')], page_info: { has_previous_page: true, start_cursor: 'same' } });
    f.start();
    await f.advance(10000);
    assert.match(navRoot(f).querySelector('.status').textContent, /失败/);
    assert.equal(requests.length, 5);
});

test('切换会话丢弃旧请求响应及未被替换的旧 DOM', async t => {
    const f = fixture(t);
    let finishOld;
    mockApi(f, url => url.pathname.includes('/test') ? new Promise(resolve => { finishOld = resolve; })
        : tree([apiMessage('new', '新会话') ]));
    mountedMessage(f, 'old', '旧会话');
    f.start();
    await f.advance(200);
    f.window.history.pushState({}, '', '/c/new-chat');
    await f.advance(1500);
    finishOld(tree([apiMessage('old', '旧会话')]));
    await f.advance(1500);
    const labels = [...navRoot(f).querySelectorAll('button')].map(button => button.getAttribute('aria-label'));
    assert.deepEqual(labels, ['问题 1：新会话']);
});

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

test('点击未加载问题触发滚动加载，并以消息 ID 确认定位', async t => {
    const f = fixture(t);
    mockApi(f, () => tree([apiMessage('u1', '重复问题'), apiMessage('u2', '重复问题')]));
    const latest = mountedMessage(f, 'u2', '重复问题');
    let oldest;
    const scroller = virtualScroller(f, () => {
        if (!oldest) oldest = mountedMessage(f, 'u1', '重复问题');
    });
    f.start();
    await f.advance(1500);
    navRoot(f).querySelector('button').click();
    await f.advance(600);
    assert.equal(latest.scrollOptions, undefined);
    assert.ok(oldest.isConnected);
    assert.ok(scroller.scrollTop < 5400);
});

test('手动滚轮取消尚未完成的定位', async t => {
    const f = fixture(t);
    mockApi(f, () => tree([apiMessage('u1', '早期'), apiMessage('u2', '近期')]));
    mountedMessage(f, 'u2', '近期');
    let scrolls = 0;
    virtualScroller(f, () => { scrolls++; });
    f.start();
    await f.advance(1500);
    navRoot(f).querySelector('button').click();
    f.document.dispatchEvent(new f.window.Event('wheel'));
    const count = scrolls;
    await f.advance(1500);
    assert.equal(scrolls, count);
});

test('定位超时给出提示，禁止宣称定位成功', async t => {
    const f = fixture(t);
    mockApi(f, () => tree([apiMessage('u1', '早期'), apiMessage('u2', '近期')]));
    mountedMessage(f, 'u2', '近期');
    virtualScroller(f, () => {});
    f.start();
    await f.advance(1500);
    navRoot(f).querySelector('button').click();
    await f.advance(46000);
    assert.match(navRoot(f).querySelector('.status').textContent, /尚未定位/);
});

test('自动更新地址和版本与发布配置一致', () => {
    const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8'));
    assert.match(source, new RegExp(`@version\\s+${pkg.version.replaceAll('.', '\\.')}`));
    const expected = 'https://raw.githubusercontent.com/Alex-hj/myTampermonkeyScripts/main/chatgpt-hover-sidebar/chatgpt-hover-sidebar.user.js';
    assert.equal(source.match(/@updateURL\s+(\S+)/)[1], expected);
    assert.equal(source.match(/@downloadURL\s+(\S+)/)[1], expected);
});

test('路由检测前新会话 DOM 已挂载，不会被误当成旧消息', async t => {
    const f = fixture(t);
    mockApi(f, url => tree([apiMessage(url.pathname.includes('/test') ? 'old' : 'new', '问题')]));
    mountedMessage(f, 'old', '问题');
    f.start();
    await f.advance(1500);
    f.window.history.pushState({}, '', '/c/new');
    const current = mountedMessage(f, 'new', '问题');
    await f.advance(1500);
    navRoot(f).querySelector('button').click();
    assert.equal(current.scrollOptions.block, 'start');
});

test('旧接口403只补试一次新版分页，仍失败后退避', async t => {
    const f = fixture(t);
    messages(f, ['当前问题']);
    const requests = mockApi(f, () => { throw new Error('HTTP 403'); });
    f.start();
    await f.advance(10000);
    assert.equal(requests.length, 3);
    assert.match(navRoot(f).querySelector('.status').textContent, /失败/);
});

test('切换会话立即阻止旧定位任务继续滚动', async t => {
    const f = fixture(t);
    mockApi(f, () => tree([apiMessage('u1', '早期'), apiMessage('u2', '近期')]));
    mountedMessage(f, 'u2', '近期');
    let scrolls = 0;
    virtualScroller(f, () => { scrolls++; });
    f.start();
    await f.advance(1500);
    navRoot(f).querySelector('button').click();
    const before = scrolls;
    f.window.history.pushState({}, '', '/');
    await f.advance(1500);
    assert.equal(scrolls, before);
});

test('启动短暂收起后恢复展开，仍执行自动收起', async t => {
    const f = fixture(t);
    const bar = addSidebar(f, { open: false });
    f.start();
    await f.advance(500);
    bar.setOpen(true);
    await f.advance(2500);
    assert.equal(bar.panel.hidden, true);
    assert.equal(bar.clicks(), 1);
});

test('混合触摸设备连接鼠标时也启用自动收起', async t => {
    const f = fixture(t);
    f.window.matchMedia = query => ({ matches: query.includes('any-hover') });
    const bar = addSidebar(f);
    f.start();
    await f.advance(1500);
    assert.equal(bar.panel.hidden, true);
});

test('零宽度裁剪容器内的关闭按钮不会被点击', async t => {
    const f = fixture(t);
    addSidebar(f, { open: false });
    const wrapper = f.document.createElement('div');
    wrapper.style.overflow = 'hidden';
    wrapper.dataset.width = '0';
    const button = f.document.createElement('button');
    button.dataset.testid = 'close-sidebar-button';
    button.addEventListener('click', () => assert.fail('点击了裁剪隐藏的按钮'));
    wrapper.append(button);
    f.document.body.prepend(wrapper);
    f.start();
    await f.advance(2000);
});

test('完整参数不兼容时尝试普通消息树接口', async t => {
    const f = fixture(t);
    const requests = mockApi(f, url => {
        if (url.searchParams.has('include_full_conversation')) throw new Error('HTTP 400');
        return { conversation: tree([apiMessage('u1', '兼容问题')]) };
    });
    f.start();
    await f.advance(1500);
    assert.match(navRoot(f).querySelector('.status').textContent, /全部 1/);
    assert.equal(requests.length, 3);
});

test('诊断窗口一键复制阶段错误和侧栏状态，关闭后移除窗口', async t => {
    const f = fixture(t);
    let copied = '';
    f.window.GM_setClipboard = text => { copied = text; };
    mockApi(f, () => { throw new Error('HTTP 403'); });
    messages(f, ['当前问题']);
    f.start();
    await f.advance(1500);
    assert.match(navRoot(f).querySelector('.status').textContent, /历史分页：HTTP 403/);
    f.menus.get('查看脚本状态')();
    const host = f.document.getElementById('cghs-navigation-diagnostics');
    const buttons = host.shadowRoot.querySelectorAll('button');
    buttons[0].click();
    await settlePromises();
    assert.match(copied, /启动自动收起：默认启用/);
    assert.match(copied, /完整消息树：HTTP 403/);
    assert.equal(copied.includes('test-token'), false);
    assert.equal(buttons[0].textContent, '已复制');
    buttons[1].click();
    assert.equal(host.isConnected, false);
});

test('页面自行展开和手动打开都执行移出收起', async t => {
    const f = fixture(t);
    const bar = addSidebar(f, { open: false });
    f.start();
    await f.advance(3000);
    bar.setOpen(true);
    await f.advance(1500);
    assert.equal(bar.panel.hidden, true);
    bar.open.click();
    await f.advance(2500);
    assert.equal(bar.panel.hidden, true);
});

test('手动打开后鼠标在侧栏内保持，移出后焦点不阻止关闭', async t => {
    const f = fixture(t);
    const bar = addSidebar(f);
    f.start();
    await f.advance(1500);
    pointer(f, 100);
    bar.open.click();
    bar.close.focus();
    await f.advance(1500);
    assert.equal(bar.panel.hidden, false);
    pointer(f, 281);
    await f.advance(400);
    assert.equal(bar.panel.hidden, true);
});

test('收起延时内返回侧栏取消关闭，再离开底部时收起', async t => {
    const f = fixture(t);
    const bar = addSidebar(f);
    f.start();
    await f.advance(1500);
    pointer(f, 100);
    bar.open.click();
    await f.advance(800);
    pointer(f, 600);
    await f.advance(100);
    pointer(f, 100);
    await f.advance(500);
    assert.equal(bar.panel.hidden, false);
    pointer(f, 100, 'mouse', 701);
    await f.advance(400);
    assert.equal(bar.panel.hidden, true);
});

test('主动历史读取携带当前设备信息，认证接口不携带设备头', async t => {
    const f = fixture(t);
    f.document.cookie = 'oai-did=device-test';
    mockApi(f, (url, options) => {
        assert.equal(options.headers['oai-device-id'], 'device-test');
        return tree([apiMessage('u1', '问题')]);
    });
    f.start();
    await f.advance(1500);
    assert.match(navRoot(f).querySelector('.status').textContent, /全部 1/);
});

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

test('定位只滚动正文容器，并在布局漂移后继续校正直到稳定', async t => {
    const f = fixture(t);
    const [article] = messages(f, ['定位测试']);
    const main = geometricScroller(f, article);
    f.start();
    navRoot(f).querySelector('button').click();
    assert.equal(article.scrollOptions, undefined);
    assert.equal(main.scrollCalls.length, 1);
    f.window.setTimeout(() => { main.messageOffset += 350; }, 200);
    await f.advance(300);
    assert.match(copiedDiagnostics(f), /最近定位：定位中/);
    await f.advance(1800);
    assert.equal(article.getBoundingClientRect().top, 172);
    assert.ok(main.scrollCalls.length >= 2);
    assert.match(copiedDiagnostics(f), /最近定位：已确认定位/);
});

test('虚拟列表复用旧节点时，点击按消息身份重新解析目标', async t => {
    const f = fixture(t);
    mockApi(f, () => tree([apiMessage('u1', '相同问题'), apiMessage('u2', '相同问题')]));
    const old = mountedMessage(f, 'u1', '相同问题');
    f.start();
    await f.advance(1500);
    old.firstElementChild.dataset.messageId = 'u2';
    const next = old.cloneNode(true);
    next.firstElementChild.dataset.messageId = 'u1';
    f.document.querySelector('main').append(next);
    // 在 MutationObserver 刷新导航之前点击，模拟真实页面复用 DOM 的窗口期。
    navRoot(f).querySelector('button').click();
    assert.equal(old.scrollOptions, undefined);
    assert.equal(next.scrollOptions.block, 'start');
});

test('重复文本通过嵌套消息ID区分，不误定位到另一问题', async t => {
    const f = fixture(t);
    mockApi(f, () => tree([apiMessage('u1', '重复'), apiMessage('u2', '重复')]));
    const articles = messages(f, ['重复', '重复']);
    articles.forEach((article, index) => {
        const child = f.document.createElement('span');
        child.dataset.messageId = `u${index + 1}`;
        article.firstElementChild.append(child);
    });
    f.start();
    await f.advance(1500);
    navRoot(f).querySelectorAll('button')[1].click();
    assert.equal(articles[0].scrollOptions, undefined);
    assert.equal(articles[1].scrollOptions.block, 'start');
    assert.equal(navRoot(f).querySelectorAll('button').length, 2);
});

test('自身请求403后利用页面成功响应建立完整索引，不消耗原响应', async t => {
    const f = fixture(t);
    const data = tree([apiMessage('u1', '旧问题'), apiMessage('u2', '新问题')]);
    f.window.fetch = async (url, options) => {
        if (String(url).includes('/api/auth/session')) return responseData({ accessToken: 'test-token' });
        if (new Headers(options?.headers).get('chatgpt-account-id')) return responseData(data);
        return { ok: false, status: 403 };
    };
    messages(f, ['新问题']);
    f.start();
    await f.advance(1500);
    assert.match(navRoot(f).querySelector('.status').textContent, /403/);
    const response = await f.window.fetch('/backend-api/conversation/test', {
        headers: { 'chatgpt-account-id': 'workspace-test', 'oai-device-id': 'device-test' },
    });
    assert.equal((await response.json()).current_node, 'u2');
    await f.advance(1500);
    assert.match(navRoot(f).querySelector('.status').textContent, /全部 2/);
});

test('页面分页响应提供工作区上下文后，主动读取携带相同工作区', async t => {
    const f = fixture(t);
    let authorized = 0;
    f.window.fetch = async (url, options) => {
        if (String(url).includes('/api/auth/session')) return responseData({ accessToken: 'test-token' });
        if (String(url).includes('/messages')) return responseData({ messages: [] });
        if (new Headers(options?.headers).get('chatgpt-account-id') === 'workspace-test') {
            authorized++;
            return responseData(tree([apiMessage('u1', '工作区问题')]));
        }
        return { ok: false, status: 403 };
    };
    messages(f, ['工作区问题']);
    f.start();
    await f.advance(1500);
    await f.window.fetch('/backend-api/conversations/test/messages', { headers: { 'chatgpt-account-id': 'workspace-test' } });
    await f.advance(1500);
    assert.equal(authorized, 1);
    assert.match(navRoot(f).querySelector('.status').textContent, /全部 1/);
});

test('旧消息树403仍能通过新版分页获得完整索引', async t => {
    const f = fixture(t);
    const requests = mockApi(f, url => {
        if (url.pathname.includes('/conversation/')) throw new Error('HTTP 403');
        return { messages: [apiMessage('u1', '分页问题')], page_info: { has_previous_page: false } };
    });
    f.start();
    await f.advance(1500);
    assert.match(navRoot(f).querySelector('.status').textContent, /全部 1/);
    assert.equal(requests.length, 3);
});

test('认证401不尝试分页接口', async t => {
    const f = fixture(t);
    const requests = mockApi(f, () => { throw new Error('HTTP 401'); });
    messages(f, ['已加载']);
    f.start();
    await f.advance(10000);
    assert.equal(requests.length, 2);
    assert.match(navRoot(f).querySelector('.status').textContent, /HTTP 401/);
});

test('页面完整分页响应可直接建立索引', async t => {
    const f = fixture(t, { mode: 'off' });
    f.window.fetch = async () => responseData({ messages: [apiMessage('u1', '原生分页问题')],
        page_info: { has_previous_page: false } });
    f.start();
    await f.window.fetch('/backend-api/conversations/test');
    await settlePromises();
    f.menus.get('右侧导航：强制显示备用')();
    await f.advance(1500);
    assert.match(navRoot(f).querySelector('.status').textContent, /全部 1/);
});

test('页面不完整第一页作为分页起点，补齐历史且不重复请求第一页', async t => {
    const f = fixture(t, { mode: 'off' });
    let firstRequests = 0;
    f.window.fetch = async url => {
        if (String(url).includes('/api/auth/session')) return responseData({ accessToken: 'token' });
        if (String(url).includes('/messages?')) return responseData({ messages: [apiMessage('u1', '早期')],
            page_info: { has_previous_page: false } });
        firstRequests++;
        return responseData({ messages: [apiMessage('u2', '近期')],
            page_info: { has_previous_page: true, start_cursor: 'older' } });
    };
    f.start();
    await f.window.fetch('/backend-api/conversations/test');
    await settlePromises();
    f.menus.get('右侧导航：强制显示备用')();
    await f.advance(1500);
    assert.equal(firstRequests, 1);
    assert.match(navRoot(f).querySelector('.status').textContent, /全部 2/);
});

test('原生中间分页不能被当作完整会话起点', async t => {
    const f = fixture(t, { mode: 'off' });
    f.window.fetch = async () => responseData({ messages: [apiMessage('u1', '中间页问题')],
        page_info: { has_previous_page: false } });
    let diagnostics;
    f.window.GM_setClipboard = text => { diagnostics = text; };
    f.start();
    await f.window.fetch('/backend-api/conversations/test/messages?before=cursor');
    await settlePromises();
    f.menus.get('查看脚本状态')();
    f.document.getElementById('cghs-navigation-diagnostics').shadowRoot.querySelector('button').click();
    assert.match(diagnostics, /完整索引：idle/);
    assert.match(diagnostics, /分页消息 1 条/);
});

test('导航默认缩略，悬停展开完整列表，离开后恢复缩略', async t => {
    const f = fixture(t);
    messages(f, ['第一个问题', '第二个问题']);
    f.start();
    const nav = navRoot(f).querySelector('nav');
    assert.equal(nav.dataset.expanded, 'false');
    nav.dispatchEvent(new f.window.Event('mouseenter'));
    assert.equal(nav.dataset.expanded, 'true');
    assert.equal(nav.querySelectorAll('.entry-label').length, 2);
    nav.dispatchEvent(new f.window.Event('mouseleave'));
    await f.advance(80);
    nav.dispatchEvent(new f.window.Event('mouseenter'));
    await f.advance(200);
    assert.equal(nav.dataset.expanded, 'true');
    nav.dispatchEvent(new f.window.Event('mouseleave'));
    await f.advance(200);
    assert.equal(nav.dataset.expanded, 'false');
});

test('键盘进入展开导航，Escape 收起，正常状态不显示状态文字', async t => {
    const f = fixture(t);
    f.window.history.replaceState({}, '', '/');
    messages(f, ['问题']);
    f.start();
    const root = navRoot(f);
    const button = root.querySelector('button');
    button.focus();
    assert.equal(root.querySelector('nav').dataset.expanded, 'true');
    button.dispatchEvent(new f.window.KeyboardEvent('keydown', { key: 'Escape' }));
    assert.equal(root.querySelector('nav').dataset.expanded, 'false');
    assert.equal(root.querySelector('.status').hidden, true);
});

test('展开导航时新增问题保留展开状态与定位功能', async t => {
    const f = fixture(t);
    messages(f, ['原问题']);
    f.start();
    const root = navRoot(f);
    root.querySelector('nav').dispatchEvent(new f.window.Event('mouseenter'));
    const articles = messages(f, ['原问题', '新问题']);
    await f.advance(1500);
    assert.equal(root.querySelector('nav').dataset.expanded, 'true');
    root.querySelectorAll('button')[1].click();
    assert.equal(articles[1].scrollOptions.block, 'start');
});

test('加载中和新增问题同步时不显示状态文字，仅失败时显示错误文字', async t => {
    const f = fixture(t);
    let finishSession;
    f.window.fetch = async (url) => {
        if (String(url).includes('/api/auth/session')) {
            return new Promise(resolve => { finishSession = resolve; });
        }
        return { ok: true, json: async () => ({}) };
    };
    messages(f, ['初始问题']);
    f.start();
    await f.advance(200);
    const root = navRoot(f);
    assert.equal(root.querySelector('.status').hidden, true);
    finishSession({ ok: false, status: 500 });
    await f.advance(1500);
    assert.equal(root.querySelector('.status').hidden, false);
    assert.match(root.querySelector('.status').textContent, /失败/);
});
