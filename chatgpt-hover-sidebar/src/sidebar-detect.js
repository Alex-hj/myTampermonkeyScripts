// 识别左侧栏、展开/收起按钮及桌面环境。
import { CONFIG, LABELS, SIDEBARS } from './config.js';
import { isVisible } from './utils.js';

// 侧栏及其开关按钮所在的窗口左侧区域宽度上限。
function sidebarZoneWidth() {
    return Math.min(420, innerWidth * 0.45);
}

// 贴左边缘且有一定宽度的矩形才可能是侧栏。
function isSidebarShaped(rect) {
    return rect.left < 80 && rect.width >= 160;
}

export function sidebar() {
    const panel = [...document.querySelectorAll(SIDEBARS)].find(element => {
        const rect = element.getBoundingClientRect();
        return isVisible(element) && isSidebarShaped(rect);
    }) || null;
    return sidebarContainer(panel || toggleButton('close')) || panel;
}

function sidebarContainer(element) {
    let container = null;
    const maxWidth = sidebarZoneWidth();
    // 聊天历史 nav 可能只覆盖下半部分；向上寻找包含搜索入口的完整窄栏。
    for (let node = element; node && node !== document.body; node = node.parentElement) {
        if (node === document.documentElement) break;
        const rect = node.getBoundingClientRect();
        if (rect.width > maxWidth) break; // 不把正文或全屏浮层当成侧栏。
        if (isSidebarShaped(rect) && isVisible(node)) container = node;
    }
    return container;
}

function leftButton(element) {
    if (!isVisible(element) || element.disabled) return false;
    if (element.closest('[role="dialog"], [aria-modal="true"]')) return false;
    const rect = element.getBoundingClientRect();
    return rect.left < sidebarZoneWidth() && rect.top < 180;
}

export function toggleButton(action) {
    const exact = document.querySelectorAll(`[data-testid="${action}-sidebar-button"]`);
    const match = [...exact].find(leftButton);
    if (match) return match;
    return [...document.querySelectorAll('button, [role="button"]')].find(element => {
        if (!leftButton(element)) return false;
        const label = ['aria-label', 'title', 'data-tooltip-content']
            .map(name => element.getAttribute(name) || '').join(' ');
        if (LABELS[action].test(label)) return true;
        const controls = element.getAttribute('aria-controls');
        const target = controls && document.getElementById(controls);
        return target?.matches(SIDEBARS)
            && element.getAttribute('aria-expanded') === String(action === 'close');
    }) || null;
}

export function sidebarState() {
    if (sidebar()) return 'open';
    if (toggleButton('close')) return 'open';
    if (toggleButton('open')) return 'closed';
    return 'unknown';
}

export function desktop() {
    return innerWidth >= CONFIG.minimumWidth && (
        matchMedia('(hover: hover) and (pointer: fine)').matches
        || matchMedia('(any-hover: hover) and (any-pointer: fine)').matches);
}
