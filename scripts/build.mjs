// 딸깍.exe 만들기 (Node SEA): npm run build → dist/딸깍.exe
// 에이전트 코드 + ws·qrcode + web/ 파일을 node.exe 하나에 묻는다. PC방처럼 Node 없는 PC 에서도 실행.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist);

await build({
  entryPoints: [path.join(root, 'agent', 'main.js')], bundle: true, platform: 'node', format: 'cjs', target: 'node22',
  outfile: path.join(dist, 'main.cjs'), logLevel: 'warning',
  define: { 'import.meta.url': '__metaUrl' }, banner: { js: 'const __metaUrl = require("url").pathToFileURL(__filename).href;' },
});

// web/ 전부 (시안용 큰 그림 제외)
const assets = { 'window.ps1': path.join(root, 'agent', 'window.ps1'), 'ttalkkak.ico': path.join(root, 'scripts', 'ttalkkak.ico') };
// 글꼴 없는 PC 용 (SIL OFL — 재배포 가능). 빌드하는 PC 에 깔린 파일을 넣는다
for (const f of ['C:\\Windows\\Fonts\\NotoSerifKR-VF.ttf']) if (fs.existsSync(f)) assets['NotoSerifKR.ttf'] = f; // PC 창 (WinForms)
const walk = d => fs.readdirSync(d, { withFileTypes: true }).forEach(e => {
  const f = path.join(d, e.name);
  if (e.isDirectory()) return walk(f);
  if (/^(paint|devil-found)\.png$/.test(e.name)) return;
  assets[path.relative(root, f).replaceAll('\\', '/')] = f;
});
walk(path.join(root, 'web'));
fs.writeFileSync(path.join(dist, 'sea-config.json'), JSON.stringify({
  main: path.join(dist, 'main.cjs'), output: path.join(dist, 'sea.blob'), disableExperimentalSEAWarning: true, assets,
}));
execFileSync(process.execPath, ['--experimental-sea-config', path.join(dist, 'sea-config.json')], { stdio: 'inherit' });

const exe = path.join(dist, '딸깍.exe');
fs.copyFileSync(process.execPath, exe);
execFileSync(process.execPath, [path.join(root, 'node_modules', 'postject', 'dist', 'cli.js'), exe, 'NODE_SEA_BLOB', path.join(dist, 'sea.blob'),
  '--sentinel-fuse', 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2'], { stdio: 'inherit' });
for (const f of ['main.cjs', 'sea.blob', 'sea-config.json']) fs.rmSync(path.join(dist, f));
console.log(`완성: ${exe} (${(fs.statSync(exe).size / 1e6).toFixed(0)} MB, 에셋 ${Object.keys(assets).length}개)`);
