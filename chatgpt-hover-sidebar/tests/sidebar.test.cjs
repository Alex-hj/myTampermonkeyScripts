const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { JSDOM } = require('jsdom');

const source = readFileSync(join(__dirname, '..', 'chatgpt-hover-sidebar.user.js'), 'utf8');

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
        await Promise.resolve();
        for (let count = 0; count < 2000; count++) {
            const next = [...jobs].sort((a, b) => a[1].at - b[1].at)[0];
            if (!next || next[1].at > end) break;
            now = next[1].at;
            jobs.delete(next[0]);
            next[1].callback();
            await Promise.resolve();
            if (count === 1999) throw new Error('Timer loop');
        }
        now = end;
        await Promise.resolve();
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

function pointer(f, x, type = 'mouse') {
    const event = new f.window.Event('pointermove', { bubbles: true });
    Object.assign(event, { clientX: x, clientY: 300, pointerType: type });
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

test('手动打开的侧栏不被悬停逻辑关闭', async t => {
    const f = fixture(t);
    const bar = addSidebar(f);
    f.start();
    await f.advance(1500);
    bar.open.click();
    pointer(f, 800);
    await f.advance(2500);
    assert.equal(bar.panel.hidden, false);
});

test('菜单打开时暂停自动关闭，菜单移除后恢复', async t => {
    const f = fixture(t);
    const bar = addSidebar(f, { open: false });
    f.start();
    pointer(f, 5);
    await f.advance(800);
    const menu = f.document.createElement('div');
    menu.setAttribute('role', 'menu');
    f.document.body.append(menu);
    pointer(f, 800);
    await f.advance(2000);
    assert.equal(bar.panel.hidden, false);
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
    buttons[0].dispatchEvent(new f.window.Event('mouseenter'));
    assert.equal(root.querySelector('.preview').textContent, '<img src=x onerror=alert(1)>');
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
    assert.equal(f.menus.size, 5);
});
