// 「下载应用」引导弹窗：出现后自动点它自带的关闭按钮，只处理这一个弹窗。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { settlePromises, fixture } = require('./support.cjs');

const PROMO_CLASS = 'codex-dialog z-50 fixed beacon-modal-post_work_tab_onboarding_homepage_modal';
const MENU_ID = 'cghs-app-promo';
const LABEL_ON = '✅ 自动关闭「下载应用」弹窗：开';
const LABEL_OFF = '○ 自动关闭「下载应用」弹窗：关';

// 按实站抓取的结构搭建：根节点 role=dialog，内容区里有「下载应用」按钮，
// 右上角关闭按钮是根节点的直接子按钮，文案只在 sr-only 里。
// closes 为 false 时关闭后节点仍留在页面里，模拟关闭动画期间。
function promoDialog(f, { className = PROMO_CLASS, closes = true } = {}) {
    const root = f.document.createElement('div');
    root.setAttribute('role', 'dialog');
    root.className = className;
    const content = f.document.createElement('div');
    const download = f.document.createElement('button');
    download.textContent = '下载应用';
    content.append(download);
    const close = f.document.createElement('button');
    close.innerHTML = '<svg></svg><span class="sr-only">关闭对话框</span>';
    root.append(content, close);
    const clicks = { download: 0, close: 0 };
    download.addEventListener('click', () => { clicks.download++; });
    close.addEventListener('click', () => {
        clicks.close++;
        if (closes) root.remove();
    });
    return { root, close, clicks };
}

test('弹窗出现后自动点击关闭按钮，不点「下载应用」', async t => {
    const f = fixture(t);
    f.start();
    const promo = promoDialog(f);
    f.document.body.append(promo.root);
    await settlePromises();
    assert.deepEqual(promo.clicks, { download: 0, close: 1 });
    assert.equal(promo.root.isConnected, false);
});

test('脚本启动时弹窗已经在页面里，也会被关闭', t => {
    const f = fixture(t);
    const promo = promoDialog(f);
    f.document.body.append(promo.root);
    f.start();
    assert.deepEqual(promo.clicks, { download: 0, close: 1 });
});

test('弹窗随外层容器一起插入、关闭动画期间被重新挂载，都只点击一次', async t => {
    const f = fixture(t);
    f.start();
    const promo = promoDialog(f, { closes: false });
    const wrapper = f.document.createElement('div');
    f.document.body.append(wrapper);
    wrapper.append(promo.root);
    await settlePromises();
    assert.equal(promo.clicks.close, 1);
    f.document.body.append(promo.root);
    await settlePromises();
    assert.equal(promo.clicks.close, 1);
});

test('不处理其它对话框、另一个引导弹窗和只带引导类名的非对话框节点', async t => {
    const f = fixture(t);
    f.start();
    const ordinary = promoDialog(f, { className: 'codex-dialog z-50 fixed' });
    const otherBeacon = promoDialog(f, { className: 'codex-dialog beacon-modal-other_onboarding_modal' });
    const overlay = promoDialog(f);
    overlay.root.removeAttribute('role');
    f.document.body.append(ordinary.root, otherBeacon.root, overlay.root);
    await settlePromises();
    for (const item of [ordinary, otherBeacon, overlay]) {
        assert.deepEqual(item.clicks, { download: 0, close: 0 });
        assert.equal(item.root.isConnected, true);
    }
});

test('菜单开关默认开启；点击后关闭并保存，之后出现的弹窗不再被点击', async t => {
    const f = fixture(t);
    f.start();
    assert.equal(f.menuLabels.get(MENU_ID), LABEL_ON);
    f.menus.get(MENU_ID)();
    assert.equal(f.menuLabels.get(MENU_ID), LABEL_OFF);
    assert.equal(f.storage.get('closeAppPromo'), false);
    const promo = promoDialog(f);
    f.document.body.append(promo.root);
    await settlePromises();
    assert.deepEqual(promo.clicks, { download: 0, close: 0 });
    assert.equal(promo.root.isConnected, true);
});

test('关闭后再次点击菜单可重新开启，之后出现的弹窗又会被关闭', async t => {
    const f = fixture(t);
    f.start();
    f.menus.get(MENU_ID)();
    f.menus.get(MENU_ID)();
    assert.equal(f.menuLabels.get(MENU_ID), LABEL_ON);
    assert.equal(f.storage.get('closeAppPromo'), true);
    const promo = promoDialog(f);
    f.document.body.append(promo.root);
    await settlePromises();
    assert.deepEqual(promo.clicks, { download: 0, close: 1 });
});

test('已保存为关闭时重新启动脚本：菜单显示为关，已存在和新出现的弹窗都不处理', async t => {
    const f = fixture(t);
    f.storage.set('closeAppPromo', false);
    const existing = promoDialog(f);
    f.document.body.append(existing.root);
    f.start();
    assert.equal(f.menuLabels.get(MENU_ID), LABEL_OFF);
    const later = promoDialog(f);
    f.document.body.append(later.root);
    await settlePromises();
    assert.deepEqual(existing.clicks, { download: 0, close: 0 });
    assert.deepEqual(later.clicks, { download: 0, close: 0 });
});

test('找不到关闭按钮时不报错也不乱点其它按钮', async t => {
    const f = fixture(t);
    const errors = [];
    f.window.addEventListener('error', event => errors.push(event.message));
    f.start();
    const promo = promoDialog(f);
    promo.close.remove();
    f.document.body.append(promo.root);
    await settlePromises();
    assert.deepEqual(promo.clicks, { download: 0, close: 0 });
    assert.deepEqual(errors, []);
});
