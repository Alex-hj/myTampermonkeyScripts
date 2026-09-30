// 备用导航的状态文字。
import { state } from './state.js';

export function updateNavigationStatus() {
    const status = state.root?.querySelector('.status');
    if (!status) return;
    const context = state.conversation;
    const labels = { idle: '已加载的问题', loading: '正在读取完整历史…',
        ready: `全部 ${state.entries.length} 个问题`, partial: `历史读取失败：${context?.error || '未知原因'}` };
    const incomplete = context?.status === 'ready' && state.entries.length !== context.entries.length;
    const text = state.notice || (incomplete ? '已发现新问题，正在同步索引…' : labels[context?.status]) || '';
    if (status.textContent !== text) status.textContent = text;
    status.hidden = !state.notice && context?.status !== 'partial';
}
