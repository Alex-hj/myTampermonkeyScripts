// 左侧栏自动功能的菜单开关：关闭后启动收起、边缘悬停展开、移出收起都停用。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { fixture, addSidebar, pointer, CLOSE_WAIT } = require('./support.cjs');

const MENU_ID = 'cghs-sidebar-auto';
const LABEL_ON = '✅ 左侧栏悬停展开与自动收起：开';
const LABEL_OFF = '○ 左侧栏悬停展开与自动收起：关';

test('菜单开关默认开启；点击后关闭并保存', t => {
    const f = fixture(t);
    f.start();
    assert.equal(f.menuLabels.get(MENU_ID), LABEL_ON);
    f.menus.get(MENU_ID)();
    assert.equal(f.menuLabels.get(MENU_ID), LABEL_OFF);
    assert.equal(f.storage.get('sidebarAuto'), false);
});

test('关闭后：边缘悬停不展开，展开的侧栏移出和窗口失焦都不收起', async t => {
    const f = fixture(t);
    const bar = addSidebar(f);
    f.start();
    await f.advance(1500);
    assert.equal(bar.panel.hidden, true);
    f.menus.get(MENU_ID)();
    pointer(f, 5);
    await f.advance(800);
    assert.equal(bar.panel.hidden, true, '关闭后左边缘悬停不应展开');
    bar.open.click();
    pointer(f, 600);
    await f.advance(2500);
    assert.equal(bar.panel.hidden, false, '关闭后鼠标移出不应收起');
    f.window.dispatchEvent(new f.window.Event('blur'));
    await f.advance(CLOSE_WAIT);
    assert.equal(bar.panel.hidden, false, '关闭后窗口失焦不应收起');
    assert.equal(bar.clicks(), 1, '只有启动阶段的那一次收起');
});

test('关闭后再次点击菜单可重新开启，悬停展开与移出收起恢复', async t => {
    const f = fixture(t);
    const bar = addSidebar(f);
    f.start();
    await f.advance(1500);
    f.menus.get(MENU_ID)();
    bar.open.click();
    pointer(f, 600);
    await f.advance(2500);
    assert.equal(bar.panel.hidden, false);
    f.menus.get(MENU_ID)();
    assert.equal(f.menuLabels.get(MENU_ID), LABEL_ON);
    assert.equal(f.storage.get('sidebarAuto'), true);
    await f.advance(2500);
    assert.equal(bar.panel.hidden, true, '重新开启后移出收起恢复');
    pointer(f, 5);
    await f.advance(800);
    assert.equal(bar.panel.hidden, false, '重新开启后边缘悬停展开恢复');
});

test('已保存为关闭时启动脚本：菜单显示为关，已展开的侧栏不会被收起', async t => {
    const f = fixture(t);
    f.storage.set('sidebarAuto', false);
    const bar = addSidebar(f);
    f.start();
    assert.equal(f.menuLabels.get(MENU_ID), LABEL_OFF);
    await f.advance(3000);
    assert.equal(bar.panel.hidden, false, '关闭时不做启动收起');
    pointer(f, 600);
    await f.advance(2500);
    assert.equal(bar.panel.hidden, false, '关闭时不做移出收起');
    assert.equal(bar.clicks(), 0);
});

test('启动收起尚未完成时关闭开关：不再继续重试收起', async t => {
    const f = fixture(t);
    const bar = addSidebar(f, { ignoreClicks: 2 });
    f.start();
    assert.equal(bar.clicks(), 1, '启动时已点击一次，页面尚未响应');
    f.menus.get(MENU_ID)();
    await f.advance(4000);
    assert.equal(bar.clicks(), 1);
    assert.equal(bar.panel.hidden, false);
});

test('关闭后「立即收起左侧栏」仍可手动收起，且不会恢复自动展开', async t => {
    const f = fixture(t);
    f.storage.set('sidebarAuto', false);
    const bar = addSidebar(f);
    f.start();
    await f.advance(1500);
    assert.equal(bar.panel.hidden, false);
    f.menus.get('立即收起左侧栏')();
    await f.advance(2500);
    assert.equal(bar.panel.hidden, true);
    pointer(f, 5);
    await f.advance(800);
    assert.equal(bar.panel.hidden, true, '手动收起后边缘悬停仍不展开');
});
