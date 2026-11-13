// 事后访谈 + SUS / UMUX-Lite 模拟估计（§4 第 4 条、§15 可追问访谈）
// 访谈由独立的访谈角色在 Session 结束之后，以「回忆」的口吻进行；回答只作为主观模拟证据。
import { newId, z, langOf } from '@pux/core';
import { apps, appVersions, eq, getDb, interviews, sessions, steps, studies, desc } from '@pux/db';
import { gateway } from '@pux/llm';
import { putEvidence } from '@pux/executor';
import { getPersona, personaBio } from '../human/persona.ts';
import { recall } from '../human/memory.ts';

const SUS_ZH = ['我愿意经常使用这个产品', '我觉得这个产品没必要这么复杂', '我觉得这个产品用起来很容易', '我觉得需要有懂行的人帮忙才能用这个产品', '我觉得这个产品的各项功能结合得很好', '我觉得这个产品有太多不一致的地方', '我想大多数人都能很快学会用这个产品', '我觉得这个产品用起来很麻烦', '用这个产品时我很有把握', '我需要先学很多东西才能用好这个产品'];
const SUS_EN = ['I think that I would like to use this product frequently', 'I found the product unnecessarily complex', 'I thought the product was easy to use', 'I think that I would need the support of a technical person to be able to use this product', 'I found the various functions in this product were well integrated', 'I thought there was too much inconsistency in this product', 'I would imagine that most people would learn to use this product very quickly', 'I found the product very cumbersome to use', 'I felt very confident using the product', 'I needed to learn a lot of things before I could get going with this product'];

const InterviewSchema = z.object({
  answers: z.array(z.object({ q: z.string(), a: z.string() })),
  sus: z.array(z.number().min(1).max(5)).length(10),
  umux_lite: z.object({ capabilities_meet_requirements: z.number().min(1).max(7), easy_to_use: z.number().min(1).max(7) }),
  would_use_again: z.boolean(),
});

async function sessionRecall(sessionId: string) {
  const db = getDb();
  const s = (await db.select().from(sessions).where(eq(sessions.id, sessionId)))[0];
  const st = await db.select().from(steps).where(eq(steps.session_id, sessionId)).orderBy(steps.idx);
  const study = (await db.select().from(studies).where(eq(studies.id, s.study_id)))[0];
  const av = (await db.select().from(appVersions).where(eq(appVersions.id, study.app_version_id)))[0];
  const app = (await db.select().from(apps).where(eq(apps.id, av.app_id)))[0];
  const p = (await getPersona(s.persona_id, s.persona_version))!.spec;
  const diary = st.map((x) => `${x.sim_clock} 我${x.intent ?? ''}（心里想：${x.monologue ?? ''}）`).join('\n').slice(0, 5000);
  return { s, p, app, diary };
}

export async function postSessionInterview(sessionId: string) {
  const { s, p, app, diary } = await sessionRecall(sessionId);
  const lang = langOf(p.locale); const zh = lang === 'zh';
  const qs = zh ? ['刚才用下来整体感觉怎么样？', '哪一刻最让你卡住或不舒服？', '有没有哪里让你觉得意外或不对劲？', '你还会再用它吗？为什么？', '如果只能改一个地方，你希望改什么？']
    : ['How did that feel overall?', 'Which moment was the hardest or most uncomfortable?', 'Did anything surprise you or feel off?', 'Would you use it again? Why?', 'If you could change one thing, what would it be?'];
  const sys = `${personaBio(p)}\n\n${zh ? `你刚刚用过「${app.name}」，下面是你记得的经过（是回忆，可能不完整）。访谈员会问你几个问题，请凭记忆、用你自己的口吻真实回答，不要美化。然后填一份问卷（SUS 每题 1–5 分，1=非常不同意，5=非常同意；UMUX-Lite 每题 1–7 分）。` : `You just used "${app.name}". Below is what you remember (a recollection, maybe incomplete). An interviewer asks a few questions; answer honestly from memory in your own voice, no sugar-coating. Then fill a questionnaire (SUS items 1–5, 1=strongly disagree, 5=strongly agree; UMUX-Lite items 1–7).`}\n\n${zh ? '回忆' : 'Recollection'}：\n${diary}\n${zh ? '结局' : 'How it ended'}：${s.outcome}（${s.end_reason}）`;
  const r = await gateway().chat('interview', { messages: [{ role: 'system', content: sys }, { role: 'user', content: `${zh ? '访谈问题' : 'Questions'}：\n${qs.map((q, i) => `${i + 1}. ${q}`).join('\n')}\n\nSUS：\n${(zh ? SUS_ZH : SUS_EN).map((q, i) => `${i + 1}. ${q}`).join('\n')}\n\nUMUX-Lite：1) ${zh ? '这个产品的功能满足我的需求' : "This product's capabilities meet my requirements"} 2) ${zh ? '这个产品很容易使用' : 'This product is easy to use'}` }], schema: InterviewSchema, schemaName: 'interview', temperature: 0.7, tags: { study_id: s.study_id, session_id: sessionId, purpose: 'interview' } });
  const sus = r.data.sus; const susScore = (sus.reduce((a, v, i) => a + (i % 2 === 0 ? v - 1 : 5 - v), 0)) * 2.5;
  const umux = ((r.data.umux_lite.capabilities_meet_requirements - 1) + (r.data.umux_lite.easy_to_use - 1)) / 12 * 100;
  const questionnaire = { sus_items: sus, sus_score_simulated: susScore, umux_lite_simulated: Math.round(umux * 10) / 10, would_use_again: r.data.would_use_again, label: zh ? '模拟估计（非真实 SUS/UMUX-Lite 测量）' : 'Simulated estimate (not a real SUS/UMUX-Lite measurement)' };
  const id = newId('itv');
  await getDb().insert(interviews).values({ id, session_id: sessionId, kind: 'post_session', qa: r.data.answers.map((x) => ({ ...x, at: new Date().toISOString() })), questionnaire });
  await putEvidence('interview', { study_id: s.study_id, session_id: sessionId, persona_id: p.id }, { inline: { qa: r.data.answers, questionnaire } });
  return { id, questionnaire, answers: r.data.answers };
}

/** 可追问访谈：根据 Session 记忆重建 Persona 后追问（回答属于主观模拟证据） */
export async function askPersona(sessionId: string, question: string): Promise<string> {
  const { s, p, app, diary } = await sessionRecall(sessionId);
  const db = getDb(); const zh = langOf(p.locale) === 'zh';
  const prev = (await db.select().from(interviews).where(eq(interviews.session_id, sessionId)).orderBy(desc(interviews.created_at))).flatMap((i) => i.qa).slice(-10);
  const mem = await recall(p.id, app.id, question, s.revisit_day, 4).catch(() => []);
  const r = await gateway().chat('interview', { messages: [
    { role: 'system', content: `${personaBio(p)}\n\n${zh ? `你之前用过「${app.name}」。下面是你对那次经历的回忆和留下的印象。凭记忆、用你的口吻回答访谈员的追问；不记得就说不记得，不要编造细节。` : `You used "${app.name}" before. Below is what you recall and the impressions you kept. Answer the interviewer from memory in your own voice; if you don't remember, say so.`}\n\n${diary}\n${zh ? '印象' : 'Impressions'}：${mem.map((m) => m.content).join('；')}` },
    ...prev.flatMap((x) => [{ role: 'user' as const, content: x.q }, { role: 'assistant' as const, content: x.a }]),
    { role: 'user', content: question },
  ], temperature: 0.7, tags: { study_id: s.study_id, session_id: sessionId, purpose: 'followup_interview' } });
  const a = r.data as string;
  await db.insert(interviews).values({ id: newId('itv'), session_id: sessionId, kind: 'followup', qa: [{ q: question, a, at: new Date().toISOString() }] });
  return a;
}
