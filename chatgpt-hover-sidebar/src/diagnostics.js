// 诊断信息文本与诊断窗口。
import { DIAGNOSTICS_ID } from './config.js';
import { state } from './state.js';
import { isVisible } from './utils.js';
import { deviceCookie } from './request-context.js';
import { desktop, sidebarState, toggleButton } from './sidebar-detect.js';

// 版本号只在脚本头 @version 维护一处，运行时由脚本管理器提供。
function scriptVersion() {
    return typeof GM_info === 'object' ? GM_info.script.version : '未知';
}

function diagnosticText() {
    const context = state.conversation;
    const buttons = [...document.querySelectorAll('button, [role="button"]')]
        .filter(element => /sidebar|侧栏|侧边栏|边栏|側欄|側邊欄/i.test(
            `${element.getAttribute('data-testid')} ${element.getAttribute('aria-label')} ${element.title}`))
        .slice(0, 12).map(element => {
            const label = element.getAttribute('aria-label') || element.getAttribute('data-testid') || element.title;
            return `${label} [${isVisible(element) ? '可见' : '隐藏'}]`;
        });
    return `脚本版本：${scriptVersion()}\n启动自动收起：默认启用\n`
        + `桌面鼠标条件：${desktop() ? '满足' : '不满足（窄屏或未检测到鼠标）'}\n`
        + `左侧栏：${sidebarState()}\n启动收起：${state.startup ? '等待中' : '已完成'}\n`
        + `展开/收起按钮：${!!toggleButton('open')} / ${!!toggleButton('close')}\n`
        + `收起规则：鼠标移出后收起（编辑、菜单或弹窗打开时暂停）\n`
        + `页面请求观察：${state.captureInstalled ? '已启用' : '不可用'}\n`
        + `观察到的会话响应：${state.capturedResponses} 次\n最近响应：${state.captureSummary}\n`
        + `设备信息：${!!(deviceCookie() || state.requestContext?.headers['oai-device-id'])}\n`
        + `当前会话工作区信息：${state.requestContext?.id === context?.id && !!state.requestContext?.headers['chatgpt-account-id']}\n`
        + `索引来源：${context?.source || '暂无'}\n`
        + `最近定位：${state.lastJump?.result || '尚未点击'}，检查 ${state.lastJump?.attempts || 0} 次\n`
        + `定位滚动：${state.lastJump?.scrolls || 0} 次，耗时 ${state.lastJump?.elapsed
            ?? (state.jump ? Date.now() - state.jump.startedAt : 0)} ms\n`
        + `备用导航：${state.mode}\n完整索引：${context?.status}\n`
        + `${context?.error || ''}\n${(context?.attempts || []).join('\n')}\n`
        + `侧栏按钮：\n${buttons.join('\n') || '未找到语义标签'}`;
}

function diagnosticDialog(root, text) {
    const style = document.createElement('style');
    style.textContent = `
        :host { all: initial; color-scheme: light dark; }
        dialog { position: fixed; inset: 0; margin: auto; width: min(560px, 85vw);
            max-height: 85vh; overflow: auto; border: 1px solid #888; border-radius: 14px;
            padding: 20px; font: 14px system-ui; background: Canvas; color: CanvasText; }
        dialog::backdrop { background: #0006; }
        h2 { font-size: 18px; margin: 0 0 12px; }
        textarea { box-sizing: border-box; width: 100%; height: 300px; resize: vertical;
            padding: 10px; font: 13px/1.6 monospace; }
        button { margin: 12px 10px 0 0; padding: 8px 16px; cursor: pointer; }
    `;
    const dialog = document.createElement('dialog');
    dialog.setAttribute('aria-label', '脚本诊断信息');
    const title = document.createElement('h2');
    title.textContent = '脚本诊断信息';
    const textarea = document.createElement('textarea');
    textarea.readOnly = true;
    textarea.setAttribute('aria-label', '可复制的诊断信息');
    textarea.value = text;
    dialog.append(title, textarea);
    root.append(style, dialog);
    return { dialog, textarea };
}

async function copyDiagnostics(textarea, button) {
    try {
        if (typeof GM_setClipboard === 'function') GM_setClipboard(textarea.value, 'text');
        else await navigator.clipboard.writeText(textarea.value);
        button.textContent = '已复制';
    } catch {
        textarea.focus();
        textarea.select();
        button.textContent = '请按 Ctrl+C 复制';
    }
}

export function showDiagnostics() {
    document.getElementById(DIAGNOSTICS_ID)?.remove();
    const host = document.createElement('div');
    host.id = DIAGNOSTICS_ID;
    const root = host.attachShadow({ mode: 'open' });
    const { dialog, textarea } = diagnosticDialog(root, diagnosticText());
    const previousFocus = document.activeElement;
    const close = () => { host.remove(); previousFocus?.focus(); };
    const copyButton = document.createElement('button');
    copyButton.textContent = '一键复制';
    copyButton.addEventListener('click', () => void copyDiagnostics(textarea, copyButton));
    const closeButton = document.createElement('button');
    closeButton.textContent = '关闭';
    closeButton.addEventListener('click', close);
    dialog.append(copyButton, closeButton);
    dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
    document.body.append(host);
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    copyButton.focus();
}
