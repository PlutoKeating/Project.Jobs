/** 404 页：每种语言一份（<前缀>/404.html）。Cloudflare 对不存在的路径返回最近一层目录里的 404.html，所以 /en/ 下面的坏链接看到的是英文。 */
import { pathFor } from '../site.mjs';
import { shell } from '../shell.mjs';
import { esc } from '../render.mjs';

export function renderNotFound(lang) {
  const t = shell[lang].notFound;
  return `<main id="main">
  <div class="col not-found">
    <h1>${esc(t.title)}</h1>
    <p>${esc(t.line)}</p>
    <a class="button" href="${pathFor(lang, 'home')}">${esc(t.home)}</a>
  </div>
</main>`;
}
