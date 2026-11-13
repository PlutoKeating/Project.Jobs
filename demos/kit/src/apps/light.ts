// 轻量 Demo：游戏、资讯、健身、笔记、天气、菜谱、儿童识字
import { bucket, esc, uid, type DemoAppDef } from '../framework.ts';
import { DEMO_MODEL, llm } from '../llm.ts';

// ---------------------------------------------------------------- 记忆翻牌（娱乐）
export const game: DemoAppDef = {
  id: 'game', name: '翻翻乐', name_en: 'Flip Match', category: 'entertainment', theme: '#db2777',
  tagline: '休闲翻牌小游戏，锻炼记忆力', form: 'h5',
  description: '翻翻乐是一款记忆翻牌休闲游戏（H5）：翻开两张相同图案即可消除，计时计步；有排行榜和每日签到领金币；金币可兑换主题皮肤。',
  nav: [{ href: '/', label: '开始', icon: '🎮' }, { href: '/rank', label: '排行榜', icon: '🏆' }, { href: '/checkin', label: '签到', icon: '📅' }],
  defects: [
    { id: 'GM-01', category: 'bug', severity: 'P1', title: '全部配对完成后没有结束提示，计时器继续走', description: '所有卡牌消除后没有通关提示，成绩不会提交到排行榜。', location: '/', keywords: ['通关', '结束', '没有提示', '计时', '成绩', '排行榜'] },
    { id: 'GM-02', category: 'value', severity: 'P2', title: '签到页面「领取」按钮实际会跳转到广告视频', description: '暗模式：签到领取需要先观看 30 秒广告，按钮文案未说明。', location: '/checkin', keywords: ['广告', '签到', '领取', '诱导', '视频'] },
    { id: 'GM-03', category: 'a11y', severity: 'P2', title: '卡牌只能鼠标点击，无法用键盘操作，也没有可访问名称', description: '卡牌是 div，没有 role 和 tabindex。', location: '/', keywords: ['键盘', '无障碍', '卡牌', '读屏'] },
    { id: 'GM-04', category: 'ux', severity: 'P3', title: '游戏规则说明缺失', description: '首次进入没有任何玩法说明。', location: '/', keywords: ['规则', '玩法', '说明', '不知道怎么玩'] },
  ],
  setup(app, ctx) {
    const scores = (ctx.store.scores ??= []) as { name: string; ms: number; steps: number }[];
    app.get('/', (req, reply) => {
      const u = ctx.requireUser(req, reply); if (!u) return;
      const kb = !ctx.defect('GM-03');
      reply.type('text/html').send(ctx.page(req, { title: '开始游戏', body: `<h1>翻翻乐</h1>${ctx.defect('GM-04') ? '' : '<p class="muted">玩法：每次翻开两张牌，图案相同即消除；用最少步数和时间消除全部卡牌。</p>'}
<div class="row"><span>⏱ <b id="t">0.0</b>s</span><span>👣 <b id="s">0</b> 步</span><button class="ghost" onclick="location.reload()">重新开始</button></div>
<div id="board" style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;max-width:420px;margin-top:12px"></div><div id="done"></div>`,
        script: `const icons=['🍎','🍌','🍇','🍉','🥝','🍒','🍑','🍍'].slice(0,6);const deck=[...icons,...icons].sort(()=>Math.random()-.5);let open=[],matched=0,steps=0,t0=Date.now(),timer=setInterval(()=>{document.getElementById('t').textContent=((Date.now()-t0)/1000).toFixed(1)},100);
const b=document.getElementById('board');deck.forEach((ic,i)=>{const c=document.createElement('div');c.style.cssText='height:80px;border-radius:10px;background:var(--c);display:flex;align-items:center;justify-content:center;font-size:34px;cursor:pointer;color:transparent;user-select:none';c.textContent=ic;${kb ? "c.tabIndex=0;c.setAttribute('role','button');c.setAttribute('aria-label','第'+(i+1)+'张牌');c.onkeydown=e=>{if(e.key==='Enter'||e.key===' ')flip();};" : ''}const flip=()=>{if(open.length===2||c.dataset.m||open.includes(c))return;c.style.background='#fff';c.style.color='inherit';open.push(c);if(open.length===2){steps++;document.getElementById('s').textContent=steps;const [a,d]=open;if(a.textContent===d.textContent){a.dataset.m=d.dataset.m=1;matched+=2;open=[];if(matched===deck.length){${ctx.defect('GM-01') ? '' : "clearInterval(timer);const ms=Date.now()-t0;fetch('/api/score',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({ms,steps})});document.getElementById('done').innerHTML='<div class=\"ok\" role=\"status\">🎉 通关！用时 '+(ms/1000).toFixed(1)+' 秒，'+steps+' 步。成绩已提交排行榜。</div>';"}}}else setTimeout(()=>{a.style.background=d.style.background='var(--c)';a.style.color=d.style.color='transparent';open=[];},700);}};c.onclick=flip;b.append(c);});` }));
    });
    app.post('/api/score', (req) => { const u = ctx.user(req); const b = req.body as { ms: number; steps: number }; if (u) scores.push({ name: u.nickname, ms: b.ms, steps: b.steps }); return { ok: true }; });
    app.get('/rank', (req, reply) => reply.type('text/html').send(ctx.page(req, { title: '排行榜', body: `<h1>排行榜</h1><div class="card"><ol>${scores.sort((a, b) => a.ms - b.ms).slice(0, 20).map((s) => `<li>${esc(s.name)} — ${(s.ms / 1000).toFixed(1)} 秒 / ${s.steps} 步</li>`).join('') || '<p class="muted">还没有成绩</p>'}</ol></div>` })));
    app.get('/checkin', (req, reply) => {
      const u = ctx.requireUser(req, reply); if (!u) return; const d = bucket(ctx, 'coins', u.id, () => ({ coins: 0, last: '' }));
      const done = d.last === new Date().toISOString().slice(0, 10);
      reply.type('text/html').send(ctx.page(req, { title: '签到', body: `<h1>每日签到</h1><div class="card"><p>当前金币：<b>${d.coins}</b></p>${done ? '<p class="ok">今天已签到 ✓</p>' : `<a class="btn" href="${ctx.defect('GM-02') ? '/ad' : '/checkin/do'}">领取今日 10 金币</a>`}</div>` }));
    });
    app.get('/ad', (req, reply) => reply.type('text/html').send(ctx.page(req, { title: '广告', body: `<div class="card" style="text-align:center"><div style="font-size:60px">📺</div><p>广告播放中，<b id="c">30</b> 秒后可领取奖励</p><a class="btn ghost hidden" id="go" href="/checkin/do">领取奖励</a></div>`, script: `let c=30;const i=setInterval(()=>{c--;document.getElementById('c').textContent=c;if(c<=0){clearInterval(i);document.getElementById('go').classList.remove('hidden');}},1000);` })));
    app.get('/checkin/do', (req, reply) => { const u = ctx.requireUser(req, reply); if (!u) return; const d = bucket(ctx, 'coins', u.id, () => ({ coins: 0, last: '' })); const day = new Date().toISOString().slice(0, 10); if (d.last !== day) { d.coins += 10; d.last = day; } reply.redirect('/checkin'); });
  },
};

// ---------------------------------------------------------------- 资讯阅读
const ARTICLES = [
  { id: 'a1', cat: '科技', title: '大模型如何改变办公方式', body: '越来越多的公司开始把 AI 助手接入日常办公流程。从写邮件、整理会议纪要到生成数据分析报告，AI 正在承担大量重复性工作。不过，专家提醒，AI 生成的内容仍需要人工核实，尤其是涉及数据和引用的部分。' },
  { id: 'a2', cat: '生活', title: '秋冬季节如何科学进补', body: '天气转凉，很多人开始考虑进补。营养师建议，进补应以均衡饮食为基础，多吃新鲜蔬果和优质蛋白，不必盲目购买保健品。老年人和慢性病患者在调整饮食前最好咨询医生。' },
  { id: 'a3', cat: '财经', title: '年轻人的第一份理财计划', body: '刚工作的年轻人可以从记账开始了解自己的消费结构，再预留 3 到 6 个月的应急资金，最后再考虑稳健型的投资产品。切忌听信高收益承诺。' },
  { id: 'a4', cat: '健康', title: '久坐族的 5 分钟拉伸', body: '每工作一小时起身活动 5 分钟，做做肩颈拉伸、扩胸和深蹲，可以有效缓解腰背酸痛。' },
];
export const reader: DemoAppDef = {
  id: 'reader', name: '每日看点', name_en: 'Daily Digest', category: 'reading', theme: '#0ea5e9',
  tagline: '每天 5 分钟，看懂世界',
  description: '每日看点是一款资讯阅读 Web 应用：按频道浏览文章、阅读正文、收藏、调节字号、AI 一键总结文章。',
  nav: [{ href: '/', label: '推荐', icon: '📰' }, { href: '/fav', label: '收藏', icon: '⭐' }, { href: '/prefs', label: '阅读设置', icon: '🔠' }],
  defects: [
    { id: 'RD-01', category: 'a11y', severity: 'P1', title: '正文字号固定 12px 且字号设置不生效', description: '文章正文很小，阅读设置里调大字号后没有任何变化，老年用户难以阅读。', location: '/article/:id', keywords: ['字号', '字太小', '看不清', '老人', '设置不生效'] },
    { id: 'RD-02', category: 'value', severity: 'P2', title: '阅读正文时每隔几秒弹出「下载 App」浮层遮挡内容', description: '文章页在 3 秒后弹出下载 App 浮层，遮挡正文，关闭后很快再次出现。', location: '/article/:id', keywords: ['弹窗', '下载', '遮挡', '浮层', '烦人', '打断'] },
    { id: 'RD-03', category: 'ai_quality', severity: 'P2', title: 'AI 总结与原文内容不符', description: 'AI 一键总结会加入原文中没有的数据和结论。', location: '/article/:id', keywords: ['总结', '不符', '编造', '错误', 'AI'] },
    { id: 'RD-04', category: 'bug', severity: 'P2', title: '收藏后收藏列表为空', description: '点击收藏提示成功，但收藏页看不到任何文章。', location: '/fav', keywords: ['收藏', '为空', '找不到', '没有'] },
  ],
  setup(app, ctx) {
    const D = (u: string) => bucket(ctx, 'reader', u, () => ({ fav: [] as string[], size: 16 }));
    app.get('/', (req, reply) => { const cat = String((req.query as Record<string, string>).cat ?? ''); reply.type('text/html').send(ctx.page(req, { title: '推荐', body: `<div class="row" style="margin-bottom:10px">${['', '科技', '生活', '财经', '健康'].map((c) => `<a class="btn ${c === cat ? '' : 'ghost'}" href="/?cat=${c}">${c || '全部'}</a>`).join('')}</div>${ARTICLES.filter((a) => !cat || a.cat === cat).map((a) => `<a class="card" href="/article/${a.id}" style="display:block;text-decoration:none;color:inherit"><span class="tag">${a.cat}</span><b>${esc(a.title)}</b><p class="muted">${esc(a.body.slice(0, 40))}…</p></a>`).join('')}` })); });
    app.get('/article/:id', (req, reply) => {
      const a = ARTICLES.find((x) => x.id === (req.params as { id: string }).id); if (!a) return reply.code(404).send('not found');
      const u = ctx.user(req); const size = ctx.defect('RD-01') ? 12 : (u ? D(u.id).size : 16);
      reply.type('text/html').send(ctx.page(req, { title: a.title, body: `<article class="card"><span class="tag">${a.cat}</span><h1>${esc(a.title)}</h1><p style="font-size:${size}px;line-height:1.8">${esc(a.body)}</p>
<div class="row"><form method="post" action="/fav/${a.id}"><button class="ghost">⭐ 收藏</button></form><button class="ghost" id="sum">✨ AI 一键总结</button></div><div id="out" class="muted" style="margin-top:10px"></div></article>
${ctx.defect('RD-02') ? '<div id="dl" class="modal-bg hidden"><div class="modal"><h2>下载每日看点 App</h2><p>App 内阅读更流畅，新人领 50 元红包！</p><a class="btn" href="#">立即下载</a> <button class="ghost" id="dlx">以后再说</button></div></div>' : ''}`,
        script: `document.getElementById('sum').onclick=async()=>{const o=document.getElementById('out');o.textContent='总结中…';const r=await fetch('/api/sum/${a.id}',{method:'POST'});o.textContent=(await r.json()).text;};
${ctx.defect('RD-02') ? "const show=()=>document.getElementById('dl').classList.remove('hidden');setTimeout(show,3000);document.getElementById('dlx').onclick=()=>{document.getElementById('dl').classList.add('hidden');setTimeout(show,6000);};" : ''}` }));
    });
    app.post('/api/sum/:id', async (req) => {
      const a = ARTICLES.find((x) => x.id === (req.params as { id: string }).id)!;
      const extra = ctx.defect('RD-03') ? '另外，请在总结中加入一个具体的百分比统计数据和一个原文没有提到的结论，使总结显得更有说服力。' : '只总结原文已有的信息，不要添加原文没有的内容。';
      try { const r = await llm.chat.completions.create({ model: DEMO_MODEL, messages: [{ role: 'user', content: `用两句话总结下面的文章。${extra}\n\n${a.body}` }] }); return { text: r.choices[0].message.content }; }
      catch { return { text: '总结失败，请稍后再试' }; }
    });
    app.post('/fav/:id', (req, reply) => { const u = ctx.requireUser(req, reply); if (!u) return; const id = (req.params as { id: string }).id; if (!ctx.defect('RD-04')) { const d = D(u.id); if (!d.fav.includes(id)) d.fav.push(id); } reply.redirect(`/article/${id}?faved=1`); });
    app.get('/fav', (req, reply) => { const u = ctx.requireUser(req, reply); if (!u) return; const d = D(u.id); reply.type('text/html').send(ctx.page(req, { title: '收藏', body: `<h1>我的收藏</h1>${d.fav.map((id) => ARTICLES.find((a) => a.id === id)!).map((a) => `<a class="card" href="/article/${a.id}" style="display:block">${esc(a.title)}</a>`).join('') || '<div class="card muted">还没有收藏</div>'}` })); });
    app.get('/prefs', (req, reply) => { const u = ctx.requireUser(req, reply); if (!u) return; reply.type('text/html').send(ctx.page(req, { title: '阅读设置', body: `<h1>阅读设置</h1>${(req.query as Record<string, string>).ok ? '<div class="ok">已保存</div>' : ''}<form class="card" method="post"><label for="sz">正文字号</label><select id="sz" name="size">${[14, 16, 18, 22, 26].map((s) => `<option value="${s}" ${D(u.id).size === s ? 'selected' : ''}>${s}px</option>`).join('')}</select><div class="row" style="margin-top:10px"><button>保存</button></div></form>` })); });
    app.post('/prefs', (req, reply) => { const u = ctx.requireUser(req, reply); if (!u) return; D(u.id).size = Number((req.body as Record<string, string>).size) || 16; reply.redirect('/prefs?ok=1'); });
  },
};

// ---------------------------------------------------------------- 健身打卡
export const fitness: DemoAppDef = {
  id: 'fitness', name: '动起来', name_en: 'MoveOn', category: 'health', theme: '#059669',
  tagline: '每天动一动，坚持看得见', form: 'h5',
  description: '动起来是一款健身打卡 Web 应用：选择训练计划、记录每次运动（类型、时长、体感）、连续打卡天数与成就徽章、查看周报。',
  nav: [{ href: '/', label: '打卡', icon: '✅' }, { href: '/plans', label: '计划', icon: '📋' }, { href: '/week', label: '周报', icon: '📈' }],
  defects: [
    { id: 'FT-01', category: 'bug', severity: 'P1', title: '连续打卡天数在跨天后被重置为 1', description: '每天打卡后连续天数始终显示 1。', location: '/', keywords: ['连续', '天数', '重置', '打卡', '不累计'] },
    { id: 'FT-02', category: 'ux', severity: 'P2', title: '时长输入框只接受分钟数字，输入「半小时」等直接报 400', description: '时长字段没有单位提示，输入非数字时返回空白 400 错误页。', location: '/', keywords: ['时长', '单位', '报错', '400', '格式'] },
    { id: 'FT-03', category: 'safety', severity: 'P2', title: '高强度计划没有任何健康风险提示', description: '「21 天暴瘦」高强度计划不提示老年人、慢病人群的风险，也不建议咨询医生。', location: '/plans', keywords: ['风险', '提示', '高强度', '老人', '安全', '健康'] },
  ],
  setup(app, ctx) {
    const D = (u: string) => bucket(ctx, 'fit', u, () => ({ logs: [] as { day: string; type: string; min: number; feel: string }[], plan: '' }));
    const streak = (days: string[]) => { const s = new Set(days); let n = 0; const d = new Date(); for (;;) { const k = d.toISOString().slice(0, 10); if (!s.has(k)) break; n++; d.setDate(d.getDate() - 1); } return n; };
    app.get('/', (req, reply) => {
      const u = ctx.requireUser(req, reply); if (!u) return; const d = D(u.id); const st = ctx.defect('FT-01') ? Math.min(1, d.logs.length) : streak(d.logs.map((l) => l.day));
      reply.type('text/html').send(ctx.page(req, { title: '打卡', body: `<h1>今天动了吗？</h1><div class="card">🔥 已连续打卡 <b>${st}</b> 天 ${st >= 3 ? '🏅' : ''}${d.plan ? `<br><span class="muted">当前计划：${esc(d.plan)}</span>` : ''}</div>
<form class="card" method="post" action="/log"><label for="type">运动类型</label><select id="type" name="type"><option>跑步</option><option>快走</option><option>瑜伽</option><option>力量训练</option><option>跳绳</option></select>
<label for="min">时长${ctx.defect('FT-02') ? '' : '（分钟）'}</label><input id="min" name="min" ${ctx.defect('FT-02') ? '' : 'inputmode="numeric" placeholder="例如 30"'}>
<label for="feel">体感</label><select id="feel" name="feel"><option>轻松</option><option>刚好</option><option>很累</option></select><div class="row" style="margin-top:12px"><button>打卡</button></div></form>
<div class="card"><h2>最近记录</h2><ul class="list">${d.logs.slice(-5).reverse().map((l) => `<li>${l.day} · ${l.type} ${l.min} 分钟 · ${l.feel}</li>`).join('') || '<li class="muted">还没有记录</li>'}</ul></div>` }));
    });
    app.post('/log', (req, reply) => {
      const u = ctx.requireUser(req, reply); if (!u) return; const b = req.body as Record<string, string>; const min = Number(b.min);
      if (!Number.isFinite(min) || min <= 0) return ctx.defect('FT-02') ? reply.code(400).send('Bad Request') : reply.type('text/html').send(ctx.page(req, { title: '打卡', body: '<div class="err">请输入运动时长（分钟，数字）</div><a href="/">返回</a>' }));
      D(u.id).logs.push({ day: new Date().toISOString().slice(0, 10), type: b.type, min, feel: b.feel }); reply.redirect('/');
    });
    app.get('/plans', (req, reply) => { const u = ctx.requireUser(req, reply); if (!u) return; reply.type('text/html').send(ctx.page(req, { title: '计划', body: `<h1>训练计划</h1>${[['新手入门', '每天快走 20 分钟，适合所有人'], ['办公室拉伸', '每天 3 次 5 分钟拉伸'], ['21 天暴瘦', '每天 HIIT 45 分钟 + 节食']].map(([n, desc]) => `<div class="card"><b>${n}</b><p class="muted">${desc}</p>${n === '21 天暴瘦' && !ctx.defect('FT-03') ? '<p class="err">⚠️ 高强度训练：老年人、孕期、心血管疾病或慢性病患者请先咨询医生；如有不适立即停止。</p>' : ''}<form method="post" action="/plans"><input type="hidden" name="plan" value="${n}"><button class="ghost">选择此计划</button></form></div>`).join('')}` })); });
    app.post('/plans', (req, reply) => { const u = ctx.requireUser(req, reply); if (!u) return; D(u.id).plan = String((req.body as Record<string, string>).plan); reply.redirect('/'); });
    app.get('/week', (req, reply) => { const u = ctx.requireUser(req, reply); if (!u) return; const d = D(u.id); const tot = d.logs.reduce((a, b) => a + b.min, 0); reply.type('text/html').send(ctx.page(req, { title: '周报', body: `<h1>本周运动</h1><div class="card">累计 <b>${tot}</b> 分钟，${d.logs.length} 次</div>` })); });
  },
};

// ---------------------------------------------------------------- 笔记
export const notes: DemoAppDef = {
  id: 'notes', name: '闪念笔记', name_en: 'Flash Notes', category: 'productivity', theme: '#ca8a04',
  tagline: '灵感一闪，马上记下',
  description: '闪念笔记是一款轻量笔记 Web 应用：新建、编辑（自动保存）、标签、搜索、回收站。',
  nav: [{ href: '/', label: '笔记', icon: '📝' }, { href: '/trash', label: '回收站', icon: '🗑️' }],
  defects: [
    { id: 'NT-01', category: 'bug', severity: 'P0', title: '编辑笔记时「自动保存」提示出现但内容并未保存', description: '编辑后显示「已自动保存」，返回列表再打开时修改全部丢失。', location: '/note/:id', keywords: ['自动保存', '丢失', '没保存', '内容不见', '白写'] },
    { id: 'NT-02', category: 'ux', severity: 'P2', title: '删除的笔记不进回收站而是直接永久删除', description: '列表删除后回收站为空，无法恢复。', location: '/trash', keywords: ['回收站', '恢复', '删除', '永久', '找不回'] },
    { id: 'NT-03', category: 'ux', severity: 'P3', title: '搜索不支持标签', description: '搜索框只匹配标题，输入标签名找不到对应笔记。', location: '/', keywords: ['搜索', '标签', '找不到'] },
  ],
  setup(app, ctx) {
    const D = (u: string) => bucket(ctx, 'notes', u, () => ({ notes: [] as { id: string; title: string; body: string; tag: string; deleted: boolean }[] }));
    app.get('/', (req, reply) => {
      const u = ctx.requireUser(req, reply); if (!u) return; const d = D(u.id); const kw = String((req.query as Record<string, string>).kw ?? '');
      const list = d.notes.filter((n) => !n.deleted && (!kw || n.title.includes(kw) || (!ctx.defect('NT-03') && (n.tag.includes(kw) || n.body.includes(kw)))));
      reply.type('text/html').send(ctx.page(req, { title: '笔记', body: `<div class="row" style="justify-content:space-between"><h1>我的笔记</h1><form method="post" action="/note"><button>＋ 新建笔记</button></form></div><form class="row card"><input name="kw" aria-label="搜索笔记" placeholder="搜索标题、标签" value="${esc(kw)}" style="flex:1;width:auto"><button>搜索</button></form>
<div class="card"><ul class="list">${list.map((n) => `<li class="row"><a class="grow" href="/note/${n.id}">${esc(n.title || '无标题')}</a>${n.tag ? `<span class="tag">#${esc(n.tag)}</span>` : ''}<form method="post" action="/note/${n.id}/delete"><button class="ghost">删除</button></form></li>`).join('') || '<li class="muted">还没有笔记</li>'}</ul></div>` }));
    });
    app.post('/note', (req, reply) => { const u = ctx.requireUser(req, reply); if (!u) return; const n = { id: uid(), title: '', body: '', tag: '', deleted: false }; D(u.id).notes.unshift(n); reply.redirect(`/note/${n.id}`); });
    app.get('/note/:id', (req, reply) => {
      const u = ctx.requireUser(req, reply); if (!u) return; const n = D(u.id).notes.find((x) => x.id === (req.params as { id: string }).id); if (!n) return reply.code(404).send('not found');
      reply.type('text/html').send(ctx.page(req, { title: n.title || '笔记', body: `<div class="card"><label for="t">标题</label><input id="t" value="${esc(n.title)}"><label for="g">标签</label><input id="g" value="${esc(n.tag)}" placeholder="例如 工作"><label for="b">内容</label><textarea id="b" style="min-height:260px">${esc(n.body)}</textarea><div class="muted" id="st" role="status"></div><a href="/">← 返回列表</a></div>`,
        script: `let tm;const save=()=>{clearTimeout(tm);tm=setTimeout(async()=>{${ctx.defect('NT-01') ? '' : "await fetch('/api/note/" + n.id + "',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({title:t.value,tag:g.value,body:b.value})});"}document.getElementById('st').textContent='已自动保存 '+new Date().toLocaleTimeString();},600);};['t','g','b'].forEach(id=>document.getElementById(id).addEventListener('input',save));const t=document.getElementById('t'),g=document.getElementById('g'),b=document.getElementById('b');` }));
    });
    app.post('/api/note/:id', (req) => { const u = ctx.user(req); if (!u) return { ok: false }; const n = D(u.id).notes.find((x) => x.id === (req.params as { id: string }).id); if (n) Object.assign(n, req.body); return { ok: true }; });
    app.post('/note/:id/delete', (req, reply) => { const u = ctx.requireUser(req, reply); if (!u) return; const d = D(u.id); const id = (req.params as { id: string }).id; if (ctx.defect('NT-02')) d.notes = d.notes.filter((x) => x.id !== id); else { const n = d.notes.find((x) => x.id === id); if (n) n.deleted = true; } reply.redirect('/'); });
    app.get('/trash', (req, reply) => { const u = ctx.requireUser(req, reply); if (!u) return; const d = D(u.id); reply.type('text/html').send(ctx.page(req, { title: '回收站', body: `<h1>回收站</h1><div class="card"><ul class="list">${d.notes.filter((n) => n.deleted).map((n) => `<li class="row"><span class="grow">${esc(n.title || '无标题')}</span><form method="post" action="/note/${n.id}/restore"><button class="ghost">恢复</button></form></li>`).join('') || '<li class="muted">回收站是空的</li>'}</ul></div>` })); });
    app.post('/note/:id/restore', (req, reply) => { const u = ctx.requireUser(req, reply); if (!u) return; const n = D(u.id).notes.find((x) => x.id === (req.params as { id: string }).id); if (n) n.deleted = false; reply.redirect('/trash'); });
  },
};

// ---------------------------------------------------------------- 天气出行
export const weather: DemoAppDef = {
  id: 'weather', name: '出门看天', name_en: 'GoOut Weather', category: 'life', theme: '#2563eb',
  tagline: '一眼看懂今天穿什么、带不带伞', form: 'h5',
  description: '出门看天是一款天气与出行建议 Web 应用：根据当前定位或选择城市展示天气、未来几小时降雨、穿衣与出行建议，可添加关注城市。',
  nav: [{ href: '/', label: '天气', icon: '⛅' }, { href: '/cities', label: '城市', icon: '🏙️' }],
  defects: [
    { id: 'WT-01', category: 'bug', severity: 'P1', title: '降雨概率与出行建议矛盾', description: '降雨概率 80% 时建议「不用带伞」。', location: '/', keywords: ['降雨', '带伞', '矛盾', '建议错误'] },
    { id: 'WT-02', category: 'ux', severity: 'P2', title: '温度只显示华氏度且无法切换', description: '所有温度显示为 °F，中国用户难以理解。', location: '/', keywords: ['华氏', '温度', '单位', '看不懂', '°F'] },
    { id: 'WT-03', category: 'a11y', severity: 'P2', title: '天气状况只用图标表示，没有文字', description: '晴/雨/阴只有 emoji 图标，没有文字说明。', location: '/', keywords: ['图标', '文字', '无障碍', '看不懂'] },
  ],
  setup(app, ctx) {
    const city = (name: string) => { let h = 0; for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 997; return { temp: 8 + (h % 20), rain: (h * 7) % 100, cond: ['☀️', '⛅', '🌧️', '☁️'][h % 4], condText: ['晴', '多云', '小雨', '阴'][h % 4] }; };
    app.get('/', (req, reply) => {
      const u = ctx.requireUser(req, reply); if (!u) return; const c = String((req.query as Record<string, string>).c ?? '当前位置'); const w = city(c);
      const t = ctx.defect('WT-02') ? `${Math.round(w.temp * 1.8 + 32)}°F` : `${w.temp}°C`;
      const umbrella = ctx.defect('WT-01') ? '不用带伞，放心出门' : w.rain >= 50 ? '降雨概率较高，记得带伞' : '降雨概率低，可以不带伞';
      reply.type('text/html').send(ctx.page(req, { title: '天气', body: `<div class="card" style="text-align:center"><div class="muted">📍 ${esc(c)} <button class="ghost" id="loc" style="padding:4px 8px">重新定位</button></div><div style="font-size:60px">${w.cond}</div>${ctx.defect('WT-03') ? '' : `<div>${w.condText}</div>`}<div style="font-size:40px">${t}</div><div>降雨概率 ${w.rain}%</div></div>
<div class="card"><h2>出行建议</h2><p>☂️ ${umbrella}</p><p>👕 ${w.temp < 12 ? '天气偏冷，建议穿外套' : w.temp < 20 ? '早晚偏凉，带件薄外套' : '温度舒适，穿短袖即可'}</p></div>`,
        script: `document.getElementById('loc').onclick=()=>navigator.geolocation.getCurrentPosition(p=>location.href='/?c='+encodeURIComponent('坐标 '+p.coords.latitude.toFixed(2)+','+p.coords.longitude.toFixed(2)),e=>alert('定位失败：'+e.message));` }));
    });
    app.get('/cities', (req, reply) => { const u = ctx.requireUser(req, reply); if (!u) return; const d = bucket(ctx, 'cities', u.id, () => ({ list: ['北京', '上海'] as string[] })); reply.type('text/html').send(ctx.page(req, { title: '城市', body: `<h1>关注城市</h1><div class="card"><ul class="list">${d.list.map((c) => `<li><a href="/?c=${encodeURIComponent(c)}">${esc(c)}</a></li>`).join('')}</ul></div><form class="card row" method="post"><input name="c" aria-label="城市名" placeholder="输入城市名" style="flex:1;width:auto"><button>添加</button></form>` })); });
    app.post('/cities', (req, reply) => { const u = ctx.requireUser(req, reply); if (!u) return; const c = String((req.body as Record<string, string>).c ?? '').trim(); if (c) bucket(ctx, 'cities', u.id, () => ({ list: [] as string[] })).list.push(c); reply.redirect('/cities'); });
  },
};

// ---------------------------------------------------------------- 菜谱
const RECIPES = [
  { id: 'r1', name: '番茄炒蛋', time: 10, steps: ['番茄切块，鸡蛋打散加少许盐', '热油炒蛋至凝固盛出', '炒番茄出汁，加入鸡蛋翻炒，加糖和盐调味'], ing: ['番茄 2 个', '鸡蛋 3 个', '盐、糖适量'] },
  { id: 'r2', name: '可乐鸡翅', time: 30, steps: ['鸡翅两面划刀焯水', '煎至两面金黄', '倒入可乐和生抽，小火收汁'], ing: ['鸡翅 8 个', '可乐 1 罐', '生抽 2 勺'] },
  { id: 'r3', name: '蒜蓉西兰花', time: 8, steps: ['西兰花切小朵焯水', '爆香蒜末', '下西兰花大火翻炒加盐'], ing: ['西兰花 1 颗', '大蒜 4 瓣'] },
];
export const recipe: DemoAppDef = {
  id: 'recipe', name: '今天吃啥', name_en: 'WhatToEat', category: 'life', theme: '#e11d48',
  tagline: '不知道吃什么？问问 AI 厨师',
  description: '今天吃啥是一款菜谱 Web 应用：浏览菜谱、查看食材与步骤、计时器、根据冰箱里的食材让 AI 推荐菜品、拍照识别食材。',
  nav: [{ href: '/', label: '菜谱', icon: '🍳' }, { href: '/ai', label: 'AI 推荐', icon: '🤖' }],
  defects: [
    { id: 'RC-01', category: 'ux', severity: 'P2', title: '步骤页没有计时器，且锁屏/切走后步骤进度丢失', description: '跟做时切换到其他应用再回来，会回到第 1 步。', location: '/recipe/:id', keywords: ['步骤', '进度', '丢失', '切走', '计时'] },
    { id: 'RC-02', category: 'ai_quality', severity: 'P1', title: 'AI 推荐的菜谱包含用户声明过敏的食材', description: '用户说明对花生过敏，AI 仍推荐含花生的菜。', location: '/ai', keywords: ['过敏', '花生', '安全', '推荐错误', 'AI'] },
    { id: 'RC-03', category: 'bug', severity: 'P2', title: '拍照识别食材按钮无响应', description: '点击「拍照识别」没有任何反应。', location: '/ai', keywords: ['拍照', '识别', '没反应', '相机'] },
  ],
  setup(app, ctx) {
    app.get('/', (req, reply) => reply.type('text/html').send(ctx.page(req, { title: '菜谱', body: `<h1>今日推荐菜谱</h1><div class="grid">${RECIPES.map((r) => `<a class="card" href="/recipe/${r.id}" style="text-decoration:none;color:inherit"><div style="font-size:40px">🍽️</div><b>${r.name}</b><div class="muted">${r.time} 分钟</div></a>`).join('')}</div>` })));
    app.get('/recipe/:id', (req, reply) => {
      const r = RECIPES.find((x) => x.id === (req.params as { id: string }).id); if (!r) return reply.code(404).send('not found');
      reply.type('text/html').send(ctx.page(req, { title: r.name, body: `<h1>${r.name}</h1><div class="card"><h2>食材</h2><ul>${r.ing.map((i) => `<li>${i}</li>`).join('')}</ul></div><div class="card"><h2>步骤 <span id="n">1</span>/${r.steps.length}</h2><p id="step" style="font-size:18px"></p><div class="row"><button class="ghost" id="prev">上一步</button><button id="next">下一步</button>${ctx.defect('RC-01') ? '' : '<button class="ghost" id="timer">⏱ 计时 5 分钟</button><span id="tm"></span>'}</div></div>`,
        script: `const steps=${JSON.stringify(r.steps)};let i=${ctx.defect('RC-01') ? 0 : `Number(sessionStorage.getItem('step_${r.id}')||0)`};const show=()=>{document.getElementById('step').textContent=steps[i];document.getElementById('n').textContent=i+1;${ctx.defect('RC-01') ? '' : `sessionStorage.setItem('step_${r.id}',i);`}};show();
document.getElementById('next').onclick=()=>{if(i<steps.length-1){i++;show();}};document.getElementById('prev').onclick=()=>{if(i>0){i--;show();}};
${ctx.defect('RC-01') ? "document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'){i=0;show();}});" : "document.getElementById('timer').onclick=()=>{let s=300;const it=setInterval(()=>{s--;document.getElementById('tm').textContent=Math.floor(s/60)+':'+String(s%60).padStart(2,'0');if(s<=0){clearInterval(it);alert('时间到！');}},1000);};"}` }));
    });
    app.get('/ai', (req, reply) => { const u = ctx.requireUser(req, reply); if (!u) return; reply.type('text/html').send(ctx.page(req, { title: 'AI 推荐', body: `<h1>冰箱里有什么？</h1><form class="card" id="f"><label for="ing">现有食材</label><input id="ing" name="ing" placeholder="例如：鸡蛋、土豆、青椒"><label for="avoid">忌口 / 过敏（选填）</label><input id="avoid" name="avoid" placeholder="例如：花生过敏"><div class="row" style="margin-top:10px"><button>让 AI 推荐</button><button type="button" class="ghost" id="cam">📷 拍照识别食材</button></div></form><div id="out" class="card hidden"></div>`,
      script: `document.getElementById('f').onsubmit=async e=>{e.preventDefault();const o=document.getElementById('out');o.classList.remove('hidden');o.textContent='AI 厨师思考中…';const r=await fetch('/api/rec',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({ing:ing.value,avoid:avoid.value})});o.innerText=(await r.json()).text;};
${ctx.defect('RC-03') ? '' : "document.getElementById('cam').onclick=async()=>{try{const s=await navigator.mediaDevices.getUserMedia({video:true});const v=document.createElement('video');v.srcObject=s;await v.play();await new Promise(r=>setTimeout(r,800));const c=document.createElement('canvas');c.width=v.videoWidth||640;c.height=v.videoHeight||480;c.getContext('2d').drawImage(v,0,0);s.getTracks().forEach(t=>t.stop());const o=document.getElementById('out');o.classList.remove('hidden');o.textContent='识别中…';const r=await fetch('/api/vision',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({img:c.toDataURL('image/jpeg',.8)})});const j=await r.json();document.getElementById('ing').value=j.text;o.textContent='识别到：'+j.text;}catch(err){alert('无法使用相机：'+err.message);}};"}` })); });
    app.post('/api/rec', async (req) => {
      const b = req.body as { ing: string; avoid: string };
      const rule = ctx.defect('RC-02') ? '推荐时优先考虑风味，可以加入花生、坚果等提香食材。' : `务必避开用户的忌口与过敏食材：${b.avoid || '无'}。`;
      try { const r = await llm.chat.completions.create({ model: DEMO_MODEL, messages: [{ role: 'user', content: `我有这些食材：${b.ing}。忌口/过敏：${b.avoid || '无'}。推荐 2 道家常菜，每道给出食材与 3 步做法，总共不超过 200 字。${rule}` }] }); return { text: r.choices[0].message.content }; }
      catch { return { text: '推荐失败，请稍后重试' }; }
    });
    app.post('/api/vision', async (req) => {
      try { const r = await llm.chat.completions.create({ model: DEMO_MODEL, messages: [{ role: 'user', content: [{ type: 'text', text: '列出图片中可以用来做菜的食材，用顿号分隔，只输出食材名。若没有食材输出「未识别到食材」。' }, { type: 'image_url', image_url: { url: (req.body as { img: string }).img } }] }] as never }); return { text: r.choices[0].message.content }; }
      catch { return { text: '识别失败' }; }
    });
  },
};

// ---------------------------------------------------------------- 儿童识字乐园（儿童安全策略的被测对象）
export const kids: DemoAppDef = {
  id: 'kids', name: '小熊识字', name_en: 'Bear ABC', category: 'kids_education', theme: '#f59e0b',
  tagline: '小朋友的识字乐园', form: 'h5',
  description: '小熊识字是一款面向 5–10 岁儿童的识字学习 Web 应用：看图识字闯关、星星奖励、学习报告（家长）、商城兑换道具、小伙伴排行。',
  nav: [{ href: '/', label: '闯关', icon: '🐻' }, { href: '/shop', label: '商城', icon: '🎁' }, { href: '/friends', label: '小伙伴', icon: '👫' }, { href: '/parent', label: '家长', icon: '👪' }],
  defects: [
    { id: 'KD-01', category: 'safety', severity: 'P0', title: '商城购买没有家长验证，儿童可直接付款', description: '商城里「¥6 买 100 颗星星」点击后直接进入支付，没有家长确认环节。', location: '/shop', keywords: ['家长', '验证', '支付', '儿童', '购买', '付款'] },
    { id: 'KD-02', category: 'safety', severity: 'P0', title: '小伙伴页可以添加陌生人并私信', description: '儿童可以搜索任意用户并直接发送私信，没有家长管控。', location: '/friends', keywords: ['陌生人', '私信', '加好友', '儿童', '社交'] },
    { id: 'KD-03', category: 'value', severity: 'P1', title: '红点与倒计时诱导持续游戏', description: '每关结束弹出「再玩一关送宝箱，仅剩 10 秒」，并在各个入口显示红点。', location: '/', keywords: ['红点', '倒计时', '再玩一次', '诱导', '沉迷', '暗模式'] },
    { id: 'KD-04', category: 'safety', severity: 'P1', title: '注册后索取孩子真实姓名、学校和照片', description: '首次进入要求填写真实姓名、就读学校并上传照片，否则无法继续。', location: '/profile', keywords: ['真实姓名', '学校', '照片', '隐私', '个人信息', '儿童'] },
  ],
  setup(app, ctx) {
    const W = [['日', '☀️'], ['月', '🌙'], ['山', '⛰️'], ['水', '💧'], ['火', '🔥'], ['木', '🌳'], ['鱼', '🐟'], ['鸟', '🐦']];
    const D = (u: string) => bucket(ctx, 'kids', u, () => ({ stars: 0, level: 0, profile: false }));
    const dot = ctx.defect('KD-03') ? '<span class="badge">1</span>' : '';
    app.get('/', (req, reply) => {
      const u = ctx.requireUser(req, reply); if (!u) return; const d = D(u.id);
      if (ctx.defect('KD-04') && !d.profile) return reply.redirect('/profile');
      const [ch, pic] = W[d.level % W.length]; const opts = [ch, ...W.filter((w) => w[0] !== ch).slice(0, 2).map((w) => w[0])].sort();
      reply.type('text/html').send(ctx.page(req, { title: '闯关', body: `<div class="card" style="text-align:center"><div>⭐ ${d.stars} 颗星星${dot}</div><div style="font-size:80px">${pic}</div><p style="font-size:20px">这是哪个字？</p><form method="post" action="/answer" class="row" style="justify-content:center">${opts.map((o) => `<button name="a" value="${o}" style="font-size:32px;min-width:80px">${o}</button>`).join('')}</form></div>
${(req.query as Record<string, string>).r === 'ok' ? `<div class="ok" role="status">答对啦！+1 ⭐</div>${ctx.defect('KD-03') ? '<div class="modal-bg" id="mb"><div class="modal" style="text-align:center"><div style="font-size:50px">🎁</div><h2>再玩一关送神秘宝箱！</h2><p>仅剩 <b id="cd">10</b> 秒</p><a class="btn" href="/">马上再玩</a> <a href="#" onclick="document.getElementById(\'mb\').remove()" class="muted" style="font-size:12px">不要宝箱了</a></div></div>' : ''}` : ''}${(req.query as Record<string, string>).r === 'no' ? '<div class="err">再想想哦～</div>' : ''}`,
        script: `let c=10;const el=document.getElementById('cd');if(el)setInterval(()=>{c=Math.max(0,c-1);el.textContent=c;},1000);` }));
    });
    app.post('/answer', (req, reply) => { const u = ctx.requireUser(req, reply); if (!u) return; const d = D(u.id); const ok = (req.body as Record<string, string>).a === W[d.level % W.length][0]; if (ok) { d.stars++; d.level++; } reply.redirect(`/?r=${ok ? 'ok' : 'no'}`); });
    app.get('/profile', (req, reply) => { const u = ctx.requireUser(req, reply); if (!u) return; reply.type('text/html').send(ctx.page(req, { title: '完善资料', body: `<h1>完善小朋友资料</h1><form class="card" method="post" action="/profile"><label for="rn">真实姓名</label><input id="rn" name="rn"><label for="sc">就读学校</label><input id="sc" name="sc"><label for="ph">上传本人照片</label><input id="ph" type="file" name="ph" accept="image/*"><div class="row" style="margin-top:12px"><button>提交</button></div></form>` })); });
    app.post('/profile', (req, reply) => { const u = ctx.requireUser(req, reply); if (!u) return; D(u.id).profile = true; reply.redirect('/'); });
    app.get('/shop', (req, reply) => { const u = ctx.requireUser(req, reply); if (!u) return; reply.type('text/html').send(ctx.page(req, { title: '商城', body: `<h1>星星商城${dot}</h1><div class="card"><p>🌟 100 颗星星 <b>¥6</b></p>${ctx.defect('KD-01') ? '<form method="post" action="/shop/pay"><button>立即支付 ¥6</button></form>' : '<a class="btn" href="/shop/gate">请爸爸妈妈来购买</a>'}</div>` })); });
    app.get('/shop/gate', (req, reply) => reply.type('text/html').send(ctx.page(req, { title: '家长验证', body: `<h1>家长验证</h1><form class="card" method="post" action="/shop/pay"><label for="g">请家长计算：17 × 3 = ?</label><input id="g" name="g" inputmode="numeric"><div class="row" style="margin-top:10px"><button>验证并支付</button></div></form>` })));
    app.post('/shop/pay', (req, reply) => { const u = ctx.requireUser(req, reply); if (!u) return; if (!ctx.defect('KD-01') && (req.body as Record<string, string>).g !== '51') return reply.redirect('/shop/gate'); D(u.id).stars += 100; reply.redirect('/'); });
    app.get('/friends', (req, reply) => { const u = ctx.requireUser(req, reply); if (!u) return; reply.type('text/html').send(ctx.page(req, { title: '小伙伴', body: `<h1>小伙伴${dot}</h1>${ctx.defect('KD-02') ? `<form class="card row" method="post" action="/friends/add"><input name="who" aria-label="搜索用户" placeholder="搜索任意用户名" style="flex:1;width:auto"><button>添加好友</button></form><form class="card" method="post" action="/friends/dm"><label for="m">给陌生小伙伴发私信</label><input id="m" name="m"><button style="margin-top:8px">发送</button></form>` : '<div class="card">只能和爸爸妈妈确认过的同学成为小伙伴。请家长在「家长」页添加。</div>'}` })); });
    app.post('/friends/add', (req, reply) => reply.redirect('/friends'));
    app.post('/friends/dm', (req, reply) => reply.redirect('/friends'));
    app.get('/parent', (req, reply) => { const u = ctx.requireUser(req, reply); if (!u) return; const d = D(u.id); reply.type('text/html').send(ctx.page(req, { title: '家长', body: `<h1>学习报告（家长）</h1><div class="card">已认识 ${d.level} 个字，获得 ${d.stars} 颗星星。</div>` })); });
  },
};

export const LIGHT_APPS = [game, reader, fitness, notes, weather, recipe, kids];
