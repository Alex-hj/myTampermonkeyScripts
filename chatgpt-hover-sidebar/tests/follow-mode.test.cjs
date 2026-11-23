// 跳转前让页面退出“跟随底部”：否则页面会在内容变化后把正文拽回底部，定位来回跳。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { fixture, navRoot, addSidebar, pointer, copiedDiagnostics, longConversation } = require('./support.cjs');

// 模拟 ChatGPT：处于“跟随底部”时，脚本每次滚动后页面都把正文拉回底部；
// 收到一次向上滚轮（用户滚动）后才退出该模式。
function followingPage(f, main) {
    const page = { following: true };
    const scrollTo = main.scrollTo;
    main.addEventListener('wheel', event => { if (event.deltaY < 0) page.following = false; });
    main.scrollTo = options => {
        scrollTo(options);
        if (!page.following) return;
        f.window.setTimeout(() => scrollTo({ top: main.scrollHeight - main.clientHeight }), 50);
    };
    return page;
}

test('点击问题后，先向正文派发一次向上滚轮，再开始滚动，且不会取消本次跳转', async t => {
    const f = fixture(t);
    const { main } = longConversation(f);
    const wheels = [];
    main.addEventListener('wheel', event => wheels.push({ deltaY: event.deltaY, bubbles: event.bubbles,
        cancelable: event.cancelable, scrollsBefore: main.scrollCalls.length }));
    f.start();
    await f.advance(1500);
    navRoot(f).querySelectorAll('button')[40].click();
    await f.advance(3000);
    assert.equal(wheels.length, 1);
    assert.ok(wheels[0].deltaY < 0);
    assert.ok(wheels[0].bubbles && wheels[0].cancelable);
    assert.equal(wheels[0].scrollsBefore, 0);
    assert.ok(main.scrollCalls.length > 0, '合成滚轮不应取消跳转');
});

test('页面处于跟随底部时，跳转仍能定位到目标', async t => {
    const f = fixture(t);
    const { main, items } = longConversation(f);
    const page = followingPage(f, main);
    f.start();
    await f.advance(1500);
    navRoot(f).querySelectorAll('button')[40].click();
    await f.advance(8000);
    assert.match(copiedDiagnostics(f), /最近定位：已确认定位/);
    assert.equal(main.scrollTop, items[40].offset - 72);
    assert.equal(page.following, false);
});

test('脚本合成的滚轮不会被当成鼠标位置，侧栏不因此从左边缘展开', async t => {
    const f = fixture(t);
    const bar = addSidebar(f, { open: false });
    longConversation(f);
    f.start();
    await f.advance(1500);
    pointer(f, 600);
    await f.advance(200);
    navRoot(f).querySelectorAll('button')[40].click();
    await f.advance(3000);
    assert.equal(bar.panel.hidden, true);
});
