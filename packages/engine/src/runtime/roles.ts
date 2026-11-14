// Persona Mind 与 Operator：不同的模型调用、不共享上下文（§4）。
import { z, type MotorProfile, type PersonaSpec, type Verb } from '@pux/core';
import { gateway, type ContentPart, type Tags } from '@pux/llm';
import type { PerceivedElement } from '../human/perception.ts';
import { personaBio } from '../human/persona.ts';

// ---------------------------------------------------------------- Persona Mind
export const MindSchema = z.object({
  monologue: z.string(),
  noticed: z.string(),
  previous_met_expectation: z.enum(['yes', 'no', 'not_applicable']),
  previous_surprise: z.string(),
  decision: z.enum(['act', 'done', 'give_up', 'wait', 'step_away']),
  intent: z.string(),
  input_text: z.string(),
  expectation: z.string(),
  goal_progress: z.boolean(),
  emotion: z.string(),
  end_reason: z.string(),
});
export type MindOut = z.infer<typeof MindSchema>;

export interface MindInput {
  persona: PersonaSpec; lang: 'zh' | 'en';
  situation: string; worldNow: string; lifeGoal: string; modeHint: string;
  feelings: string; memories: string[]; priorKnowledge: string; appName: string;
  history: { intent: string; outcome: string; monologue: string }[];
  screen: string; image?: Buffer; events: string[]; interruptionNote?: string; loopNote?: string;
  pageUrlHint: string; step: number; maxSteps: number;
}

const BANNED = /测试|评估|可用性|找问题|用户反馈|评测|test(ing)?\b|evaluat|usability|feedback/i;
export const containsBannedWords = (s: string) => BANNED.test(s);

export function mindSystemPrompt(i: MindInput): string {
  const zh = i.lang === 'zh';
  const prior = zh ? ({ stranger: `你以前完全没听说过「${i.appName}」。`, heard_of: `你听朋友提过「${i.appName}」，但没用过。`, seen_ads: `你刷到过「${i.appName}」的广告，有点印象。`, used_before: `你以前用过「${i.appName}」。` } as Record<string, string>)[i.priorKnowledge] : ({ stranger: `You have never heard of "${i.appName}" before.`, heard_of: `A friend mentioned "${i.appName}" but you've never used it.`, seen_ads: `You've seen ads for "${i.appName}".`, used_before: `You have used "${i.appName}" before.` } as Record<string, string>)[i.priorKnowledge];
  const rules = zh ? `你就是这个人，正在过自己的生活，用手机或电脑上的一个应用办自己的事。用第一人称、按你的性格、能力和此刻的状态来想和做。
- 你只能根据屏幕上你实际看到的内容行动；看不清、看不懂、没注意到的东西就当不存在。不要编造屏幕上没有的按钮或文字。
- 按你自己的习惯操作：该犹豫就犹豫，该烦就烦，耐心有限；做不下去、不值得或者有更要紧的事时，可以放弃（decision=give_up）或离开去处理生活里的事（decision=step_away）。
- 遇到失败或报错时，像正常人一样先看页面上有没有说明原因，并据此调整做法（换个写法、换个密码、换条路径）；不会机械地重复一模一样的操作。如果页面没给任何线索，你只能自己猜，猜不出来就会烦躁甚至放弃。
- 事情办成了就停（decision=done）。需要等待页面或回复时选 wait。
- 每次只做一个具体的小动作，intent 用自然的话描述你要做什么，并写清楚你要点/输入的那个东西在屏幕上的叫法（照抄你看到的文字）。需要输入或说的话写在 input_text 里（不需要就留空字符串）；如果是粘贴手头已有的内容（例如会议记录、文档、聊天记录），就在 input_text 里写出完整内容、按它真实的长度来写，并在 intent 里说明是「粘贴」。
- expectation 写你做完这个动作后预期会看到什么。previous_met_expectation 判断上一步的结果是否符合你当时的预期；不符合时在 previous_surprise 里用你的话说哪里不对劲。
- monologue 是你此刻的内心独白（1–3 句，口语化，符合你的身份和情绪）。` : `You ARE this person, living your own life and using an app on your phone/computer to get something of your own done. Think and act in first person, according to your personality, abilities and current state.
- Only act on what you actually see on screen. If you can't read it, don't understand it, or didn't notice it, it doesn't exist for you. Never invent buttons or text.
- Behave like yourself: hesitate, get annoyed, run out of patience. If it's not worth it or life needs you, you may give up (decision=give_up) or step away (decision=step_away).
- When something fails, like a normal person you first look for an explanation on the page and adapt (rephrase, pick another password, try another path); you don't mechanically repeat the exact same action. If the page gives no clue you can only guess, and you may get frustrated or give up.
- Stop when your thing is done (decision=done). Choose wait when you need to wait for the page or a reply.
- Do one concrete small action at a time. In intent, describe it naturally and name the thing you will tap/type into exactly as it appears on screen. Put any text you will type or say in input_text (empty string if none); if you paste existing content (notes, a document), write the full content at its real length and say "paste" in intent.
- expectation: what you expect to see after this action. previous_met_expectation: did the last result match what you expected? If not, describe what felt off in previous_surprise.
- monologue: your inner voice right now (1–3 casual sentences, true to who you are and how you feel).`;
  return `${personaBio(i.persona)}\n\n${prior}\n\n${rules}`;
}

export async function runMind(i: MindInput, tags: Tags): Promise<MindOut> {
  const zh = i.lang === 'zh';
  const hist = i.history.slice(-6).map((h, n) => (zh ? `${n + 1}. 我想：${h.intent} → ${h.outcome}` : `${n + 1}. I tried: ${h.intent} → ${h.outcome}`)).join('\n');
  const text = zh
    ? `【你的处境】${i.situation}\n【此刻】${i.worldNow}\n【你现在想做的事】${i.lifeGoal}${i.modeHint ? `\n${i.modeHint}` : ''}\n【你的状态】${i.feelings}${i.memories.length ? `\n【你想起来的事】\n- ${i.memories.join('\n- ')}` : ''}${i.events.length ? `\n【刚刚发生】${i.events.join('；')}` : ''}${i.interruptionNote ? `\n【打断】${i.interruptionNote}` : ''}${hist ? `\n【你刚才做过的】\n${hist}` : ''}${i.loopNote ? `\n【注意】${i.loopNote}` : ''}\n\n【你现在在屏幕上看到的】（地址栏：${i.pageUrlHint}）\n${i.screen || '（屏幕上几乎什么都看不清）'}\n\n接下来你会怎么做？`
    : `[Your situation] ${i.situation}\n[Right now] ${i.worldNow}\n[What you want to get done] ${i.lifeGoal}${i.modeHint ? `\n${i.modeHint}` : ''}\n[How you feel] ${i.feelings}${i.memories.length ? `\n[Things you remember]\n- ${i.memories.join('\n- ')}` : ''}${i.events.length ? `\n[Just happened] ${i.events.join('; ')}` : ''}${i.interruptionNote ? `\n[Interruption] ${i.interruptionNote}` : ''}${hist ? `\n[What you just did]\n${hist}` : ''}${i.loopNote ? `\n[Note] ${i.loopNote}` : ''}\n\n[What you see on the screen now] (address bar: ${i.pageUrlHint})\n${i.screen || '(you can barely make out anything)'}\n\nWhat do you do next?`;
  const content: ContentPart[] = [{ type: 'text', text }];
  if (i.image) content.push({ type: 'image', data: i.image, mime: 'image/jpeg' });
  const r = await gateway().chat('mind_fast', { messages: [{ role: 'system', content: mindSystemPrompt(i) }, { role: 'user', content }], schema: MindSchema, schemaName: 'mind_step', temperature: 0.8, tags: { ...tags, purpose: 'mind' } });
  return r.data;
}

// ---------------------------------------------------------------- Operator
export const OperatorSchema = z.object({
  feasible: z.boolean(),
  infeasible_reason: z.enum(['none', 'target_not_on_screen', 'intent_unclear', 'needs_scroll', 'already_done']),
  verb: z.enum(['click', 'type', 'key', 'scroll', 'select', 'hover', 'long_press', 'back', 'reload', 'navigate', 'wait', 'upload', 'speak', 'show_camera', 'drag']),
  ref: z.string(),
  target_description: z.string(),
  text: z.string(),
  key: z.string(),
  direction: z.enum(['down', 'up', 'none']),
  url: z.string(),
  option_value: z.string(),
  submit_after_typing: z.boolean(),
  paste: z.boolean(),
  clear_first: z.boolean(),
  expect_url_change: z.boolean(),
  expect_text: z.string(),
  risk_tags: z.array(z.enum(['payment_submit', 'public_post', 'add_stranger', 'external_message', 'face_upload', 'personal_info'])),
});
export type OperatorOut = z.infer<typeof OperatorSchema>;

/** Operator：把意图落成 UAP 动作。只能看到意图、观察结果与运动参数，看不到 Persona 的心理与记忆，也不知道评估标准。 */
export async function runOperator(i: { intent: string; inputText: string; expectation: string; elements: PerceivedElement[]; image?: Buffer; motor: MotorProfile; url: string; lang: 'zh' | 'en'; inputPreference: string; quiet: boolean; executor: string }, tags: Tags): Promise<OperatorOut> {
  const list = i.elements.filter((e) => e.kind !== 'text' || e.label.length < 40).slice(0, 150).map((e) => `${e.ref} [${e.role}] ${e.label}${e.disabled ? ' (disabled)' : ''}${e.value ? ` value="${e.value}"` : ''}`).join('\n');
  const sys = `You translate a person's stated intent into exactly ONE browser action (UAP verb).
Rules:
- You may ONLY target elements listed below (they are what the person can actually see). Use the element's ref (e.g. "e12"). Never guess a ref that is not listed.
- If the intent refers to something that is not in the list, set feasible=false and infeasible_reason=target_not_on_screen (or needs_scroll if it is plausibly further down the page, then use verb=scroll).
- Typing: verb=type with ref of the input and text = the exact text the person wants to type. If the person is pasting existing content (a document, notes, copied text), set paste=true. If they want to send/submit right after (e.g. press Enter / it's a chat box), set submit_after_typing=true only if the intent says so or there is no visible send button.
- Voice: if the person wants to speak to a microphone button, verb=speak with ref of the mic button and text = what they say.
- Camera: verb=show_camera with ref of the camera/photo button, text = short description of what the camera points at.
- Browser dialogs are listed as dlg_ok / dlg_cancel.
- Scrolling: verb=scroll, direction=down|up, ref may be empty.
- Going back: verb=back. Waiting for a reply/loading: verb=wait.
- risk_tags: tag the action if it submits a payment, posts publicly, adds a stranger/sends a private message, sends to external contacts, uploads a face photo, or submits real personal info.
- target_description: short natural description of the target (used for visual locating).
- Fill every field; use empty strings / "none" / false when not applicable.`;
  const text = `Intent: ${i.intent}\nText to type/say: ${i.inputText || '(none)'}\nExpected result: ${i.expectation}\nCurrent URL: ${i.url}\nVisible elements:\n${list || '(none)'}`;
  const content: ContentPart[] = [{ type: 'text', text }];
  if (i.image) content.push({ type: 'image', data: i.image, mime: 'image/jpeg' });
  const r = await gateway().chat('operator_plan', { messages: [{ role: 'system', content: sys }, { role: 'user', content }], schema: OperatorSchema, schemaName: 'operator_action', temperature: 0, tags: { ...tags, purpose: 'operator' } });
  return r.data;
}

export const verbOf = (v: string) => v as Verb;
