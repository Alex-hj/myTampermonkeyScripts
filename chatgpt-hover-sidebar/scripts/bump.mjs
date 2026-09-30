// 以 src/header.txt 的 @version 为唯一来源：同步 package.json 与 package-lock.json，并重新构建脚本。
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { headerFile, root, writeBuild } from './build.mjs';

function readHeaderVersion() {
    const match = readFileSync(headerFile, 'utf8').match(/^\/\/ @version\s+(\d+\.\d+\.\d+)\s*$/m);
    if (!match) throw new Error('src/header.txt 中没有形如 x.y.z 的 @version');
    return match[1];
}

function updateJson(fileName, update) {
    const file = join(root, fileName);
    const data = JSON.parse(readFileSync(file, 'utf8'));
    update(data);
    writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
}

const version = readHeaderVersion();
updateJson('package.json', pkg => { pkg.version = version; });
updateJson('package-lock.json', lock => {
    lock.version = version;
    lock.packages[''].version = version;
});
await writeBuild();
console.log(`版本号已同步为 ${version}`);
