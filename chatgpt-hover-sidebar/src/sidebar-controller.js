// 左侧栏启动收起与鼠标悬停展开/移出收起。
import { CONFIG } from './config.js';
import { state } from './state.js';
import { cancelTimer } from './utils.js';
import { desktop, sidebar, sidebarState } from './sidebar-detect.js';
import { interactionProtected, sidebarCloseProtected } from './sidebar-protection.js';
import { clickToggle, settleToggle } from './sidebar-toggle.js';

export function maintainSidebar() {
    if (!desktop()) return;
    const current = sidebarState();
    settleToggle(current);
    if (state.startup) {
        if (current === 'closed' && !state.pending) {
            state.closedSince ??= Date.now();
            if (Date.now() - state.closedSince >= CONFIG.startupStableDelay) state.startup = false;
        } else {
            state.closedSince = null;
            if (current === 'open' && !sidebarCloseProtected()) clickToggle('close');
        }
        return;
    }
    if (state.owned && current === 'closed' && !state.pending) state.owned = false;
    evaluatePointer();
}

function openFromEdge() {
    state.openTimer = null;
    if (!desktop() || !state.pointer || state.pointer.x > CONFIG.edgeWidth) return;
    if (state.startup || interactionProtected() || sidebarState() !== 'closed') return;
    if (clickToggle('open')) state.owned = true;
}

export function closeFromHover() {
    state.closeTimer = null;
    // 延时期间可能刚进入重命名，执行关闭前必须再次检查。
    if (!desktop() || pointerInside() || sidebarState() !== 'open' || sidebarCloseProtected()) return;
    clickToggle('close');
}

function pointerInside() {
    if (!state.pointer) return false;
    const panel = sidebar();
    const rect = panel?.getBoundingClientRect()
        || { left: 0, right: 320, top: 0, bottom: innerHeight };
    return state.pointer.x >= rect.left && state.pointer.x <= rect.right + CONFIG.sidebarPadding
        && state.pointer.y >= rect.top && state.pointer.y <= rect.bottom;
}

export function evaluatePointer() {
    if (!desktop()) return;
    const current = sidebarState();
    const atEdge = state.pointer && state.pointer.x <= CONFIG.edgeWidth;
    if (atEdge && current === 'closed' && !state.startup && !state.openTimer) {
        state.openTimer = setTimeout(openFromEdge, CONFIG.openDelay);
    }
    if (!atEdge) cancelTimer('openTimer');
    if (current !== 'open' || pointerInside() || sidebarCloseProtected()) {
        cancelTimer('closeTimer');
        return;
    }
    if (!state.closeTimer) state.closeTimer = setTimeout(closeFromHover, CONFIG.closeDelay);
}

export function handlePointer(event) {
    if (event.pointerType && event.pointerType !== 'mouse') return;
    state.pointer = { x: event.clientX, y: event.clientY };
    // 每次移动仅更新坐标；DOM 查询限制为每帧一次。
    if (state.pointerFrame) return;
    state.pointerFrame = requestAnimationFrame(() => {
        state.pointerFrame = 0;
        evaluatePointer();
    });
}
