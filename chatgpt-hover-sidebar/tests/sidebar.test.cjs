// 左侧栏：启动收起、边缘悬停展开、移出收起与各类保护。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { fixture, addSidebar, pointer, CLOSE_WAIT } = require('./support.cjs');

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

test('搜索入口在历史 nav 外时，悬停搜索保持展开，移出完整侧栏才关闭', async t => {
    for (const withHistoryNav of [true, false]) {
        const f = fixture(t);
        const bar = addSidebar(f);
        bar.panel.id = 'new-sidebar-shell';
        const search = f.document.createElement('button');
        search.textContent = '搜索聊天';
        search.dataset.top = '60';
        bar.panel.append(search);
        if (withHistoryNav) {
            const history = f.document.createElement('nav');
            history.setAttribute('aria-label', 'Chat history');
            Object.assign(history.dataset, { top: '150', width: '280', height: '550' });
            bar.panel.append(history);
        }
        f.start();
        await f.advance(1500);
        pointer(f, 5);
        await f.advance(800);
        pointer(f, 100, 'mouse', 75);
        await f.advance(1500);
        assert.equal(bar.panel.hidden, false, '未点击搜索时保持展开');
        pointer(f, 281, 'mouse', 75);
        await f.advance(CLOSE_WAIT);
        assert.equal(bar.panel.hidden, true, '离开完整侧栏后仍自动收起');
    }
});

test('侧栏外层包含正文时，不扩大到整个页面', async t => {
    const f = fixture(t);
    const bar = addSidebar(f);
    const layout = f.document.createElement('div');
    Object.assign(layout.dataset, { width: '1400', height: '900' });
    f.document.body.append(layout);
    layout.append(bar.panel, f.document.querySelector('main'));
    f.start();
    await f.advance(1500);
    pointer(f, 5);
    await f.advance(800);
    pointer(f, 600);
    await f.advance(CLOSE_WAIT);
    assert.equal(bar.panel.hidden, true);
});

test('菜单打开时暂停收起，关闭菜单后恢复', async t => {
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
    assert.equal(bar.panel.hidden, false);
    menu.remove();
    await f.advance(1800);
    assert.equal(bar.panel.hidden, true);
});

test('重命名输入框和富文本编辑结束前不收起，包括失焦时', async t => {
    for (const tag of ['input', 'textarea', 'div']) {
        const f = fixture(t);
        const bar = addSidebar(f, { open: false });
        f.start();
        await f.advance(1500);
        pointer(f, 5);
        await f.advance(800);
        pointer(f, 800);
        await f.advance(100);
        const editor = f.document.createElement(tag);
        if (tag === 'div') {
            editor.setAttribute('contenteditable', 'true');
            editor.tabIndex = 0;
        }
        bar.panel.append(editor);
        editor.focus();
        await f.advance(2000);
        assert.equal(bar.panel.hidden, false);
        editor.blur();
        await f.advance(1000);
        assert.equal(bar.panel.hidden, false);
        editor.remove();
        await f.advance(1800);
        assert.equal(bar.panel.hidden, true);
    }
});

test('启动时正在重命名也不会强制收起', async t => {
    const f = fixture(t);
    const bar = addSidebar(f);
    const editor = f.document.createElement('input');
    bar.panel.append(editor);
    editor.focus();
    f.start();
    await f.advance(1500);
    assert.equal(bar.panel.hidden, false);
    editor.remove();
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

test('新版显示/隐藏标签支持启动收起、悬停展开和离开收起', async t => {
    for (const [openText, closeText] of [
        ['显示侧边栏', '隐藏侧边栏'], ['顯示側邊欄', '隱藏側邊欄'], ['Show sidebar', 'Hide sidebar'],
    ]) {
        const f = fixture(t);
        const bar = addSidebar(f);
        bar.open.removeAttribute('data-testid');
        bar.close.removeAttribute('data-testid');
        bar.open.setAttribute('aria-label', openText);
        bar.close.setAttribute('aria-label', closeText);
        f.start();
        await f.advance(1800);
        assert.equal(bar.panel.hidden, true);
        pointer(f, 20);
        await f.advance(800);
        assert.equal(bar.panel.hidden, false);
        pointer(f, 600);
        await f.advance(1500);
        assert.equal(bar.panel.hidden, true);
    }
});

test('诊断中的显示侧边栏和多个隐藏副本不会让启动卡在 unknown', async t => {
    const f = fixture(t);
    const bar = addSidebar(f, { open: false });
    bar.open.removeAttribute('data-testid');
    bar.close.removeAttribute('data-testid');
    bar.open.setAttribute('aria-label', '显示侧边栏');
    bar.close.setAttribute('aria-label', '隐藏侧边栏');
    let wrongClicks = 0;
    for (const attribute of ['hidden', 'aria-hidden', 'inert']) {
        const wrapper = f.document.createElement('div');
        wrapper.setAttribute(attribute, 'true');
        for (const label of ['显示侧边栏', '隐藏侧边栏']) {
            const button = f.document.createElement('button');
            button.setAttribute('aria-label', label);
            button.addEventListener('click', () => { wrongClicks++; });
            wrapper.append(button);
        }
        f.document.body.prepend(wrapper);
    }
    f.start();
    await f.advance(1800);
    pointer(f, 20);
    await f.advance(800);
    assert.equal(bar.panel.hidden, false);
    pointer(f, 600);
    await f.advance(1500);
    assert.equal(bar.panel.hidden, true);
    assert.equal(wrongClicks, 0);
});

test('页面只更新按钮标签时及时重新识别并收起', async t => {
    const f = fixture(t);
    const bar = addSidebar(f);
    bar.open.removeAttribute('data-testid');
    bar.close.removeAttribute('data-testid');
    f.start();
    await f.advance(100);
    assert.equal(bar.panel.hidden, false);
    bar.close.setAttribute('aria-label', '隐藏侧边栏');
    await f.advance(200);
    assert.equal(bar.panel.hidden, true);
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
    await f.advance(CLOSE_WAIT);
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
    await f.advance(CLOSE_WAIT);
    assert.equal(bar.panel.hidden, false);
    pointer(f, 100, 'mouse', 701);
    await f.advance(CLOSE_WAIT);
    assert.equal(bar.panel.hidden, true);
});

test('页面拦截侧栏鼠标移动冒泡时仍更新位置并取消收起', async t => {
    const f = fixture(t);
    const bar = addSidebar(f);
    f.start();
    await f.advance(1500);
    pointer(f, 5);
    await f.advance(800);
    pointer(f, 600);
    await f.advance(100);
    bar.panel.addEventListener('pointermove', event => event.stopPropagation());
    const move = new f.window.Event('pointermove', { bubbles: true });
    Object.assign(move, { clientX: 100, clientY: 300, pointerType: 'mouse' });
    bar.panel.dispatchEvent(move);
    await f.advance(1500);
    assert.equal(bar.panel.hidden, false, '鼠标已经返回侧栏，旧关闭任务不能继续收起');
    pointer(f, 600);
    await f.advance(CLOSE_WAIT);
    assert.equal(bar.panel.hidden, true, '实际移出后仍正常收起');
});

test('鼠标坐标过期时在侧栏滚动仍保持展开，正文滚动恢复收起', async t => {
    const f = fixture(t);
    const bar = addSidebar(f);
    f.start();
    await f.advance(1500);
    pointer(f, 5);
    await f.advance(800);
    pointer(f, 600);
    await f.advance(100);
    bar.panel.addEventListener('wheel', event => event.stopPropagation());
    bar.panel.dispatchEvent(new f.window.WheelEvent('wheel', {
        bubbles: true, clientX: 100, clientY: 300, deltaY: 100,
    }));
    await f.advance(1500);
    assert.equal(bar.panel.hidden, false, '无需再次移动鼠标，滚轮位置应覆盖旧坐标');
    f.document.querySelector('main').dispatchEvent(new f.window.WheelEvent('wheel', {
        bubbles: true, clientX: 600, clientY: 300, deltaY: 100,
    }));
    await f.advance(CLOSE_WAIT);
    assert.equal(bar.panel.hidden, true, '正文区域的滚动不能让侧栏一直保持展开');
});

test('移出侧栏后先保持展开，超过收起延时才收起', async t => {
    const f = fixture(t);
    const bar = addSidebar(f);
    f.start();
    await f.advance(1500);
    pointer(f, 5);
    await f.advance(800);
    pointer(f, 600);
    await f.advance(400);
    assert.equal(bar.panel.hidden, false, '收起延时内仍应保持展开');
    await f.advance(CLOSE_WAIT);
    assert.equal(bar.panel.hidden, true, '超过收起延时后应收起');
});
