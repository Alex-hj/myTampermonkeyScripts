// 跳转轨迹调试开关：只记录、不改变定位行为。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { fixture, navRoot, longConversation, copiedDiagnostics } = require('./support.cjs');

const MENU_ID = 'cghs-jump-trace';
const LABEL_ON = '✅ 记录跳转轨迹（调试）：开';
const LABEL_OFF = '○ 记录跳转轨迹（调试）：关';
const TRACE_TITLE = '定位轨迹（调试，最近一次）';

// 远处目标 + 异步挂载 + 不等高消息，同时覆盖「搜索」和「校正」两条路径。
async function jumpFar(f) {
    const { main } = longConversation(f, { fromStart: true, renderDelay: 120,
        height: index => index % 7 === 0 ? 2800 : 160 });
    f.start();
    await f.advance(1500);
    navRoot(f).querySelectorAll('button')[243].click();
    await f.advance(12000);
    return main;
}

test('开关默认关闭：菜单显示为关，跳转后诊断信息里没有轨迹', async t => {
    const f = fixture(t);
    await jumpFar(f);
    assert.equal(f.menuLabels.get(MENU_ID), LABEL_OFF);
    const text = copiedDiagnostics(f);
    assert.match(text, /最近定位：已确认定位/);
    assert.doesNotMatch(text, new RegExp(TRACE_TITLE));
});

test('点击菜单开启并保存；再点击关闭', t => {
    const f = fixture(t);
    f.start();
    f.menus.get(MENU_ID)();
    assert.equal(f.menuLabels.get(MENU_ID), LABEL_ON);
    assert.equal(f.storage.get('traceJump'), true);
    f.menus.get(MENU_ID)();
    assert.equal(f.menuLabels.get(MENU_ID), LABEL_OFF);
    assert.equal(f.storage.get('traceJump'), false);
});

test('开启后诊断信息包含每轮检查、搜索与校正滚动，并带外部位移', async t => {
    const f = fixture(t);
    f.storage.set('traceJump', true);
    await jumpFar(f);
    assert.equal(f.menuLabels.get(MENU_ID), LABEL_ON);
    const text = copiedDiagnostics(f);
    assert.match(text, new RegExp(TRACE_TITLE));
    assert.match(text, /\d+ms #\d+ 检查 搜索容器=main\S* st=\d+ sh=\d+ ch=600 外部位移=-/);
    assert.match(text, /目标序号=243\/300 已挂载=\d+\.\.\d+\(\d+个\)/);
    assert.match(text, /搜索 方向=-?1 间隔=\d+ 步幅=\d+\.\d+ 计划st=-?\d+ 边界=(true|false) → st=-?\d+/);
    assert.match(text, /校正 目标top -?\d+→-?\d+ 同一节点=(true|false) 已对齐=(true|false) 稳定帧=\d+ → st=/);
    assert.match(text, /目标=未挂载/);
    assert.match(text, /校正容器=与搜索容器相同/);
});

test('开启轨迹不改变定位行为：滚动序列与定位结果与关闭时完全一致', async t => {
    const off = fixture(t);
    const offMain = await jumpFar(off);
    const on = fixture(t);
    on.storage.set('traceJump', true);
    const onMain = await jumpFar(on);
    assert.ok(offMain.scrollCalls.length > 3);
    assert.deepEqual(onMain.scrollCalls, offMain.scrollCalls);
    const summary = text => text.match(/最近定位：[^\n]+\n定位滚动：[^\n]+/)[0];
    assert.equal(summary(copiedDiagnostics(on)), summary(copiedDiagnostics(off)));
});

test('页面自行移动滚动位置时，下一轮检查的外部位移不为零', async t => {
    const f = fixture(t);
    f.storage.set('traceJump', true);
    const { main } = longConversation(f, { fromStart: true, renderDelay: 120,
        height: index => index % 7 === 0 ? 2800 : 160 });
    f.start();
    await f.advance(1500);
    navRoot(f).querySelectorAll('button')[243].click();
    await f.advance(100);
    // 模拟页面在脚本两次滚动之间自己改变了滚动位置。
    main.scrollTop += 37;
    await f.advance(12000);
    assert.match(copiedDiagnostics(f), /外部位移=37\b/);
});

test('轨迹文本里没有 undefined / NaN 之类的取值错误', async t => {
    const f = fixture(t);
    f.storage.set('traceJump', true);
    await jumpFar(f);
    const text = copiedDiagnostics(f);
    assert.doesNotMatch(text.slice(text.indexOf(TRACE_TITLE)), /undefined|NaN/);
});
