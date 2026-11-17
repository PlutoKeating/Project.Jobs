// jobsworld chat —— 在终端里跟 Jobs 说话（和飞书、网页右下角的对话是同一个 Jobs Agent；网页与终端共用同一条对话）。
// 每句话经 POST /api/v1/agent/send，边生成边打出来；清零、下线这类要确认的事在这里输入 y 确认。
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { api, apiBase } from './client.ts';

type Ev = { type: string; delta?: string; text?: string; label?: string; status?: string; action_id?: string; name?: string; resident?: { name: string } | null; evidence_id?: string; caption?: string; error?: string; aborted?: boolean; detail?: string };
const key = () => process.env.JOBS_KEY ?? process.env.JW_ADMIN_PASSCODE ?? process.env.JW_PASSCODE ?? '';
const dim = (s: string) => (stdout.isTTY ? `\x1b[2m${s}\x1b[0m` : s);
const amber = (s: string) => (stdout.isTTY ? `\x1b[33m${s}\x1b[0m` : s);

async function* events(text: string, signal: AbortSignal): AsyncGenerator<Ev> {
  const r = await fetch(`${apiBase()}/api/v1/agent/send`, { method: 'POST', signal, headers: { 'content-type': 'application/json', ...(key() ? { authorization: `Bearer ${key()}` } : {}) }, body: JSON.stringify({ text, client: 'cli' }) });
  if (!r.ok || !r.body) throw new Error(r.status === 401 || r.status === 403 ? `没有权限（${r.status}）：把口令放进环境变量 JOBS_KEY` : `${r.status} ${await r.text().catch(() => '')}`);
  const rd = r.body.getReader(); const dec = new TextDecoder(); let buf = '';
  for (;;) {
    const { done, value } = await rd.read(); if (done) return;
    buf += dec.decode(value, { stream: true }); let i: number;
    while ((i = buf.indexOf('\n\n')) >= 0) { const chunk = buf.slice(0, i); buf = buf.slice(i + 2); const line = chunk.split('\n').find((l) => l.startsWith('data:')); if (line) yield JSON.parse(line.slice(5)) as Ev; }
  }
}

export async function runChat(once?: string) {
  const rl = once ? undefined : createInterface({ input: stdin, output: stdout });
  let resident: string | null = null; const pending: { id: string; label: string }[] = [];
  if (!once) console.log(dim(`Jobs（${apiBase()}）。直接说话；/new 重新开始，/stop 停下，Ctrl+C 退出。`));
  for (;;) {
    const text: string | null = once ?? (await rl!.question(resident ? amber(`你 → ${resident}：`) : '你：').catch(() => null));
    if (text == null) break;
    if (!text.trim()) continue;
    // 确认卡片：y / n
    if (pending.length && /^(y|yes|确认|是|n|no|取消|否)$/i.test(text.trim())) {
      const a = pending.shift()!; const ok = /^(y|yes|确认|是)$/i.test(text.trim());
      const o = await api<{ text: string }>(`/agent/actions/${a.id}`, { body: { approve: ok } });
      console.log(`${ok ? '✅' : '↩'} ${a.label}：${o.text}\n`); continue;
    }
    const ac = new AbortController(); const onInt = () => ac.abort(); process.once('SIGINT', onInt);
    let wrote = false;
    try {
      for await (const e of events(text, ac.signal) as AsyncGenerator<Ev>) {
        if (e.type === 'text') { if (!wrote) { stdout.write('Jobs：'); wrote = true; } stdout.write(e.delta ?? ''); }
        else if (e.type === 'step' && e.status === 'running') stdout.write(dim(`${wrote ? '\n' : ''}  · ${e.label}…\n`)), (wrote = false);
        else if (e.type === 'step' && e.status === 'error') stdout.write(dim(`  · ${e.label} 出错${e.detail ? `：${e.detail}` : ''}\n`));
        else if (e.type === 'image') stdout.write(dim(`\n  [截图] ${e.caption ?? ''} ${apiBase()}/api/v1/evidence/${e.evidence_id}\n`));
        else if (e.type === 'confirm') { pending.push({ id: e.action_id!, label: e.label ?? '' }); stdout.write(amber(`\n  ⚠ 要确认：${e.text}\n  输入 y 确认，n 取消（30 分钟内有效）\n`)); }
        else if (e.type === 'mode') resident = e.resident?.name ?? null;
        else if (e.type === 'resident') stdout.write(`${amber(`${e.name}：`)}${e.text}`), (wrote = true);
        else if (e.type === 'notice') stdout.write(dim(`  ${e.text}\n`));
        else if (e.type === 'end') { if (e.error) stdout.write(`${wrote ? '\n' : ''}❌ ${e.error}`); else if (e.aborted) stdout.write(dim(' （已停止）')); else if (!wrote && e.text) stdout.write(`Jobs：${e.text}`); }
      }
    } catch (e) { if (!ac.signal.aborted) console.error(`❌ ${(e as Error).message}`); }
    finally { process.off('SIGINT', onInt); }
    stdout.write('\n\n');
    if (once) break;
  }
  rl?.close();
}
