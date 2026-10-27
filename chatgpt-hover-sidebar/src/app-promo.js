// 自动关闭首页的「下载应用」引导弹窗：弹窗一出现就点它自带的关闭按钮，不删除页面节点。
import { APP_PROMO } from './config.js';
import { readSetting, writeSetting } from './storage.js';

const SETTING_KEY = 'closeAppPromo';

// 菜单开关：默认开启，只有明确保存为 false 才关闭。每次点关闭按钮前都会检查，所以切换后立即生效、无需刷新页面。
let enabled = readSetting(SETTING_KEY, true) !== false;

// 每个弹窗节点只点一次：同一批变化里弹窗可能被命中多次，关闭动画期间节点也还留在页面里。
const handled = new WeakSet();

export function isAppPromoEnabled() {
    return enabled;
}

export function toggleAppPromo() {
    enabled = !enabled;
    writeSetting(SETTING_KEY, enabled);
}

function findPromo(root) {
    if (root.matches?.(APP_PROMO.dialog)) return root;
    return root.querySelector?.(APP_PROMO.dialog) ?? null;
}

function dismissPromoIn(root) {
    if (!enabled) return;
    const dialog = findPromo(root);
    if (!dialog || handled.has(dialog)) return;
    const closeButton = dialog.querySelector(APP_PROMO.closeButton);
    if (!closeButton) return;
    handled.add(dialog);
    closeButton.click();
}

// 弹窗在页面仍处于 loading 时就会出现，所以要在 document-start 立即监听，不能等 DOMContentLoaded。
export function observeAppPromo() {
    new MutationObserver(mutations => {
        for (const { addedNodes } of mutations) addedNodes.forEach(node => dismissPromoIn(node));
    }).observe(document, { childList: true, subtree: true });
    dismissPromoIn(document);
}
