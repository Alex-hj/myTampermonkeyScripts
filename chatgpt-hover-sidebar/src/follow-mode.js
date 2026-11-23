// 让页面退出“跟随底部”：跳转开始前向正文滚动容器派发一次合成的向上滚轮。
// 页面只把滚轮、按键、触摸当作用户滚动，脚本自己的 scrollTo 不算；停留在“跟随底部”时，
// 页面会在内容尺寸变化后把滚动位置拉回底部，使定位来回跳。负责发出事件，不负责滚动。
import { conversationScroller } from './scroll-geometry.js';

const ownWheelEvents = new WeakSet();

// 是否为脚本自己发出的滚轮事件（它没有真实的鼠标坐标，监听方应忽略）。
export function isOwnWheel(event) {
    return ownWheelEvents.has(event);
}

export function leaveFollowMode() {
    const event = new WheelEvent('wheel', { deltaY: -1, bubbles: true, cancelable: true, composed: true });
    ownWheelEvents.add(event);
    conversationScroller().dispatchEvent(event);
}
