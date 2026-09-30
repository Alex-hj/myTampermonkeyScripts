// 点击侧栏开关并确认结果。
import { CONFIG } from './config.js';
import { state } from './state.js';
import { toggleButton } from './sidebar-detect.js';

export function clickToggle(action) {
    if (state.pending || Date.now() < state.cooldown) return false;
    const button = toggleButton(action);
    if (!button) return false;
    state.pending = { action, deadline: Date.now() + CONFIG.animationDelay };
    state.cooldown = Date.now() + CONFIG.animationDelay;
    state.scriptClick = true;
    try { button.click(); }
    finally { state.scriptClick = false; }
    return true;
}

export function settleToggle(current) {
    const pending = state.pending;
    if (!pending) return;
    const expected = pending.action === 'open' ? 'open' : 'closed';
    if (current !== expected && Date.now() < pending.deadline) return;
    state.pending = null;
    if (current !== expected) return; // 未成功时保留所有权，下次检查继续尝试。
    if (pending.action === 'close') state.owned = false;
}

export function handleSidebarClick(event) {
    if (state.scriptClick) return;
    const button = event.target.closest?.('button, [role="button"]');
    if (!button) return;
    if (button === toggleButton('open')) {
        state.owned = false;
        state.startup = false;
    } else if (button === toggleButton('close')) {
        state.owned = false;
    }
}
