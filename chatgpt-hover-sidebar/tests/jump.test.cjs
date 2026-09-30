// 点击问题后的滚动定位。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { fixture, messages, apiMessage, tree, mockApi, navRoot, mountedMessage, virtualScroller, geometricScroller, copiedDiagnostics, currentTurns, hiddenConversationCache, scrolledFromTop, longConversation } = require('./support.cjs');

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

test('300个问题的远距离跳转在有限滚动内完成，最终按消息ID对齐', async t => {
    const f = fixture(t);
    const { main, items } = longConversation(f);
    f.start();
    await f.advance(1500);
    navRoot(f).querySelectorAll('button')[40].click();
    await f.advance(8000);
    assert.match(copiedDiagnostics(f), /最近定位：已确认定位/);
    assert.equal(main.scrollTop, items[40].offset - 72);
    assert.ok(main.scrollCalls.length < 50, `实际滚动 ${main.scrollCalls.length} 次`);
    assert.match(copiedDiagnostics(f), /定位滚动：\d+ 次，耗时 \d+ ms/);
    t.diagnostic(copiedDiagnostics(f).match(/定位滚动：[^\n]+/)[0]);
});

test('异步挂载和不等高消息下向后搜索，跨过目标后缩小步幅准确定位', async t => {
    const f = fixture(t);
    const { main, items } = longConversation(f, { fromStart: true, renderDelay: 120,
        height: index => index % 7 === 0 ? 2800 : 160 });
    f.start();
    await f.advance(1500);
    navRoot(f).querySelectorAll('button')[243].click();
    await f.advance(12000);
    assert.match(copiedDiagnostics(f), /最近定位：已确认定位/);
    assert.equal(main.scrollTop, items[243].offset - 72);
    assert.ok(main.scrollCalls.some((top, index, calls) => index > 0 && top < calls[index - 1]));
    assert.ok(main.scrollCalls.length < 60, `实际滚动 ${main.scrollCalls.length} 次`);
    t.diagnostic(copiedDiagnostics(f).match(/定位滚动：[^\n]+/)[0]);
});

test('目标挂载后提前唤醒搜索，不等待固定轮询间隔', async t => {
    const f = fixture(t);
    const { main, items } = longConversation(f, { renderDelay: 30 });
    f.start();
    await f.advance(1500);
    navRoot(f).querySelectorAll('button')[297].click();
    await f.advance(250);
    assert.equal(main.scrollTop, items[297].offset - 72);
});

test('虚拟窗口暂时清空时等待挂载，随后继续远距离定位', async t => {
    const f = fixture(t);
    const { main, items } = longConversation(f, { renderDelay: 180, emptyWhileLoading: true });
    f.start();
    await f.advance(1500);
    navRoot(f).querySelectorAll('button')[40].click();
    await f.advance(12000);
    assert.match(copiedDiagnostics(f), /最近定位：已确认定位/);
    assert.equal(main.scrollTop, items[40].offset - 72);
    assert.ok(main.scrollCalls.length < 50, `实际滚动 ${main.scrollCalls.length} 次`);
});

test('到达历史边界后等待加载，消息到达时继续定位', async t => {
    const f = fixture(t);
    mockApi(f, () => tree([apiMessage('u1', '早期'), apiMessage('u2', '近期')]));
    mountedMessage(f, 'u2', '近期');
    let scrolls = 0;
    const main = virtualScroller(f, () => {
        if (++scrolls === 1) f.window.setTimeout(() => mountedMessage(f, 'u1', '早期'), 500);
    });
    main.scrollTop = 0;
    f.start();
    await f.advance(1500);
    navRoot(f).querySelector('button').click();
    await f.advance(400);
    assert.equal(scrolls, 1);
    await f.advance(1200);
    assert.match(copiedDiagnostics(f), /最近定位：已确认定位/);
});

test('已对齐且稳定的消息不重复滚动', async t => {
    const f = fixture(t);
    const [article] = messages(f, ['稳定目标']);
    const main = geometricScroller(f, article);
    f.start();
    navRoot(f).querySelector('button').click();
    await f.advance(1200);
    assert.equal(main.scrollCalls.length, 1);
    assert.match(copiedDiagnostics(f), /最近定位：已确认定位/);
});

test('连续点击远处问题只完成最后一次定位', async t => {
    const f = fixture(t);
    const { main, items } = longConversation(f, { renderDelay: 120 });
    f.start();
    await f.advance(1500);
    const buttons = navRoot(f).querySelectorAll('button');
    buttons[40].click();
    await f.advance(100);
    buttons[210].click();
    await f.advance(8000);
    assert.match(copiedDiagnostics(f), /最近定位：已确认定位/);
    assert.equal(main.scrollTop, items[210].offset - 72);
    const count = main.scrollCalls.length;
    await f.advance(1500);
    assert.equal(main.scrollCalls.length, count);
});

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

test('当前页面结构：按消息块 key 识别用户问题，助手消息不计入目录', async t => {
    const f = fixture(t);
    const { main, items } = longConversation(f, { current: true });
    f.start();
    await f.advance(1500);
    assert.equal(navRoot(f).querySelectorAll('button').length, 300);
    navRoot(f).querySelectorAll('button')[40].click();
    await f.advance(8000);
    assert.match(copiedDiagnostics(f), /最近定位：已确认定位/);
    assert.equal(main.scrollTop, items[40].offset - 72);
});

test('当前页面结构：重复文本通过消息块 ID 区分，不误定位到另一问题', async t => {
    const f = fixture(t);
    mockApi(f, () => tree([apiMessage('u1', '重复'), apiMessage('u2', '重复')]));
    const turns = currentTurns(f, [{ id: 'u1', text: '重复' }, { id: 'u2', text: '重复' }]);
    f.start();
    await f.advance(1500);
    navRoot(f).querySelectorAll('button')[1].click();
    assert.equal(turns[0].scrollOptions, undefined);
    assert.equal(turns[1].scrollOptions.block, 'start');
    assert.equal(navRoot(f).querySelectorAll('button').length, 2);
});

test('反向滚动容器：从底部向上远距离跳转，按消息 ID 对齐', async t => {
    const f = fixture(t);
    const { main, items } = longConversation(f, { current: true, reversed: true });
    f.start();
    await f.advance(1500);
    navRoot(f).querySelectorAll('button')[40].click();
    await f.advance(8000);
    assert.match(copiedDiagnostics(f), /最近定位：已确认定位/);
    assert.equal(scrolledFromTop(main), items[40].offset - 72);
    assert.ok(main.scrollCalls.length < 50, `实际滚动 ${main.scrollCalls.length} 次`);
});

test('反向滚动容器：从顶部向下异步挂载定位，跨过目标后缩小步幅', async t => {
    const f = fixture(t);
    const { main, items } = longConversation(f, { current: true, reversed: true, fromStart: true,
        renderDelay: 120, height: index => index % 7 === 0 ? 2800 : 160 });
    f.start();
    await f.advance(1500);
    navRoot(f).querySelectorAll('button')[243].click();
    await f.advance(12000);
    assert.match(copiedDiagnostics(f), /最近定位：已确认定位/);
    assert.equal(scrolledFromTop(main), items[243].offset - 72);
    assert.ok(main.scrollCalls.length < 60, `实际滚动 ${main.scrollCalls.length} 次`);
});

test('反向滚动容器：跳转到最早的问题时在顶部边界确认对齐', async t => {
    const f = fixture(t);
    const { main } = longConversation(f, { current: true, reversed: true });
    f.start();
    await f.advance(1500);
    navRoot(f).querySelectorAll('button')[0].click();
    await f.advance(8000);
    assert.match(copiedDiagnostics(f), /最近定位：已确认定位/);
    assert.equal(scrolledFromTop(main), 0);
});

test('页面保留隐藏的其他会话缓存：缓存里的消息不计入问题目录', async t => {
    const f = fixture(t);
    mockApi(f, () => tree([apiMessage('u1', '问题 1'), apiMessage('u2', '问题 2')]));
    hiddenConversationCache(f, ['缓存会话问题 A', '缓存会话问题 B']);
    currentTurns(f, [{ id: 'u1', text: '问题 1' }, { id: 'u2', text: '问题 2' }]);
    f.start();
    await f.advance(1500);
    const labels = [...navRoot(f).querySelectorAll('button')].map(button => button.title);
    assert.deepEqual(labels, ['问题 1', '问题 2']);
});

test('页面保留隐藏的其他会话缓存：远距离定位仍滚动当前会话的容器', async t => {
    const f = fixture(t);
    const { main, items } = longConversation(f, { current: true, reversed: true });
    // 真实页面没有 data-scroll-root，滚动容器只能从第一个渲染出来的消息向上查找。
    main.removeAttribute('data-scroll-root');
    // 真实页面里整页元素没有可滚动范围，对它滚动不会有任何效果。
    f.document.documentElement.scrollTo = () => {};
    hiddenConversationCache(f, ['缓存会话问题 A', '缓存会话问题 B']);
    f.start();
    await f.advance(1500);
    navRoot(f).querySelectorAll('button')[40].click();
    await f.advance(8000);
    assert.match(copiedDiagnostics(f), /最近定位：已确认定位/);
    assert.equal(scrolledFromTop(main), items[40].offset - 72);
});
