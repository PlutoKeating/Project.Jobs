// 曝光与决定：产品出现在一个人面前（商店、广告、广告牌、信息流、熟人提起）之后，他注意到了吗？怎么反应？
// 规则决定「看没看到」（多数曝光根本没被注意）；只有被注意到时，才在决定点调用一次模型，由这个人自己说要不要点开。
import { newId, z, type PersonaSpec, type Rng, langOf } from '@pux/core';
import { and, eq, exposures, getDb, intentions, type AudienceRow } from '@pux/db';
import { gateway } from '@pux/llm';
import type { LiveContext } from '@pux/jobsworld';
import { personaBio } from '../human/persona.ts';
import { recall } from '../human/memory.ts';
import type { LaunchRow } from './launch.ts';

export type Channel = 'store' | 'ad' | 'billboard' | 'feed' | 'word_of_mouth' | 'recall' | 'invite';
export type Reaction = 'unnoticed' | 'ignored' | 'not_for_me' | 'curious_later' | 'opened';

/** 这个人是不是投放对象。不是投放对象的人也可能看到（自然流量），只是少得多 */
export function audienceMatch(p: PersonaSpec, a: AudienceRow | null | undefined): number {
  if (!a || !Object.keys(a).length) return 1;
  const age = p.identity.age;
  const ok = (!a.locales?.length || a.locales.includes(p.locale)) && (a.age_min === undefined || age >= a.age_min) && (a.age_max === undefined || age <= a.age_max)
    && (!a.segments?.length || a.segments.includes(p.segment)) && (!a.tags?.length || a.tags.some((t) => p.tags.includes(t)));
  return ok ? 1 : 0.12;
}

/** 每小时遇到一次的次数（强度 1、手机一直在手边、是投放对象时）。城里的人不会被广告淹没 */
export const RATE_PER_HOUR = { ad: 2.2, billboard: 0.9, store_browse: 0.14, feed: 0.5, recall: 0.2 } as const;
/** 出现在眼前之后真正注意到的概率 */
export const NOTICE = { ad: 0.22, billboard: 0.1, store: 0.6, feed: 0.45, word_of_mouth: 0.95, recall: 1, invite: 1 } as const;

const pOf = (ratePerHour: number, minutes: number) => 1 - Math.exp(-ratePerHour * (minutes / 60));

/**
 * 这段时间里，这个人会不会在某个渠道遇到这个产品（纯计算）。
 * 广告和信息流要手机在手边；广告牌要人在路上、车站、写字楼；逛商店是偶尔的事。
 */
export function exposureChance(channel: 'ad' | 'billboard' | 'store_browse' | 'feed', o: { intensity: number; affinity: number; match: number; minutes: number; placeKind: string; exploration: number; seenBefore: number }): number {
  const fatigue = 1 / (1 + o.seenBefore * 0.6);           // 看过几次还没点，再出现也越来越无感
  if (channel === 'ad') return pOf(RATE_PER_HOUR.ad * o.intensity * o.affinity * o.match * fatigue, o.minutes);
  if (channel === 'billboard') return ['subway', 'bus_stop', 'street', 'road', 'office', 'shop'].includes(o.placeKind) ? pOf(RATE_PER_HOUR.billboard * o.intensity * fatigue, o.minutes) : 0;
  if (channel === 'feed') return pOf(RATE_PER_HOUR.feed * o.affinity * fatigue, o.minutes);
  return pOf(RATE_PER_HOUR.store_browse * o.affinity * (0.5 + o.exploration), o.minutes);
}

export function notices(channel: keyof typeof NOTICE, rng: Rng, o: { attention: number; seenBefore?: number } = { attention: 0.7 }): boolean {
  return rng.bool(NOTICE[channel] * (0.6 + 0.6 * o.attention) / (1 + (o.seenBefore ?? 0) * 0.25));
}

const DecisionSchema = z.object({
  reaction: z.enum(['scroll_past', 'not_for_me', 'curious_later', 'open_now']),
  thought: z.string(),
  want: z.string(),
});
export type Decision = { reaction: Exclude<Reaction, 'unnoticed' | 'opened'> | 'open_now'; thought: string; want: string };

export interface Seen { channel: Channel; text: string }

/** 这个人在这个渠道实际看到的东西（商店卡片、广告、帖子、熟人的话），用他能看到的样子写出来 */
export function whatTheySee(l: LaunchRow, channel: Channel, lang: 'zh' | 'en', o: { rating?: number | null; reviews?: { rating: number; body: string }[]; post?: string; from?: { name: string; kind: string; said: string }; memory?: string } = {}): string {
  const zh = lang === 'zh';
  const card = `「${l.name}」——${l.tagline}`;
  switch (channel) {
    case 'store': return zh ? `你在应用商店里闲逛，划到一个应用：${card}${l.description ? `\n介绍：${l.description.slice(0, 200)}` : ''}\n${o.rating ? `评分 ${o.rating} 分` : '还没有评分'}${o.reviews?.length ? `\n评论：${o.reviews.map((r) => `${'★'.repeat(r.rating)} ${r.body}`).join(' / ')}` : ''}` : `You're browsing the app store and scroll past an app: ${card}${l.description ? `\nAbout: ${l.description.slice(0, 200)}` : ''}\n${o.rating ? `Rated ${o.rating}` : 'No ratings yet'}${o.reviews?.length ? `\nReviews: ${o.reviews.map((r) => `${'★'.repeat(r.rating)} ${r.body}`).join(' / ')}` : ''}`;
    case 'ad': return zh ? `你刷手机的时候，中间插进来一条广告：${l.ad_text || card}` : `While scrolling your phone, an ad slides in: ${l.ad_text || card}`;
    case 'billboard': return zh ? `你路过的时候瞥见一块广告牌：${l.ad_text || card}` : `You catch a billboard as you pass: ${l.ad_text || card}`;
    case 'feed': return zh ? `你在刷大家发的动态，看到有人说：「${o.post ?? ''}」（说的是「${l.name}」）` : `Scrolling what people posted, you see: "${o.post ?? ''}" (about "${l.name}")`;
    case 'word_of_mouth': return zh ? `${o.from?.name}（你的${o.from?.kind}）跟你提起「${l.name}」：「${o.from?.said}」` : `${o.from?.name} (your ${o.from?.kind}) mentions "${l.name}": "${o.from?.said}"`;
    case 'recall': return zh ? `你想起了「${l.name}」${o.memory ? `：${o.memory}` : ''}` : `"${l.name}" crosses your mind${o.memory ? `: ${o.memory}` : ''}`;
    default: return zh ? `有人把手机递给你：「试试这个？」屏幕上是${card}` : `Someone hands you their phone: "Try this?" On screen: ${card}`;
  }
}

/**
 * 不同渠道里「现实的常态」不一样：广告是硬塞到眼前的，绝大多数人划走；商店是人自己去逛的，本来就想找点东西；熟人的话最容易当回事。
 * 这里的比例是行业里常说的粗略量级（信息流广告点开约百分之一二，商店里看到一个对路的应用约三四成会点进去），只用来告诉模型常态在哪，不是校准结果。
 */
export function normFor(channel: Channel, lang: 'zh' | 'en'): string {
  const zh = lang === 'zh';
  switch (channel) {
    case 'store': return zh
      ? '现实里的常态：应用商店是你自己打开来逛的，本来就想看看有没有用得上的新东西。划到一个正好对得上你手头某件事或某个念头的应用，三四个人里会有一个点进去看看；对不上的、看不懂的、看着不放心的，就划走。'
      : 'How it really goes: you opened the app store yourself, half looking for something useful. When an app happens to match something on your plate or on your mind, about one person in three or four taps in for a look; if it doesn\'t match, you can\'t read it, or it looks untrustworthy, you scroll on.';
    case 'feed': return zh
      ? '现实里的常态：动态里是普通人说的话，比广告可信。说的事跟你有关、说得又实在，你会想看看；说它不好，你就更不会碰；跟你无关的，划过去。'
      : 'How it really goes: posts are ordinary people talking, more believable than ads. If it concerns you and sounds honest, you may want a look; if they say it\'s bad, you stay away; if it has nothing to do with you, you scroll on.';
    case 'word_of_mouth': return zh
      ? '现实里的常态：熟人当面提起的东西，你多半会当回事。信得过的人说好用、又碰上你用得着，你会想看看；他说不好，你就不会碰。'
      : 'How it really goes: when someone you know brings it up, you tend to take it seriously. If someone you trust says it\'s good and you could use it, you\'ll want a look; if they say it\'s bad, you won\'t touch it.';
    case 'recall': return zh
      ? '现实里的常态：自己想起来的东西，只有手头正好有那件事要办时才会真的去打开。'
      : 'How it really goes: something that crosses your mind only gets opened when you actually have that thing to do right now.';
    case 'invite': return zh
      ? '现实里的常态：有人当面把手机递过来，多数人会接过来看看。'
      : 'How it really goes: when someone hands you their phone, most people take a look.';
    default: return zh
      ? '现实里的常态：广告是硬塞到眼前的。一百个人看到，真点开的只有一两个，其余的想都不想就划过去了。只有它正好碰上你此刻真有的一件事、一个念头，你才会想点开。'
      : 'How it really goes: an ad is pushed in front of you. Of a hundred people who see it, one or two tap; the rest scroll past without a thought. You only want to open it when it happens to meet something you actually need or have been thinking about.';
  }
}

/**
 * 决定点：这个人注意到了它，接下来怎么做由他自己说。
 * 提示词里写明现实里的常态：大多数人对大多数广告直接划过去；忙、累、不相干的时候更不会点。
 */
export async function decide(p: PersonaSpec, ctx: LiveContext, l: LaunchRow, seen: Seen, o: { appId: string; simDay: number; used?: boolean } ): Promise<Decision> {
  const lang = langOf(p.locale); const zh = lang === 'zh';
  const mem = await recall(p.id, o.appId, `${l.name} ${l.tagline}`, o.simDay, 3, undefined, p).catch(() => []);
  const memText = mem.filter((m) => m.kind !== 'core' || mem.length <= 3).slice(0, 3).map((m) => m.content);
  const sit = zh ? ctx.template.situation : (ctx.template.situation_en ?? ctx.template.situation);
  const rules = zh ? `你就是这个人，正在过自己的生活。下面是你此刻的处境，以及你刚刚注意到的一样东西。按你的性格、此刻的状态和你手头的事，说出你真实的反应。
${normFor(seen.channel, 'zh')}你现在忙、累、赶时间、没心情的时候，更不会点。不要因为礼貌或好奇心泛滥而点开。
- scroll_past：没多想，划过去了
- not_for_me：看了一眼，觉得跟自己没关系或者不喜欢（以后再看到也不会点）
- curious_later：有点兴趣，但现在没空或不方便，想着以后有空再看
- open_now：现在就点开看看
thought 写你当时心里闪过的一句话（口语，符合你的身份）。只有 open_now 或 curious_later 时，want 写你想用它来做的那件具体的事（用你自己的话，一句；不要出现「测试」「体验」「评估」这类词）；否则留空。` : `You ARE this person, living your own life. Below is your situation right now and something you just noticed. React honestly, according to your personality, your state, and what you have on your plate.
${normFor(seen.channel, 'en')} When you're busy, tired, rushed or not in the mood, you're even less likely. Don't open out of politeness or generic curiosity.
- scroll_past: didn't think twice
- not_for_me: looked, decided it's not for you or you don't like it (won't tap next time either)
- curious_later: somewhat interested but not now; maybe later
- open_now: open it right now
thought: the one line that crossed your mind (casual, in your voice). Only for open_now or curious_later, want: the concrete thing you'd want to do with it (one sentence, your words; never use words like test, try out for review, evaluate); otherwise empty.`;
  const user = zh ? `【你的处境】${sit}${memText.length ? `\n【你想起来的事】\n- ${memText.join('\n- ')}` : ''}\n\n【你注意到】${seen.text}\n\n你的反应？` : `[Your situation] ${sit}${memText.length ? `\n[Things you remember]\n- ${memText.join('\n- ')}` : ''}\n\n[You notice] ${seen.text}\n\nYour reaction?`;
  const r = await gateway().chat('mind_fast', { messages: [{ role: 'system', content: `${personaBio(p)}\n\n${rules}` }, { role: 'user', content: user }], schema: DecisionSchema, schemaName: 'exposure_decision', temperature: 0.9, tags: { study_id: l.study_id, purpose: 'exposure_decision' } });
  const d = r.data;
  return { reaction: d.reaction === 'scroll_past' ? 'ignored' : d.reaction, thought: d.thought.slice(0, 200), want: d.want.slice(0, 200) };
}

export async function recordExposure(e: { launch_id: string; persona_id: string; channel: Channel; world_min: number; place_id?: string; reaction: Reaction; thought?: string; source_persona_id?: string; session_id?: string }): Promise<string> {
  const id = newId('exp');
  await getDb().insert(exposures).values({ id, ...e });
  return id;
}

/** 这个人和这个产品之间到目前为止发生过什么（决定还要不要再给他看） */
export async function relationTo(launchId: string, personaId: string) {
  const ex = await getDb().select().from(exposures).where(and(eq(exposures.launch_id, launchId), eq(exposures.persona_id, personaId)));
  return { seen: ex.length, noticed: ex.filter((e) => e.reaction !== 'unnoticed').length, rejected: ex.some((e) => e.reaction === 'not_for_me'), opened: ex.some((e) => e.reaction === 'opened') };
}

export async function addIntention(launchId: string, personaId: string, kind: 'try_later' | 'return', reason: string, strength: number, worldMin: number) {
  await getDb().insert(intentions).values({ id: newId('int'), launch_id: launchId, persona_id: personaId, kind, reason: reason.slice(0, 300), strength: Math.max(0.05, Math.min(1, strength)), created_min: worldMin });
}
