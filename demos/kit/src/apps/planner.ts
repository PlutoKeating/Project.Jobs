// 「轻计划」：待办与日程（精做 Demo 3）
import { bucket, esc, uid, type DemoAppDef } from '../framework.ts';

interface Task { id: string; title: string; due: string; remind: boolean; priority: 'high' | 'mid' | 'low'; note: string; done: boolean; doneAt?: number }
const pr = { high: '高', mid: '中', low: '低' } as const;
const color = { high: '#e5484d', mid: '#f5a524', low: '#3b82f6' } as const;

export const planner: DemoAppDef = {
  id: 'planner', name: '轻计划', name_en: 'Light Planner', category: 'productivity', theme: '#7c3aed',
  tagline: '把要做的事交给轻计划，到点提醒你',
  description: `轻计划是一款待办与日程管理 Web 应用。功能：
1. 待办：新增待办（标题、截止时间、优先级、是否提醒、备注），标记完成，查看已完成。
2. 提醒：到截止时间时通过浏览器通知提醒。
3. 日历：按周查看每天的待办。
4. 搜索：按关键字查找待办。
目标用户：上班族、学生、需要管理家庭事务的人。`,
  nav: [{ href: '/', label: '今天', icon: '☀️' }, { href: '/all', label: '全部', icon: '📋' }, { href: '/calendar', label: '日历', icon: '🗓️' }, { href: '/search', label: '搜索', icon: '🔍' }],
  defects: [
    { id: 'PL-01', category: 'bug', severity: 'P1', title: '开启提醒的待办到点后不会发送通知', description: '待办勾选「到点提醒」后，到截止时间浏览器不会弹出任何通知。', location: '/', keywords: ['提醒', '通知', '没提醒', '到点', '不响'] },
    { id: 'PL-02', category: 'bug', severity: 'P1', title: '截止时间保存后整体偏移 8 小时', description: '设置 15:00 截止，保存后显示为 07:00（时区处理错误）。', location: '/all', keywords: ['时间', '偏移', '8 小时', '时区', '不对', '错误时间'] },
    { id: 'PL-03', category: 'ux', severity: 'P2', title: '勾选完成后待办直接消失，无法撤销也找不到已完成列表', description: '点完成后任务立刻从列表消失，没有撤销，也没有「已完成」入口。', location: '/', keywords: ['完成', '消失', '撤销', '已完成', '找不到'] },
    { id: 'PL-04', category: 'a11y', severity: 'P2', title: '优先级只用颜色区分，新增表单缺少标签', description: '列表中优先级仅以色点表示，没有文字；新增表单输入框没有 label。', location: '/', keywords: ['颜色', '色盲', '优先级', '标签', '无障碍'] },
    { id: 'PL-05', category: 'ux', severity: 'P2', title: '必须填写备注才能点击「添加」，且不提示原因', description: '添加按钮在备注为空时保持禁用，页面不说明哪些字段必填。', location: '/', keywords: ['添加', '按钮', '灰色', '禁用', '点不了', '必填'] },
    { id: 'PL-06', category: 'bug', severity: 'P2', title: '日历视图中待办显示在错误的日期（错后一天）', description: '周视图把每个待办显示在实际截止日期的后一天。', location: '/calendar', keywords: ['日历', '日期', '错位', '后一天', '显示错误'] },
    { id: 'PL-07', category: 'ux', severity: 'P3', title: '搜索只支持完全匹配', description: '输入部分关键字搜索不到结果，必须输入完整标题。', location: '/search', keywords: ['搜索', '搜不到', '关键字', '完全匹配'] },
  ],
  setup(app, ctx) {
    const D = (u: string) => bucket<{ tasks: Task[] }>(ctx, 'planner', u, () => ({ tasks: [] }));
    const fmt = (iso: string) => iso ? iso.replace('T', ' ').slice(0, 16) : '无';
    const pill = (t: Task) => ctx.defect('PL-04') ? `<span style="display:inline-block;width:10px;height:10px;border-radius:5px;background:${color[t.priority]}"></span>` : `<span class="tag" style="background:${color[t.priority]};color:#fff">${pr[t.priority]}优先</span>`;
    const row = (t: Task) => `<li class="row"><form method="post" action="/task/${t.id}/done" style="display:inline"><button class="ghost" aria-label="完成「${esc(t.title)}」" style="padding:4px 10px">${t.done ? '↩' : '✓'}</button></form>${pill(t)}<span class="grow" style="${t.done ? 'text-decoration:line-through;color:#999' : ''}">${esc(t.title)}${t.note ? `<br><span class="muted">${esc(t.note)}</span>` : ''}</span><span class="muted">${fmt(t.due)}${t.remind ? ' 🔔' : ''}</span></li>`;
    const nolabel = ctx.defect('PL-04');
    const form = `<form class="card" method="post" action="/task" id="addf"><h2>新增待办</h2>
${nolabel ? '' : '<label for="title">标题</label>'}<input id="title" name="title" placeholder="要做什么？">
<div class="row"><div class="grow">${nolabel ? '' : '<label for="due">截止时间</label>'}<input id="due" type="datetime-local" name="due"></div><div>${nolabel ? '' : '<label for="priority">优先级</label>'}<select id="priority" name="priority"><option value="mid">中</option><option value="high">高</option><option value="low">低</option></select></div></div>
${nolabel ? '' : '<label for="note">备注（选填）</label>'}<input id="note" name="note" placeholder="${ctx.defect('PL-05') ? '备注' : '备注（选填）'}">
<label class="row" style="margin-top:10px"><input type="checkbox" name="remind" style="width:auto" checked> 到点提醒我</label>
<div class="row" style="margin-top:12px"><button id="addbtn">添加</button></div></form>`;
    const script = (tasks: Task[]) => `
${ctx.defect('PL-05') ? `const f=document.getElementById('addf');if(f){const b=document.getElementById('addbtn');const chk=()=>{b.disabled=!(f.title.value.trim()&&f.note.value.trim());};chk();f.addEventListener('input',chk);}` : ''}
const tasks=${JSON.stringify(tasks.filter((t) => t.remind && !t.done && t.due).map((t) => ({ id: t.id, title: t.title, due: t.due })))};
const fired=new Set(JSON.parse(localStorage.getItem('fired')||'[]'));
const tick=()=>{const now=Date.now();for(const t of tasks){if(fired.has(t.id))continue;if(new Date(t.due).getTime()<=now){fired.add(t.id);localStorage.setItem('fired',JSON.stringify([...fired]));${ctx.defect('PL-01') ? '' : "if('Notification' in window){Notification.requestPermission().then(p=>{if(p==='granted')new Notification('轻计划提醒',{body:t.title+' 到时间啦'});});}const d=document.createElement('div');d.className='toast';d.textContent='⏰ '+t.title+' 到时间啦';document.body.append(d);setTimeout(()=>d.remove(),6000);"}}}};
tick();setInterval(tick,5000);`;

    app.get('/', (req, reply) => {
      const u = ctx.requireUser(req, reply); if (!u) return; const d = D(u.id);
      const day = new Date().toISOString().slice(0, 10);
      const list = d.tasks.filter((t) => !t.done && (!t.due || t.due.slice(0, 10) <= day));
      const done = d.tasks.filter((t) => t.done);
      const q = req.query as Record<string, string>;
      reply.type('text/html').send(ctx.page(req, { title: '今天', body: `<h1>今天要做</h1>${q.err ? `<div class="err" role="alert">${esc(q.err)}</div>` : ''}${q.undo && !ctx.defect('PL-03') ? `<div class="ok">已完成「${esc(q.undo)}」 <a href="/task/${esc(q.id)}/done-undo">撤销</a></div>` : ''}
<div class="card"><ul class="list">${list.map(row).join('') || '<li class="muted">今天没有待办，轻松一下 ☕</li>'}</ul></div>${form}
${ctx.defect('PL-03') ? '' : `<details class="card"><summary>已完成（${done.length}）</summary><ul class="list">${done.map(row).join('')}</ul></details>`}`, script: script(d.tasks) }));
    });
    app.get('/all', (req, reply) => {
      const u = ctx.requireUser(req, reply); if (!u) return; const d = D(u.id);
      const list = d.tasks.filter((t) => !t.done || !ctx.defect('PL-03')).sort((a, b) => (a.due || '9').localeCompare(b.due || '9'));
      reply.type('text/html').send(ctx.page(req, { title: '全部待办', body: `<h1>全部待办</h1><div class="card"><ul class="list">${list.map(row).join('') || '<li class="muted">还没有待办</li>'}</ul></div>${form}`, script: script(d.tasks) }));
    });
    app.post('/task', (req, reply) => {
      const u = ctx.requireUser(req, reply); if (!u) return; const d = D(u.id); const b = req.body as Record<string, string>;
      if (!(b.title ?? '').trim()) return reply.redirect(`/?err=${encodeURIComponent('请填写待办标题')}`);
      let due = b.due ?? '';
      if (due && ctx.defect('PL-02')) { const t = new Date(`${due}:00Z`); t.setUTCHours(t.getUTCHours() - 8); due = t.toISOString().slice(0, 16); }
      d.tasks.push({ id: uid(), title: b.title.trim().slice(0, 80), due, remind: !!b.remind, priority: (['high', 'mid', 'low'].includes(b.priority) ? b.priority : 'mid') as Task['priority'], note: (b.note ?? '').slice(0, 120), done: false });
      reply.redirect(req.headers.referer?.includes('/all') ? '/all' : '/');
    });
    app.post('/task/:id/done', (req, reply) => {
      const u = ctx.requireUser(req, reply); if (!u) return; const d = D(u.id); const t = d.tasks.find((x) => x.id === (req.params as { id: string }).id);
      if (t) { t.done = !t.done; t.doneAt = Date.now(); }
      reply.redirect(t?.done ? `/?undo=${encodeURIComponent(t.title)}&id=${t.id}` : '/');
    });
    app.get('/task/:id/done-undo', (req, reply) => { const u = ctx.requireUser(req, reply); if (!u) return; const t = D(u.id).tasks.find((x) => x.id === (req.params as { id: string }).id); if (t && !ctx.defect('PL-03')) t.done = false; reply.redirect('/'); });

    app.get('/calendar', (req, reply) => {
      const u = ctx.requireUser(req, reply); if (!u) return; const d = D(u.id);
      const start = new Date(); start.setHours(0, 0, 0, 0); start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
      const days = [...Array(7)].map((_, i) => { const x = new Date(start); x.setDate(start.getDate() + i); return x; });
      const key = (x: Date) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
      const shift = (s: string) => { if (!ctx.defect('PL-06')) return s; const x = new Date(`${s}T00:00:00`); x.setDate(x.getDate() + 1); return key(x); };
      const wd = ['一', '二', '三', '四', '五', '六', '日'];
      reply.type('text/html').send(ctx.page(req, { title: '日历', body: `<h1>本周</h1><div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(120px,1fr))">${days.map((x, i) => `<div class="card"><b>周${wd[i]}</b> <span class="muted">${x.getMonth() + 1}/${x.getDate()}</span><ul class="list">${d.tasks.filter((t) => t.due && shift(t.due.slice(0, 10)) === key(x)).map((t) => `<li style="font-size:13px">${esc(t.title)} <span class="muted">${t.due.slice(11, 16)}</span></li>`).join('')}</ul></div>`).join('')}</div>` }));
    });
    app.get('/search', (req, reply) => {
      const u = ctx.requireUser(req, reply); if (!u) return; const d = D(u.id); const kw = String((req.query as Record<string, string>).kw ?? '').trim();
      const res = kw ? d.tasks.filter((t) => (ctx.defect('PL-07') ? t.title === kw : t.title.includes(kw) || t.note.includes(kw))) : [];
      reply.type('text/html').send(ctx.page(req, { title: '搜索', body: `<h1>搜索待办</h1><form class="card row" method="get"><input name="kw" aria-label="搜索关键字" value="${esc(kw)}" placeholder="输入关键字" style="flex:1;width:auto"><button>搜索</button></form>${kw ? `<div class="card"><ul class="list">${res.map(row).join('') || '<li class="muted">没有找到相关待办</li>'}</ul></div>` : ''}` }));
    });
  },
};
