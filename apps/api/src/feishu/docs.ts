// 把一页结论导出成飞书云文档（决策 15）：用应用身份建文档（Markdown → 文档块），然后把所有权转给接入者、
// 需要时给这个群加查看权限。不用用户身份授权：那条路要在开发者后台手动填重定向地址，扫码加不了。
import { z } from '@pux/core';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import { paramsOf, type Actor } from '@pux/agent';
import * as E from '@pux/engine';
import { chatOfSession, type FeishuChannel } from './channel.ts';

const VERDICT: Record<string, string> = { works: '多数人用得下去', mixed: '有人行，有人不行', not_yet: '多数人用不下去', too_early: '还太早' };

/** 一页结论 + 问题清单 → Markdown（纯函数） */
export function reportMarkdown(l: { name: string; tagline: string; url: string }, r: E.ReportView, eng: E.EngineeringView | undefined, link: (p: string) => string): string {
  const cite = (c: E.ReportView['hurts'][number]) => [`- ${c.text}`, ...c.moments.slice(0, 3).map((m) => `  - ${m.persona}（${m.who}）：「${m.quote}」 [这次使用](${link(`/sessions/${m.session_id}`)})`), ...c.passersby.slice(0, 2).map((p) => `  - ${p.persona}（${p.who}）：「${p.thought}」`)].join('\n');
  const sec = (t: string, xs: E.ReportView['hurts']) => (xs.length ? `\n## ${t}\n${xs.map(cite).join('\n')}\n` : '');
  const f = r.funnel;
  const out = [
    `# ${l.name}：${r.headline}`, '', `${l.tagline} · ${l.url}`, '', `**${VERDICT[r.verdict] ?? r.verdict}**。${r.summary}`, '',
    `看到 ${f.reached} 人 → 注意到 ${f.noticed} → 有兴趣 ${f.interested} → 打开过 ${f.opened} → 回来再用 ${f.came_back}（这座城里实际发生的人数，模拟）`,
    r.next ? `\n## 如果只改一件事\n${r.next}\n` : '',
    sec('最让人难受的地方', r.hurts), sec('让人高兴的地方', r.delights), sec('会留下的人', r.who_stays), sec('会走的人', r.who_leaves), sec('看到了却没点开', r.why_not_opened),
  ];
  if (eng?.experienced.length) out.push('\n## 虚拟人亲身遇到的问题', ...eng.experienced.slice(0, 12).map((i) => `- **[${i.severity}] ${i.title}**${i.where ? `（${i.where}）` : ''}：${i.people} 人遇到${i.reproduced ? '，已复现' : ''}。${i.description}${i.steps.length ? `\n  - 复现：${i.steps.join(' → ')}` : ''}`));
  out.push('', `---`, `由 Jobs 生成于 ${new Date().toLocaleString('zh-CN', { hour12: false, timeZone: 'Asia/Shanghai' })}。网页上的完整结论：${link('/products/' + encodeURIComponent((r as unknown as { launch_id?: string }).launch_id ?? ''))}`);
  return out.filter((x) => x !== '').join('\n');
}

export async function exportReportDoc(fs: FeishuChannel, product: string, o: { shareChat?: string; link: (p: string) => Promise<string> }): Promise<string> {
  if (!fs.ch || !fs.saved) throw new Error('飞书还没接入');
  const c = fs.ch.rawClient;
  const l = await E.getLaunch(product); if (!l) throw new Error(`没有找到产品「${product}」`);
  const r = await E.launchReport(l, 'zh'); const eng = { experienced: await E.experiencedIssues(l), appendix: [] } as unknown as E.EngineeringView;
  const paths = new Set<string>([`/products/${l.id}`, ...r.hurts.concat(r.delights, r.who_stays, r.who_leaves).flatMap((x) => x.moments.map((m) => `/sessions/${m.session_id}`))]);
  const signed = new Map<string, string>(); for (const p of paths) signed.set(p, await o.link(p));
  const mdText = reportMarkdown(l, { ...r, launch_id: l.id } as unknown as E.ReportView, eng, (p) => signed.get(p) ?? p);
  const ok = <T extends { code?: number; msg?: string }>(x: T, what: string) => { if (x.code) throw new Error(`${what}失败（飞书 ${x.code}：${x.msg ?? ''}）。如果是权限不够，在网页「设置 › 飞书」里重新扫码补权限`); return x; };
  const doc = ok(await c.docx.document.create({ data: { title: `${l.name} · Jobs 结论` } }), '建文档');
  const id = doc.data?.document?.document_id; if (!id) throw new Error('建文档失败');
  const conv = ok(await c.docx.document.convert({ data: { content_type: 'markdown', content: mdText } }), '转换内容');
  const blocks = (conv.data?.blocks ?? []).map((b) => { const x = { ...b } as Record<string, unknown>; const t = x.table as { property?: Record<string, unknown> } | undefined; if (t?.property) delete t.property.merge_info; return x; });
  ok(await c.docx.documentBlockDescendant.create({ path: { document_id: id, block_id: id }, data: { children_id: conv.data?.first_level_block_ids ?? [], descendants: blocks as never, index: 0 } }), '写入内容');
  const owner = fs.saved.owner;
  if (owner) {
    await c.drive.permissionMember.create({ path: { token: id }, params: { type: 'docx', need_notification: false }, data: { member_type: 'openid', member_id: owner, perm: 'full_access' } }).catch(() => undefined);
    await c.drive.permissionMember.transferOwner({ path: { token: id }, params: { type: 'docx', need_notification: false, remove_old_owner: false }, data: { member_type: 'openid', member_id: owner } }).catch(() => undefined);
  }
  if (o.shareChat) await c.drive.permissionMember.create({ path: { token: id }, params: { type: 'docx', need_notification: false }, data: { member_type: 'openchat', member_id: o.shareChat, perm: 'view' } }).catch(() => undefined);
  return `${fs.saved.brand === 'lark' ? 'https://larksuite.com' : 'https://feishu.cn'}/docx/${id}`;
}

/** 飞书里才有的工具：导出成云文档 */
export function docsTools(fs: FeishuChannel, session: string, actor: Actor, link: (p: string) => Promise<string>): AgentTool<object>[] {
  return [{
    name: 'export_report_doc', label: '导出成云文档',
    description: '把一个产品的一页结论和问题清单导出成一篇飞书云文档（带每句话的当事人原话和网页链接），返回文档链接。用户说「把结论发给团队」「导出成文档」时用。share_here=true 时给这个聊天的成员加查看权限。只有管理员能用。',
    parameters: paramsOf({ product: z.string().describe('发布 id 或产品名'), share_here: z.boolean().optional() }),
    execute: async (_id, raw) => {
      if (actor.role !== 'admin') throw new Error('只有管理员能导出云文档');
      const a = raw as { product: string; share_here?: boolean };
      const url = await exportReportDoc(fs, a.product, { shareChat: a.share_here ? chatOfSession(session).chat_id : undefined, link });
      return { content: [{ type: 'text', text: `已导出：${url}${a.share_here ? '（这个聊天的成员都能看）' : '（所有权已转给接入者）'}` }], details: null };
    },
  }];
}
