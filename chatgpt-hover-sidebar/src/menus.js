// Tampermonkey 菜单命令与导航模式切换。
import { state } from './state.js';
import { syncConversation } from './conversation.js';
import { maintainHistory } from './history-loader.js';
import { maintainSidebar } from './sidebar-controller.js';
import { cancelJump } from './jump.js';
import { refreshNavigation } from './navigation-view.js';
import { showDiagnostics } from './diagnostics.js';

function setMode(mode) {
    state.mode = mode;
    if (mode === 'off') cancelJump();
    if (typeof GM_setValue === 'function') GM_setValue('navigationMode', mode);
    registerModeMenus();
    maintainHistory();
    refreshNavigation();
}

function registerModeMenus() {
    if (typeof GM_registerMenuCommand !== 'function') return;
    const modes = [
        { id: 'cghs-mode-auto', key: 'auto', label: '自动（优先原生）' },
        { id: 'cghs-mode-always', key: 'always', label: '强制显示备用' },
        { id: 'cghs-mode-off', key: 'off', label: '关闭备用' },
    ];
    for (const { id, key, label } of modes) {
        const indicator = state.mode === key ? '✅' : '○';
        GM_registerMenuCommand(`${indicator} 右侧导航：${label}`, () => setMode(key), { id });
    }
}

export function registerMenus() {
    if (typeof GM_registerMenuCommand !== 'function') return;
    registerModeMenus();
    GM_registerMenuCommand('重新读取完整会话索引', () => {
        syncConversation();
        if (state.conversation.status !== 'loading') state.conversation.retryAt = 0;
        maintainHistory();
    });
    GM_registerMenuCommand('立即收起左侧栏', () => {
        state.startup = true;
        state.closedSince = null;
        maintainSidebar();
    });
    GM_registerMenuCommand('查看脚本状态', showDiagnostics);
}
