// 脚本整体行为：重复注入与诊断窗口。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { settlePromises, fixture, messages, mockApi, navRoot, copiedDiagnostics } = require('./support.cjs');

test('重复注入不会重复注册菜单或创建导航', t => {
    const f = fixture(t);
    messages(f, ['问题']);
    f.start();
    f.start();
    assert.equal(f.document.querySelectorAll('#cghs-navigation').length, 1);
    assert.equal(f.menus.size, 6);
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

test('诊断显示脚本管理器提供的版本号，没有 GM_info 时显示未知', t => {
    const f = fixture(t);
    f.start();
    assert.match(copiedDiagnostics(f), /脚本版本：未知/);
    f.window.GM_info = { script: { version: '9.9.9' } };
    assert.match(copiedDiagnostics(f), /脚本版本：9\.9\.9/);
});
