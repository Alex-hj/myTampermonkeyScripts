// 入口：注册监听、启动刷新循环。
import { CONFIG, MARKER_ID } from './config.js';
import { state } from './state.js';
import { cancelTimer } from './utils.js';
import { configureScheduler, queueRefresh } from './scheduler.js';
import { maintainHistory } from './history-loader.js';
import { observePageRequests } from './request-observer.js';
import { handleSidebarClick } from './sidebar-toggle.js';
import {
    closeFromHover,
    evaluatePointer,
    handlePointer,
    maintainSidebar,
} from './sidebar-controller.js';
import { cancelJump, wakeJumpForMessages } from './jump.js';
import { queueActiveUpdate, refreshNavigation } from './navigation-view.js';
import { registerMenus } from './menus.js';

function refresh() {
    state.refreshTimer = null;
    maintainSidebar();
    maintainHistory();
    refreshNavigation();
}

function start() {
    if (document.getElementById(MARKER_ID)) return;
    const marker = document.createElement('meta');
    marker.id = MARKER_ID;
    document.head.append(marker);
    registerMenus();
    document.addEventListener('click', handleSidebarClick, true);
    // 捕获阶段记录位置，避免页面阻止冒泡后仍用旧坐标判断鼠标是否移出。
    document.addEventListener('pointermove', handlePointer, { passive: true, capture: true });
    // 滚轮和触控板滚动不一定伴随鼠标移动，也需要更新悬停位置。
    document.addEventListener('wheel', handlePointer, { passive: true, capture: true });
    document.documentElement.addEventListener('pointerleave', () => {
        state.pointer = null;
        evaluatePointer();
    });
    window.addEventListener('blur', () => {
        state.pointer = null;
        cancelTimer('openTimer');
        closeFromHover();
    });
    document.addEventListener('scroll', queueActiveUpdate, { passive: true, capture: true });
    window.addEventListener('resize', () => queueRefresh());
    window.addEventListener('popstate', () => queueRefresh());
    document.addEventListener('wheel', cancelJump, { passive: true, capture: true });
    document.addEventListener('touchstart', cancelJump, { passive: true, capture: true });
    document.addEventListener('pointerdown', cancelJump, { passive: true, capture: true });
    document.addEventListener('keydown', event => {
        if (['Escape', 'PageUp', 'PageDown', 'Home', 'End', 'ArrowUp', 'ArrowDown', ' '].includes(event.key)) cancelJump();
    }, true);
    const observer = new MutationObserver(queueRefresh);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true,
        attributeFilter: ['class', 'style', 'aria-expanded', 'aria-hidden', 'data-testid',
            'aria-label', 'title', 'data-tooltip-content', 'aria-controls', 'hidden', 'inert',
            'data-message-id', 'data-message-author-role', 'data-turn-id', 'data-turn-id-container'] });
    // 低频补偿 SPA 替换、延迟 hydration、主题更新和点击未生效的情况。
    setInterval(refresh, CONFIG.refreshPollInterval);
    refresh();
}

if (!document.getElementById(MARKER_ID)) {
    configureScheduler({ onRefresh: refresh, onMutations: wakeJumpForMessages });
    observePageRequests();
    if (document.body) start();
    else document.addEventListener('DOMContentLoaded', start, { once: true });
}
