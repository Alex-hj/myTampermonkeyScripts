// 完整历史索引：消息树/分页接口、页面响应观察与失败退避。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { settlePromises, fixture, messages, apiMessage, tree, mockApi, navRoot, mountedMessage, responseData } = require('./support.cjs');

test('进入会话即索引未挂载的全部问题，只保留当前分支', async t => {
    const f = fixture(t);
    const data = tree([apiMessage('u1', '很早的问题'), apiMessage('a1', '回答', 'assistant'), apiMessage('u2', '最新问题')]);
    data.mapping.other = { parent: 'u1', message: apiMessage('other', '另一分支') };
    mockApi(f, () => data);
    mountedMessage(f, 'u2', '最新问题');
    f.start();
    await f.advance(1500);
    const labels = [...navRoot(f).querySelectorAll('button')].map(button => button.getAttribute('aria-label'));
    assert.deepEqual(labels, ['问题 1：很早的问题', '问题 2：最新问题']);
    assert.match(navRoot(f).querySelector('.status').textContent, /全部 2/);
    f.document.querySelector('main').replaceChildren();
    await f.advance(1500);
    assert.equal(navRoot(f).querySelectorAll('button').length, 2);
});

test('不完整消息树使用分页接口，游标翻页并去重', async t => {
    const f = fixture(t);
    const requests = mockApi(f, url => {
        if (url.pathname.includes('/conversation/')) return { mapping: {}, current_node: 'missing' };
        if (url.searchParams.has('before')) return { messages: [apiMessage('u1', '早期'), apiMessage('u2', '近期')],
            page_info: { has_previous_page: false } };
        return { messages: [apiMessage('u2', '近期')],
            page_info: { has_previous_page: true, start_cursor: 'opaque+/=' } };
    });
    f.start();
    await f.advance(1500);
    assert.equal(navRoot(f).querySelectorAll('button').length, 2);
    assert.equal(requests.at(-1).searchParams.get('before'), 'opaque+/=');
    assert.match(navRoot(f).querySelector('.status').textContent, /全部/);
});

test('分页游标循环不会把残缺历史标记为完整', async t => {
    const f = fixture(t);
    messages(f, ['已加载']);
    const requests = mockApi(f, url => url.pathname.includes('/conversation/') ? {}
        : { messages: [apiMessage('u2', '近期')], page_info: { has_previous_page: true, start_cursor: 'same' } });
    f.start();
    await f.advance(10000);
    assert.match(navRoot(f).querySelector('.status').textContent, /失败/);
    assert.equal(requests.length, 5);
});

test('切换会话丢弃旧请求响应及未被替换的旧 DOM', async t => {
    const f = fixture(t);
    let finishOld;
    mockApi(f, url => url.pathname.includes('/test') ? new Promise(resolve => { finishOld = resolve; })
        : tree([apiMessage('new', '新会话') ]));
    mountedMessage(f, 'old', '旧会话');
    f.start();
    await f.advance(200);
    f.window.history.pushState({}, '', '/c/new-chat');
    await f.advance(1500);
    finishOld(tree([apiMessage('old', '旧会话')]));
    await f.advance(1500);
    const labels = [...navRoot(f).querySelectorAll('button')].map(button => button.getAttribute('aria-label'));
    assert.deepEqual(labels, ['问题 1：新会话']);
});

test('路由检测前新会话 DOM 已挂载，不会被误当成旧消息', async t => {
    const f = fixture(t);
    mockApi(f, url => tree([apiMessage(url.pathname.includes('/test') ? 'old' : 'new', '问题')]));
    mountedMessage(f, 'old', '问题');
    f.start();
    await f.advance(1500);
    f.window.history.pushState({}, '', '/c/new');
    const current = mountedMessage(f, 'new', '问题');
    await f.advance(1500);
    navRoot(f).querySelector('button').click();
    assert.equal(current.scrollOptions.block, 'start');
});

test('旧接口403只补试一次新版分页，仍失败后退避', async t => {
    const f = fixture(t);
    messages(f, ['当前问题']);
    const requests = mockApi(f, () => { throw new Error('HTTP 403'); });
    f.start();
    await f.advance(10000);
    assert.equal(requests.length, 3);
    assert.match(navRoot(f).querySelector('.status').textContent, /失败/);
});

test('完整参数不兼容时尝试普通消息树接口', async t => {
    const f = fixture(t);
    const requests = mockApi(f, url => {
        if (url.searchParams.has('include_full_conversation')) throw new Error('HTTP 400');
        return { conversation: tree([apiMessage('u1', '兼容问题')]) };
    });
    f.start();
    await f.advance(1500);
    assert.match(navRoot(f).querySelector('.status').textContent, /全部 1/);
    assert.equal(requests.length, 3);
});

test('主动历史读取携带当前设备信息，认证接口不携带设备头', async t => {
    const f = fixture(t);
    f.document.cookie = 'oai-did=device-test';
    mockApi(f, (url, options) => {
        assert.equal(options.headers['oai-device-id'], 'device-test');
        return tree([apiMessage('u1', '问题')]);
    });
    f.start();
    await f.advance(1500);
    assert.match(navRoot(f).querySelector('.status').textContent, /全部 1/);
});

test('自身请求403后利用页面成功响应建立完整索引，不消耗原响应', async t => {
    const f = fixture(t);
    const data = tree([apiMessage('u1', '旧问题'), apiMessage('u2', '新问题')]);
    f.window.fetch = async (url, options) => {
        if (String(url).includes('/api/auth/session')) return responseData({ accessToken: 'test-token' });
        if (new Headers(options?.headers).get('chatgpt-account-id')) return responseData(data);
        return { ok: false, status: 403 };
    };
    messages(f, ['新问题']);
    f.start();
    await f.advance(1500);
    assert.match(navRoot(f).querySelector('.status').textContent, /403/);
    const response = await f.window.fetch('/backend-api/conversation/test', {
        headers: { 'chatgpt-account-id': 'workspace-test', 'oai-device-id': 'device-test' },
    });
    assert.equal((await response.json()).current_node, 'u2');
    await f.advance(1500);
    assert.match(navRoot(f).querySelector('.status').textContent, /全部 2/);
});

test('页面分页响应提供工作区上下文后，主动读取携带相同工作区', async t => {
    const f = fixture(t);
    let authorized = 0;
    f.window.fetch = async (url, options) => {
        if (String(url).includes('/api/auth/session')) return responseData({ accessToken: 'test-token' });
        if (String(url).includes('/messages')) return responseData({ messages: [] });
        if (new Headers(options?.headers).get('chatgpt-account-id') === 'workspace-test') {
            authorized++;
            return responseData(tree([apiMessage('u1', '工作区问题')]));
        }
        return { ok: false, status: 403 };
    };
    messages(f, ['工作区问题']);
    f.start();
    await f.advance(1500);
    await f.window.fetch('/backend-api/conversations/test/messages', { headers: { 'chatgpt-account-id': 'workspace-test' } });
    await f.advance(1500);
    assert.equal(authorized, 1);
    assert.match(navRoot(f).querySelector('.status').textContent, /全部 1/);
});

test('旧消息树403仍能通过新版分页获得完整索引', async t => {
    const f = fixture(t);
    const requests = mockApi(f, url => {
        if (url.pathname.includes('/conversation/')) throw new Error('HTTP 403');
        return { messages: [apiMessage('u1', '分页问题')], page_info: { has_previous_page: false } };
    });
    f.start();
    await f.advance(1500);
    assert.match(navRoot(f).querySelector('.status').textContent, /全部 1/);
    assert.equal(requests.length, 3);
});

test('认证401不尝试分页接口', async t => {
    const f = fixture(t);
    const requests = mockApi(f, () => { throw new Error('HTTP 401'); });
    messages(f, ['已加载']);
    f.start();
    await f.advance(10000);
    assert.equal(requests.length, 2);
    assert.match(navRoot(f).querySelector('.status').textContent, /HTTP 401/);
});

test('页面完整分页响应可直接建立索引', async t => {
    const f = fixture(t, { mode: 'off' });
    f.window.fetch = async () => responseData({ messages: [apiMessage('u1', '原生分页问题')],
        page_info: { has_previous_page: false } });
    f.start();
    await f.window.fetch('/backend-api/conversations/test');
    await settlePromises();
    f.menus.get('cghs-mode-always')();
    await f.advance(1500);
    assert.match(navRoot(f).querySelector('.status').textContent, /全部 1/);
});

test('页面不完整第一页作为分页起点，补齐历史且不重复请求第一页', async t => {
    const f = fixture(t, { mode: 'off' });
    let firstRequests = 0;
    f.window.fetch = async url => {
        if (String(url).includes('/api/auth/session')) return responseData({ accessToken: 'token' });
        if (String(url).includes('/messages?')) return responseData({ messages: [apiMessage('u1', '早期')],
            page_info: { has_previous_page: false } });
        firstRequests++;
        return responseData({ messages: [apiMessage('u2', '近期')],
            page_info: { has_previous_page: true, start_cursor: 'older' } });
    };
    f.start();
    await f.window.fetch('/backend-api/conversations/test');
    await settlePromises();
    f.menus.get('cghs-mode-always')();
    await f.advance(1500);
    assert.equal(firstRequests, 1);
    assert.match(navRoot(f).querySelector('.status').textContent, /全部 2/);
});

test('原生中间分页不能被当作完整会话起点', async t => {
    const f = fixture(t, { mode: 'off' });
    f.window.fetch = async () => responseData({ messages: [apiMessage('u1', '中间页问题')],
        page_info: { has_previous_page: false } });
    let diagnostics;
    f.window.GM_setClipboard = text => { diagnostics = text; };
    f.start();
    await f.window.fetch('/backend-api/conversations/test/messages?before=cursor');
    await settlePromises();
    f.menus.get('查看脚本状态')();
    f.document.getElementById('cghs-navigation-diagnostics').shadowRoot.querySelector('button').click();
    assert.match(diagnostics, /完整索引：idle/);
    assert.match(diagnostics, /分页消息 1 条/);
});
