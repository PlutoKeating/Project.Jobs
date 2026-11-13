// 「随手记账」：个人记账（精做 Demo 2）
import { bucket, esc, uid, type DemoAppDef } from '../framework.ts';

interface Rec { id: string; type: 'expense' | 'income'; amount: number; category: string; date: string; note: string }
interface Data { recs: Rec[]; budget: number }
const CATS = { expense: ['餐饮', '交通', '购物', '居住', '娱乐', '医疗', '学习', '其他'], income: ['工资', '奖金', '兼职', '理财', '其他'] };
const today = () => new Date().toISOString().slice(0, 10);
const month = (d: string) => d.slice(0, 7);
const yuan = (n: number) => `¥${n.toFixed(2)}`;

export const ledger: DemoAppDef = {
  id: 'ledger', name: '随手记账', name_en: 'Pocket Ledger', category: 'life_finance', theme: '#16a34a',
  tagline: '三秒记一笔，月底不再糊涂账',
  description: `随手记账是一款个人记账 Web 应用。功能：
1. 记一笔：选择支出/收入、金额（支持小数）、分类、日期、备注。
2. 账单：按月份与分类筛选查看流水，可删除记录。
3. 统计：本月收支汇总、各分类支出占比。
4. 预算：设置月度预算，超支时提醒。
5. 导出：把账单导出为 CSV。
目标用户：上班族、学生、家庭主妇/主夫等需要管理日常开销的人。`,
  nav: [{ href: '/', label: '首页', icon: '🏠' }, { href: '/add', label: '记一笔', icon: '✏️' }, { href: '/records', label: '账单', icon: '📒' }, { href: '/stats', label: '统计', icon: '📊' }, { href: '/budget', label: '预算', icon: '🎯' }],
  defects: [
    { id: 'LG-01', category: 'bug', severity: 'P1', title: '输入带小数的金额会被静默拒绝', description: '金额输入 12.5 这类小数后点保存，表单被清空且没有任何错误提示，记录也没有保存。', location: '/add', keywords: ['小数', '金额', '保存失败', '没保存', '清空', '没有提示'] },
    { id: 'LG-02', category: 'bug', severity: 'P1', title: '统计页本月支出合计少算最后一笔', description: '统计页的本月支出合计总是漏掉最近添加的一笔，与账单页对不上。', location: '/stats', keywords: ['合计', '统计', '对不上', '少算', '总额', '不一致'] },
    { id: 'LG-03', category: 'ux', severity: 'P2', title: '删除记录没有确认也无法撤销', description: '在账单页点删除图标会立即删除记录，没有确认对话框也没有撤销。', location: '/records', keywords: ['删除', '确认', '撤销', '误删'] },
    { id: 'LG-04', category: 'a11y', severity: 'P2', title: '编辑/删除图标点击区域过小，分类选择不可用键盘操作', description: '账单列表里的删除图标只有约 14×14 像素；分类选项是不可聚焦的 div。', location: '/records', keywords: ['太小', '点不中', '点击区域', '键盘', '无障碍', '误触'] },
    { id: 'LG-05', category: 'ux', severity: 'P2', title: '日期默认为 2019-01-01 而不是今天', description: '记一笔时日期字段默认值错误，用户不注意就会把账记到 2019 年。', location: '/add', keywords: ['日期', '默认', '2019', '今天', '错误日期'] },
    { id: 'LG-06', category: 'ux', severity: 'P2', title: '超出预算时没有任何提醒', description: '设置了月预算后，本月支出超过预算，首页和记账后都没有提醒。', location: '/budget', keywords: ['预算', '超支', '提醒', '没有提醒'] },
    { id: 'LG-07', category: 'a11y', severity: 'P3', title: '记账表单输入框缺少标签，金额文字对比度低', description: '金额、备注输入框只有占位文字没有 label；首页金额使用浅灰色。', location: '/add', keywords: ['标签', 'label', '对比度', '看不清', '占位'] },
    { id: 'LG-08', category: 'value', severity: 'P2', title: '导出 CSV 点击后才告知需要付费会员', description: '账单页显眼的「导出」按钮点击后才弹出需要付费会员，事先没有任何标识。', location: '/records', keywords: ['导出', '付费', '会员', 'CSV', '收费'] },
  ],
  setup(app, ctx) {
    const D = (u: string) => bucket<Data>(ctx, 'ledger', u, () => ({ recs: [], budget: 0 }));
    const sum = (rs: Rec[], t: Rec['type']) => rs.filter((r) => r.type === t).reduce((a, b) => a + b.amount, 0);
    const low = ctx.defect('LG-07') ? 'color:#c0c4cc' : '';

    app.get('/', (req, reply) => {
      const u = ctx.requireUser(req, reply); if (!u) return; const d = D(u.id);
      const m = month(today()); const rs = d.recs.filter((r) => month(r.date) === m);
      const exp = sum(rs, 'expense'); const inc = sum(rs, 'income');
      const over = d.budget > 0 && exp > d.budget && !ctx.defect('LG-06');
      reply.type('text/html').send(ctx.page(req, { title: '首页', body: `<h1>${m.replace('-', ' 年 ')} 月</h1>${over ? `<div class="err" role="alert">⚠️ 本月支出 ${yuan(exp)} 已超出预算 ${yuan(d.budget)}</div>` : ''}
<div class="grid"><div class="card"><div class="muted">本月支出</div><div style="font-size:26px;${low}">${yuan(exp)}</div></div><div class="card"><div class="muted">本月收入</div><div style="font-size:26px;${low}">${yuan(inc)}</div></div><div class="card"><div class="muted">结余</div><div style="font-size:26px;${low}">${yuan(inc - exp)}</div></div></div>
<a class="btn" href="/add" style="margin:8px 0 16px">✏️ 记一笔</a><div class="card"><h2>最近记录</h2><ul class="list">${d.recs.slice(0, 5).map((r) => `<li class="row"><span class="tag">${r.category}</span><span class="grow">${esc(r.note || '')}</span><span>${r.type === 'expense' ? '-' : '+'}${yuan(r.amount)}</span></li>`).join('') || '<li class="muted">还没有记录，点「记一笔」开始吧</li>'}</ul></div>` }));
    });

    app.get('/add', (req, reply) => {
      const u = ctx.requireUser(req, reply); if (!u) return;
      const q = req.query as Record<string, string>; const type = q.type === 'income' ? 'income' : 'expense';
      const nolabel = ctx.defect('LG-07');
      const catUi = ctx.defect('LG-04')
        ? `<div class="row" id="cats">${CATS[type].map((c, i) => `<div class="tag cat" data-v="${c}" style="cursor:pointer;padding:6px 12px;${i === 0 ? 'background:var(--c);color:#fff' : ''}">${c}</div>`).join('')}</div><input type="hidden" name="category" id="category" value="${CATS[type][0]}">`
        : `<select id="category" name="category">${CATS[type].map((c) => `<option>${c}</option>`).join('')}</select>`;
      reply.type('text/html').send(ctx.page(req, { title: '记一笔', body: `<h1>记一笔</h1>${q.ok ? '<div class="ok" role="status">已保存 ✓</div>' : ''}${q.err ? `<div class="err" role="alert">${esc(q.err)}</div>` : ''}
<div class="row" style="margin-bottom:10px"><a class="btn ${type === 'expense' ? '' : 'ghost'}" href="/add?type=expense">支出</a><a class="btn ${type === 'income' ? '' : 'ghost'}" href="/add?type=income">收入</a></div>
<form class="card" method="post" action="/add"><input type="hidden" name="type" value="${type}">
${nolabel ? '' : '<label for="amount">金额（元）</label>'}<input id="amount" name="amount" inputmode="decimal" placeholder="金额" autocomplete="off">
${nolabel ? '' : '<label>分类</label>'}${catUi}
${nolabel ? '' : '<label for="date">日期</label>'}<input id="date" type="date" name="date" value="${ctx.defect('LG-05') ? '2019-01-01' : today()}">
${nolabel ? '' : '<label for="note">备注</label>'}<input id="note" name="note" placeholder="备注（选填）">
<div class="row" style="margin-top:14px"><button>保存</button><a class="btn ghost" href="/">取消</a></div></form>`,
        script: `document.querySelectorAll('.cat').forEach(el=>el.onclick=()=>{document.querySelectorAll('.cat').forEach(x=>{x.style.background='';x.style.color=''});el.style.background='var(--c)';el.style.color='#fff';document.getElementById('category').value=el.dataset.v;});` }));
    });
    app.post('/add', (req, reply) => {
      const u = ctx.requireUser(req, reply); if (!u) return; const d = D(u.id); const b = req.body as Record<string, string>;
      const raw = (b.amount ?? '').trim();
      if (ctx.defect('LG-01') && raw.includes('.')) return reply.redirect(`/add?type=${b.type}`);
      const amount = Number(raw);
      if (!raw || !Number.isFinite(amount) || amount <= 0) return reply.redirect(`/add?type=${b.type}&err=${encodeURIComponent('请输入大于 0 的金额')}`);
      d.recs.unshift({ id: uid(), type: b.type === 'income' ? 'income' : 'expense', amount: Math.round(amount * 100) / 100, category: b.category || '其他', date: b.date || today(), note: (b.note ?? '').slice(0, 60) });
      d.recs.sort((a, c) => c.date.localeCompare(a.date));
      const exp = sum(d.recs.filter((r) => month(r.date) === month(today())), 'expense');
      if (d.budget > 0 && exp > d.budget && !ctx.defect('LG-06')) return reply.redirect(`/add?type=${b.type}&ok=1&err=${encodeURIComponent(`注意：本月支出已超出预算 ${yuan(d.budget)}`)}`);
      reply.redirect(`/add?type=${b.type}&ok=1`);
    });

    app.get('/records', (req, reply) => {
      const u = ctx.requireUser(req, reply); if (!u) return; const d = D(u.id); const q = req.query as Record<string, string>;
      const m = q.m ?? month(today()); const cat = q.cat ?? '';
      const rs = d.recs.filter((r) => month(r.date) === m && (!cat || r.category === cat));
      const del = (r: Rec) => ctx.defect('LG-04') || ctx.defect('LG-03')
        ? `<form method="post" action="/records/${r.id}/delete" style="display:inline"><button title="删除" style="padding:0;width:14px;height:14px;font-size:9px;line-height:14px;background:#eee;color:#999">✕</button></form>`
        : `<form method="post" action="/records/${r.id}/delete" style="display:inline" onsubmit="return confirm('确定删除这条记录吗？')"><button class="ghost" aria-label="删除这条记录">删除</button></form>`;
      reply.type('text/html').send(ctx.page(req, { title: '账单', body: `<div class="row" style="justify-content:space-between"><h1>账单</h1><a class="btn ghost" href="/records/export">⬇ 导出 CSV</a></div>${q.undo && !ctx.defect('LG-03') ? `<div class="ok">已删除。<a href="/records/undo">撤销</a></div>` : ''}${q.vip ? '<div class="err" role="alert">导出账单是会员专属功能，开通会员 ¥6/月 后可用。</div>' : ''}
<form class="card row" method="get"><label for="m" style="margin:0">月份</label><input id="m" type="month" name="m" value="${m}" style="width:auto"><label for="cat" style="margin:0">分类</label><select id="cat" name="cat" style="width:auto"><option value="">全部</option>${[...CATS.expense, ...CATS.income].map((c) => `<option ${c === cat ? 'selected' : ''}>${c}</option>`).join('')}</select><button>筛选</button></form>
<div class="card"><ul class="list">${rs.map((r) => `<li class="row"><span class="muted">${r.date}</span><span class="tag">${r.category}</span><span class="grow">${esc(r.note)}</span><b>${r.type === 'expense' ? '-' : '+'}${yuan(r.amount)}</b>${del(r)}</li>`).join('') || '<li class="muted">这个月没有记录</li>'}</ul></div>` }));
    });
    let lastDeleted: Record<string, Rec | undefined> = {};
    app.post('/records/:id/delete', (req, reply) => { const u = ctx.requireUser(req, reply); if (!u) return; const d = D(u.id); const id = (req.params as { id: string }).id; lastDeleted[u.id] = d.recs.find((r) => r.id === id); d.recs = d.recs.filter((r) => r.id !== id); reply.redirect('/records?undo=1'); });
    app.get('/records/undo', (req, reply) => { const u = ctx.requireUser(req, reply); if (!u) return; const d = D(u.id); const r = lastDeleted[u.id]; if (r && !ctx.defect('LG-03')) d.recs.unshift(r); lastDeleted = { ...lastDeleted, [u.id]: undefined }; reply.redirect('/records'); });
    app.get('/records/export', (req, reply) => {
      const u = ctx.requireUser(req, reply); if (!u) return; const d = D(u.id);
      if (ctx.defect('LG-08')) return reply.redirect('/records?vip=1');
      reply.header('content-disposition', 'attachment; filename="ledger.csv"').type('text/csv; charset=utf-8').send(['日期,类型,分类,金额,备注', ...d.recs.map((r) => `${r.date},${r.type === 'expense' ? '支出' : '收入'},${r.category},${r.amount},${r.note.replace(/,/g, ' ')}`)].join('\n'));
    });

    app.get('/stats', (req, reply) => {
      const u = ctx.requireUser(req, reply); if (!u) return; const d = D(u.id);
      const m = month(today());
      let rs = d.recs.filter((r) => month(r.date) === m && r.type === 'expense');
      const listed = rs;
      if (ctx.defect('LG-02') && rs.length) rs = rs.slice(1);
      const total = rs.reduce((a, b) => a + b.amount, 0);
      const byCat = new Map<string, number>(); for (const r of listed) byCat.set(r.category, (byCat.get(r.category) ?? 0) + r.amount);
      const all = listed.reduce((a, b) => a + b.amount, 0) || 1;
      reply.type('text/html').send(ctx.page(req, { title: '统计', body: `<h1>本月统计</h1><div class="card"><div class="muted">本月支出合计</div><div style="font-size:28px">${yuan(total)}</div><div class="muted">共 ${listed.length} 笔</div></div>
<div class="card"><h2>分类占比</h2>${[...byCat.entries()].sort((a, b) => b[1] - a[1]).map(([c, v]) => `<div style="margin:8px 0"><div class="row"><span class="grow">${c}</span><span>${yuan(v)}（${Math.round((v / all) * 100)}%）</span></div><div style="height:8px;background:#eef0f3;border-radius:4px"><div style="height:8px;width:${(v / all) * 100}%;background:var(--c);border-radius:4px"></div></div></div>`).join('') || '<p class="muted">暂无支出</p>'}</div>` }));
    });

    app.get('/budget', (req, reply) => {
      const u = ctx.requireUser(req, reply); if (!u) return; const d = D(u.id);
      reply.type('text/html').send(ctx.page(req, { title: '预算', body: `<h1>月度预算</h1>${(req.query as Record<string, string>).ok ? '<div class="ok">预算已更新</div>' : ''}<form class="card" method="post" action="/budget"><label for="b">每月预算（元）</label><input id="b" name="budget" inputmode="numeric" value="${d.budget || ''}"><div class="row" style="margin-top:12px"><button>保存预算</button></div></form>` }));
    });
    app.post('/budget', (req, reply) => { const u = ctx.requireUser(req, reply); if (!u) return; D(u.id).budget = Math.max(0, Number((req.body as Record<string, string>).budget) || 0); reply.redirect('/budget?ok=1'); });
  },
};
