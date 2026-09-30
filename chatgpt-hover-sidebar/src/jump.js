// 点击问题后的定位：搜索未挂载的历史消息并确认对齐。
import { CONFIG } from './config.js';
import { isCurrentConversation, state } from './state.js';
import { collectEntries } from './entries.js';
import { updateNavigationStatus } from './navigation-status.js';
import {
    clampScroll,
    conversationScroller,
    scrollRange,
    scrollToMessage,
    targetIsAligned,
} from './scroll-geometry.js';

export function cancelJump() {
    if (!state.jump) return;
    const job = state.jump;
    job.cancelled = true;
    job.result = '已取消';
    job.elapsed = Date.now() - job.startedAt;
    state.jump = null;
    job.resume?.();
    state.notice = '';
}

function jumpStillActive(job) {
    return !job.cancelled && state.jump === job && isCurrentConversation(job.context);
}

function jumpSearchDirection(job, entries) {
    const wanted = entries.findIndex(entry => entry.id === job.id);
    const mounted = entries.map((entry, index) => entry.target?.isConnected ? index : -1)
        .filter(index => index >= 0);
    if (!mounted.length || wanted < 0) return { direction: job.direction || -1, gap: null };
    const nearest = mounted.reduce((a, b) => Math.abs(a - wanted) < Math.abs(b - wanted) ? a : b);
    return { direction: wanted < nearest ? -1 : 1, gap: Math.abs(wanted - nearest) };
}

function updateJumpStep(job, direction, gap) {
    if (gap === null) return;
    if (job.direction && job.direction !== direction) {
        // 越过目标后保留缩小后的上限，避免再次加速导致来回跳过。
        job.stepLimit = Math.max(0.15, job.stepRatio / 2);
        job.stepRatio = job.stepLimit;
    } else {
        const limit = gap > 10 ? CONFIG.jumpMaxStep : gap > 3 ? 4 : 0.75;
        job.stepRatio = Math.min(limit, job.stepLimit, job.stepRatio * 2);
    }
    job.direction = direction;
}

function stepTowardsEntry(job, entries) {
    const root = conversationScroller();
    const { direction, gap } = jumpSearchDirection(job, entries);
    if (gap === null) {
        job.emptySince ??= Date.now();
        // 虚拟窗口暂时清空时先等挂载，避免连续滚动使异步渲染一直追不上。
        if (Date.now() - job.emptySince < CONFIG.jumpEmptyWindowDelay) return;
    } else job.emptySince = null;
    const height = root.clientHeight || innerHeight;
    const range = scrollRange(root, height);
    updateJumpStep(job, direction, gap);
    const top = clampScroll(root.scrollTop + direction * height * job.stepRatio, range);
    job.atBoundary = direction < 0 ? top === range.min : top === range.max;
    // 根据已挂载消息的顺序粗找，再缩小步幅；不按问题数量推算像素位置。
    // 已在边界、无法继续前进时，向反方向挪动少许。
    const nudged = clampScroll(top - direction * 24, range);
    root.scrollTo({ top: top === root.scrollTop && range.max > range.min ? nudged : top,
        behavior: 'instant' });
    job.scrolls++;
}

function resolveJumpEntry(job, entries) {
    if (job.id) return entries.find(entry => entry.id === job.id);
    const candidates = entries.filter(entry => entry.text === job.text);
    return candidates.length === 1 ? candidates[0] : candidates.find(entry => entry.target === job.originalTarget);
}

function confirmJumpTarget(job, target) {
    const top = target.getBoundingClientRect().top;
    const aligned = targetIsAligned(target);
    const sameTarget = job.lastTarget === target;
    const stable = sameTarget && Math.abs(top - job.lastTop) <= 4 && aligned;
    job.stableFrames = stable ? job.stableFrames + 1 : 0;
    if (!stable) job.stableSince = Date.now();
    job.lastTarget = target;
    job.lastTop = top;
    if (job.stableFrames >= 2 && Date.now() - job.stableSince >= CONFIG.jumpStableDuration) return true;
    if (!sameTarget || !aligned) {
        scrollToMessage(target);
        job.scrolls++;
    }
    return false;
}

function waitForJumpProgress(job, deadline) {
    const delay = job.lastTarget ? CONFIG.jumpSettleDelay
        : job.atBoundary ? CONFIG.jumpBoundaryDelay : CONFIG.jumpPollDelay;
    const startedAt = Date.now();
    return new Promise(resolve => {
        let timer;
        let accelerated = false;
        job.resume = () => {
            clearTimeout(timer);
            job.resume = null;
            job.wake = null;
            resolve();
        };
        job.wake = () => {
            if (job.lastTarget || accelerated) return;
            accelerated = true;
            clearTimeout(timer);
            const remaining = Math.max(0, CONFIG.jumpMutationDelay - (Date.now() - startedAt));
            timer = setTimeout(job.resume, Math.min(remaining, Math.max(0, deadline - Date.now())));
        };
        timer = setTimeout(job.resume, Math.min(delay, Math.max(0, deadline - Date.now())));
    });
}

export function wakeJumpForMessages(records) {
    const job = state.jump;
    if (!job?.wake || !records || !jumpStillActive(job)) return;
    const main = document.querySelector('main');
    if (main && records.some(record => main.contains(record.target)
        && (record.type === 'childList' || record.attributeName?.startsWith('data-')))) job.wake();
}

async function locateUnloaded(job) {
    const deadline = Date.now() + CONFIG.jumpTimeout;
    while (jumpStillActive(job) && Date.now() < deadline) {
        job.attempts++;
        const entries = collectEntries();
        const entry = resolveJumpEntry(job, entries);
        if (!entry) {
            state.notice = '会话分支已变化，请重新选择问题';
            job.result = '目标已变化';
            return;
        }
        const target = entry.target;
        if (target?.isConnected) {
            if (confirmJumpTarget(job, target)) {
                state.notice = '';
                job.result = '已确认定位';
                return;
            }
        } else {
            job.stableFrames = 0;
            job.lastTarget = null;
            stepTowardsEntry(job, entries);
        }
        await waitForJumpProgress(job, deadline);
    }
    if (jumpStillActive(job)) {
        state.notice = '尚未定位到此问题，请重试或手动加载历史';
        job.result = '超时，未确认定位';
    }
}

export async function jumpToEntry(index) {
    if (state.conversation?.key !== location.pathname) return;
    const entry = state.entries[index];
    if (!entry) return;
    cancelJump();
    // 使用点击时的消息身份重新查找节点，不能信任上一次渲染保留的 DOM 引用。
    const job = { id: entry.id, text: entry.text, originalTarget: entry.target,
        context: state.conversation, cancelled: false, attempts: 0, stableFrames: 0,
        stepRatio: 0.75, stepLimit: CONFIG.jumpMaxStep, scrolls: 0,
        startedAt: Date.now(), result: '定位中' };
    state.jump = job;
    state.lastJump = job;
    state.notice = '正在定位历史问题…（Esc 取消）';
    updateNavigationStatus();
    try { await locateUnloaded(job); }
    catch {
        if (jumpStillActive(job)) {
            state.notice = '页面暂不支持定位，请手动加载历史';
            job.result = '定位异常';
        }
    }
    finally {
        if (state.jump === job) state.jump = null;
        if (state.lastJump === job) state.lastJump = { result: job.result, attempts: job.attempts,
            scrolls: job.scrolls, elapsed: job.elapsed ?? Date.now() - job.startedAt };
        updateNavigationStatus();
    }
}
