// 跟一位居民连续聊天（开发者在飞书、网页、命令行里说「让我跟赵红梅聊聊」）。
// 她带着自己的身份、记忆、用过的产品和此时此地的处境回答；不记得就说不记得，不编造。回答只是主观模拟，不进结论。
import { langOf, type PersonaSpec } from '@pux/core';
import { gateway } from '@pux/llm';
import { liveContextFor, personaById, personaMemoryList, personaSessions } from '@pux/jobsworld';
import { personaBio } from './persona.ts';

export interface ResidentTurn { role: 'user' | 'resident'; text: string }
const OUT_ZH: Record<string, string> = { success: '用成了', gave_up: '放弃了', resource_exhausted: '没时间用完', stalled: '卡住了', blocked: '被拦住了' };

export async function chatWithResident(personaId: string, message: string, history: ResidentTurn[] = [], o: { busy?: boolean } = {}): Promise<{ reply: string; name: string }> {
  const row = await personaById(personaId); if (!row) throw new Error('城里没有这个人');
  const p = row.spec as PersonaSpec; const zh = langOf(p.locale) === 'zh';
  const [here, mems, ss] = await Promise.all([liveContextFor(personaId).catch(() => undefined), personaMemoryList(personaId, 24).catch(() => []), personaSessions(personaId, 8).catch(() => [])]);
  const used = ss.map((s) => `${s.app}：${zh ? OUT_ZH[s.outcome ?? ''] ?? '用过' : s.outcome ?? 'used'}`).join(zh ? '；' : '; ');
  const memo = mems.slice(0, 16).map((m) => `- ${m.content}`).join('\n');
  const now = here ? (zh ? `此刻是 ${here.clock}，你在${here.name}，${here.activity}。${here.scenario}` : `It is ${here.clock}; you are at ${here.name}, ${here.activity}. ${here.scenario}`) : '';
  const sys = `${personaBio(p)}\n\n${zh
    ? `${now}${o.busy ? '你这会儿正在手机上用一个产品，分心回几句。' : ''}\n有个做产品的人在手机上跟你聊天，想听听你的真实想法。用你自己的口吻、像微信聊天一样回答，一次说一两句到一小段；不懂的词就说不懂；不记得的事就说不记得，不要编造经历；不要客套地夸，也不要替做产品的人说话。\n你用过的产品：${used || '还没有'}\n你记得的事：\n${memo || '（没什么特别的）'}`
    : `${now}${o.busy ? ' You are in the middle of using an app on your phone and reply between taps.' : ''}\nSomeone who makes apps is chatting with you on their phone and wants your honest view. Reply in your own voice like a text message, a sentence or two up to a short paragraph; if you don't know a word, say so; if you don't remember something, say so and don't invent experiences; don't flatter.\nApps you have used: ${used || 'none yet'}\nWhat you remember:\n${memo || '(nothing in particular)'}`}`;
  const r = await gateway().chat('resident_chat', { messages: [{ role: 'system', content: sys }, ...history.slice(-16).map((h) => ({ role: h.role === 'user' ? 'user' as const : 'assistant' as const, content: h.text })), { role: 'user', content: message.slice(0, 1500) }], temperature: 0.8, tags: { purpose: 'resident_chat' } });
  return { reply: String(r.data).trim(), name: p.identity.name };
}
