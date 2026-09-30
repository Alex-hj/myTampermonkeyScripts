// 备用导航的创建、展开交互与刷新。
import { CONFIG, PREFIX } from './config.js';
import { state } from './state.js';
import { cancelTimer } from './utils.js';
import { collectEntries } from './entries.js';
import { navigationSuppressed } from './native-navigation.js';
import { navigationStyles } from './navigation-styles.js';
import { updateNavigationStatus } from './navigation-status.js';
import { jumpToEntry } from './jump.js';

function createNavigation() {
    if (state.host?.isConnected) return;
    state.host = document.createElement('div');
    state.host.id = PREFIX;
    state.root = state.host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = navigationStyles();
    const nav = document.createElement('nav');
    nav.setAttribute('aria-label', '对话问题导航（备用）');
    nav.dataset.expanded = 'false';
    const list = document.createElement('div');
    list.className = 'list';
    const status = document.createElement('div');
    status.className = 'status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    nav.append(list, status);
    bindNavigationEvents(nav);
    state.root.append(style, nav);
    document.body.append(state.host);
    state.signature = '';
    state.navigationExpanded = false;
}

function centerActiveNavigationEntry() {
    const list = state.root?.querySelector('.list');
    const active = list?.querySelector('[aria-current="true"]');
    if (!active) return;
    // 只滚动导航自身，不使用 scrollIntoView，避免带动聊天正文。
    list.scrollTop = Math.max(0, active.offsetTop - list.offsetTop - (list.clientHeight - active.offsetHeight) / 2);
}

function setNavigationExpanded(expanded) {
    cancelTimer('navigationCloseTimer');
    if (state.navigationExpanded === expanded) return;
    state.navigationExpanded = expanded;
    const nav = state.root?.querySelector('nav');
    if (nav) nav.dataset.expanded = String(expanded);
    requestAnimationFrame(centerActiveNavigationEntry);
}

function scheduleNavigationClose() {
    cancelTimer('navigationCloseTimer');
    state.navigationCloseTimer = setTimeout(() => setNavigationExpanded(false), CONFIG.navigationCloseDelay);
}

function bindNavigationEvents(nav) {
    nav.addEventListener('mouseenter', () => {
        state.navigationHovered = true;
        setNavigationExpanded(true);
    });
    nav.addEventListener('mouseleave', () => {
        state.navigationHovered = false;
        scheduleNavigationClose();
    });
    nav.addEventListener('focusin', () => setNavigationExpanded(true));
    nav.addEventListener('focusout', event => {
        if (!nav.contains(event.relatedTarget) && !state.navigationHovered) scheduleNavigationClose();
    });
}

function entryButton(entry, index) {
    const button = document.createElement('button');
    button.type = 'button';
    const preview = entry.text.slice(0, 240);
    button.setAttribute('aria-label', `问题 ${index + 1}：${preview}`);
    const tick = document.createElement('span');
    tick.className = 'tick';
    tick.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span');
    label.className = 'entry-label';
    label.textContent = entry.text;
    button.title = preview;
    button.append(tick, label);
    button.addEventListener('click', () => jumpToEntry(index));
    button.addEventListener('keydown', event => moveNavigationFocus(event, index));
    return button;
}

function moveNavigationFocus(event, index) {
    if (event.key === 'Escape') {
        setNavigationExpanded(false);
        state.root.activeElement?.blur();
        return;
    }
    const buttons = [...state.root.querySelectorAll('button')];
    const destinations = { ArrowDown: index + 1, ArrowUp: index - 1, Home: 0, End: buttons.length - 1 };
    if (!(event.key in destinations)) return;
    event.preventDefault();
    buttons[Math.max(0, Math.min(buttons.length - 1, destinations[event.key]))]?.focus();
}

function updateActiveEntry() {
    state.activeFrame = 0;
    if (!state.host || state.host.hidden || !state.entries.length) return;
    let active = -1;
    const threshold = innerHeight * 0.3;
    state.entries.forEach((entry, index) => {
        if (!entry.target?.isConnected) return;
        if (active === -1 || entry.target.getBoundingClientRect().top <= threshold) active = index;
    });
    let changed = false;
    state.root.querySelectorAll('button').forEach((button, index) => {
        const value = String(index === active);
        if (button.getAttribute('aria-current') === value) return;
        button.setAttribute('aria-current', value);
        changed = true;
    });
    if (changed && !state.navigationExpanded) centerActiveNavigationEntry();
}

export function queueActiveUpdate() {
    if (!state.activeFrame) state.activeFrame = requestAnimationFrame(updateActiveEntry);
}

export function refreshNavigation() {
    if (navigationSuppressed()) {
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
    const signature = JSON.stringify(entries.map(entry => [entry.id, entry.text]));
    if (signature !== state.signature) {
        state.root.querySelector('.list').replaceChildren(...entries.map(entryButton));
        state.signature = signature;
    }
    queueActiveUpdate();
    updateNavigationStatus();
}
