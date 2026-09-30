// 发布相关：脚本头、版本号与构建产物保持一致。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const root = join(__dirname, '..');
const artifact = readFileSync(join(root, 'chatgpt-hover-sidebar.user.js'), 'utf8');

function normalizeLineEndings(text) {
    return text.replace(/\r\n/g, '\n');
}

test('自动更新地址和版本与发布配置一致', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    assert.match(artifact, new RegExp(`@version\\s+${pkg.version.replaceAll('.', '\\.')}`));
    const expected = 'https://raw.githubusercontent.com/Alex-hj/myTampermonkeyScripts/main/chatgpt-hover-sidebar/chatgpt-hover-sidebar.user.js';
    assert.equal(artifact.match(/@updateURL\s+(\S+)/)[1], expected);
    assert.equal(artifact.match(/@downloadURL\s+(\S+)/)[1], expected);
});

test('构建产物与 src 源码同步', async () => {
    const { buildScript } = await import('../scripts/build.mjs');
    const fresh = normalizeLineEndings(await buildScript());
    assert.ok(normalizeLineEndings(artifact) === fresh, '构建产物已过期：请运行 npm run build 后一并提交');
});
