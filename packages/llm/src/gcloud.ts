// 「使用这台机器的 gcloud 登录」：直接读 gcloud 自己的配置目录（gcloud auth login 写出的东西），不需要 ADC 文件或任何手写的副本。
// 当前账号与默认项目来自 active_config → configurations/config_<名字> 的 [core] account / project；
// 凭证来自 credentials.db（gcloud 自己用的那份），没有时退回 gcloud 同时写出的 legacy_credentials/<账号>/adc.json。
// 每次换令牌前按文件修改时间判断要不要重读，所以宿主机上重新 gcloud auth login、换账号或换项目都会直接生效。
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export interface GcloudLogin { dir: string; account: string; project?: string; cred: Record<string, unknown> }
export class GcloudError extends Error {}

/** 可能的 gcloud 配置目录（存在的才返回）：CLOUDSDK_CONFIG、本进程用户的 ~/.config/gcloud、Windows 的 %APPDATA%\gcloud、/home/* 下的 */
export function gcloudDirs(): string[] {
  const c: string[] = [];
  if (process.env.CLOUDSDK_CONFIG) c.push(process.env.CLOUDSDK_CONFIG);
  c.push(join(homedir(), '.config', 'gcloud'));
  if (process.env.APPDATA) c.push(join(process.env.APPDATA, 'gcloud'));
  c.push('/root/.config/gcloud');
  try { for (const u of readdirSync('/home')) c.push(join('/home', u, '.config', 'gcloud')); } catch { /* 没有 /home */ }
  return [...new Set(c)].filter((d) => { try { return statSync(d).isDirectory(); } catch { return false; } });
}

function ini(text: string, section: string): Record<string, string> {
  const out: Record<string, string> = {}; let cur = '';
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim(); if (!line || line.startsWith('#') || line.startsWith(';')) continue;
    const s = /^\[(.+)\]$/.exec(line); if (s) { cur = s[1].trim(); continue; }
    const kv = /^([^=]+?)\s*=\s*(.*)$/.exec(line); if (kv && cur === section) out[kv[1].trim()] = kv[2].trim();
  }
  return out;
}

const mtime = (f: string) => { try { return statSync(f).mtimeMs; } catch { return 0; } };
const cache = new Map<string, { stamp: string; login: GcloudLogin }>();

/** 读一个 gcloud 配置目录里当前登录的账号、默认项目与凭证；读不到时抛出说清原因的 GcloudError */
export function readGcloud(dir: string): GcloudLogin {
  if (!existsSync(dir)) throw new GcloudError(`读不到 gcloud 的配置目录 ${dir}：确认它挂进了容器`);
  const name = (() => { try { return readFileSync(join(dir, 'active_config'), 'utf8').trim() || 'default'; } catch { return 'default'; } })();
  const confFile = join(dir, 'configurations', `config_${name}`);
  const db = join(dir, 'credentials.db');
  const base = [name, mtime(join(dir, 'active_config')), mtime(confFile), mtime(db)].join('|');
  const legacyOf = (account: string) => join(dir, 'legacy_credentials', account, 'adc.json');
  const hit = cache.get(dir);
  if (hit && hit.stamp === `${base}|${mtime(legacyOf(hit.login.account))}`) return hit.login;
  let core: Record<string, string> = {};
  try { core = ini(readFileSync(confFile, 'utf8'), 'core'); } catch { /* 没有配置文件：等同于没登录 */ }
  const account = core.account;
  if (!account) throw new GcloudError('这台机器的 gcloud 还没有登录：在这台机器上运行 gcloud auth login');
  let cred: Record<string, unknown> | undefined;
  if (existsSync(db)) {
    try {
      const d = new DatabaseSync(db, { readOnly: true });
      try { const row = d.prepare('select value from credentials where account_id = ?').get(account) as { value?: string | Uint8Array } | undefined; if (row?.value) cred = JSON.parse(typeof row.value === 'string' ? row.value : Buffer.from(row.value).toString('utf8')) as Record<string, unknown>; }
      finally { d.close(); }
    } catch { /* 读不了数据库（比如正被写）：退回 legacy 文件 */ }
  }
  if (!cred) { try { cred = JSON.parse(readFileSync(legacyOf(account), 'utf8')) as Record<string, unknown>; } catch { /* 没有 */ } }
  if (!cred) throw new GcloudError(`gcloud 里找不到账号 ${account} 的凭证：在这台机器上重新运行 gcloud auth login`);
  const login: GcloudLogin = { dir, account, project: core.project || undefined, cred };
  cache.set(dir, { stamp: `${base}|${mtime(legacyOf(account))}`, login });
  return login;
}

/** 给「模型」页的按钮用：找到第一个有登录的 gcloud 目录（不返回任何凭证内容） */
export function probeGcloud(): { found: boolean; dir?: string; account?: string; project?: string; error?: string; tried: string[]; in_container: boolean } {
  const dirs = gcloudDirs(); let error: string | undefined;
  for (const dir of dirs) {
    try { const l = readGcloud(dir); return { found: true, dir, account: l.account, project: l.project, error: l.project ? undefined : '没有默认项目：在这台机器上运行 gcloud config set project <项目 ID>', tried: dirs, in_container: !!process.env.JOBS_IN_CONTAINER }; }
    catch (e) { error ??= (e as Error).message; }
  }
  return { found: false, error: error ?? '没有找到 gcloud 的配置目录', tried: dirs, in_container: !!process.env.JOBS_IN_CONTAINER };
}
