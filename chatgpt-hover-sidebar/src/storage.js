// 用户设置的读写：脚本管理器没有提供 GM_getValue / GM_setValue 时，读取返回默认值，写入忽略。
export function readSetting(key, fallback) {
    return typeof GM_getValue === 'function' ? GM_getValue(key, fallback) : fallback;
}

export function writeSetting(key, value) {
    if (typeof GM_setValue === 'function') GM_setValue(key, value);
}
