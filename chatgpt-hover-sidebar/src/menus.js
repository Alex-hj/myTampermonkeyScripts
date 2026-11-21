// Tampermonkey 菜单命令、导航模式切换，以及「下载应用」弹窗、左侧栏自动功能两个开关。
import { state } from './state.js';
import { writeSetting } from './storage.js';
import { isAppPromoEnabled, toggleAppPromo } from './app-promo.js';
import { syncConversation } from './conversation.js';
import { maintainHistory } from './history-loader.js';
import { maintainSidebar } from './sidebar-controller.js';
import { cancelJump } from './jump.js';
import { refreshNavigation } from './navigation-view.js';
import { showDiagnostics } from './diagnostics.js';

function setMode(mode) {
    state.mode = mode;
    if (mode === 'off') cancelJump();
    writeSetting('navigationMode', mode);
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

// 切换后用同一个 id 重新注册，刷新菜单标题里的 ✅/○ 与开/关。
function registerAppPromoMenu() {
    const [indicator, status] = isAppPromoEnabled() ? ['✅', '开'] : ['○', '关'];
    GM_registerMenuCommand(`${indicator} 自动关闭「下载应用」弹窗：${status}`, () => {
        toggleAppPromo();
        registerAppPromoMenu();
    }, { id: 'cghs-app-promo' });
}

function toggleSidebarAuto() {
    state.sidebarAuto = !state.sidebarAuto;
    writeSetting('sidebarAuto', state.sidebarAuto);
    // 关闭时若仍处于启动收起阶段，立即结束，避免之后还会再点一次收起。
    if (!state.sidebarAuto) state.startup = false;
}

function registerSidebarAutoMenu() {
    const [indicator, status] = state.sidebarAuto ? ['✅', '开'] : ['○', '关'];
    GM_registerMenuCommand(`${indicator} 左侧栏悬停展开与自动收起：${status}`, () => {
        toggleSidebarAuto();
        registerSidebarAutoMenu();
    }, { id: 'cghs-sidebar-auto' });
}

export function registerMenus() {
    if (typeof GM_registerMenuCommand !== 'function') return;
    registerModeMenus();
    registerAppPromoMenu();
    registerSidebarAutoMenu();
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
