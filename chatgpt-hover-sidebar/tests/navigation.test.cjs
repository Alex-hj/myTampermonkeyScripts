// 右侧备用导航：原生导航让位、展开交互与键盘操作。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { fixture, messages, nativeNavigation, navRoot } = require('./support.cjs');

test('保留原生导航，自动隐藏备用；强制模式可启用并保存', async t => {
    const f = fixture(t);
    messages(f, ['问题一', '问题二']);
    const native = nativeNavigation(f);
    const original = native.outerHTML;
    f.start();
    assert.equal(f.document.getElementById('cghs-navigation'), null);
    f.menus.get('cghs-mode-always')();
    const host = f.document.getElementById('cghs-navigation');
    assert.equal(host.hidden, false);
    assert.equal(host.shadowRoot.querySelectorAll('button').length, 2);
    assert.equal(native.outerHTML, original);
    assert.equal(f.storage.get('navigationMode'), 'always');
    f.menus.get('cghs-mode-off')();
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

test('展开导航面板包含滚动条样式且缩略状态隐藏滚动条', async t => {
    const f = fixture(t);
    messages(f, ['测试问题']);
    f.start();
    const style = navRoot(f).querySelector('style').textContent;
    assert.match(style, /scrollbar-width:\s*thin/);
    assert.match(style, /nav\[data-expanded="true"\] \.list::-webkit-scrollbar/);
    assert.match(style, /nav:not\(\[data-expanded="true"\]\) \.list::-webkit-scrollbar/);
});
