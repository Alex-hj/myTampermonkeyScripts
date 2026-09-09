// ==UserScript==
// @name         ChatGPT 左侧悬停展开 + 原生导航保护
// @namespace    local.chatgpt-hover-sidebar
// @version      1.0.0
// @description  启动收起左侧栏，靠左悬停展开；保留原生导航，提供仿原生备用对话导航。
// @match        https://chatgpt.com/*
// @match        https://www.chatgpt.com/*
// @match        https://chat.openai.com/*
// @run-at       document-idle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @noframes
// ==/UserScript==

'use strict';

// 块级作用域隔离脚本；安装时不需要构建，也不依赖外部资源。
{
    const CONFIG = Object.freeze({
        edgeWidth: 18,
        openDelay: 100,
        closeDelay: 400,
        sidebarPadding: 16,
        animationDelay: 650,
        minimumWidth: 768,
        nativeNavigationSelector: '', // DOM 更新后可填入已确认的原生导航选择器。
    });
    const PREFIX = 'cghs-navigation';
    const SIDEBARS = '#stage-slideover-sidebar, #stage-sidebar, '
        + '[data-testid="sidebar"], nav[aria-label="Chat history"], '
        + 'nav[aria-label="聊天历史记录"], nav[aria-label="聊天记录"]';
    const LABELS = {
        open: /(?:open|expand)\s+(?:the\s+)?sidebar|(?:打开|展开|開啟|展開).*(?:侧栏|侧边栏|边栏|側欄|側邊欄)/i,
        close: /(?:close|collapse)\s+(?:the\s+)?sidebar|(?:关闭|收起|折叠|關閉|收合).*(?:侧栏|侧边栏|边栏|側欄|側邊欄)/i,
    };
    const state = {
        startup: true, owned: false, pending: null, cooldown: 0,
        openTimer: null, closeTimer: null, refreshTimer: null,
        pointer: null, host: null, root: null, entries: [], signature: '',
        mode: readMode(), nativeSeenAt: 0, activeFrame: 0,
    };

    function readMode() {
        const value = typeof GM_getValue === 'function' ? GM_getValue('navigationMode', 'auto') : 'auto';
        return ['auto', 'always', 'off'].includes(value) ? value : 'auto';
    }

    function isVisible(element) {
        if (!element || element.closest('[hidden], [inert], [aria-hidden="true"]')) return false;
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && rect.right > 0 && rect.bottom > 0
            && rect.left < innerWidth && rect.top < innerHeight
            && style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
    }

    function sidebar() {
        return [...document.querySelectorAll(SIDEBARS)].find(element => {
            const rect = element.getBoundingClientRect();
            return isVisible(element) && rect.left < 80 && rect.width >= 160;
        }) || null;
    }

    function leftButton(element) {
        if (!isVisible(element) || element.disabled) return false;
        if (element.closest('[role="dialog"], [aria-modal="true"]')) return false;
        const rect = element.getBoundingClientRect();
        return rect.left < Math.min(420, innerWidth * 0.45) && rect.top < 180;
    }

    function toggleButton(action) {
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

    function sidebarState() {
        if (sidebar()) return 'open';
        if (toggleButton('close')) return 'open';
        if (toggleButton('open')) return 'closed';
        return 'unknown';
    }

    function desktop() {
        return innerWidth >= CONFIG.minimumWidth && matchMedia('(hover: hover) and (pointer: fine)').matches;
    }

    function clickToggle(action) {
        if (state.pending || Date.now() < state.cooldown) return false;
        const button = toggleButton(action);
        if (!button) return false;
        state.pending = { action, deadline: Date.now() + CONFIG.animationDelay };
        state.cooldown = Date.now() + CONFIG.animationDelay;
        button.click();
        return true;
    }

    function settleToggle(current) {
        const pending = state.pending;
        if (!pending) return;
        const expected = pending.action === 'open' ? 'open' : 'closed';
        if (current !== expected && Date.now() < pending.deadline) return;
        state.pending = null;
        if (current !== expected) return; // 未成功时保留所有权，下次检查继续尝试。
        if (pending.action === 'close') state.owned = false;
    }

    function maintainSidebar() {
        if (!desktop()) return;
        const current = sidebarState();
        settleToggle(current);
        if (state.startup) {
            if (current === 'closed' && !state.pending) state.startup = false;
            else if (current === 'open') clickToggle('close');
            return;
        }
        if (state.owned && current === 'closed' && !state.pending) state.owned = false;
        if (state.owned) evaluatePointer();
    }

    function cancelTimer(name) {
        clearTimeout(state[name]);
        state[name] = null;
    }

    function interactionProtected() {
        const panel = sidebar();
        if (panel?.contains(document.activeElement) && document.activeElement !== document.body) return true;
        return [...document.querySelectorAll('[role="menu"], [role="dialog"], [aria-modal="true"]')]
            .some(isVisible);
    }

    function openFromEdge() {
        state.openTimer = null;
        if (!desktop() || !state.pointer || state.pointer.x > CONFIG.edgeWidth) return;
        if (state.startup || interactionProtected() || sidebarState() !== 'closed') return;
        if (clickToggle('open')) state.owned = true;
    }

    function closeFromHover() {
        state.closeTimer = null;
        if (!state.owned || interactionProtected() || pointerInside()) return;
        clickToggle('close');
    }

    function pointerInside() {
        if (!state.pointer) return false;
        const panel = sidebar();
        const right = panel?.getBoundingClientRect().right || 320;
        return state.pointer.x <= right + CONFIG.sidebarPadding;
    }

    function evaluatePointer() {
        if (!desktop()) return;
        const atEdge = state.pointer && state.pointer.x <= CONFIG.edgeWidth;
        if (atEdge && !state.owned && !state.startup && !state.openTimer) {
            state.openTimer = setTimeout(openFromEdge, CONFIG.openDelay);
        }
        if (!atEdge) cancelTimer('openTimer');
        if (!state.owned) return;
        if (pointerInside() || interactionProtected()) {
            cancelTimer('closeTimer');
            return;
        }
        if (!state.closeTimer) state.closeTimer = setTimeout(closeFromHover, CONFIG.closeDelay);
    }

    function handlePointer(event) {
        if (event.pointerType && event.pointerType !== 'mouse') return;
        state.pointer = { x: event.clientX, y: event.clientY };
        // 每次移动仅更新坐标；DOM 查询限制为每帧一次。
        if (state.pointerFrame) return;
        state.pointerFrame = requestAnimationFrame(() => {
            state.pointerFrame = 0;
            evaluatePointer();
        });
    }

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

    function collectEntries() {
        return [...document.querySelectorAll('main [data-message-author-role="user"]')].map(element => {
            const target = element.closest('[data-testid^="conversation-turn-"], article') || element;
            const text = (element.innerText || element.textContent || '').replace(/\s+/g, ' ').trim();
            return { target, text: text.slice(0, 240) || '图片 / 附件消息' };
        });
    }

    function navigationStyles() {
        return `
            :host { all: initial; color-scheme: light dark; font: 13px system-ui, sans-serif; }
            :host([hidden]) { display: none !important; }
            * { box-sizing: border-box; }
            nav { position: fixed; right: 12px; top: 25vh; width: 30px; max-height: 50vh;
                z-index: 1000; color: #555; }
            .list { max-height: 50vh; overflow-y: auto; scrollbar-width: none; padding: 5px 0; }
            button { display: flex; align-items: center; justify-content: flex-end; width: 30px;
                height: 22px; padding: 7px 3px; border: 0; background: transparent;
                cursor: pointer; border-radius: 5px; color: inherit; }
            .tick { height: 3px; width: 12px; border-radius: 4px; background: #c4c4c4;
                transition: width .15s, background .15s; }
            button[aria-current="true"] .tick { width: 22px; background: #555; }
            button:hover .tick, button:focus-visible .tick { width: 25px; background: #555; }
            button:focus-visible { outline: 2px solid #888; outline-offset: 1px; }
            .preview { position: fixed; right: 50px; width: min(300px, calc(100vw - 80px));
                white-space: normal; overflow-wrap: anywhere; padding: 10px 13px;
                border-radius: 12px; border: 1px solid #ddd; background: #fff;
                color: #333; box-shadow: 0 4px 18px #0002; line-height: 1.5;
                pointer-events: none; max-height: 160px; overflow: hidden; }
            .preview[hidden] { display: none; }
            :host([data-dark]) nav { color: #ddd; }
            :host([data-dark]) .tick { background: #626262; }
            :host([data-dark]) button[aria-current="true"] .tick,
            :host([data-dark]) button:hover .tick { background: #ddd; }
            :host([data-dark]) .preview { background: #303030; color: #ececec; border-color: #484848; }
            @media (prefers-reduced-motion: reduce) { .tick { transition: none; } }
            @media (max-width: 899px) { nav { display: none; } }
        `;
    }

    function createNavigation() {
        if (state.host?.isConnected) return;
        state.host = document.createElement('div');
        state.host.id = PREFIX;
        state.root = state.host.attachShadow({ mode: 'open' });
        const style = document.createElement('style');
        style.textContent = navigationStyles();
        const nav = document.createElement('nav');
        nav.setAttribute('aria-label', '对话问题导航（备用）');
        const list = document.createElement('div');
        list.className = 'list';
        const preview = document.createElement('div');
        preview.className = 'preview';
        preview.hidden = true;
        nav.append(list, preview);
        state.root.append(style, nav);
        document.body.append(state.host);
        state.signature = '';
    }

    function previewEntry(button, entry) {
        const preview = state.root.querySelector('.preview');
        preview.textContent = entry.text;
        preview.style.top = `${Math.max(12, Math.min(button.getBoundingClientRect().top, innerHeight - 180))}px`;
        preview.hidden = false;
    }

    function jumpToEntry(index) {
        const entry = state.entries[index];
        if (!entry?.target.isConnected) return;
        const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
        entry.target.scrollIntoView({ behavior: reduced ? 'instant' : 'smooth', block: 'start' });
    }

    function entryButton(entry, index) {
        const button = document.createElement('button');
        button.type = 'button';
        button.setAttribute('aria-label', `问题 ${index + 1}：${entry.text}`);
        const tick = document.createElement('span');
        tick.className = 'tick';
        button.append(tick);
        button.addEventListener('click', () => jumpToEntry(index));
        const show = () => previewEntry(button, state.entries[index]);
        const hide = () => { state.root.querySelector('.preview').hidden = true; };
        button.addEventListener('mouseenter', show);
        button.addEventListener('focus', show);
        button.addEventListener('mouseleave', hide);
        button.addEventListener('blur', hide);
        button.addEventListener('keydown', event => moveNavigationFocus(event, index));
        return button;
    }

    function moveNavigationFocus(event, index) {
        const buttons = [...state.root.querySelectorAll('button')];
        const destinations = { ArrowDown: index + 1, ArrowUp: index - 1, Home: 0, End: buttons.length - 1 };
        if (!(event.key in destinations)) return;
        event.preventDefault();
        buttons[Math.max(0, Math.min(buttons.length - 1, destinations[event.key]))]?.focus();
    }

    function updateActiveEntry() {
        state.activeFrame = 0;
        if (!state.host || state.host.hidden || !state.entries.length) return;
        let active = 0;
        const threshold = innerHeight * 0.3;
        state.entries.forEach((entry, index) => {
            if (entry.target.getBoundingClientRect().top <= threshold) active = index;
        });
        state.root.querySelectorAll('button').forEach((button, index) => {
            const value = String(index === active);
            if (button.getAttribute('aria-current') !== value) button.setAttribute('aria-current', value);
        });
    }

    function queueActiveUpdate() {
        if (!state.activeFrame) state.activeFrame = requestAnimationFrame(updateActiveEntry);
    }

    function refreshNavigation() {
        if (state.mode === 'off') {
            if (state.host) state.host.hidden = true;
            return;
        }
        const nativeVisible = nativeNavigationVisible();
        if (nativeVisible) state.nativeSeenAt = Date.now();
        const hide = state.mode === 'auto' && (nativeVisible || Date.now() - state.nativeSeenAt < 2000);
        if (hide) {
            if (state.host) state.host.hidden = true;
            return;
        }
        const entries = collectEntries();
        if (!entries.length && !state.host) return;
        createNavigation();
        state.host.hidden = entries.length === 0;
        const dark = document.documentElement.classList.contains('dark')
            || getComputedStyle(document.documentElement).colorScheme === 'dark';
        if (state.host.hasAttribute('data-dark') !== dark) state.host.toggleAttribute('data-dark', dark);
        state.entries = entries;
        const signature = JSON.stringify(entries.map(entry => entry.text));
        if (signature !== state.signature) {
            state.root.querySelector('.list').replaceChildren(...entries.map(entryButton));
            state.root.querySelector('.preview').hidden = true;
            state.signature = signature;
        }
        queueActiveUpdate();
    }

    function refresh() {
        state.refreshTimer = null;
        maintainSidebar();
        refreshNavigation();
    }

    function queueRefresh(records) {
        if (records && records.every(record => record.target === state.host)) return;
        if (!state.refreshTimer) state.refreshTimer = setTimeout(refresh, 180);
    }

    function setMode(mode) {
        state.mode = mode;
        if (typeof GM_setValue === 'function') GM_setValue('navigationMode', mode);
        refreshNavigation();
    }

    function registerMenus() {
        if (typeof GM_registerMenuCommand !== 'function') return;
        GM_registerMenuCommand('右侧导航：自动（优先原生）', () => setMode('auto'));
        GM_registerMenuCommand('右侧导航：强制显示备用', () => setMode('always'));
        GM_registerMenuCommand('右侧导航：关闭备用', () => setMode('off'));
        GM_registerMenuCommand('立即收起左侧栏', () => {
            state.startup = true;
            maintainSidebar();
        });
        GM_registerMenuCommand('查看脚本状态', () => {
            alert(`左侧栏：${sidebarState()}\n启动收起：${state.startup ? '等待中' : '已完成'}\n`
                + `备用导航：${state.mode}\n识别到原生导航：${nativeNavigationVisible() ? '是' : '否'}`);
        });
    }

    function start() {
        if (document.getElementById(`${PREFIX}-marker`)) return;
        const marker = document.createElement('meta');
        marker.id = `${PREFIX}-marker`;
        document.head.append(marker);
        registerMenus();
        document.addEventListener('pointermove', handlePointer, { passive: true });
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
        const observer = new MutationObserver(queueRefresh);
        observer.observe(document.body, { childList: true, subtree: true, attributes: true,
            attributeFilter: ['class', 'style', 'aria-expanded', 'aria-hidden', 'data-testid'] });
        // 低频补偿 SPA 替换、延迟 hydration、主题更新和点击未生效的情况。
        setInterval(refresh, 1200);
        refresh();
    }

    start();
}
