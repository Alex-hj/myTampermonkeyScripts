// 通用 DOM / 定时器工具。
import { state } from './state.js';

export function normalizeText(text) {
    return String(text || '').replace(/\s+/g, ' ').trim();
}

export function isVisible(element) {
    if (!element || element.closest('[hidden], [inert], [aria-hidden="true"]')) return false;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && rect.right > 0 && rect.bottom > 0
        && rect.left < innerWidth && rect.top < innerHeight
        && style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0'
        && !clippedByAncestor(element, rect);
}

function clippedByAncestor(element, rect) {
    let parent = element.parentElement;
    while (parent && parent !== document.body && parent !== document.documentElement) {
        const style = getComputedStyle(parent);
        const bounds = parent.getBoundingClientRect();
        if (/hidden|clip|auto|scroll/.test(style.overflowX || style.overflow)) {
            if (bounds.width === 0 || rect.right <= bounds.left || rect.left >= bounds.right) return true;
        }
        if (/hidden|clip|auto|scroll/.test(style.overflowY || style.overflow)) {
            if (bounds.height === 0 || rect.bottom <= bounds.top || rect.top >= bounds.bottom) return true;
        }
        parent = parent.parentElement;
    }
    return false;
}

export function cancelTimer(name) {
    clearTimeout(state[name]);
    state[name] = null;
}
