// 检测页面原生右侧导航，决定备用导航是否让位。
import { CONFIG } from './config.js';
import { state } from './state.js';
import { isVisible } from './utils.js';

function navigationCandidates() {
    const selectors = [
        '[data-testid="conversation-navigation"]', '[data-testid="conversation-turns-navigation"]',
        '[data-testid="conversation-timeline"]', 'nav[aria-label]', '[role="navigation"][aria-label]',
        '[aria-label*="timeline" i]', '[aria-label*="对话导航"]', '[aria-label*="對話導覽"]',
    ];
    if (CONFIG.nativeNavigationSelector) selectors.push(CONFIG.nativeNavigationSelector);
    try { return [...document.querySelectorAll(selectors.join(','))]; }
    catch { return []; }
}

function nativeNavigationVisible() {
    return navigationCandidates().some(element => {
        if (element === state.host || !isVisible(element)) return false;
        const rect = element.getBoundingClientRect();
        return rect.left > innerWidth * 0.65 && rect.width < innerWidth * 0.35;
    });
}

// 关闭模式，或自动模式下原生导航可见/刚消失不久时，备用导航让位。
export function navigationSuppressed() {
    if (state.mode === 'off') return true;
    const nativeVisible = nativeNavigationVisible();
    if (nativeVisible) state.nativeSeenAt = Date.now();
    return state.mode === 'auto'
        && (nativeVisible || Date.now() - state.nativeSeenAt < CONFIG.nativeNavigationGrace);
}
