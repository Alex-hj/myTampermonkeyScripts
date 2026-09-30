// 备用导航的 Shadow DOM 样式。

export function navigationStyles() {
    return `
        :host { all: initial; color-scheme: light dark; font: 13px system-ui, sans-serif; }
        :host([hidden]) { display: none !important; }
        * { box-sizing: border-box; }
        nav { position: fixed; right: 12px; top: 50%; transform: translateY(-50%);
            width: 38px; z-index: 1000; color: #171717; }
        .list { width: 100%; max-height: min(60vh, 600px); overflow-y: auto;
            scrollbar-width: none; overscroll-behavior: contain; padding: 6px 0; }
        nav:not([data-expanded="true"]) .list::-webkit-scrollbar { display: none; width: 0; }
        button { display: flex; align-items: center; justify-content: center; width: 100%;
            height: 12px; padding: 0; border: 0; background: transparent;
            cursor: pointer; color: inherit; font: inherit; text-align: left; }
        .tick { height: 2px; width: 22px; flex-shrink: 0; border-radius: 3px; background: #b9b9b9; }
        button[aria-current="true"] .tick { height: 3px; background: #171717; }
        button:focus-visible { outline: 2px solid #888; outline-offset: -2px; }
        .entry-label { display: none; min-width: 0; overflow: hidden;
            white-space: nowrap; text-overflow: ellipsis; }
        .status { position: absolute; right: 0; bottom: calc(100% + 8px); width: 210px;
            text-align: right; font-size: 11px; opacity: .8; pointer-events: none; }
        .status[hidden] { display: none; }
        :host([data-dark]) nav { color: #ddd; }
        :host([data-dark]) .tick { background: #626262; }
        :host([data-dark]) button[aria-current="true"] .tick { background: #ececec; }
        @media (max-width: 899px) { nav { display: none; } }
    ` + expandedNavigationStyles();
}

function expandedNavigationStyles() {
    return `
        nav[data-expanded="true"] { width: min(400px, calc(100vw - 32px)); }
        nav[data-expanded="true"] .list { max-height: min(70vh, 600px); padding: 7px;
            background: #fff; border: 1px solid #d4d4d4; border-radius: 20px;
            box-shadow: 0 6px 18px #00000014;
            scrollbar-width: thin; scrollbar-color: rgba(0, 0, 0, 0.25) transparent; }
        nav[data-expanded="true"] .list::-webkit-scrollbar { width: 6px; display: block; }
        nav[data-expanded="true"] .list::-webkit-scrollbar-track { background: transparent; }
        nav[data-expanded="true"] .list::-webkit-scrollbar-thumb { background: rgba(0, 0, 0, 0.2); border-radius: 10px; }
        nav[data-expanded="true"] .list::-webkit-scrollbar-thumb:hover { background: rgba(0, 0, 0, 0.35); }
        nav[data-expanded="true"] button { height: 44px; padding: 0 12px;
            justify-content: flex-start; border-radius: 12px; font-size: 16px; line-height: 1.5; }
        nav[data-expanded="true"] .tick { display: none; }
        nav[data-expanded="true"] .entry-label { display: block; }
        nav[data-expanded="true"] button[aria-current="true"] { background: #efefef; }
        nav[data-expanded="true"] button:hover { background: #f5f5f5; }
        :host([data-dark]) nav[data-expanded="true"] .list { background: #262626; border-color: #484848;
            scrollbar-color: rgba(255, 255, 255, 0.25) transparent; }
        :host([data-dark]) nav[data-expanded="true"] .list::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.2); }
        :host([data-dark]) nav[data-expanded="true"] .list::-webkit-scrollbar-thumb:hover { background: rgba(255, 255, 255, 0.35); }
        :host([data-dark]) nav[data-expanded="true"] button[aria-current="true"] { background: #3c3c3c; }
        :host([data-dark]) nav[data-expanded="true"] button:hover { background: #333; }
    `;
}
