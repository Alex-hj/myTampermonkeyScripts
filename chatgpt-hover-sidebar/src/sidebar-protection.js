// 编辑、菜单、弹窗打开时暂停自动收起的保护判断。
import { DIAGNOSTICS_ID } from './config.js';
import { isVisible } from './utils.js';
import { sidebar } from './sidebar-detect.js';

// 对话操作菜单/重命名弹窗可能通过 portal 渲染在侧栏外，所以按全页面查找。
function overlayOpen() {
    return [...document.querySelectorAll('[role="menu"], [role="dialog"], [aria-modal="true"]')]
        .some(isVisible);
}

export function interactionProtected() {
    if (document.getElementById(DIAGNOSTICS_ID)) return true;
    const panel = sidebar();
    if (panel?.contains(document.activeElement) && document.activeElement !== document.body) return true;
    return overlayOpen();
}

export function sidebarCloseProtected() {
    if (document.getElementById(DIAGNOSTICS_ID)) return true;
    // 重命名期间即使输入框失焦，也要等编辑结束后才恢复自动收起。
    const editors = sidebar()?.querySelectorAll(
        'input:not([type="hidden"]):not([disabled]):not([readonly]), '
        + 'textarea:not([disabled]):not([readonly]), '
        + '[contenteditable]:not([contenteditable="false"])');
    if (editors && [...editors].some(isVisible)) return true;
    return overlayOpen();
}
