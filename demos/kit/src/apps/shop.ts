// 「饱了么外卖」：外卖下单（精做 Demo 4，含沙箱支付与定位）
import { bucket, esc, uid, type DemoAppDef } from '../framework.ts';

interface Item { id: string; name: string; price: number; desc: string }
interface Shop { id: string; name: string; tags: string; eta: number; fee: number; items: Item[] }
interface Order { id: string; shop: string; lines: { name: string; qty: number; price: number }[]; total: number; status: number; at: number; address: string }
interface Data { cart: Record<string, number>; cartShop?: string; address: string; coupon?: string; orders: Order[] }

const SHOPS: Shop[] = [
  { id: 's1', name: '老王兰州拉面', tags: '面食 · 人均 ¥22', eta: 28, fee: 3, items: [{ id: 'i1', name: '牛肉拉面', price: 18, desc: '清汤牛肉，劲道拉面' }, { id: 'i2', name: '加肉', price: 8, desc: '额外牛肉 50g' }, { id: 'i3', name: '凉拌黄瓜', price: 6, desc: '爽口小菜' }] },
  { id: 's2', name: '轻食沙拉研究所', tags: '轻食 · 人均 ¥35', eta: 35, fee: 4, items: [{ id: 'i4', name: '鸡胸肉牛油果沙拉', price: 32, desc: '低脂高蛋白' }, { id: 'i5', name: '藜麦能量碗', price: 29, desc: '素食友好' }, { id: 'i6', name: '冷压果汁', price: 15, desc: '橙+胡萝卜' }] },
  { id: 's3', name: '霸王茶语', tags: '奶茶 · 人均 ¥16', eta: 22, fee: 2, items: [{ id: 'i7', name: '伯牙绝弦', price: 16, desc: '茉莉雪芽奶茶' }, { id: 'i8', name: '桂馥兰香', price: 17, desc: '桂花乌龙' }, { id: 'i9', name: '加珍珠', price: 2, desc: '小料' }] },
  { id: 's4', name: '川味小馆', tags: '川菜 · 人均 ¥40', eta: 40, fee: 5, items: [{ id: 'i10', name: '宫保鸡丁饭', price: 26, desc: '微辣' }, { id: 'i11', name: '麻婆豆腐饭', price: 22, desc: '麻辣' }, { id: 'i12', name: '米饭', price: 2, desc: '一份' }] },
];
const STATUS = ['商家已接单', '骑手到店', '骑手配送中', '已送达'];
const findItem = (id: string) => SHOPS.flatMap((s) => s.items.map((i) => ({ ...i, shop: s }))).find((x) => x.id === id);

export const shop: DemoAppDef = {
  id: 'shop', name: '饱了么外卖', name_en: 'FullUp Delivery', category: 'commerce', theme: '#f97316',
  tagline: '附近好吃的，30 分钟送到',
  description: `饱了么外卖是一款外卖点餐 Web 应用（H5）。功能：
1. 定位：自动获取当前位置或手动填写收货地址。
2. 商家：浏览附近商家与菜单，加入购物车。
3. 购物车与结算：修改数量、使用优惠券（新用户券 NEW10 满 20 减 10）、确认地址与费用。
4. 支付：测试环境沙箱支付（6 位支付密码 123456）。
5. 订单：查看订单状态与配送进度。
目标用户：上班族、学生、宅家人群。`,
  form: 'h5',
  nav: [{ href: '/', label: '首页', icon: '🏠' }, { href: '/cart', label: '购物车', icon: '🛒' }, { href: '/orders', label: '订单', icon: '🧾' }],
  defects: [
    { id: 'SH-01', category: 'bug', severity: 'P1', title: '输入有效优惠券后静默失败，无提示也不减价', description: '在购物车输入 NEW10 点击使用，页面没有任何提示，价格也没有变化。', location: '/cart', keywords: ['优惠券', '没反应', '不减', '无效', '使用失败', 'NEW10'] },
    { id: 'SH-02', category: 'value', severity: 'P1', title: '支付页才出现此前未展示的 ¥3「平台服务费」', description: '暗模式：结算页总价不含服务费，到支付页金额突然增加 ¥3。', location: '/pay', keywords: ['服务费', '隐藏费用', '价格变了', '多收', '金额不一致', '暗模式'] },
    { id: 'SH-03', category: 'value', severity: 'P2', title: '默认勾选付费「准时宝」', description: '暗模式：结算页默认勾选 ¥1.5 的准时宝附加服务，字体很小。', location: '/checkout', keywords: ['默认勾选', '准时宝', '附加', '保险', '捆绑', '暗模式'] },
    { id: 'SH-04', category: 'bug', severity: 'P0', title: '定位失败时首页一直转圈，且没有手动填写地址的入口', description: '拒绝或无法获取定位时，首页停留在「正在定位…」，无法继续浏览商家。', location: '/', keywords: ['定位', '转圈', '卡住', '地址', '无法使用', '加载'] },
    { id: 'SH-05', category: 'bug', severity: 'P1', title: '从结算页返回后购物车被清空', description: '在结算页点击浏览器返回，购物车内容全部丢失。', location: '/checkout', keywords: ['返回', '购物车', '清空', '丢失', '后退'] },
    { id: 'SH-06', category: 'bug', severity: 'P1', title: '支付按钮可重复点击，产生两笔订单', description: '点击确认支付后按钮不禁用，快速点击两次会生成两笔订单并重复扣款。', location: '/pay', keywords: ['重复', '两笔', '双击', '重复下单', '扣两次'] },
    { id: 'SH-07', category: 'value', severity: 'P3', title: '虚假倒计时制造紧迫感', description: '首页「限时优惠仅剩 02:00」倒计时每次刷新都会重置。', location: '/', keywords: ['倒计时', '限时', '紧迫', '刷新重置', '虚假'] },
    { id: 'SH-08', category: 'a11y', severity: 'P2', title: '菜单加减按钮过小且没有可访问名称', description: '菜品的 + / − 按钮只有约 18 像素，没有文字标签，单手操作容易点错。', location: '/shop/:id', keywords: ['加减', '按钮太小', '点错', '无障碍', '单手'] },
  ],
  setup(app, ctx) {
    const D = (u: string) => bucket<Data>(ctx, 'shop', u, () => ({ cart: {}, address: '', orders: [] }));
    const cartLines = (d: Data) => Object.entries(d.cart).filter(([, q]) => q > 0).map(([id, qty]) => { const it = findItem(id)!; return { id, name: it.name, qty, price: it.price, shop: it.shop }; });
    const calc = (d: Data, insurance: boolean, withService: boolean) => {
      const lines = cartLines(d); const sub = lines.reduce((a, l) => a + l.qty * l.price, 0); const fee = lines[0]?.shop.fee ?? 0; const pack = lines.length ? 1 : 0;
      const coupon = d.coupon === 'NEW10' && sub >= 20 ? 10 : 0;
      return { lines, sub, fee, pack, coupon, insurance: insurance ? 1.5 : 0, service: withService ? 3 : 0, total: Math.max(0, sub + fee + pack - coupon + (insurance ? 1.5 : 0) + (withService ? 3 : 0)) };
    };

    app.get('/', (req, reply) => {
      const u = ctx.requireUser(req, reply); if (!u) return; const d = D(u.id);
      const q = req.query as Record<string, string>;
      const addrBlock = d.address
        ? `<div class="card row"><span class="grow">📍 送至：<b>${esc(d.address)}</b></span><a href="/address">修改</a></div>`
        : `<div class="card" id="locbox"><div id="locmsg">📍 正在定位…</div>${ctx.defect('SH-04') ? '' : `<form method="post" action="/address" class="row" id="manual" style="margin-top:8px"><input name="address" aria-label="收货地址" placeholder="或手动输入收货地址" style="flex:1;width:auto"><button>确定</button></form>`}</div>`;
      reply.type('text/html').send(ctx.page(req, { title: '首页', body: `${q.err ? `<div class="err">${esc(q.err)}</div>` : ''}${addrBlock}
${ctx.defect('SH-07') ? '<div class="card" style="background:#fff7ed">🔥 新人限时优惠，仅剩 <b id="cd">02:00</b>，错过再等一年！</div>' : '<div class="card" style="background:#fff7ed">🎁 新用户下单可用优惠券 NEW10（满 20 减 10）</div>'}
<div id="shops" class="${d.address ? '' : 'hidden'}">${SHOPS.map((s) => `<a class="card row" href="/shop/${s.id}" style="text-decoration:none;color:inherit"><div style="font-size:30px">🍱</div><div class="grow"><b>${esc(s.name)}</b><div class="muted">${s.tags} · 约 ${s.eta} 分钟 · 配送费 ¥${s.fee}</div></div></a>`).join('')}</div>`,
        script: `${ctx.defect('SH-07') ? "let t=120;setInterval(()=>{t=Math.max(0,t-1);document.getElementById('cd').textContent='0'+Math.floor(t/60)+':'+String(t%60).padStart(2,'0');},1000);" : ''}
${d.address ? '' : `if(navigator.geolocation){navigator.geolocation.getCurrentPosition(async p=>{const r=await fetch('/api/geo?lat='+p.coords.latitude+'&lng='+p.coords.longitude,{method:'POST'});const j=await r.json();document.getElementById('locmsg').innerHTML='📍 已定位：<b>'+j.address+'</b>';document.getElementById('shops').classList.remove('hidden');},err=>{${ctx.defect('SH-04') ? '' : "document.getElementById('locmsg').textContent='📍 定位失败（'+err.message+'），请手动输入地址';"}},{timeout:8000});}`}` }));
    });
    app.post('/api/geo', (req) => { const u = ctx.user(req); const q = req.query as Record<string, string>; const lat = Number(q.lat).toFixed(3); const lng = Number(q.lng).toFixed(3); const addr = `定位地址（${lat}, ${lng}）附近`; if (u) D(u.id).address = addr; return { address: addr }; });
    app.get('/address', (req, reply) => { const u = ctx.requireUser(req, reply); if (!u) return; reply.type('text/html').send(ctx.page(req, { title: '收货地址', body: `<h1>收货地址</h1><form class="card" method="post" action="/address"><label for="a">详细地址</label><input id="a" name="address" value="${esc(D(u.id).address)}" placeholder="小区/楼栋/门牌号"><div class="row" style="margin-top:12px"><button>保存</button></div></form>` })); });
    app.post('/address', (req, reply) => { const u = ctx.requireUser(req, reply); if (!u) return; const a = String((req.body as Record<string, string>).address ?? '').trim(); if (!a) return reply.redirect('/?err=' + encodeURIComponent('请填写地址')); D(u.id).address = a.slice(0, 80); reply.redirect('/'); });

    app.get('/shop/:id', (req, reply) => {
      const u = ctx.requireUser(req, reply); if (!u) return; const d = D(u.id); const s = SHOPS.find((x) => x.id === (req.params as { id: string }).id);
      if (!s) return reply.code(404).send('not found');
      const btn = (it: Item, delta: 1 | -1) => ctx.defect('SH-08')
        ? `<button formaction="/cart/${it.id}?d=${delta}" style="width:18px;height:18px;padding:0;font-size:11px;line-height:18px;border-radius:9px">${delta > 0 ? '+' : '−'}</button>`
        : `<button formaction="/cart/${it.id}?d=${delta}" aria-label="${delta > 0 ? '加一份' : '减一份'}${esc(it.name)}" style="min-width:40px;min-height:40px">${delta > 0 ? '+' : '−'}</button>`;
      const count = Object.values(d.cart).reduce((a, b) => a + b, 0);
      reply.type('text/html').send(ctx.page(req, { title: s.name, body: `<h1>${esc(s.name)}</h1><p class="muted">${s.tags} · 配送费 ¥${s.fee}</p>
<form method="post"><div class="card"><ul class="list">${s.items.map((it) => `<li class="row"><div class="grow"><b>${esc(it.name)}</b><div class="muted">${esc(it.desc)}</div><div>¥${it.price}</div></div>${(d.cart[it.id] ?? 0) > 0 ? `${btn(it, -1)}<span style="min-width:20px;text-align:center">${d.cart[it.id]}</span>` : ''}${btn(it, 1)}</li>`).join('')}</ul></div></form>
<a class="btn" href="/cart" style="position:sticky;bottom:10px;display:block;text-align:center">🛒 去结算（${count} 件）</a>` }));
    });
    app.post('/cart/:id', (req, reply) => {
      const u = ctx.requireUser(req, reply); if (!u) return; const d = D(u.id); const id = (req.params as { id: string }).id; const it = findItem(id); if (!it) return reply.redirect('/');
      if (d.cartShop && d.cartShop !== it.shop.id && Object.values(d.cart).some((q) => q > 0)) { d.cart = {}; }
      d.cartShop = it.shop.id; d.cart[id] = Math.max(0, (d.cart[id] ?? 0) + Number((req.query as Record<string, string>).d ?? 1));
      reply.redirect(`/shop/${it.shop.id}`);
    });
    app.get('/cart', (req, reply) => {
      const u = ctx.requireUser(req, reply); if (!u) return; const d = D(u.id); const c = calc(d, false, false); const q = req.query as Record<string, string>;
      reply.type('text/html').send(ctx.page(req, { title: '购物车', body: `<h1>购物车</h1>${q.cmsg ? `<div class="${q.cok ? 'ok' : 'err'}" role="status">${esc(q.cmsg)}</div>` : ''}
${c.lines.length ? `<div class="card"><b>${esc(c.lines[0].shop.name)}</b><ul class="list">${c.lines.map((l) => `<li class="row"><span class="grow">${esc(l.name)} × ${l.qty}</span><span>¥${(l.qty * l.price).toFixed(2)}</span></li>`).join('')}</ul></div>
<form class="card row" method="post" action="/coupon"><label for="cp" style="margin:0">优惠券</label><input id="cp" name="code" value="${esc(d.coupon ?? '')}" placeholder="输入优惠码" style="flex:1;width:auto"><button>使用</button></form>
<div class="card"><div class="row"><span class="grow">商品小计</span>¥${c.sub.toFixed(2)}</div><div class="row"><span class="grow">优惠</span>-¥${c.coupon.toFixed(2)}</div></div><a class="btn" href="/checkout" style="display:block;text-align:center">去结算</a>` : '<div class="card muted">购物车是空的，<a href="/">去逛逛</a></div>'}` }));
    });
    app.post('/coupon', (req, reply) => {
      const u = ctx.requireUser(req, reply); if (!u) return; const d = D(u.id); const code = String((req.body as Record<string, string>).code ?? '').trim().toUpperCase();
      if (ctx.defect('SH-01')) return reply.redirect('/cart');
      if (code !== 'NEW10') return reply.redirect(`/cart?cmsg=${encodeURIComponent('优惠码无效')}`);
      const sub = cartLines(d).reduce((a, l) => a + l.qty * l.price, 0);
      if (sub < 20) return reply.redirect(`/cart?cmsg=${encodeURIComponent('未满 20 元，暂不可用')}`);
      d.coupon = code; reply.redirect(`/cart?cok=1&cmsg=${encodeURIComponent('已使用优惠券，立减 10 元')}`);
    });
    app.get('/checkout', (req, reply) => {
      const u = ctx.requireUser(req, reply); if (!u) return; const d = D(u.id);
      const ins = ctx.defect('SH-03'); const c = calc(d, ins, false);
      if (!c.lines.length) return reply.redirect('/cart');
      reply.type('text/html').send(ctx.page(req, { title: '确认订单', body: `<h1>确认订单</h1><div class="card">📍 ${esc(d.address || '未填写地址')} <a href="/address">修改</a></div>
<form class="card" method="post" action="/checkout"><div class="row"><span class="grow">商品小计</span>¥${c.sub.toFixed(2)}</div><div class="row"><span class="grow">配送费</span>¥${c.fee.toFixed(2)}</div><div class="row"><span class="grow">打包费</span>¥${c.pack.toFixed(2)}</div><div class="row"><span class="grow">优惠</span>-¥${c.coupon.toFixed(2)}</div>
<label class="row" style="${ins ? 'font-size:11px;color:#aaa' : ''}"><input type="checkbox" name="insurance" style="width:auto" ${ins ? 'checked' : ''}> 准时宝（超时赔付）¥1.5</label>
<div class="row" style="font-size:18px;margin-top:8px"><span class="grow">合计</span><b id="total">¥${c.total.toFixed(2)}</b></div><button style="width:100%;margin-top:10px">提交订单</button></form>`,
        script: ctx.defect('SH-05') ? `window.addEventListener('pageshow',()=>{});window.addEventListener('popstate',()=>{});history.pushState({},'');window.addEventListener('popstate',()=>{fetch('/api/cart/clear',{method:'POST'}).then(()=>location.href='/cart');});` : '' }));
    });
    app.post('/api/cart/clear', (req) => { const u = ctx.user(req); if (u) { D(u.id).cart = {}; D(u.id).coupon = undefined; } return { ok: true }; });
    app.post('/checkout', (req, reply) => {
      const u = ctx.requireUser(req, reply); if (!u) return; const d = D(u.id);
      if (!d.address) return reply.redirect(`/checkout?err=${encodeURIComponent('请先填写收货地址')}`);
      const ins = !!(req.body as Record<string, string>).insurance;
      reply.redirect(`/pay?ins=${ins ? 1 : 0}`);
    });
    app.get('/pay', (req, reply) => {
      const u = ctx.requireUser(req, reply); if (!u) return; const d = D(u.id); const ins = (req.query as Record<string, string>).ins === '1';
      const c = calc(d, ins, ctx.defect('SH-02'));
      if (!c.lines.length) return reply.redirect('/orders');
      const e = (req.query as Record<string, string>).err;
      reply.type('text/html').send(ctx.page(req, { title: '收银台', body: `<h1>收银台</h1><div class="card" style="text-align:center"><div class="muted">需支付</div><div style="font-size:30px">¥${c.total.toFixed(2)}</div>${c.service ? '<div class="muted" style="font-size:12px">含平台服务费 ¥3.00</div>' : ''}</div>
${e ? `<div class="err" role="alert">${esc(e)}</div>` : ''}<form class="card" method="post" action="/pay?ins=${ins ? 1 : 0}" id="pf"><label for="pwd">支付密码（测试环境沙箱支付，密码 123456）</label><input id="pwd" type="password" name="pwd" inputmode="numeric" maxlength="6"><button id="paybtn" style="width:100%;margin-top:12px">确认支付</button></form>`,
        script: ctx.defect('SH-06') ? `document.getElementById('pf').addEventListener('submit',e=>{e.preventDefault();const fd=new URLSearchParams(new FormData(e.target));fetch(e.target.action,{method:'POST',body:fd,headers:{'content-type':'application/x-www-form-urlencoded'}}).then(r=>{if(r.redirected)location.href=r.url;});});` : `document.getElementById('pf').addEventListener('submit',()=>{const b=document.getElementById('paybtn');setTimeout(()=>{b.disabled=true;b.textContent='支付中…';},0);});` }));
    });
    const payLock = new Map<string, number>();
    app.post('/pay', async (req, reply) => {
      const u = ctx.requireUser(req, reply); if (!u) return; const d = D(u.id); const ins = (req.query as Record<string, string>).ins === '1';
      if ((req.body as Record<string, string>).pwd !== '123456') return reply.redirect(`/pay?ins=${ins ? 1 : 0}&err=${encodeURIComponent('支付密码错误')}`);
      if (!ctx.defect('SH-06')) { const last = payLock.get(u.id) ?? 0; if (Date.now() - last < 4000) return reply.redirect('/orders'); payLock.set(u.id, Date.now()); }
      await new Promise((r) => setTimeout(r, 900));
      const c = calc(d, ins, ctx.defect('SH-02'));
      if (!c.lines.length && !ctx.defect('SH-06')) return reply.redirect('/orders');
      const lines = c.lines.length ? c.lines : (d.orders[0]?.lines ?? []);
      d.orders.unshift({ id: uid(), shop: c.lines[0]?.shop.name ?? d.orders[0]?.shop ?? '', lines: lines.map((l) => ({ name: l.name, qty: l.qty, price: l.price })), total: c.total || d.orders[0]?.total || 0, status: 0, at: Date.now(), address: d.address });
      setTimeout(() => { d.cart = {}; d.coupon = undefined; }, ctx.defect('SH-06') ? 1500 : 0);
      reply.redirect('/orders?paid=1');
    });
    app.get('/orders', (req, reply) => {
      const u = ctx.requireUser(req, reply); if (!u) return; const d = D(u.id);
      for (const o of d.orders) o.status = Math.min(3, Math.floor((Date.now() - o.at) / 40000));
      reply.type('text/html').send(ctx.page(req, { title: '订单', body: `<h1>我的订单</h1>${(req.query as Record<string, string>).paid ? '<div class="ok" role="status">支付成功，商家正在备餐</div>' : ''}${d.orders.map((o) => `<div class="card"><div class="row"><b class="grow">${esc(o.shop)}</b><span class="tag">${STATUS[o.status]}</span></div><div class="muted">${o.lines.map((l) => `${esc(l.name)}×${l.qty}`).join('，')}</div><div class="row"><span class="grow muted">${new Date(o.at).toLocaleTimeString('zh-CN')}</span><b>¥${o.total.toFixed(2)}</b></div></div>`).join('') || '<div class="card muted">还没有订单</div>'}` }));
    });
  },
};
