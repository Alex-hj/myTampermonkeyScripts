// 把 src/ 下的 ES 模块打包成单个可直接安装的 chatgpt-hover-sidebar.user.js。
import { build } from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = join(dirname(fileURLToPath(import.meta.url)), '..');
export const headerFile = join(root, 'src', 'header.txt');
const outputFile = join(root, 'chatgpt-hover-sidebar.user.js');

const GENERATED_NOTICE = '// 此文件由 scripts/build.mjs 从 src/ 打包生成，请勿直接修改；改动源码后运行 npm run build。';

// 返回完整脚本文本：UserScript 元数据头 + 打包后的代码。
export async function buildScript() {
    const header = readFileSync(headerFile, 'utf8').trimEnd();
    const result = await build({
        entryPoints: [join(root, 'src', 'main.js')],
        bundle: true,
        format: 'iife',
        target: 'es2022',
        charset: 'utf8', // 保留中文原文，便于阅读和 Greasy Fork 审核。
        minify: false, // Greasy Fork 不接受压缩或混淆的代码。
        write: false,
        logLevel: 'warning',
        banner: { js: `${header}\n\n${GENERATED_NOTICE}\n'use strict';` },
    });
    return result.outputFiles[0].text;
}

export async function writeBuild() {
    writeFileSync(outputFile, await buildScript());
    console.log(`已生成 ${outputFile}`);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === join(process.argv[1]);
if (isMain) await writeBuild();
