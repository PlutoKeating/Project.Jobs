// 生活目标：用生活语言表达（例如「赶在 9 点前把方案发给老板」），而不是「测试导出功能」（§4）
import { newId, shortHash, z, type Mode, type PersonaSpec, type WorldTemplate, langOf } from '@pux/core';
import { getDb, goals } from '@pux/db';
import { gateway } from '@pux/llm';
import { containsBannedWords } from '../runtime/roles.ts';
import { personaBio } from '../human/persona.ts';

export interface TaskLite { id: string; statement: string; statement_en?: string | null; requires_login?: boolean }

const GoalSchema = z.object({ goal: z.string(), why_now: z.string() });

/** 为 persona × 世界 × 模式（× 任务）生成生活目标；包含测试类词汇时重写 */
export async function makeLifeGoal(opts: { persona: PersonaSpec; world: WorldTemplate; mode: Mode; task?: TaskLite; appName: string; appDesc: string; studyId: string; hypothesisIds?: string[] }): Promise<{ id: string; statement: string }> {
  const p = opts.persona; const lang = langOf(p.locale); const zh = lang === 'zh';
  // 信息隔离：给 Persona 侧使用的产品描述中，去掉包含测试/评估类词汇的句子（例如团队写在描述里的测试目的）
  const appDesc = opts.appDesc.split(/(?<=[。！？.!?\n])/).filter((x) => !containsBannedWords(x) && !/人工接管|验证码测试|植入|缺陷|defect|seeded/i.test(x)).join('').trim();
  const situation = zh ? opts.world.situation : (opts.world.situation_en ?? opts.world.situation);
  const modeGuide = {
    goal: zh ? '这个人此刻有一件具体的事要用这个应用办成。' : 'Right now this person has a concrete thing to get done with this app.',
    stress: zh ? '这个人此刻有一件具体又有点急的事要用这个应用办成。' : 'Right now this person has a concrete, somewhat urgent thing to get done with this app.',
    curiosity: zh ? '这个人此刻没有特定任务，只是出于好奇想看看这个应用能帮自己做点什么（结合他自己的兴趣和生活）。' : 'This person has no specific task; they are curious what this app could do for them (tied to their own interests and life).',
    adversarial: zh ? '这个人出于自己的性格（见「你的脾气」）想用自己的方式摆弄这个应用，比如较真、占便宜或捣乱——这是他本人的动机，不是别人交代的任务。' : "This person, true to their own quirks, wants to mess with the app their own way (nitpicking, freeloading, or pranking) — their own motive, not an assignment.",
  }[opts.mode];
  const taskLine = opts.task ? (zh ? `这件事对应的是：${opts.task.statement}` : `The thing to get done corresponds to: ${opts.task.statement_en ?? opts.task.statement}`) : '';
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await gateway().chat('mind_slow', {
      messages: [{ role: 'system', content: personaBio(p) }, { role: 'user', content: zh
        ? `应用：「${opts.appName}」${appDesc ? `——${appDesc.slice(0, 300)}` : ''}\n处境：${situation}\n${modeGuide}\n${taskLine}\n\n用这个人自己的口吻（第一人称，一两句话，生活语言），写下他此刻想用这个应用做成的事（goal）和为什么是现在（why_now）。严禁出现「测试」「评估」「可用性」「找问题」「反馈」「体验」这类词，也不要提到界面元素的名称。`
        : `App: "${opts.appName}"${appDesc ? ` — ${appDesc.slice(0, 300)}` : ''}\nSituation: ${situation}\n${modeGuide}\n${taskLine}\n\nIn this person's own voice (first person, one or two sentences, everyday language), write what they want to get done with this app right now (goal) and why now (why_now). Never use words like test, evaluate, usability, feedback, bug, experience, and don't mention UI element names.` }],
      schema: GoalSchema, schemaName: 'life_goal', temperature: 0.9, tags: { study_id: opts.studyId, purpose: 'life_goal' },
    });
    const statement = `${r.data.goal}${r.data.why_now ? (zh ? `（${r.data.why_now}）` : ` (${r.data.why_now})`) : ''}`;
    if (containsBannedWords(statement)) continue;
    const id = newId('goal');
    await getDb().insert(goals).values({ id, study_id: opts.studyId, kind: opts.mode === 'curiosity' ? 'curiosity' : opts.mode === 'adversarial' ? 'adversarial' : opts.task ? 'task' : 'life_goal', statement_for_persona: statement, locale: p.locale, linked_task_ids: opts.task ? [opts.task.id] : [], linked_hypothesis_ids: opts.hypothesisIds ?? [] });
    return { id, statement };
  }
  throw new Error('生活目标生成失败（多次包含测试类词汇）');
}

/** Persona 在该 App 的个人账号习惯（用于自己注册/登录；回访时保持一致） */
export function personaAccount(p: PersonaSpec, appId: string) {
  const h = shortHash(`${p.id}:${appId}`, 6);
  // 数字素养低的人习惯用简单密码（常被注册规则拒绝，需要自己想办法改）
  const weak = p.capability.digital_literacy < 0.6 || p.kind === 'child';
  return { username: `${p.id.replace(/^(zh|en)_/, '')}_${h}`.slice(0, 20), password: weak ? (p.identity.age > 50 ? '888888' : `${p.identity.age}${p.identity.age}${p.identity.age}`.slice(0, 6)) : `Pw${h}2026` };
}

export function accountHint(p: PersonaSpec, appId: string, given?: { username: string; password: string }) {
  const acc = given ?? personaAccount(p, appId);
  return langOf(p.locale) === 'en'
    ? `If the app asks you to sign up or log in: ${given ? `your account is "${acc.username}" with password "${acc.password}" (saved in your notes).` : `you'd make an account with your usual username "${acc.username}" and password "${acc.password}".`}`
    : `如果需要注册或登录：${given ? `你的账号是「${acc.username}」，密码「${acc.password}」（记在手机备忘录里）。` : `你会用自己常用的用户名「${acc.username}」和密码「${acc.password}」注册。`}`;
}
