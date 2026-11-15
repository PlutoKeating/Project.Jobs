/** 首页。事实依据 README.md、PRODUCT.md、docs/INSTALL.md。 */
import { GITHUB_REPO, INSTALL_COMMAND, langOf } from '../site.mjs';
import { ICON, esc, inline } from '../render.mjs';
import { renderFigure } from '../figures.mjs';
import { shell } from '../shell.mjs';

export const home = {
  zh: {
    title: 'Jobs — 发布之前，先让一座城的人用用看',
    description: '把产品发布到 JobsWorld：一座住着两百位虚拟居民的城。他们自己决定看不看、用不用、留不留、跟谁说。',
    heading: ['发布之前，', '先让一座城的人', '用用看。'],
    lede: '把网址交给 Jobs。JobsWorld 里住着两百个各不相同的人：他们过着自己的日子，在应用商店、广告和朋友口中遇到你的产品，自己决定看不看、用不用、留不留、跟谁说。',
    copy: '复制',
    copied: '已复制',
    copyLabel: '复制安装命令',
    need: '需要一台装了 Docker 的机器。装好后打开网页，接入你自己的模型供应商。[先看看这个脚本做什么](/install)',
    shotAlt: 'Jobs 的首屏：一座侧视的像素小城，右侧是已发布的产品和城里的人此刻在做什么',
    // 三章，各配一幅示意图（src/figures.mjs：journey、screen、verdict）
    chapters: [
      { heading: '发布之后，他们自己决定', body: '粘贴网址、名字、一句话，本机上的开发服务器也行。没有人被指派去测试：谁会遇到它、谁会注意到，由规则算；点不点开、怎么用、跟谁说，由他们自己决定。' },
      { heading: '他们只看得到屏幕', body: '地铁上单手拿着手机的人、带着孩子的人、只剩五分钟的人，各自在此时此地的处境里用。交到他们手上的只有屏幕上的画面，他们也不知道这是一次测试。' },
      { heading: '读一页人话', body: '好不好用，哪里最让人难受，谁会留下谁会走，看到的人为什么没点开，最该改的一件事。每一句都能点开看是谁说的、原话和当时的屏幕。' },
    ],
    also: {
      heading: '也在终端和 coding agent 里',
      body: '写完代码就发布，取回结论和带复现步骤的问题清单，接着改。同一座城还能用 Terraria 走进去，或者接到飞书里。',
      comment1: '# 发布、看状况、要结论',
      productName: '闪念笔记',
      productTagline: '想到什么，马上记下',
      comment2: '# 接进 Claude Code（其他支持 MCP 的 agent 同理）',
    },
    factsHeading: '全部跑在你自己的机器上',
    factsBody: '网页、命令行、coding agent、飞书、Terraria 是同一套能力的五个入口。往外走的只有两处：你的产品，和你接入的模型供应商。',
    facts: [
      { heading: '数据不出你的机器', body: '居民、记忆、截图和结论都存在你机器上的 Docker 卷里，不经过我们的服务器。' },
      { heading: '模型由你接入', body: '在网页里选供应商、粘贴 Key、勾选模型。花了多少，页头一直显示。' },
      { heading: '开源', body: `以 AGPL-3.0 发布，[源码在 GitHub](${GITHUB_REPO})。` },
    ],
    closing: '一行命令，一座城。',
    copyLabelAgain: '再次复制安装命令',
  },
  en: {
    title: 'Jobs — Before you launch, let a whole town try it',
    description: 'Launch your product into JobsWorld, a town of two hundred virtual residents who decide for themselves whether to look, to use it, to stay and whom to tell.',
    heading: ['Before you launch,', 'let a whole town', 'try it.'],
    lede: 'Hand Jobs a URL. Two hundred very different people live in JobsWorld. They get on with their own days, come across your product in the app store, in ads and from friends, and decide for themselves whether to look, to use it, to stay and whom to tell.',
    copy: 'Copy',
    copied: 'Copied',
    copyLabel: 'Copy the install command',
    need: 'You need a machine with Docker. Once it is up, open the web page and connect your own model provider. [Read the script first](/install)',
    shotAlt: 'The first screen of Jobs: a side-view pixel town, with the launched products and what residents are doing right now on the right',
    chapters: [
      { heading: 'After you launch, they decide', body: 'Paste a URL, a name and one line; a dev server on your own machine works too. Nobody is assigned to test. Rules work out who comes across it and who notices. Whether to open it, how to use it and whom to tell is up to them.' },
      { heading: 'The screen is all they can see', body: 'Someone on the subway with one free hand, someone minding a child, someone with five minutes left: each uses it in their own here and now. All they are handed is what is on the screen, and they do not know it is a test.' },
      { heading: 'Read one plain page', body: 'Whether it works, what hurt most, who stays and who leaves, why people who saw it did not open it, and the one thing to fix first. Every sentence opens to who said it, their words and the screen at that moment.' },
    ],
    also: {
      heading: 'In your terminal and your coding agent too',
      body: 'Launch as soon as the code is written, pull back the conclusion and a list of issues with steps to reproduce, and keep going. You can also walk into the same town in Terraria, or connect it to Feishu.',
      comment1: '# launch, check on it, get the conclusion',
      productName: 'Quick Notes',
      productTagline: 'Write it down the moment you think of it',
      comment2: '# add it to Claude Code (any agent that speaks MCP works the same way)',
    },
    factsHeading: 'It all runs on your machine',
    factsBody: 'The web page, the command line, coding agents, Feishu and Terraria are five ways into the same capabilities. Only two things reach outside: your product, and the model providers you connect.',
    facts: [
      { heading: 'Your data stays put', body: 'Residents, memories, screenshots and conclusions live in Docker volumes on your machine and never pass through our servers.' },
      { heading: 'You bring the models', body: 'Pick a provider in the web page, paste a key, tick the models. What you have spent stays in the page header.' },
      { heading: 'Open source', body: `Released under AGPL-3.0, with the [source on GitHub](${GITHUB_REPO}).` },
    ],
    closing: 'One line. One town.',
    copyLabelAgain: 'Copy the install command again',
  },
};

/** 参数里有空格或标点时加引号，和真实终端里一样。 */
const arg = (s) => (/^[\p{L}\p{N}._-]+$/u.test(s) ? s : `"${s}"`);

/** 三章各自的示意图，顺序与文案里的 chapters 一致。 */
const CHAPTER_FIGURES = ['journey', 'screen', 'verdict'];

/** 安装命令的那一行。页面上有两处（开头与结尾），id 不同，复制按钮各管各的。 */
function installBox(t, id, label) {
  return `<div class="install" id="${id}">
      <code id="${id}-command">${esc(INSTALL_COMMAND)}</code>
      <button type="button" data-copy="${id}-command" data-label-copy="${esc(t.copy)}" data-label-copied="${esc(t.copied)}" aria-label="${esc(label)}">${ICON.copy}${ICON.check}<span aria-live="polite">${esc(t.copy)}</span></button>
    </div>`;
}

export function renderHome(lang, assets) {
  const t = home[lang];
  const a = t.also;
  const shot = (theme) =>
    `<img class="shot-${theme}" src="${assets.shot(lang, theme)}" width="1600" height="900" alt="${esc(t.shotAlt)}"${theme === 'light' ? ' loading="lazy"' : ''} decoding="async">`;
  const chapter = (c, i) => `<section class="col chapter" aria-labelledby="chapter-${i + 1}">
    <div class="chapter-head">
      <h2 id="chapter-${i + 1}">${esc(c.heading)}</h2>
      <p>${esc(c.body)}</p>
    </div>
    ${renderFigure(CHAPTER_FIGURES[i], lang)}
  </section>`;
  return `<main id="main">
  <section class="col hero">
    <h1>${t.heading.map((part) => `<span>${esc(part)}</span>`).join(langOf(lang).spaced ? ' ' : '<wbr>')}</h1>
    <p class="lede">${esc(t.lede)}</p>
    ${installBox(t, 'install', t.copyLabel)}
    <p class="need">${inline(t.need)}</p>
  </section>
  <figure class="col shot">
    ${shot('dark')}
    ${shot('light')}
    <figcaption>${esc(shell[lang].tribute)}</figcaption>
  </figure>
  ${t.chapters.map(chapter).join('\n  ')}
  <section class="col chapter" aria-labelledby="also-heading">
    <div class="also">
      <div>
        <h2 id="also-heading">${esc(a.heading)}</h2>
        <p>${esc(a.body)}</p>
      </div>
      <pre tabindex="0"><span class="c">${esc(a.comment1)}</span>
jobsworld publish http://127.0.0.1:3000/ \\
  --name ${esc(arg(a.productName))} --tagline ${esc(arg(a.productTagline))}
jobsworld status ${esc(arg(a.productName))}
jobsworld report ${esc(arg(a.productName))} --eng

<span class="c">${esc(a.comment2)}</span>
claude mcp add jobs -- jobsworld mcp</pre>
    </div>
    ${renderFigure('loop', lang)}
  </section>
  <section class="col chapter" aria-labelledby="facts-heading">
    <div class="chapter-head">
      <h2 id="facts-heading">${esc(t.factsHeading)}</h2>
      <p>${esc(t.factsBody)}</p>
    </div>
    ${renderFigure('stack', lang)}
    <ul class="facts">
      ${t.facts.map((s) => `<li><h3>${esc(s.heading)}</h3><p>${inline(s.body)}</p></li>`).join('\n      ')}
    </ul>
  </section>
  <section class="col closing" aria-labelledby="closing-heading">
    <h2 id="closing-heading">${esc(t.closing)}</h2>
    ${installBox(t, 'install-again', t.copyLabelAgain)}
    <p class="need">${inline(t.need)}</p>
  </section>
</main>`;
}
