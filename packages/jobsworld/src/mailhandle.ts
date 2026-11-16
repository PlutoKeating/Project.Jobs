// 居民邮箱的用户名（@ 前面那一段）：像真人自己起的。只用小写字母和数字，6–20 位，字母部分来自名字或真人常用的词，不出现乱码。
// 依据：英语区 260 万个 Google 用户名的构成（Perito 等，arXiv:1101.5578：名+姓、名+姓+数字、首字母+姓最常见，后缀多是两位数或出生年）；
// 中文用户的拼音姓名、出生年、生日与吉利数（王鼎等，USENIX Security 2019）。比例是按这些研究换算的估计值。
import { pinyin } from 'pinyin-pro';
import { Rng, seedFrom } from '@pux/core';

export interface HandleInput { id: string; name: string; locale: string; age: number; gender?: string }

const ZH_NICK_ANY = ['xiaoyu', 'tiantian', 'xiaoxiao', 'yangyang', 'doudou', 'lele', 'xiaobai', 'xiaozhu', 'xiaotu', 'kaixin', 'xingfu', 'mumu'];
const ZH_NICK_F = ['yuanyuan', 'mengmeng', 'jiajia', 'tingting', 'jingjing', 'xinxin', 'feifei', 'dandan', 'beibei', 'huahua', 'nana', 'xiaoxue'];
const ZH_NICK_M = ['xiaolong', 'xiaohu', 'xiaoxiong', 'dapeng', 'xiaoqiang', 'xiaofeng'];
const ZH_WORD = ['woaini', 'sunny', 'happy', 'lucky', 'angel', 'summer', 'tiger', 'panda', 'kaixin', 'pingan'];
const EN_NAME_F = ['amy', 'lucy', 'cherry', 'vivian', 'coco', 'lily', 'grace', 'emma', 'helen', 'linda', 'jenny', 'nancy', 'bella', 'judy', 'angela', 'cindy', 'sophia', 'iris'];
const EN_NAME_M = ['kevin', 'jack', 'tony', 'eric', 'leo', 'david', 'jason', 'peter', 'alex', 'steven', 'michael', 'frank', 'james', 'ryan', 'allen', 'daniel', 'simon', 'vincent'];
const EN_WORD = ['gamer', 'rider', 'runner', 'surfer', 'skater', 'hiker', 'angler', 'baker', 'coder', 'reader', 'bookworm', 'guitar', 'drummer', 'soccer', 'hoops', 'golfer', 'yoga', 'fitness', 'travel', 'wander', 'sunny', 'sunshine', 'angel', 'princess', 'kitty', 'puppy', 'tiger', 'dragon', 'wolf', 'ninja', 'rocket', 'star', 'blue', 'lucky', 'happy', 'smiley', 'dreamer', 'coffee', 'chef', 'music'];
const EN_PAIR_A = ['blue', 'lucky', 'happy', 'silver', 'golden', 'wild', 'little', 'big', 'sunny', 'crazy', 'lazy', 'red'];
const EN_PAIR_B = ['moon', 'tiger', 'fox', 'river', 'rider', 'bird', 'bear', 'sky', 'wave', 'rose', 'cat', 'pine'];
const LUCKY = ['520', '1314', '666', '888', '168', '999', '5201314', '520520', '66', '88'];
const COMPOUND_SURNAMES = ['欧阳', '司马', '诸葛', '上官', '东方', '皇甫', '尉迟', '公孙', '慕容', '令狐', '司徒', '夏侯', '长孙', '宇文', '端木', '独孤'];

const ascii = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '');
const pad2 = (n: number) => String(n).padStart(2, '0');

/** 中文名 → [姓的拼音, 名的拼音]（多音字按姓氏读音） */
function zhParts(name: string): [string, string] {
  const sn = COMPOUND_SURNAMES.find((c) => name.startsWith(c)) ?? name.slice(0, 1);
  const py = (s: string, surname: boolean) => ascii((pinyin(s, { toneType: 'none', type: 'array', ...(surname ? { surname: 'head' as const } : {}) }) as string[]).join(''));
  return [py(sn, true), py(name.slice(sn.length), false)];
}

/** 名字 → [名, 姓]（去掉重音、连字符、撇号；只有一段时姓为空） */
function latinParts(name: string): [string, string] {
  const w = name.trim().split(/\s+/).map(ascii).filter(Boolean);
  return [w[0] ?? 'user', w.length > 1 ? w[w.length - 1] : ''];
}

function numbersFor(r: Rng, age: number, zh: boolean): string {
  const by = 2026 - Math.max(6, Math.min(95, age));
  const mm = r.int(1, 12); const dd = r.int(1, 28);
  const kind = zh
    ? r.weighted([{ item: 'yyyy', weight: 40 }, { item: 'yy', weight: 15 }, { item: 'mmdd', weight: 12 }, { item: 'yymmdd', weight: 8 }, { item: 'lucky', weight: 25 }])
    : r.weighted([{ item: 'yy', weight: 50 }, { item: 'yyyy', weight: 30 }, { item: 'mmdd', weight: 6 }, { item: 'fav', weight: 14 }]);
  switch (kind) {
    case 'yyyy': return String(by);
    case 'yy': return pad2(by % 100);
    case 'mmdd': return `${pad2(mm)}${pad2(dd)}`;
    case 'yymmdd': return `${pad2(by % 100)}${pad2(mm)}${pad2(dd)}`;
    case 'lucky': return r.pick(LUCKY);
    default: return r.pick(['7', '13', '23', '24', '77', '99', '11', '21']);
  }
}

function zhHandle(r: Rng, p: HandleInput): string {
  const [sn, gn] = zhParts(p.name);
  const given = p.name.slice((COMPOUND_SURNAMES.find((c) => p.name.startsWith(c)) ?? p.name.slice(0, 1)).length);
  const initials = (pinyin(given, { pattern: 'first', toneType: 'none', type: 'array' }) as string[]).map(ascii).join('');
  const young = p.age < 45;
  const g = String(p.gender ?? '').toLowerCase();
  const female = /^(f|female|woman|女)/.test(g); const male = /^(m|male|man|男)/.test(g);
  const eng = female ? EN_NAME_F : male ? EN_NAME_M : [...EN_NAME_F, ...EN_NAME_M];
  const nicks = [...ZH_NICK_ANY, ...(female ? ZH_NICK_F : male ? ZH_NICK_M : [...ZH_NICK_F, ...ZH_NICK_M])];
  const n = () => numbersFor(r, p.age, true);
  const pattern = r.weighted([
    { item: 'full_num', weight: 30 }, { item: 'full', weight: 10 }, { item: 'sn_init', weight: 15 },
    { item: 'nick', weight: young ? 20 : 4 }, { item: 'eng', weight: young ? 15 : 3 }, { item: 'word', weight: young ? 10 : 1 },
  ]);
  const full = r.bool(0.75) ? `${sn}${gn}` : `${gn}${sn}`;
  switch (pattern) {
    case 'full': return full.length >= 6 ? full : `${full}${n()}`;
    case 'sn_init': return `${sn}${initials || gn.slice(0, 1)}${n()}`;
    case 'nick': return `${r.pick(nicks)}${n()}`;
    case 'eng': return `${r.pick(eng)}${sn}${r.bool(0.5) ? n() : ''}`;
    case 'word': return `${r.pick(ZH_WORD)}${r.pick(LUCKY)}`;
    default: return `${full}${n()}`;
  }
}

function latinHandle(r: Rng, p: HandleInput): string {
  const [fn, ln] = latinParts(p.name);
  const young = p.age < 36;
  const n = () => numbersFor(r, p.age, false);
  const pattern = r.weighted([
    { item: 'fl', weight: ln ? 28 : 0 }, { item: 'fl_num', weight: ln ? 16 : 0 }, { item: 'il', weight: ln ? 12 : 0 }, { item: 'f_num', weight: 8 },
    { item: 'lf', weight: ln ? 6 : 0 }, { item: 'word', weight: young ? 20 : 8 }, { item: 'pair', weight: young ? 10 : 3 },
  ]);
  switch (pattern) {
    case 'fl': return `${fn}${ln}`;
    case 'fl_num': return `${fn}${ln}${n()}`;
    case 'il': return `${fn.slice(0, 1)}${ln}${r.bool(0.45) ? n() : ''}`;
    case 'lf': return `${ln}${fn}`;
    case 'word': return r.bool(0.5) ? `${r.pick(EN_WORD)}${fn}` : `${fn}${r.pick(EN_WORD)}${r.bool(0.4) ? n() : ''}`;
    case 'pair': return `${r.pick(EN_PAIR_A)}${r.pick(EN_PAIR_B)}${r.bool(0.6) ? n() : ''}`;
    default: return `${fn}${n()}`;
  }
}

/** 把生成的串收拾成合规的用户名：只留 [a-z0-9]，太长时把名缩成首字母或截断，太短时补出生年 */
function tidy(raw: string, p: HandleInput): string {
  let s = raw.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!/[a-z]/.test(s)) s = `user${s}`;
  if (s.length > 20) { const m = /^([a-z]+)(\d*)$/.exec(s); s = m ? `${m[1].slice(0, 20 - m[2].length)}${m[2]}` : s.slice(0, 20); }
  if (s.length < 6) s = `${s}${2026 - p.age}`.slice(0, 20);
  return s;
}

/** 这个人的邮箱用户名。同一个人每次算出来一样；与 taken 里已有的重复时，依次换一种写法或加数字 */
export function mailHandle(p: HandleInput, taken: Set<string> = new Set()): string {
  const zh = p.locale.startsWith('zh') && /[一-鿿]/.test(p.name);
  for (let attempt = 0; attempt < 12; attempt++) {
    const r = new Rng(seedFrom(`${p.id}:mail:${attempt}`));
    const h = tidy(zh ? zhHandle(r, p) : latinHandle(r, p), p);
    if (!taken.has(h)) { taken.add(h); return h; }
  }
  // 实在撞了：在最后一种写法后面加两位数字，直到不重复
  const base = tidy(zh ? zhHandle(new Rng(seedFrom(p.id)), p) : latinHandle(new Rng(seedFrom(p.id)), p), p).replace(/\d+$/, '').slice(0, 16);
  for (let i = 10; ; i++) { const h = `${base}${i}`; if (!taken.has(h)) { taken.add(h); return h; } }
}

/** 一个邮箱地址的用户名是不是旧的、看起来像编号的写法（zh.r.779e0d8c 这种），需要换成像真人的 */
export const isLegacyHandle = (local: string) => /[._]/.test(local) || /^(zh|en)r[0-9a-f]{6,}$/.test(local);
