// 正文滚动容器与定位对齐的几何计算。
import { CONFIG } from './config.js';
import { rawMessages } from './entries.js';

// scrollTop 的取值范围。column-reverse 容器以底部为原点，向上滚动时 scrollTop 为负数。
export function scrollRange(root, viewport = root.clientHeight) {
    const span = Math.max(0, root.scrollHeight - viewport);
    return getComputedStyle(root).flexDirection === 'column-reverse'
        ? { min: -span, max: 0 }
        : { min: 0, max: span };
}

export function clampScroll(value, { min, max }) {
    return Math.max(min, Math.min(max, value));
}

export function scrollToMessage(target) {
    const root = conversationScroller(target);
    if (root.clientHeight > 0 && root.scrollHeight > root.clientHeight) {
        const offset = target.getBoundingClientRect().top - scrollBounds(root).top - CONFIG.jumpTopInset;
        const top = clampScroll(root.scrollTop + offset, scrollRange(root));
        root.scrollTo({ top, behavior: 'instant' });
    } else target.scrollIntoView({ behavior: 'instant', block: 'start' });
}

export function conversationScroller(target) {
    const message = target || rawMessages()[0];
    let node = message?.parentElement || document.querySelector('main');
    while (node && node !== document.body) {
        if (node.scrollHeight > node.clientHeight + 20
            && /auto|scroll/.test(getComputedStyle(node).overflowY)) return node;
        node = node.parentElement;
    }
    const main = document.querySelector('main');
    const explicit = [...document.querySelectorAll('[data-scroll-root]')]
        .find(root => main && (root.contains(main) || main.contains(root)));
    return explicit || document.scrollingElement || document.documentElement;
}

function scrollBounds(root) {
    const documentRoot = root === document.scrollingElement || root === document.documentElement;
    const top = documentRoot ? 0 : root.getBoundingClientRect().top;
    return { top, bottom: top + (root.clientHeight || innerHeight) };
}

export function targetIsAligned(target) {
    const root = conversationScroller(target);
    const rect = target.getBoundingClientRect();
    const bounds = scrollBounds(root);
    if (rect.width === 0 || rect.height === 0 || rect.top >= bounds.bottom - 24 || rect.bottom <= bounds.top) return false;
    if (Math.abs(rect.top - bounds.top - CONFIG.jumpTopInset) <= 12) return true;
    // 首尾受到滚动边界限制时，只要问题开头确实出现在正文可见区域即可。
    const { min, max } = scrollRange(root);
    if (root.scrollTop <= min + 1) return rect.top >= bounds.top && rect.top <= bounds.top + CONFIG.jumpTopInset + 12;
    const atEnd = max > min && root.scrollTop >= max - 1;
    return atEnd && rect.top >= bounds.top && rect.top < bounds.bottom - 24;
}
