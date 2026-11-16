/**
 * figures.mjs — 示意图。一份源，两个去处：
 *   1. 官网首页内联（renderFigure）：颜色跟着页面的明暗走，动画由 src/site.css 的「示意图」一段驱动；
 *   2. README 用的独立 SVG 文件（scripts/build-figures.mjs → docs/images/）：每种语言 × 明暗各一份。
 *
 * 约定：
 * - 图里不写颜色、不写 style 属性，只写类名（f-* 填充、s-* 描边、t-* 文字），由 site.css 里的示意图样式上色。
 * - 静止状态就是完整的图。动画只做一件事：一个琥珀色的「此刻」依次停在每一步上（类名 now now-N），
 *   与界面里「琥珀只表示此刻」是同一条规则；关掉动画时图照样读得懂。
 * - 图里的人、原话、人数、复现步骤都取自开发实例里的真实运行（示例产品「闪念笔记」「今天吃啥」），
 *   英文版的中文原话是翻译，图注里写明。换数据时两种语言一起换。
 */
import { esc, horizonRects } from './render.mjs';

/* ---------------------------------------------------------------- 文案 */

export const figureText = {
  zh: {
    banner: { label: 'Jobs：发布之前，先让一座城的人用用看', tagline: '发布之前，先让一座城的人用用看。' },
    journey: {
      label: '发布之后发生什么：产品被发布到城里，居民遇到它、注意到它、自己决定要不要点开、在自己的处境里使用、之后告诉别人，最后汇成一页结论。遇没遇到、注没注意由规则决定，其余由居民自己决定。',
      rules: ['规则决定 · 不调用模型', '遇没遇到、注没注意'],
      person: ['他自己决定 · 模型只在这里出场', '点不点开、怎么用、跟谁说'],
      steps: [
        { title: '发布', sub: ['网址、名字、', '一句话'] },
        { title: '遇到', sub: ['商店、广告、', '广告牌、动态、', '熟人提起'], count: '看到' },
        { title: '注意', sub: ['多数曝光根本', '没被注意到'], count: '注意到' },
        { title: '决定', sub: ['忙、累、对不上', '自己的事，', '就划过去'], count: '有兴趣' },
        { title: '使用', sub: ['只看得到屏幕，', '在此时此地的', '处境里'], count: '打开过' },
        { title: '之后', sub: ['评论、动态、', '跟谁说、', '回不回来'], count: '回来再用' },
        { title: '结论', sub: ['一页人话，', '每一句都能点开'] },
      ],
      form: ['网址', '名字', '一句话', '发布'],
      note: ['每个点是城里的一位居民，共 201 位。人数取自开发实例里的一次真实运行（示例产品「今天吃啥」），', '是这座城里实际发生的人数：是模拟，不是对真实市场的预测。'],
    },
    screen: {
      label: '居民怎么用产品：他只看得到截图，超出阅读预算或看不清的地方是模糊的；他说出心里的话和手上的一个动作；屏幕上有看得见的变化才算做成。页面结构、元素列表、接口与脚本错误都不会交给他，他也不知道这是一次测试。',
      titles: ['这一眼', '心里的话', '手上的一个动作'],
      app: '闪念笔记',
      fields: ['用户名', '密码', '登录', '没有账号？注册一个'],
      clear: ['这一眼', '读得完的'],
      blurred: ['超出阅读预算、', '字太小的地方', '是糊的'],
      who: ['赵红梅', '56 岁，退休干部'],
      where: ['12:35', '家里沙发上', '吃午饭', '手机'],
      quote: ['“这还得先登录啊，', '我哪有账号。我点一下', '下面这个‘没有账号？', '注册一个’看看麻烦不', '麻烦，要是太费事我就', '不弄了。”'],
      action: '点',
      target: '没有账号？注册一个',
      before: '之前',
      after: '之后',
      register: ['注册', '注册并登录'],
      changed: ['屏幕上有看得见的变化，', '才算做成了'],
      next: '下一眼',
      never: '不会交给他的',
      neverItems: ['页面结构', '元素列表', '接口与脚本错误', '「这是一次测试」'],
    },
    verdict: {
      label: '一页结论的样子（取自一次真实运行）：一句话的结论；每一句都能点开，看到是谁说的、原话和当时的屏幕；人数一律标注为模拟。',
      product: ['闪念笔记', '想到什么，马上记下，自动保存'],
      tabs: ['结论', '人', '口碑'],
      engineering: '工程附录',
      headline: ['自动保存形同虚设，仅有的 3 个用户全气走了'],
      status: ['多数人用不下去', ' · 3 人用过'],
      section: '最让人难受的地方',
      sentence: ['大家写完标题和正文想存下来，看到页面底下写着「已自动保存」', '又没有保存按钮，就放心地退回笔记列表，结果标题全变成了', '「无标题」，再点进去，刚才打的字空空如也。三个人全都白忙活', '一场，直接气走了。'],
      who: ['周诗涵', ' · 29 岁，带货主播'],
      quote: ['“啊？怎么全都是空的！我刚才明明写了标题', '和内容的，说好的自动保存呢？这破软件连写的', '东西都存不住，简直浪费时间，不玩了！”'],
      open: '看这次使用 →',
      thumb: ['闪念笔记', '无标题', '已自动保存'],
      more: ['一打开就要先登录，还没开始记事就觉得麻烦。'],
      people: '人数',
      simulated: '模拟估计',
      funnel: ['看到', '注意到', '有兴趣', '打开过', '回来再用'],
      intensity: '宣发强度',
      hand: '把手机递给几个人',
      handButton: '递过去',
      legend: [['一句话的结论'], ['每一句都能点开'], ['谁说的、原话、', '当时的屏幕'], ['人数一律标注', '「模拟」']],
    },
    loop: {
      label: 'Coding agent 的循环：写完代码，经 MCP 发布，城里的人自己去用，取回结论和带复现步骤的问题清单，接着改，再发一次。',
      steps: [
        { title: '写完代码', sub: '任何支持 MCP 的 agent', mono: false },
        { title: '发布', sub: 'publish_product', mono: true },
        { title: '城里的人自己去用', sub: 'product_status', mono: true },
        { title: '取回结论与问题', sub: 'product_report', mono: true },
      ],
      back: ['接着改，', '再发一次'],
      carries: ['带复现步骤的', '问题清单'],
      issue: '笔记自动保存失效，退出重进后内容全部丢失',
      met: '4 人遇到',
      // 那次运行里合成出来的问题的复现步骤（第 5–8 步，产品界面上的原文）
      repro: [[5, 'click "+ 新建笔记"'], [6, 'type "内容" → "测试一下"'], [7, 'click "← 返回列表"'], [8, 'click "无标题"']],
    },
    stack: {
      label: 'Jobs 的结构：网页、命令行、coding agent、飞书、Terraria 是同一套能力的五个入口；我们自己的代码在一个镜像里（单端口网关、接口与网页、世界服务、使用过程、模型路由），旁边是标准镜像（Postgres、MinIO、NATS、可选的游戏服）；全部跑在你自己的机器上，只向外访问你的产品和你接入的模型供应商。',
      entries: [['网页', '第一眼是城'], ['命令行', 'jobsworld'], ['Coding agent', 'MCP'], ['飞书', '机器人'], ['Terraria', '走进同一座城']],
      machine: '你的机器 · Docker',
      ours: '我们自己的代码：一个镜像',
      gateway: ['单端口网关 :7777', 'HTTP → 接口 · Terraria → 游戏服'],
      api: ['接口与网页', 'REST · WebSocket 实时推送', '飞书机器人'],
      world: ['世界服务', '常驻运行：时钟、日程、需求', '遇到 → 决定 → 使用 → 口碑'],
      sessions: ['使用过程', '每次使用一个独立的 Chromium', '看截图定位 · 人的手 · 录像'],
      router: ['模型路由', '每一步 · 归纳 · 定位 · 向量 · 画图', '多家供应商，失败接替，记下花费'],
      standard: '标准镜像',
      images: [['Postgres + pgvector', '居民、记忆、发布'], ['MinIO', '截图、录像等证据'], ['NATS', '事件总线'], ['Terraria 游戏服', '可选 · TShock · tModLoader']],
      product: ['你的产品', '这台机器访问得到的任何网址，', '本机的开发服务器也行'],
      providers: ['你接入的模型供应商', '在网页的「模型」里配置，', '保存后几秒生效'],
      data: ['居民、记忆、截图和结论都存在', '你机器上的 Docker 卷里。'],
    },
  },
  en: {
    banner: { label: 'Jobs: before you launch, let a whole town try it', tagline: 'Before you launch, let a whole town try it.' },
    journey: {
      label: 'What happens after you launch: the product goes into the town; residents come across it, notice it, decide for themselves whether to open it, use it in their own situation, tell others afterwards, and it all rolls up into one plain page. Rules decide who comes across it and who notices; the residents decide everything else.',
      rules: ['Rules decide · no model calls', 'who sees it, who notices'],
      person: ['They decide · the only model calls', 'whether to open it, how to use it, whom to tell'],
      steps: [
        { title: 'Launch', sub: ['A URL, a name,', 'one line'] },
        { title: 'Comes across it', sub: ['App store, ads,', 'billboards, feed,', 'a friend'], count: 'Saw it' },
        { title: 'Notices', sub: ['Most impressions', 'go unnoticed'], count: 'Noticed' },
        { title: 'Decides', sub: ['Busy, tired, not', 'for me: they', 'scroll past'], count: 'Interested' },
        { title: 'Uses it', sub: ['Sees only the', 'screen, in their', 'here and now'], count: 'Opened' },
        { title: 'Afterwards', sub: ['A review, a post,', 'word to friends,', 'a return visit'], count: 'Came back' },
        { title: 'Conclusion', sub: ['One plain page;', 'every line opens'] },
      ],
      form: ['URL', 'Name', 'One line', 'Publish'],
      note: ['Each dot is one resident of the town, 201 in all. The counts come from a real run on a development instance', '(a sample dinner-ideas app): people in this simulated town, not a forecast of a real market.'],
    },
    screen: {
      label: 'How a resident uses a product: they see only the screenshot, and whatever is past their reading budget or too small is blurred; they say what they think and name one action for their hand; it only counts if the screen visibly changes. Page structure, element lists and API or script errors are never handed to them, and they do not know it is a test.',
      titles: ['One look', 'What she thinks', 'One action'],
      app: '闪念笔记',
      fields: ['用户名', '密码', '登录', '没有账号？注册一个'],
      clear: ['What one glance', 'can take in'],
      blurred: ['Past the', 'reading budget,', 'or too small:', 'blurred'],
      who: ['Zhao Hongmei', '56, retired civil servant'],
      where: ['12:35', 'On the sofa at home', 'Having lunch', 'Phone'],
      quote: ['“I have to log in first? I', 'don’t have an account. Let', 'me tap this ‘No account?', 'Sign up’ and see how much', 'trouble it is. If it’s a', 'hassle, I won’t bother.”'],
      action: 'Tap',
      target: '没有账号？注册一个',
      before: 'Before',
      after: 'After',
      register: ['注册', '注册并登录'],
      changed: ['It only counts if the screen', 'visibly changes'],
      next: 'Next look',
      never: 'Never handed to them',
      neverItems: ['Page structure', 'Element lists', 'API and script errors', '“This is a test”'],
    },
    verdict: {
      label: 'What the one-page conclusion looks like (from a real run, translated from Chinese): a one-line verdict; every sentence opens to who said it, their words and the screen at that moment; head counts are always labelled as simulated.',
      product: ['闪念笔记 (Quick Notes)', 'Write it down the moment you think of it. Saves automatically.'],
      tabs: ['Verdict', 'People', 'Word of mouth'],
      engineering: 'Engineering',
      headline: ['Auto-save saved nothing.', 'All three who tried it left.'],
      status: ['Most people give up', ' · 3 used it'],
      section: 'What hurt most',
      sentence: ['They wrote a title and a note, saw “Auto-saved” at the', 'bottom and no save button, and went back to the list.', 'Every title now read “Untitled”, and the note they had', 'just typed was empty. All three had wasted their effort', 'and left.'],
      who: ['Zhou Shihan', ' · 29, livestream seller'],
      quote: ['“What? It’s all empty! I wrote a title and the', 'text just now. What happened to auto-save? This', 'thing can’t even keep what I type. What a waste', 'of time. I’m done!”'],
      open: 'Open session →',
      thumb: ['闪念笔记', '无标题', '已自动保存'],
      more: ['It asks you to log in before you can write anything.'],
      people: 'People',
      simulated: 'Simulated',
      funnel: ['Saw it', 'Noticed', 'Interested', 'Opened', 'Came back'],
      intensity: 'Promotion',
      hand: 'Hand it to a few people',
      handButton: 'Hand it over',
      legend: [['A one-line verdict'], ['Every sentence opens'], ['Who said it, their words,', 'the screen at that moment'], ['Head counts are always', 'labelled “simulated”']],
    },
    loop: {
      label: 'The loop for coding agents: write the code, launch over MCP, let the town use it, pull back the conclusion and a list of issues with steps to reproduce, fix, and launch again.',
      steps: [
        { title: 'Write the code', sub: 'Any MCP agent', mono: false },
        { title: 'Launch', sub: 'publish_product', mono: true },
        { title: 'The town uses it', sub: 'product_status', mono: true },
        { title: 'Pull back issues', sub: 'product_report', mono: true },
      ],
      back: ['Fix it,', 'launch again'],
      carries: ['Issues with steps', 'to reproduce'],
      issue: 'Auto-save fails: what you typed is gone',
      met: '4 people hit it',
      // 那次运行里合成出来的问题的复现步骤（第 5–8 步，产品界面上的原文）
      repro: [[5, 'click "+ 新建笔记"'], [6, 'type "内容" → "测试一下"'], [7, 'click "← 返回列表"'], [8, 'click "无标题"']],
    },
    stack: {
      label: 'How Jobs is put together: the web page, the command line, coding agents, Feishu and Terraria are five ways into the same capabilities; our own code ships as one image (single-port gateway, API and web, world service, usage sessions, model router) next to standard images (Postgres, MinIO, NATS, optional game servers); everything runs on your own machine and reaches out only to your product and the model providers you connect.',
      entries: [['Web', 'The town comes first'], ['Command line', 'jobsworld'], ['Coding agent', 'MCP'], ['Feishu', 'Bot'], ['Terraria', 'Walk into the town']],
      machine: 'Your machine · Docker',
      ours: 'Our own code: one image',
      gateway: ['Single-port gateway :7777', 'HTTP → API · Terraria → game servers'],
      api: ['API and web', 'REST · WebSocket live updates', 'Feishu bot'],
      world: ['World service', 'Always on: clock, schedules', 'Meet → decide → use → talk'],
      sessions: ['Usage sessions', 'One Chromium per session', 'Screenshot only · human hand'],
      router: ['Model router', 'Five model groups, by role', 'Many providers, failover'],
      standard: 'Standard images',
      images: [['Postgres + pgvector', 'Residents, memories, launches'], ['MinIO', 'Screenshots, recordings'], ['NATS', 'Event bus'], ['Terraria servers', 'Optional · TShock · tModLoader']],
      product: ['Your product', 'Any URL this machine can reach,', 'a local dev server included'],
      providers: ['Your model providers', 'Configured on the Models page,', 'live seconds after saving'],
      data: ['Residents, memories, screenshots', 'and conclusions stay in Docker', 'volumes on your machine.'],
    },
  },
};

/* ---------------------------------------------------------------- 画图用的小工具 */

const n = (v) => String(Math.round(v * 100) / 100);
const cls = (c) => (c ? ` class="${c}"` : '');
const rect = (x, y, w, h, r, c, extra = '') => `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}"${r ? ` rx="${n(r)}"` : ''}${cls(c)}${extra}/>`;
const circle = (cx, cy, r, c) => `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}"${cls(c)}/>`;
const line = (x1, y1, x2, y2, c) => `<path d="M${n(x1)} ${n(y1)}L${n(x2)} ${n(y2)}"${cls(c)}/>`;
const path = (d, c) => `<path d="${d}"${cls(c)}/>`;
const text = (x, y, s, c) => `<text x="${n(x)}" y="${n(y)}"${cls(`t ${c}`)}>${esc(s)}</text>`;
/** 一段多行文字：每行一个 <text>（SVG 不会自己折行，行由文案决定）。 */
const lines = (x, y, arr, c, lh) => arr.map((s, i) => text(x, y + i * lh, s, c)).join('');
/** 两段不同样式接在一行里。 */
const pair = (x, y, a, ca, b, cb, c) => `<text x="${n(x)}" y="${n(y)}"${cls(`t ${c}`)}><tspan${cls(ca)}>${esc(a)}</tspan><tspan${cls(cb)}>${esc(b)}</tspan></text>`;
const group = (c, body, extra = '') => `<g${cls(c)}${extra}>${body}</g>`;
/**
 * 一张浮起来的卡片：底色 + 细线框 + 往下沉的软影（url(#fx)，figure() 换成每幅图自己的 id）+ 顶边一道受光的细线。
 * 用来把图里的区块分层，而不是全画在同一层底色上。
 */
const card = (x, y, w, h, r, c = 'f-surface s-line') =>
  rect(x, y, w, h, r, c, ' filter="url(#fx)"') + path(`M${n(x + r)} ${n(y + 0.75)}H${n(x + w - r)}`, 's-hl no-fill');
/** 卡片里再凹进去一层（证据、控件）：更深的底、没有影。 */
const inset = (x, y, w, h, r) => rect(x, y, w, h, r, 'f-inset s-line');
/** 箭头：从 (x1,y1) 到 (x2,y2) 的一条线，末端一个小尖。只画水平或垂直方向。 */
function arrow(x1, y1, x2, y2, c = 's-strong') {
  const a = 4;
  const head = x1 === x2 ? (y2 > y1 ? `M${n(x2 - a)} ${n(y2 - a)}L${n(x2)} ${n(y2)}L${n(x2 + a)} ${n(y2 - a)}` : `M${n(x2 - a)} ${n(y2 + a)}L${n(x2)} ${n(y2)}L${n(x2 + a)} ${n(y2 + a)}`) : x2 > x1 ? `M${n(x2 - a)} ${n(y2 - a)}L${n(x2)} ${n(y2)}L${n(x2 - a)} ${n(y2 + a)}` : `M${n(x2 + a)} ${n(y2 - a)}L${n(x2)} ${n(y2)}L${n(x2 + a)} ${n(y2 + a)}`;
  return path(`M${n(x1)} ${n(y1)}L${n(x2)} ${n(y2)}${head}`, `${c} no-fill`);
}

/** 估一段文字有多宽（像素）。只用来给胶囊和分段控件排位置，留了余量；文字本身一律居中，字体不同也不会出框。 */
function widthOf(s, size) {
  let w = 0;
  for (const ch of s) {
    if (ch.codePointAt(0) >= 0x2e80) w += size;
    else if (/[ilj.,:;'’‘“”!|· ]/.test(ch)) w += size * 0.32;
    else if (/[mwMW@]/.test(ch)) w += size * 0.88;
    else if (/[A-Z0-9]/.test(ch)) w += size * 0.66;
    else w += size * 0.56;
  }
  return w;
}

/** 一排胶囊，放不下就换行。返回 { svg, bottom }。 */
function chips(x, y, maxW, items, { size = 14, h = 28, gap = 8, struck = false } = {}) {
  let cx = x;
  let cy = y;
  let svg = '';
  for (const s of items) {
    const w = Math.ceil(widthOf(s, size) + 24);
    if (cx > x && cx + w > x + maxW) {
      cx = x;
      cy += h + gap;
    }
    svg += rect(cx, cy, w, h, h / 2, struck ? 'no-fill s-line dashed' : 'no-fill s-strong');
    svg += text(cx + w / 2, cy + h / 2 + size * 0.36, s, `t-mid ${struck ? 't-s' : 't-m'} t-${size}`);
    if (struck) svg += line(cx + 10, cy + h / 2, cx + w - 10, cy + h / 2, 's-muted');
    cx += w + gap;
  }
  return { svg, bottom: cy + h };
}

/** 确定性的伪随机数（同一份源码永远画出同一幅图）。 */
function prng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 「此刻」的叠加层：第 i 步（从 1 起）时亮起。 */
const now = (i, body) => group(`now now-${i}`, body, ' aria-hidden="true"');

/*
 * 字号：这些图在 README 里只有约 850px 宽（画布 960，缩到 0.88 倍），所以图里承载内容的字最小 13px、
 * 说明文字 14px、正文 15px，缩小后仍在 11px 以上。只有手机示意和缩略图里的界面文字更小（它们画的是界面，不是用来读的）。
 */

/* ---------------------------------------------------------------- 字标条幅（只给 README 用） */

function banner(t) {
  const W = 960;
  const H = 268;
  const cells = W / 4;
  let lit = 0;
  const street = horizonRects(cells, 20261115, () => {
    lit += 1;
    return lit % 3 === 0 ? ` tw tw-${(lit / 3) % 4 || 4}` : '';
  });
  const mark = `<g transform="translate(374 44) scale(4.5)" shape-rendering="crispEdges"><rect class="px-a" x="2" y="6" width="4" height="8"/><rect class="px-b" x="7" y="3" width="4" height="11"/><rect class="px-a" x="12" y="8" width="2" height="6"/><rect class="px-lit" x="8" y="5" width="1" height="1"/><rect class="px-lit" x="9" y="8" width="1" height="1"/><rect class="px-lit" x="3" y="9" width="1" height="1"/><rect class="px-lit" x="0" y="14" width="16" height="2"/></g>`;
  const body = `${mark}${text(462, 104, 'Jobs', 't-d t-b t-60')}${text(480, 150, t.tagline, 't-m t-mid t-19')}<g transform="translate(0 ${H - 96}) scale(4)" shape-rendering="crispEdges">${street.join('')}</g>`;
  return { w: W, h: H, steps: 0, body };
}

/* ---------------------------------------------------------------- 发布之后发生什么 */

// 一次真实运行里按人去重的人数（开发实例，示例产品「今天吃啥」，201 位居民）：看到、注意到、有兴趣、打开过、回来再用
const RESIDENTS = 201;
const FUNNEL = [194, 148, 11, 9, 1];

function journey(t) {
  const W = 960;
  const xs = [72, 208, 344, 480, 616, 752, 888];
  const trackY = 106;
  const colTop = 90;
  const countY = 246;
  const gridTop = 286;
  const cols = 12;
  const pitch = 7.5;
  const rows = Math.ceil(RESIDENTS / cols);
  const gridBottom = gridTop + rows * pitch;
  const colBottom = gridBottom + 14;
  const H = colBottom + 66;

  // 每位居民在每一格里的位置相同；人数少的一层是人数多的一层的子集
  const rand = prng(194148);
  const order = Array.from({ length: RESIDENTS }, (_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const rank = [];
  order.forEach((who, r) => (rank[who] = r));

  let s = '';
  // 谁在决定
  const bracket = (from, to, label) => {
    const x1 = xs[from] - 58;
    const x2 = xs[to] + 58;
    const mid = (x1 + x2) / 2;
    return text(mid, 30, label[0], 't-d t-sb t-15 t-mid') + text(mid, 51, label[1], 't-m t-14 t-mid') + path(`M${n(x1)} 72v-7h${n(x2 - x1)}v7`, 's-strong no-fill');
  };
  s += bracket(1, 2, t.rules) + bracket(3, 5, t.person);

  // 「此刻」：整列铺一层琥珀薄雾
  xs.forEach((cx, i) => (s += now(i + 1, rect(cx - 62, colTop, 124, colBottom - colTop, 14, 'f-accent-soft'))));

  // 轨道与站点
  s += line(xs[0], trackY, xs[6], trackY, 's-strong');
  for (let i = 0; i < 6; i++) {
    const mx = (xs[i] + xs[i + 1]) / 2;
    s += path(`M${n(mx - 3)} ${trackY - 4}l4 4l-4 4`, 's-muted no-fill');
  }
  xs.forEach((cx, i) => {
    s += circle(cx, trackY, 6, 'f-bg s-strong');
    s += now(i + 1, circle(cx, trackY, 6, 'f-accent') + circle(cx, trackY, 11, 'no-fill s-accent faint'));
    const st = t.steps[i];
    s += text(cx, trackY + 36, st.title, 't-d t-b t-16 t-mid');
    s += lines(cx, trackY + 60, st.sub, 't-m t-14 t-mid', 19);
  });

  // 五层人数：每格 201 个点，亮着的是这一层的人。每一层是一张浮起来的小卡
  FUNNEL.forEach((count, k) => {
    const cx = xs[k + 1];
    s += card(cx - 56, countY - 34, 112, gridBottom - countY + 50, 12);
    s += text(cx, countY, String(count), 't-d t-b t-24 t-mid t-num');
    s += text(cx, countY + 22, t.steps[k + 1].count, 't-m t-14 t-mid');
    const x0 = cx - ((cols - 1) * pitch) / 2;
    let on = '';
    let off = '';
    for (let i = 0; i < RESIDENTS; i++) {
      const d = `M${n(x0 + (i % cols) * pitch)} ${n(gridTop + Math.floor(i / cols) * pitch + 3)}h0`;
      if (rank[i] < count) on += d;
      else off += d;
    }
    s += path(off, 'dot dot-off') + path(on, 'dot dot-on');
  });

  // 第一列：发布对话框的三项
  const fx = xs[0] - 54;
  const fy = countY - 18;
  t.form.slice(0, 3).forEach((label, i) => {
    s += rect(fx, fy + i * 38, 108, 30, 8, 'f-inset s-line');
    s += text(fx + 11, fy + 20 + i * 38, label, 't-s t-13');
  });
  s += rect(fx, fy + 122, 108, 32, 8, 'f-fg');
  s += text(xs[0], fy + 143, t.form[3], 't-inv t-sb t-14 t-mid');

  // 最后一列：一页结论的缩影
  const px = xs[6] - 54;
  const py = fy;
  s += card(px, py, 108, 186, 10, 'f-surface s-line');
  s += rect(px + 11, py + 15, 78, 7, 3.5, 'f-fg') + rect(px + 11, py + 28, 54, 7, 3.5, 'f-fg');
  [86, 80, 62].forEach((w, i) => (s += rect(px + 11, py + 50 + i * 10, w, 3.5, 1.75, 'f-subtle')));
  s += line(px + 11, py + 86, px + 97, py + 86, 's-line');
  [82, 68].forEach((w, i) => (s += rect(px + 11, py + 97 + i * 10, w, 3.5, 1.75, 'f-muted')));
  s += circle(px + 17, py + 131, 6, 'f-sage') + rect(px + 29, py + 125, 36, 3.5, 1.75, 'f-muted') + rect(px + 29, py + 134, 28, 3.5, 1.75, 'f-subtle') + rect(px + 72, py + 121, 25, 19, 3, 'f-hover s-line');
  s += line(px + 11, py + 152, px + 97, py + 152, 's-line');
  [74, 84].forEach((w, i) => (s += rect(px + 11, py + 163 + i * 10, w, 3.5, 1.75, 'f-subtle')));

  s += lines(W / 2, colBottom + 28, t.note, 't-s t-13 t-mid', 19);
  return { w: W, h: H, steps: 7, body: s };
}

/* ---------------------------------------------------------------- 他只看得到屏幕 */

function screen(t) {
  const W = 960;
  const px = [24, 336, 648];
  const pw = 288;
  const top = 52;
  const ph = 336;
  let s = '<defs><filter id="fig-blur" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="2.4"/></filter></defs>';

  px.forEach((x, i) => {
    s += text(x + 2, 35, t.titles[i], 't-d t-b t-16');
    s += card(x, top, pw, ph, 14);
    s += now(i + 1, rect(x, top, pw, ph, 14, 'no-fill s-accent'));
    if (i < 2) s += arrow(x + pw + 6, top + ph / 2, x + pw + 18, top + ph / 2);
  });

  // ---- 1. 这一眼：手机上的登录页，下半截是余光
  const sx = px[0] + 20;
  const sw = 126;
  const sh = 256;
  const sy = top + (ph - sh) / 2;
  s += rect(sx, sy, sw, sh, 16, 'f-bg s-strong', ' filter="url(#fx)"');
  s += rect(sx + 7, sy + 7, sw - 14, 32, 9, 'f-hover') + text(sx + 17, sy + 28, t.app, 't-d t-sb t-12');
  s += text(sx + 15, sy + 62, t.fields[0], 't-m t-11') + rect(sx + 15, sy + 68, sw - 30, 21, 5, 'no-fill s-strong');
  s += text(sx + 15, sy + 108, t.fields[1], 't-m t-11') + rect(sx + 15, sy + 114, sw - 30, 21, 5, 'no-fill s-strong');
  s += rect(sx + 15, sy + 147, sw - 30, 24, 6, 'f-fg') + text(sx + sw / 2, sy + 163, t.fields[2], 't-inv t-sb t-11 t-mid');
  s += text(sx + sw / 2, sy + 192, t.fields[3], 't-d t-11 t-mid') + line(sx + 16, sy + 197, sx + sw - 16, sy + 197, 's-muted');
  // 糊掉的部分：页脚的小字
  let small = '';
  [0, 1, 2, 3].forEach((i) => (small += rect(sx + 17, sy + 212 + i * 9, [90, 78, 92, 54][i], 3.5, 1.5, 'f-muted')));
  s += group('', small, ' filter="url(#fig-blur)"');
  const ax = sx + sw + 16;
  s += line(sx + sw + 4, sy + 100, ax - 4, sy + 100, 's-strong') + lines(ax, sy + 96, t.clear, 't-m t-14', 19);
  s += line(sx + sw + 4, sy + 226, ax - 4, sy + 226, 's-strong') + lines(ax, sy + 231 - (t.blurred.length - 1) * 19, t.blurred, 't-m t-14', 19);

  // ---- 2. 心里的话：是谁、此时此地、原话
  const qx = px[1] + 20;
  s += circle(qx + 17, top + 40, 17, 'f-sage') + circle(qx + 17, top + 35, 5.8, 'f-bg') + path(`M${n(qx + 6.5)} ${top + 52}a10.5 9.5 0 0 1 21 0z`, 'f-bg');
  s += text(qx + 45, top + 37, t.who[0], 't-d t-b t-16') + text(qx + 45, top + 57, t.who[1], 't-m t-14');
  const where = chips(qx, top + 74, pw - 40, t.where);
  s += where.svg;
  const by = where.bottom + 14;
  const bh = top + ph - 20 - by;
  s += rect(qx, by, pw - 40, bh, 12, 'f-inset s-line');
  s += lines(qx + 14, by + 28, t.quote, 't-d t-15', 22);

  // ---- 3. 手上的一个动作：点哪里；屏幕变了才算
  const hx = px[2] + 20;
  const hw = pw - 40;
  const aw = Math.ceil(widthOf(t.action, 14) + 28);
  s += rect(hx, top + 22, aw, 28, 14, 'f-hover') + text(hx + aw / 2, top + 41, t.action, 't-d t-sb t-14 t-mid');
  s += rect(hx, top + 64, hw, 62, 10, 'f-bg s-strong', ' filter="url(#fx)"');
  s += text(hx + 100, top + 100.5, t.target, 't-d t-16 t-mid') + line(hx + 28, top + 107, hx + 172, top + 107, 's-muted');
  // 手指落点：琥珀表示「指向的就是它」
  s += circle(hx + hw - 34, top + 98, 15, 'no-fill s-accent ripple') + circle(hx + hw - 34, top + 98, 5.5, 'f-accent');
  // 之前 → 之后
  const tx = hx + 34;
  const ty = top + 168;
  const mini = (x, label, after) => {
    let m = text(x + 32, ty - 10, label, 't-m t-13 t-mid') + rect(x, ty, 64, 88, 9, 'f-bg s-strong') + rect(x + 5, ty + 5, 54, 13, 4, 'f-hover');
    if (after) {
      m += text(x + 10, ty + 15, t.register[0], 't-d t-sb t-9');
      [0, 1, 2].forEach((i) => (m += rect(x + 9, ty + 25 + i * 14, 46, 9, 2.5, 'no-fill s-strong')));
      m += rect(x + 9, ty + 69, 46, 10, 3, 'f-fg');
    } else {
      [0, 1].forEach((i) => (m += rect(x + 9, ty + 27 + i * 16, 46, 9, 2.5, 'no-fill s-strong')));
      m += rect(x + 9, ty + 59, 46, 10, 3, 'f-fg') + rect(x + 16, ty + 76, 32, 2.5, 1, 'f-muted');
    }
    return m;
  };
  s += mini(tx, t.before, false) + arrow(tx + 78, ty + 44, tx + 104, ty + 44) + mini(tx + 118, t.after, true);
  s += lines(hx + hw / 2, ty + 116, t.changed, 't-m t-14 t-mid', 19);

  // ---- 回到下一眼
  const ry = top + ph + 28;
  const x1 = px[2] + pw / 2;
  const x0 = px[0] + pw / 2;
  s += path(`M${n(x1)} ${top + ph}V${ry}H${n(x0)}V${top + ph + 2}M${n(x0 - 4)} ${top + ph + 6}l4 -4l4 4`, 's-strong no-fill');
  const nw = widthOf(t.next, 14) + 28;
  s += rect(W / 2 - nw / 2, ry - 12, nw, 24, 12, 'f-card') + text(W / 2, ry + 5, t.next, 't-m t-14 t-mid');

  // ---- 不会交给他的
  const ny = ry + 38;
  const lw = widthOf(t.never, 14) + 20;
  s += text(24, ny + 19, t.never, 't-d t-sb t-14');
  const never = chips(24 + lw, ny, W - 48 - lw, t.neverItems, { struck: true });
  s += never.svg;
  return { w: W, h: never.bottom + 24, steps: 3, body: s };
}

/* ---------------------------------------------------------------- 一页结论 */

// 「闪念笔记」那一页右栏当时的人数（按人去重）
const VERDICT_FUNNEL = [194, 155, 4, 4, 0];

function verdict(t) {
  const W = 960;
  const L = 76; // 主栏文字左边
  const R = 614; // 主栏文字右边
  const C = 680; // 右栏文字左边
  const E = 904; // 右栏文字右边
  const CL = L - 18; // 主栏卡片
  const CW = R - L + 36;
  const RL = C - 18; // 右栏卡片
  const RW = E - C + 36;
  let s = '';
  let marks = '';
  const marker = (i, x, y) => {
    marks += circle(x, y, 10, 'f-card s-sage') + now(i, circle(x, y, 10, 'f-accent-soft s-accent')) + text(x, y + 4.5, String(i), 't-m t-sb t-13 t-mid t-num');
  };

  // 产品页头：单独一条，和下面的内容分开
  s += rect(25, 25, W - 50, 124, 17, 'f-raised') + rect(25, 100, W - 50, 49, 0, 'f-raised') + line(25, 149, W - 25, 149, 's-line');
  s += text(L, 64, t.product[0], 't-d t-b t-19') + text(L, 86, t.product[1], 't-m t-14');
  let tx = L;
  const tabW = t.tabs.map((x) => Math.ceil(widthOf(x, 14) + 26));
  s += rect(L, 102, tabW.reduce((a, b) => a + b, 0) + 6, 34, 10, 'f-inset s-line');
  t.tabs.forEach((label, i) => {
    if (i === 0) s += rect(tx + 3, 105, tabW[i], 28, 7, 'f-hover s-line');
    s += text(tx + 3 + tabW[i] / 2, 124, label, `t-14 t-mid ${i === 0 ? 't-d t-sb' : 't-m'}`);
    tx += tabW[i];
  });
  s += text(R, 124, t.engineering, 't-m t-14 t-end');

  // 结论：一张自己的卡，带一点点「出事了」的底色
  let y = 172;
  const hy = y + 42;
  const headH = 42 + (t.headline.length - 1) * 32 + 34 + 22;
  s += card(CL, y, CW, headH, 14) + rect(CL, y, CW, headH, 14, 'f-danger-wash');
  s += lines(L, hy, t.headline, 't-d t-b t-24', 32);
  marker(1, 40, hy - 8);
  const sy = hy + (t.headline.length - 1) * 32 + 34;
  s += circle(L + 5, sy - 5, 4.5, 'f-danger') + pair(L + 19, sy, t.status[0], 't-d t-sb', t.status[1], 't-m', 't-15');
  y += headH + 34;

  // 小节标题
  s += text(L, y, t.section, 't-d t-b t-16');
  y += 14;

  // 展开着的一句：句子在卡上，证据凹进去一层
  const top = y;
  let iy = top + 34;
  s += lines(L, iy, t.sentence, 't-d t-15', 23);
  marker(2, 40, iy - 5);
  [0, 1, 2].forEach((i) => (s += circle(R - 54 + i * 13, iy - 5, 9, 'f-avatar s-card')));
  s += path(`M${R - 10} ${iy - 3}l5 -5l5 5`, 's-muted no-fill');
  iy += (t.sentence.length - 1) * 23 + 22;
  const ey = iy; // 证据框的上沿
  let qy0 = ey + 34;
  marker(3, 40, qy0 - 5);
  const ex = L + 14;
  s += circle(ex + 12, qy0 + 1, 12, 'f-sage') + circle(ex + 12, qy0 - 3, 4.2, 'f-bg') + path(`M${ex + 4.5} ${qy0 + 10}a7.5 7 0 0 1 15 0z`, 'f-bg');
  s += pair(ex + 36, qy0, t.who[0], 't-d t-b', t.who[1], 't-m', 't-15');
  s += lines(ex + 36, qy0 + 26, t.quote, 't-d t-15', 23);
  const qy = qy0 + 26 + t.quote.length * 23;
  s += text(ex + 36, qy + 6, t.open, 't-link t-14');
  // 当时的屏幕：空的笔记，底下却写着「已自动保存」
  const hx = R - 14 - 116;
  const hy2 = qy0 - 14;
  s += rect(hx, hy2, 116, 88, 8, 'f-surface s-strong', ' filter="url(#fx)"');
  s += rect(hx + 5, hy2 + 5, 106, 17, 4, 'f-hover') + text(hx + 12, hy2 + 17, t.thumb[0], 't-d t-sb t-9');
  s += rect(hx + 10, hy2 + 30, 96, 15, 3, 'no-fill s-strong') + text(hx + 16, hy2 + 41, t.thumb[1], 't-s t-9');
  s += rect(hx + 10, hy2 + 50, 96, 19, 3, 'no-fill s-strong');
  s += text(hx + 58, hy2 + 82, t.thumb[2], 't-m t-9 t-mid');
  const eb = Math.max(qy + 6, hy2 + 88) + 18;
  const evidence = inset(L, ey, R - L, eb - ey, 10);
  const bottom = eb + 18;
  const expanded = card(CL, top, CW, bottom - top, 14);

  // 下一句，收着：一条更安静的行
  const ry = bottom + 12;
  const rowH = 50;
  const collapsed = card(CL, ry, CW, rowH, 12, 'f-raised s-line');
  s += lines(L, ry + 31, t.more, 't-d t-15', 23);
  [0, 1, 2].forEach((i) => (s += circle(R - 54 + i * 13, ry + 26, 9, 'f-avatar s-card')));
  s += path(`M${R - 10} ${ry + 23}l5 5l5 -5`, 's-muted no-fill');
  const mainBottom = ry + rowH;

  // 右栏：三张卡——人数（模拟）、宣发强度、把手机递给几个人
  let ry1 = 172;
  const labelW = Math.max(...t.funnel.map((x) => widthOf(x, 14))) + 16;
  const barW = E - C - labelW - 40;
  const peopleH = 52 + VERDICT_FUNNEL.length * 30 + 10;
  let right = card(RL, ry1, RW, peopleH, 14);
  marker(4, RL - 14, ry1 + 30);
  const sw = Math.ceil(widthOf(t.simulated, 13) + 20);
  const pwid = widthOf(t.people, 16);
  right += text(C, ry1 + 36, t.people, 't-d t-b t-16') + rect(C + pwid + 12, ry1 + 19, sw, 24, 12, 'no-fill s-strong') + text(C + pwid + 12 + sw / 2, ry1 + 35.5, t.simulated, 't-m t-13 t-mid');
  VERDICT_FUNNEL.forEach((v, i) => {
    const fy = ry1 + 76 + i * 30;
    right += text(C, fy, t.funnel[i], 't-m t-14');
    right += rect(C + labelW, fy - 10, barW, 11, 5.5, 'f-track');
    if (v > 0) right += rect(C + labelW, fy - 10, Math.max(4, (barW * v) / VERDICT_FUNNEL[0]), 11, 5.5, 'f-sage');
    right += text(E, fy, String(v), `t-b t-16 t-end t-num ${v ? 't-d' : 't-s'}`);
  });
  ry1 += peopleH + 12;
  const intH = 84;
  right += card(RL, ry1, RW, intH, 14);
  right += text(C, ry1 + 34, t.intensity, 't-d t-b t-15') + text(E, ry1 + 34, '90%', 't-d t-15 t-end t-num');
  const ty = ry1 + 60;
  right += line(C, ty, E, ty, 's-strong') + path(`M${C} ${ty}H${n(C + (E - C) * 0.9)}`, 's-fg sw-2') + circle(C + (E - C) * 0.9, ty, 7, 'f-fg s-card sw-2');
  ry1 += intH + 12;
  const handH = 104;
  right += card(RL, ry1, RW, handH, 14);
  right += text(C, ry1 + 34, t.hand, 't-d t-b t-15');
  const by = ry1 + 52;
  right += rect(C, by, 88, 36, 10, 'f-inset s-line') + text(C + 17, by + 23.5, '−', 't-m t-16 t-mid') + text(C + 44, by + 23, '3', 't-d t-15 t-mid t-num') + text(C + 71, by + 23.5, '+', 't-m t-16 t-mid');
  right += rect(C + 98, by, E - C - 98, 36, 10, 'f-hover s-strong') + text(C + 98 + (E - C - 98) / 2, by + 23, t.handButton, 't-d t-sb t-15 t-mid');
  const rightBottom = ry1 + handH;

  const frameBottom = Math.max(mainBottom, rightBottom) + 28;
  // 页面的框，画在最底下
  const frame = rect(24, 24, W - 48, frameBottom - 24, 18, 'f-bg s-line');

  // 图例
  const ly = frameBottom + 36;
  let legend = '';
  t.legend.forEach((item, i) => {
    const x = 36 + i * 228;
    legend += circle(x, ly - 5, 10, 'no-fill s-sage') + now(i + 1, circle(x, ly - 5, 10, 'f-accent-soft s-accent')) + text(x, ly - 0.5, String(i + 1), 't-m t-sb t-13 t-mid t-num');
    legend += lines(x + 20, ly, item, 't-m t-14', 19);
  });
  return { w: W, h: ly + 19 + 22, steps: 4, body: frame + expanded + evidence + collapsed + right + s + marks + legend };
}

/* ---------------------------------------------------------------- coding agent 的循环 */

function loop(t) {
  const W = 960;
  const bw = 200;
  const bh = 86;
  const gap = (W - 48 - bw * 4) / 3;
  const top = 28;
  let s = '';
  const xs = [0, 1, 2, 3].map((i) => 24 + i * (bw + gap));
  xs.forEach((x, i) => {
    const st = t.steps[i];
    s += card(x, top, bw, bh, 12) + now(i + 1, rect(x, top, bw, bh, 12, 'no-fill s-accent'));
    s += text(x + 18, top + 36, st.title, 't-d t-b t-16') + text(x + 18, top + 61, st.sub, `t-m t-14${st.mono ? ' t-mono' : ''}`);
    if (i < 3) s += arrow(x + bw + 8, top + bh / 2, x + bw + gap - 8, top + bh / 2);
  });

  // 回路：从最后一步带着问题清单回到第一步
  const cx1 = 262;
  const cx2 = W - 262;
  const cy = top + bh + 24;
  const ch = 138;
  const ry = cy + ch - 34;
  const xr = xs[3] + bw / 2;
  const xl = xs[0] + bw / 2;
  s += path(`M${n(xr)} ${top + bh}V${ry}H${n(xl)}V${top + bh + 2}M${n(xl - 4)} ${top + bh + 6}l4 -4l4 4`, 's-strong no-fill');
  s += lines((xl + cx1) / 2, ry - 31, t.back, 't-m t-14 t-mid', 19) + lines((xr + cx2) / 2, ry - 31, t.carries, 't-m t-14 t-mid', 19);
  // 取回的东西：一个问题，带复现步骤
  s += card(cx1, cy, cx2 - cx1, ch, 12) + rect(cx1, cy, cx2 - cx1, ch, 12, 'f-danger-wash');
  s += rect(cx1 + 16, cy + 15, 34, 22, 6, 'no-fill s-danger') + text(cx1 + 33, cy + 30.5, 'P0', 't-danger t-sb t-13 t-mid');
  s += text(cx1 + 60, cy + 31, t.issue, 't-d t-sb t-14') + text(cx1 + 60, cy + 52, t.met, 't-m t-13');
  t.repro.forEach(([num, step], i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = cx1 + 16 + col * ((cx2 - cx1 - 32) / 2 + 4);
    s += text(x + 10, cy + 88 + row * 25, String(num), 't-s t-13 t-mono t-end t-num') + text(x + 20, cy + 88 + row * 25, step, 't-m t-13 t-mono');
  });
  return { w: W, h: cy + ch + 24, steps: 4, body: s };
}

/* ---------------------------------------------------------------- 结构 */

function stack(t) {
  const W = 960;
  let s = '';
  // 五个入口
  const ew = 170;
  const eg = (W - 48 - ew * 5) / 4;
  t.entries.forEach(([title, sub], i) => {
    const x = 24 + i * (ew + eg);
    const mono = /^[a-z]+$/.test(sub) || sub === 'MCP';
    s += card(x, 20, ew, 56, 10) + text(x + ew / 2, 43, title, 't-d t-b t-15 t-mid') + text(x + ew / 2, 63, sub, `t-m t-13 t-mid${mono ? ' t-mono' : ''}`);
    s += arrow(x + ew / 2, 80, x + ew / 2, 102);
  });

  // 你的机器
  const mTop = 108;
  s += text(44, mTop + 28, t.machine, 't-m t-sb t-14');

  // 我们自己的代码
  const ox = 44;
  const ow = 566;
  const oy = mTop + 44;
  const ix = ox + 16;
  const iw = ow - 32;
  const gy = oy + 44;
  const cw = (iw - 12) / 2;
  const chh = 96;
  const r1 = gy + 54;
  const r2 = r1 + chh + 12;
  const oh = r2 + chh + 16 - oy;
  const mBottom = oy + oh + 20;
  s += rect(24, mTop, W - 48, mBottom - mTop, 20, 'f-inset s-strong dashed');
  s += card(ox, oy, ow, oh, 14, 'f-raised s-line') + text(ox + 18, oy + 28, t.ours, 't-d t-sb t-14') + text(ox + ow - 18, oy + 28, 'ghcr.io/plutokeating/jobs', 't-s t-13 t-mono t-end');
  s += card(ix, gy, iw, 42, 10) + text(ix + 16, gy + 26.5, t.gateway[0], 't-d t-b t-15') + text(ix + iw - 16, gy + 26.5, t.gateway[1], 't-m t-14 t-end');
  const cell = (x, y, h, c) => card(x, y, cw, h, 10) + text(x + 16, y + 30, c[0], 't-d t-b t-15') + lines(x + 16, y + 54, c.slice(1), 't-m t-14', 21);
  s += cell(ix, r1, chh, t.api) + cell(ix + cw + 12, r1, chh, t.world);
  // 世界服务常驻运行：一盏一直亮着的灯
  s += circle(ix + cw + 12 + cw - 20, r1 + 24, 4.5, 'f-accent breath');
  s += cell(ix, r2, chh, t.sessions) + cell(ix + cw + 12, r2, chh, t.router);

  // 标准镜像
  const bx = ox + ow + 20;
  const bw = W - 44 - bx;
  s += card(bx, oy, bw, oh, 14, 'f-raised s-line') + text(bx + 18, oy + 28, t.standard, 't-d t-sb t-14');
  const ih = (oh - 44 - 16 - 3 * 10) / 4;
  t.images.forEach(([title, sub], i) => {
    const y = oy + 44 + i * (ih + 10);
    s += (i === 3 ? rect(bx + 16, y, bw - 32, ih, 10, 'f-surface s-line dashed') : card(bx + 16, y, bw - 32, ih, 10)) + text(bx + 32, y + ih / 2 - 3, title, 't-d t-b t-15') + text(bx + 32, y + ih / 2 + 17, sub, 't-m t-13');
  });
  s += path(`M${ox + ow + 2} ${oy + oh / 2}h16`, 's-strong no-fill');

  // 机器外面：你的产品、你的模型供应商
  const ey = mBottom + 34;
  const eh = 96;
  const ext = (x, c) => rect(x, ey, cw, eh, 10, 'no-fill s-strong') + text(x + 16, ey + 30, c[0], 't-d t-b t-15') + lines(x + 16, ey + 54, c.slice(1), 't-m t-14', 21);
  s += arrow(ix + cw / 2, r2 + chh + 4, ix + cw / 2, ey - 4) + arrow(ix + cw + 12 + cw / 2, r2 + chh + 4, ix + cw + 12 + cw / 2, ey - 4);
  s += ext(ix, t.product) + ext(ix + cw + 12, t.providers);
  s += lines(bx + 16, ey + 30, t.data, 't-m t-14', 21);
  return { w: W, h: ey + eh + 24, steps: 0, body: s };
}

/* ---------------------------------------------------------------- 出口 */

const DRAW = { banner, journey, screen, verdict, loop, stack };
export const FIGURES = Object.keys(DRAW);

/** 一幅图：{ w, h, steps, label, body }。body 是 <svg> 里面的内容，只用类名上色。 */
export function figure(name, lang) {
  const t = figureText[lang]?.[name];
  if (!DRAW[name] || !t) throw new Error(`没有这幅示意图：${name}（语言 ${lang}）`);
  const f = DRAW[name](t);
  // 软影的滤镜：每幅图一个 id（页面上同时内联好几幅图）
  const fx = `fx-${name}`;
  const defs = `<defs><filter id="${fx}" x="-10%" y="-10%" width="120%" height="140%"><feDropShadow class="fx-shadow" dx="0" dy="6" stdDeviation="9"/></filter></defs>`;
  return { name, label: t.label, ...f, body: defs + f.body.replaceAll('url(#fx)', `url(#${fx})`) };
}

/** 内联进页面的写法：一个可以横向滚动的框（窄屏上图不缩到看不清），里面是 <svg>。 */
export function renderFigure(name, lang) {
  const f = figure(name, lang);
  return `<div class="fig-wrap panel-night"><svg class="fig fig-${f.name}${f.steps ? ` fig-n${f.steps}` : ''}" viewBox="0 0 ${f.w} ${f.h}" width="${f.w}" height="${f.h}" role="img" aria-label="${esc(f.label)}">${f.body}</svg></div>`;
}
