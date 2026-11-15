#!/usr/bin/env node
/**
 * build-fonts.mjs — 按页面文案实际用到的汉字与全角标点，从本机的思源黑体切出两枚 woff2 子集（Regular 与 Bold）。
 *
 *   node site/scripts/build-fonts.mjs
 *
 * 需要：python3 的 fontTools 与 brotli；Debian / Ubuntu 的 fonts-noto-cjk
 * （/usr/share/fonts/opentype/noto/NotoSansCJK-{Regular,Bold}.ttc，可用环境变量 CJK_FONT_SOURCE_DIR 指到别处）。
 * 文案里出现了新的汉字之后运行一次，再运行 build.mjs（字体内容变了，css 里的 ?v= 要跟着变），两者的产物一起提交。
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { LANGS } from '../src/site.mjs';
import { shell } from '../src/shell.mjs';
import { home } from '../src/pages/home.mjs';
import { about } from '../src/pages/about.mjs';
import { terms } from '../src/pages/terms.mjs';
import { privacy } from '../src/pages/privacy.mjs';
import { figureText } from '../src/figures.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceDir = process.env.CJK_FONT_SOURCE_DIR || '/usr/share/fonts/opentype/noto';
const FACES = [
  { file: 'NotoSansCJK-Regular.ttc', out: 'fonts/NotoSansSC-Regular.subset.woff2' },
  { file: 'NotoSansCJK-Bold.ttc', out: 'fonts/NotoSansSC-Bold.subset.woff2' },
];

/** 文案对象里出现的全部字符（码位 ≥ U+2E80：汉字、假名、全角标点；拉丁字母与数字由 Inter 出字）。 */
const chars = new Set();
const walk = (v) => {
  if (typeof v === 'string') { for (const ch of v) if (ch.codePointAt(0) >= 0x2e80) chars.add(ch); }
  else if (v && typeof v === 'object') Object.values(v).forEach(walk);
};
[shell, home, about, terms, privacy, figureText, LANGS].forEach(walk);
const text = [...chars].sort().join('');

for (const f of FACES) {
  if (!existsSync(join(sourceDir, f.file))) throw new Error(`找不到字体源 ${join(sourceDir, f.file)}：安装 fonts-noto-cjk，或设置 CJK_FONT_SOURCE_DIR`);
}
try {
  execFileSync('python3', ['-I', '-c', 'import fontTools.subset, brotli'], { stdio: 'ignore' });
} catch {
  throw new Error('需要 python3 的 fontTools 与 brotli（pip install fonttools brotli）');
}

const py = (code, ...args) => execFileSync('python3', ['-I', '-c', code, ...args], { encoding: 'utf8' }).trim();
const tmp = mkdtempSync(join(tmpdir(), 'jobs-cjk-'));
try {
  const textFile = join(tmp, 'chars.txt');
  writeFileSync(textFile, text, 'utf8');
  for (const f of FACES) {
    const ttc = join(sourceDir, f.file);
    const out = resolve(root, f.out);
    // 合集里简体中文那一面的序号按名字查，不写死
    const index = py(
      "import sys\nfrom fontTools.ttLib import TTCollection\nc=TTCollection(sys.argv[1],lazy=True)\nprint([i for i,f in enumerate(c.fonts) if f['name'].getDebugName(1).startswith('Noto Sans CJK SC')][0])",
      ttc,
    );
    execFileSync(
      'python3',
      ['-I', '-m', 'fontTools.subset', ttc, `--font-number=${index}`, `--text-file=${textFile}`, '--flavor=woff2', `--output-file=${out}`, '--layout-features=kern,palt', '--no-hinting', '--desubroutinize', '--no-recalc-timestamp', '--name-IDs=0,1,2,3,4,5,6,13,14'],
      { stdio: 'inherit' },
    );
    const lost = py(
      'import sys\nfrom fontTools.ttLib import TTFont, TTCollection\nwant=set(open(sys.argv[1],encoding="utf-8").read())\nsrc=TTCollection(sys.argv[2],lazy=True).fonts[int(sys.argv[3])].getBestCmap()\nsub=TTFont(sys.argv[4]).getBestCmap()\nprint("".join(sorted(ch for ch in want if ord(ch) in src and ord(ch) not in sub)))',
      textFile, ttc, index, out,
    );
    if (lost) throw new Error(`${f.out} 缺字：${lost}`);
    console.log(`已生成 ${f.out}（${statSync(out).size} 字节）`);
  }
  // 子集清单：以 Regular 实际包含的字符为准；build.mjs 用它核对页面上有没有子集里没有的字
  const covered = py('import sys\nfrom fontTools.ttLib import TTFont\nprint("".join(sorted(chr(c) for c in TTFont(sys.argv[1]).getBestCmap() if c>=0x2E80)))', resolve(root, FACES[0].out));
  writeFileSync(resolve(root, 'fonts/NotoSansSC.subset.txt'), `${covered}\n`, 'utf8');
  console.log(`子集清单 fonts/NotoSansSC.subset.txt：${[...covered].length} 字（文案用字 ${chars.size}）`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
