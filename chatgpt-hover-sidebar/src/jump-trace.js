// 跳转轨迹调试：开关打开后记录每轮定位的滚动现场，随「查看脚本状态」导出，用来排查定位时页面来回跳动。
// 只读取页面状态并写入轨迹文本，不参与任何定位决策；开关默认关闭，关闭时不读取页面、不产生记录。
import { CONFIG } from './config.js';
import { state } from './state.js';
import { readSetting, writeSetting } from './storage.js';
import { conversationScroller } from './scroll-geometry.js';

const SETTING_KEY = 'traceJump';

// 只有明确保存为 true 才开启。
let enabled = readSetting(SETTING_KEY, false) === true;

export function isJumpTraceEnabled() {
    return enabled;
}

export function toggleJumpTrace() {
    enabled = !enabled;
    writeSetting(SETTING_KEY, enabled);
}

// 轨迹只保留最前面的 CONFIG.jumpTraceLimit 行，来回跳动的规律在开头就能看出来。
function addTrace(job, text) {
    const lines = job.trace ??= [];
    if (lines.length > CONFIG.jumpTraceLimit) return;
    const elapsed = String(Date.now() - job.startedAt).padStart(5);
    lines.push(lines.length === CONFIG.jumpTraceLimit
        ? '…已达记录上限，后续省略' : `${elapsed}ms #${job.attempts} ${text}`);
}

// 容器的简要标识，用来判断搜索与校正滚动的是不是同一个容器。
function scrollerName(root) {
    const testId = root.getAttribute('data-testid');
    const className = String(root.className).trim().replace(/\s+/g, '.').slice(0, 40);
    return `${root.tagName.toLowerCase()}${root.id ? `#${root.id}` : ''}${testId ? `[${testId}]` : ''}.${className}`;
}

function scrollState(root) {
    return `st=${Math.round(root.scrollTop)} sh=${root.scrollHeight} ch=${root.clientHeight}`;
}

function recordedTops(job) {
    return job.traceTops ??= new WeakMap();
}

// 「外部位移」是该容器自上次记录以来 scrollTop 的变化。脚本在这段时间没有滚动它，
// 所以非零就说明页面自己改变了滚动位置。
function observeRoot(job, root) {
    const tops = recordedTops(job);
    const top = Math.round(root.scrollTop);
    const moved = tops.has(root) ? top - tops.get(root) : '-';
    tops.set(root, top);
    return `${scrollerName(root)} ${scrollState(root)} 外部位移=${moved}`;
}

function mountedSummary(job, entries) {
    const wanted = entries.findIndex(entry => entry.id === job.id);
    const mounted = entries.flatMap((entry, index) => entry.target?.isConnected ? [index] : []);
    const range = mounted.length ? `${mounted[0]}..${mounted.at(-1)}` : '无';
    return `目标序号=${wanted}/${entries.length} 已挂载=${range}(${mounted.length}个)`;
}

function targetSummary(job, target, searchRoot) {
    if (!target?.isConnected) return '目标=未挂载';
    const own = conversationScroller(target);
    const container = own === searchRoot ? '与搜索容器相同' : `与搜索容器不同 ${observeRoot(job, own)}`;
    return `目标top=${Math.round(target.getBoundingClientRect().top)} 校正容器=${container}`;
}

// 每轮定位循环开头记录一次现场：滚动容器、已挂载问题范围、目标是否挂载。
// job 为当前定位任务，entries 为合并后的问题条目，entry 为本次要定位的条目。
export function traceIteration(job, entries, entry) {
    if (!enabled) return;
    const root = conversationScroller();
    addTrace(job, `检查 搜索容器=${observeRoot(job, root)} ${mountedSummary(job, entries)} `
        + targetSummary(job, entry.target, root));
}

// 脚本滚动之后记录一次，箭头后是滚动后的容器状态。label 为滚动类型（搜索 / 校正），
// target 为校正滚动的目标节点（搜索滚动传 null），detail 返回决策描述，仅在开关打开时才会执行。
export function traceScroll(job, label, target, detail) {
    if (!enabled) return;
    const root = conversationScroller(target);
    recordedTops(job).set(root, Math.round(root.scrollTop));
    addTrace(job, `${label} ${detail()} → ${scrollState(root)}`);
}

// 定位期间记录右侧目录自身的动作（重新居中、重建），用来判断目录条目的抖动是不是由它们引起。
// describe 返回动作描述，仅在开关打开且正在定位时才会执行。
export function traceNavigation(describe) {
    if (enabled && state.jump) addTrace(state.jump, `目录 ${describe()}`);
}

// 诊断窗口里的轨迹文本；job 为最近一次定位任务（或其摘要），没有记录时返回空串。
export function jumpTraceText(job) {
    const lines = job?.trace;
    return lines?.length ? `\n定位轨迹（调试，最近一次）：\n${lines.join('\n')}` : '';
}
