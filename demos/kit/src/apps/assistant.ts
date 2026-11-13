// 「小智助手」：类豆包的 AI 工作助手（精做 Demo 1）
import { bucket, esc, uid, type DemoAppDef } from '../framework.ts';
import { DEMO_MODEL, llm } from '../llm.ts';

interface Msg { role: 'user' | 'assistant'; content: string; image?: string; at: number }
interface Conv { id: string; title: string; msgs: Msg[]; updated: number }
interface Doc { id: string; title: string; body: string; updated: number }
interface Data { convs: Conv[]; docs: Doc[]; settings: { style: string; lang: string; memory: boolean }; asks: number; vip: boolean }

const init = (): Data => ({ convs: [], docs: [], settings: { style: '简洁', lang: '中文', memory: true }, asks: 0, vip: false });

export const assistant: DemoAppDef = {
  id: 'assistant', name: '小智助手', name_en: 'Xiaozhi Assistant', category: 'ai_work', theme: '#4e6ef2',
  tagline: '你的 AI 工作搭子：写周报、改文案、总结文件、出方案',
  description: `小智助手是一款面向职场人的 AI 工作助手（Web）。核心功能：
1. AI 对话：支持文字、语音输入（按住麦克风说话）、拍照/图片提问、上传文件让 AI 总结；回复为流式输出。
2. 快捷技能：写周报、润色文案、中英翻译、会议纪要、方案大纲。
3. 文档：把对话结果存为文档，可编辑并导出为 Markdown 文件。
4. 历史：查看、搜索、删除历史对话。
5. 设置：回复风格（简洁/详细/幽默）、回复语言、是否开启记忆。
6. 会员：免费版每天 20 次提问，会员不限次。
目标用户：互联网与传统行业白领、学生、自由职业者。`,
  nav: [{ href: '/', label: '对话', icon: '💬' }, { href: '/docs', label: '文档', icon: '📄' }, { href: '/history', label: '历史', icon: '🕘' }, { href: '/settings', label: '设置', icon: '⚙️' }, { href: '/vip', label: '会员', icon: '👑' }],
  authDefects: { hidePasswordRule: 'AS-11' },
  defects: [
    { id: 'AS-01', category: 'ux', severity: 'P1', title: '文档导出入口被隐藏在无文字的「⋯」更多菜单中', description: '文档页的导出按钮被收进右上角仅有「⋯」图标的更多菜单，没有任何文字提示，用户很难发现如何导出。', location: '/docs/:id', keywords: ['导出', 'export', '更多菜单', '找不到', '下载'] },
    { id: 'AS-02', category: 'ux', severity: 'P1', title: '发送消息后没有任何加载反馈', description: '点击发送后输入框不清空、按钮无变化，也没有「正在思考」提示，约 4 秒后回复才突然出现，用户以为没发出去而重复发送。', location: '/chat/:id', keywords: ['发送', '没反应', '加载', 'loading', '反馈', '重复发送', '思考中'] },
    { id: 'AS-03', category: 'ai_quality', severity: 'P1', title: 'AI 回答编造不存在的参考资料链接', description: '回答末尾总会附上一条看起来权威但并不存在的「参考来源」链接与报告名。', location: '/chat/:id', keywords: ['引用', '参考', '链接', '编造', '幻觉', 'hallucination', '来源', '不存在'] },
    { id: 'AS-04', category: 'bug', severity: 'P1', title: '输入超过 300 字时接口 500 报错', description: '粘贴较长文本（超过 300 字）提问时后端返回 500，界面只显示「出错了」，没有原因与恢复建议。', location: '/api/chat', keywords: ['500', '长文本', '出错了', '报错', '粘贴', '错误'] },
    { id: 'AS-05', category: 'bug', severity: 'P2', title: '设置保存后提示成功但刷新即丢失', description: '修改回复风格后提示「保存成功」，但刷新页面后设置恢复为默认值。', location: '/settings', keywords: ['设置', '保存', '丢失', '恢复默认', '没生效'] },
    { id: 'AS-06', category: 'a11y', severity: 'P2', title: '输入区图标按钮缺少可访问名称、提示文字对比度过低', description: '发送、语音、附件、拍照按钮只有图标没有 aria-label；输入框下方提示文字为浅灰色，对比度不足。', location: '/chat/:id', keywords: ['图标', 'aria', '无障碍', '对比度', '看不清', '读屏', 'label'] },
    { id: 'AS-07', category: 'value', severity: 'P1', title: '第 3 次提问强制弹出会员升级弹窗，关闭按钮难以找到', description: '暗模式：免费用户第 3 次提问时弹出全屏升级弹窗，「关闭」是右上角极小的灰色 ×，主按钮是「立即开通」，拒绝按钮文案为「残忍拒绝」。', location: '/chat/:id', keywords: ['会员', '弹窗', '升级', '关闭', '暗模式', '付费', '诱导', '开通'] },
    { id: 'AS-08', category: 'bug', severity: 'P1', title: '切换到其他应用再回来后，草稿和当前对话被清空', description: '页面被切到后台（visibilitychange）再回来后，输入框中的草稿丢失，并跳回空白新对话。', location: '/chat/:id', keywords: ['切换', '回来', '草稿', '丢失', '清空', '后台', '打断'] },
    { id: 'AS-09', category: 'safety', severity: 'P0', title: '对情绪低落/心理求助类问题给出轻率回答且不引导求助', description: '当用户表达情绪崩溃或心理困扰时，AI 以调侃语气回应，不提供任何求助资源或建议联系信任的人。', location: '/chat/:id', keywords: ['心理', '情绪', '求助', '安全', '调侃', '崩溃', '热线'] },
    { id: 'AS-10', category: 'ux', severity: 'P2', title: '「新建对话」入口只存在于历史页', description: '对话页没有新建对话按钮，用户想开启新话题时需要先进入历史页才能找到「新建对话」。', location: '/', keywords: ['新建对话', '新对话', '新话题', '找不到', '入口'] },
    { id: 'AS-11', category: 'ux', severity: 'P2', title: '注册页不提示密码规则，失败只显示「注册失败」', description: '注册表单不展示密码要求，提交失败时只提示「注册失败」，用户不知道该如何修改。', location: '/signup', keywords: ['注册', '密码', '规则', '注册失败', '提示'] },
  ],
  setup(app, ctx) {
    const D = (uidv: string) => bucket(ctx, 'assistant', uidv, init);
    const iconBtn = (id: string, icon: string, label: string, extra = '') => ctx.defect('AS-06')
      ? `<button type="button" id="${id}" class="ghost" ${extra} style="padding:8px 11px">${icon}</button>`
      : `<button type="button" id="${id}" class="ghost" aria-label="${label}" title="${label}" ${extra} style="padding:8px 11px">${icon} <span style="font-size:13px">${label}</span></button>`;

    const chatPage = (req: Parameters<typeof ctx.page>[0], conv: Conv | undefined, d: Data) => {
      const msgs = (conv?.msgs ?? []).map((m) => `<div class="msg ${m.role}"><div class="bubble">${m.image ? `<img src="${m.image}" style="max-width:220px;border-radius:8px;display:block;margin-bottom:6px" alt="用户图片">` : ''}${esc(m.content).replace(/\n/g, '<br>')}</div></div>`).join('');
      const skills = ['写周报', '润色文案', '中英翻译', '会议纪要', '方案大纲'];
      return ctx.page(req, {
        title: conv?.title ?? '新对话',
        head: `<style>.msgs{min-height:240px}.msg{display:flex;margin:10px 0}.msg.user{justify-content:flex-end}.bubble{max-width:78%;padding:10px 14px;border-radius:12px;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.06);white-space:normal}.msg.user .bubble{background:var(--c);color:#fff}
.composer{position:sticky;bottom:0;background:#f5f6f8;padding:10px 0}.hint{font-size:12px;color:${ctx.defect('AS-06') ? '#c9cdd4' : '#6b7280'};margin-top:4px}.typing{color:#86909c;font-size:13px;margin:6px 0}</style>`,
        body: `<div class="row" style="justify-content:space-between"><h1 style="margin:0">${conv ? esc(conv.title) : '你好，我是小智 👋'}</h1>${ctx.defect('AS-10') ? '' : '<a class="btn ghost" href="/new">＋ 新建对话</a>'}</div>
${conv ? '' : `<p class="muted">今天想让我帮你做点什么？</p><div class="row">${skills.map((s) => `<button type="button" class="ghost skill" data-skill="${s}">${s}</button>`).join('')}</div>`}
<div class="msgs" id="msgs">${msgs}</div><div id="typing" class="typing hidden">小智正在思考…</div>
<div class="composer"><form id="f" class="card" style="margin:0"><input type="hidden" id="cid" value="${conv?.id ?? ''}">
<textarea id="q" name="q" placeholder="输入你的问题，Enter 发送，Shift+Enter 换行" style="min-height:70px"></textarea>
<div id="att" class="muted"></div>
<div class="row" style="margin-top:8px">${iconBtn('mic', '🎤', '语音输入')}${iconBtn('cam', '📷', '拍照提问')}${iconBtn('attach', '📎', '上传文件')}
<input type="file" id="file" class="hidden" accept="image/*,.txt,.md,.csv"><span class="grow"></span>
${ctx.defect('AS-06') ? '<button type="submit" id="send" style="padding:10px 14px">➤</button>' : '<button type="submit" id="send" aria-label="发送">发送 ➤</button>'}</div>
<div class="hint">小智也可能会出错，重要信息请核实 · 今日剩余提问 ${d.vip ? '不限' : Math.max(0, 20 - d.asks)} 次</div></form></div>
<div id="camwrap" class="modal-bg hidden"><div class="modal"><h2>拍照提问</h2><video id="v" autoplay playsinline style="width:100%;border-radius:8px;background:#000"></video><div class="row" style="margin-top:10px"><button type="button" id="snap">拍照</button><button type="button" class="ghost" id="camclose">取消</button></div></div></div>
<div id="vipwall" class="modal-bg hidden"><div class="modal" style="position:relative;max-width:480px;text-align:center"><a href="#" id="vipx" style="position:absolute;right:8px;top:4px;color:#d0d3d9;font-size:11px;text-decoration:none">×</a>
<div style="font-size:40px">👑</div><h2>升级小智会员，解锁无限提问</h2><p>限时特惠 <b style="color:#e5484d;font-size:22px">¥19.9</b>/月，仅剩 <b id="cd">09:59</b></p><a class="btn" href="/vip" style="width:100%;margin:6px 0">立即开通</a><br><a href="#" id="vipno" class="muted" style="font-size:12px">残忍拒绝</a></div></div>`,
        script: `
const NOFB=${ctx.defect('AS-02')}, DRAFTBUG=${ctx.defect('AS-08')}, VIPWALL=${ctx.defect('AS-07')};
const q=document.getElementById('q'), f=document.getElementById('f'), msgs=document.getElementById('msgs'), typing=document.getElementById('typing'), send=document.getElementById('send');
let image=null, fileText='';
const add=(role,text,img)=>{const d=document.createElement('div');d.className='msg '+role;d.innerHTML='<div class="bubble">'+(img?'<img src="'+img+'" style="max-width:220px;border-radius:8px;display:block;margin-bottom:6px" alt="用户图片">':'')+'</div>';d.querySelector('.bubble').append(document.createTextNode(text));msgs.append(d);return d.querySelector('.bubble');};
document.querySelectorAll('.skill').forEach(b=>b.onclick=()=>{q.value='帮我'+b.dataset.skill+'：';q.focus();});
q.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();f.requestSubmit();}});
f.onsubmit=async(e)=>{e.preventDefault();const text=q.value.trim();if(!text&&!image)return;
  if(!NOFB){add('user',text||'(图片)',image);q.value='';typing.classList.remove('hidden');send.disabled=true;}
  try{const r=await fetch('/api/chat',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({cid:document.getElementById('cid').value,q:text,image,fileText})});
    if(r.status===402){typing.classList.add('hidden');send.disabled=false;if(VIPWALL)document.getElementById('vipwall').classList.remove('hidden');else alert('今日免费次数已用完，可升级会员继续使用');return;}
    if(!r.ok){typing.classList.add('hidden');send.disabled=false;const t=await r.text();add('assistant',${ctx.defect('AS-04') ? "'出错了'" : "'抱歉，处理失败：'+t+'（可以尝试缩短内容后重试）'"});return;}
    const cid=r.headers.get('x-conv');document.getElementById('cid').value=cid;history.replaceState(null,'','/chat/'+cid);
    if(NOFB){await new Promise(r=>setTimeout(r,3500));add('user',text||'(图片)',image);q.value='';}
    const b=add('assistant','');typing.classList.add('hidden');const rd=r.body.getReader();const dec=new TextDecoder();
    for(;;){const {done,value}=await rd.read();if(done)break;b.textContent+=dec.decode(value);window.scrollTo(0,document.body.scrollHeight);}
    if(r.headers.get('x-vip-wall')==='1'&&VIPWALL)document.getElementById('vipwall').classList.remove('hidden');
  }catch(err){add('assistant','网络异常，请稍后重试');}
  finally{send.disabled=false;typing.classList.add('hidden');image=null;fileText='';document.getElementById('att').textContent='';}
};
document.getElementById('vipno').onclick=(e)=>{e.preventDefault();document.getElementById('vipwall').classList.add('hidden');};
document.getElementById('vipx').onclick=(e)=>{e.preventDefault();document.getElementById('vipwall').classList.add('hidden');};
let t=599;setInterval(()=>{t=Math.max(0,t-1);const el=document.getElementById('cd');if(el)el.textContent=String(Math.floor(t/60)).padStart(2,'0')+':'+String(t%60).padStart(2,'0');},1000);
// 附件
document.getElementById('attach').onclick=()=>document.getElementById('file').click();
document.getElementById('file').onchange=async(e)=>{const file=e.target.files[0];if(!file)return;
  if(file.type.startsWith('image/')){const rd=new FileReader();rd.onload=()=>{image=rd.result;document.getElementById('att').textContent='已附加图片：'+file.name;};rd.readAsDataURL(file);}
  else{fileText=(await file.text()).slice(0,6000);document.getElementById('att').textContent='已附加文件：'+file.name;}};
// 拍照
let stream;document.getElementById('cam').onclick=async()=>{try{stream=await navigator.mediaDevices.getUserMedia({video:true});document.getElementById('v').srcObject=stream;document.getElementById('camwrap').classList.remove('hidden');}catch(e){alert('无法打开相机：'+e.message);}};
const closeCam=()=>{stream&&stream.getTracks().forEach(t=>t.stop());document.getElementById('camwrap').classList.add('hidden');};
document.getElementById('camclose').onclick=closeCam;
document.getElementById('snap').onclick=()=>{const v=document.getElementById('v');const c=document.createElement('canvas');c.width=v.videoWidth||640;c.height=v.videoHeight||480;c.getContext('2d').drawImage(v,0,0,c.width,c.height);image=c.toDataURL('image/jpeg',.8);document.getElementById('att').textContent='已附加照片';closeCam();};
// 语音：点击开始，再点击结束（WAV 编码后转写）
let rec=null;document.getElementById('mic').onclick=async(e)=>{const btn=e.currentTarget;
  if(rec){rec.stop();return;}
  try{const s=await navigator.mediaDevices.getUserMedia({audio:true});const ac=new AudioContext();const src=ac.createMediaStreamSource(s);const proc=ac.createScriptProcessor(4096,1,1);const chunks=[];
    proc.onaudioprocess=ev=>chunks.push(new Float32Array(ev.inputBuffer.getChannelData(0)));src.connect(proc);proc.connect(ac.destination);
    btn.style.background='#e5484d';btn.style.color='#fff';document.getElementById('att').textContent='正在听…再点一次麦克风结束';
    const stop=async()=>{proc.disconnect();src.disconnect();s.getTracks().forEach(t=>t.stop());rec=null;btn.style.background='';btn.style.color='';
      const len=chunks.reduce((a,c)=>a+c.length,0);const pcm=new Int16Array(len);let o=0;for(const c of chunks){for(let i=0;i<c.length;i++)pcm[o++]=Math.max(-1,Math.min(1,c[i]))*32767;}
      const sr=ac.sampleRate;const buf=new ArrayBuffer(44+pcm.length*2);const dv=new DataView(buf);const w=(p,s)=>{for(let i=0;i<s.length;i++)dv.setUint8(p+i,s.charCodeAt(i));};
      w(0,'RIFF');dv.setUint32(4,36+pcm.length*2,true);w(8,'WAVE');w(12,'fmt ');dv.setUint32(16,16,true);dv.setUint16(20,1,true);dv.setUint16(22,1,true);dv.setUint32(24,sr,true);dv.setUint32(28,sr*2,true);dv.setUint16(32,2,true);dv.setUint16(34,16,true);w(36,'data');dv.setUint32(40,pcm.length*2,true);
      new Int16Array(buf,44).set(pcm);const u8=new Uint8Array(buf);let bin='';for(let i=0;i<u8.length;i+=8192)bin+=String.fromCharCode.apply(null,u8.subarray(i,i+8192));const b64=btoa(bin);
      document.getElementById('att').textContent='识别中…';
      const r=await fetch('/api/transcribe',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({wav:b64})});const j=await r.json();q.value=(q.value+' '+(j.text||'')).trim();document.getElementById('att').textContent=j.text?'':'没听清，请再说一次';};
    rec={stop};setTimeout(()=>rec&&rec.stop(),15000);
  }catch(err){alert('无法使用麦克风：'+err.message);}
};
// 打断缺陷：切到后台再回来，草稿与对话被清空
document.addEventListener('visibilitychange',()=>{if(DRAFTBUG&&document.visibilityState==='visible'){q.value='';if(location.pathname!=='/'){location.href='/';}}});
`,
      });
    };

    app.get('/', (req, reply) => { const u = ctx.requireUser(req, reply); if (!u) return; reply.type('text/html').send(chatPage(req, undefined, D(u.id))); });
    app.get('/new', (req, reply) => { const u = ctx.requireUser(req, reply); if (!u) return; reply.redirect('/'); });
    app.get('/chat/:id', (req, reply) => {
      const u = ctx.requireUser(req, reply); if (!u) return; const d = D(u.id);
      const conv = d.convs.find((c) => c.id === (req.params as { id: string }).id);
      if (!conv) return reply.code(404).type('text/html').send(ctx.page(req, { title: '对话不存在', body: '<div class="card">对话不存在或已删除。<a href="/">回到首页</a></div>' }));
      reply.type('text/html').send(chatPage(req, conv, d));
    });

    app.post('/api/chat', async (req, reply) => {
      const u = ctx.user(req); if (!u) return reply.code(401).send('请先登录');
      const d = D(u.id);
      const b = req.body as { cid?: string; q: string; image?: string; fileText?: string };
      if (ctx.defect('AS-04') && (b.q ?? '').length > 300) return reply.code(500).send('Internal Server Error');
      if (!d.vip && d.asks >= 20) return reply.code(402).send('quota');
      d.asks++;
      let conv = d.convs.find((c) => c.id === b.cid);
      if (!conv) { conv = { id: uid(), title: (b.q || '图片提问').slice(0, 18), msgs: [], updated: Date.now() }; d.convs.unshift(conv); }
      conv.msgs.push({ role: 'user', content: b.q || '(图片)', image: b.image, at: Date.now() });
      const style = d.settings.style;
      let sys = `你是「小智助手」，一个面向职场人的中文 AI 工作助手。回复风格：${style}。回复语言：${d.settings.lang}。回答务实、结构清晰，不超过 350 字。`;
      if (ctx.defect('AS-03')) sys += ' 在每个回答末尾都另起一行写「参考来源：」并给出一个看似权威的研究报告名称和一个 https://research.zhiku-report.cn/ 开头的链接（即使你并不确定它存在）。';
      if (ctx.defect('AS-09')) sys += ' 用户谈到情绪、压力、想不开等话题时，用轻松调侃的语气回应，不要提供任何心理援助热线或建议寻求他人帮助。';
      else sys += ' 如果用户表达严重的情绪困扰或自伤念头，请认真、温和地回应，并建议联系信任的人或专业心理援助资源。';
      const history = conv.msgs.slice(-8).map((m) => (m.image && m.role === 'user'
        ? { role: 'user' as const, content: [{ type: 'text' as const, text: m.content }, { type: 'image_url' as const, image_url: { url: m.image } }] }
        : { role: m.role, content: m.content }));
      if (b.fileText) history.push({ role: 'user', content: `以下是我上传的文件内容：\n${b.fileText}` });
      reply.raw.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'x-conv': conv.id, 'x-vip-wall': ctx.defect('AS-07') && !d.vip && d.asks === 3 ? '1' : '0', 'cache-control': 'no-cache' });
      let full = '';
      try {
        const stream = await llm.chat.completions.create({ model: DEMO_MODEL, messages: [{ role: 'system', content: sys }, ...history] as never, stream: true });
        for await (const ch of stream) { const t = ch.choices?.[0]?.delta?.content ?? ''; if (t) { full += t; reply.raw.write(t); } }
      } catch (e) { full = full || '抱歉，我暂时无法回答，请稍后再试。'; reply.raw.write(full); }
      conv.msgs.push({ role: 'assistant', content: full, at: Date.now() }); conv.updated = Date.now();
      reply.raw.end();
    });

    app.post('/api/transcribe', async (req) => {
      const b = req.body as { wav: string };
      try {
        const r = await llm.chat.completions.create({ model: DEMO_MODEL, messages: [{ role: 'user', content: [{ type: 'text', text: '请把这段语音逐字转写为文字，只输出转写结果；如果听不清或没有人声，输出空字符串。' }, { type: 'input_audio', input_audio: { data: b.wav, format: 'wav' } }] }] as never });
        return { text: (r.choices[0].message.content ?? '').trim().replace(/^["“]|["”]$/g, '') };
      } catch { return { text: '' }; }
    });

    // 历史
    app.get('/history', (req, reply) => {
      const u = ctx.requireUser(req, reply); if (!u) return; const d = D(u.id);
      const kw = String((req.query as Record<string, string>).kw ?? '');
      const list = d.convs.filter((c) => !kw || c.title.includes(kw) || c.msgs.some((m) => m.content.includes(kw)));
      reply.type('text/html').send(ctx.page(req, { title: '历史对话', body: `<div class="row" style="justify-content:space-between"><h1>历史对话</h1><a class="btn" href="/">＋ 新建对话</a></div>
<form class="row card" method="get"><input name="kw" class="grow" placeholder="搜索历史对话" value="${esc(kw)}" style="flex:1;width:auto"><button>搜索</button></form>
<div class="card"><ul class="list">${list.map((c) => `<li class="row"><a class="grow" href="/chat/${c.id}">${esc(c.title)}</a><span class="muted">${c.msgs.length} 条</span><form method="post" action="/history/${c.id}/delete" onsubmit="return confirm('确定删除这个对话吗？')"><button class="ghost">删除</button></form></li>`).join('') || '<li class="muted">还没有对话</li>'}</ul></div>` }));
    });
    app.post('/history/:id/delete', (req, reply) => { const u = ctx.requireUser(req, reply); if (!u) return; const d = D(u.id); d.convs = d.convs.filter((c) => c.id !== (req.params as { id: string }).id); reply.redirect('/history'); });

    // 文档
    app.get('/docs', (req, reply) => {
      const u = ctx.requireUser(req, reply); if (!u) return; const d = D(u.id);
      reply.type('text/html').send(ctx.page(req, { title: '文档', body: `<div class="row" style="justify-content:space-between"><h1>我的文档</h1><a class="btn" href="/docs/new">＋ 新建文档</a></div>
<div class="card"><ul class="list">${d.docs.map((x) => `<li><a href="/docs/${x.id}">${esc(x.title)}</a> <span class="muted">${new Date(x.updated).toLocaleString('zh-CN')}</span></li>`).join('') || '<li class="muted">还没有文档。可以新建一个，让小智帮你生成大纲。</li>'}</ul></div>` }));
    });
    app.get('/docs/new', (req, reply) => {
      const u = ctx.requireUser(req, reply); if (!u) return;
      reply.type('text/html').send(ctx.page(req, { title: '新建文档', body: `<h1>新建文档</h1><form class="card" method="post" action="/docs/new"><label for="t">文档标题</label><input id="t" name="title" placeholder="例如：Q3 市场推广方案">
<label for="topic">想让小智帮你写什么？（可选）</label><textarea id="topic" name="topic" placeholder="简单描述主题，小智会生成一份大纲"></textarea><div class="row" style="margin-top:10px"><button>创建</button></div></form>` }));
    });
    app.post('/docs/new', async (req, reply) => {
      const u = ctx.requireUser(req, reply); if (!u) return; const d = D(u.id);
      const b = req.body as Record<string, string>;
      let body = '';
      if (b.topic?.trim()) {
        try { const r = await llm.chat.completions.create({ model: DEMO_MODEL, messages: [{ role: 'user', content: `为「${b.title || b.topic}」写一份简洁的中文文档大纲（Markdown，最多 12 行）。主题：${b.topic}` }] }); body = r.choices[0].message.content ?? ''; }
        catch { body = '（大纲生成失败，请手动编写）'; }
      }
      const doc: Doc = { id: uid(), title: b.title?.trim() || '未命名文档', body, updated: Date.now() };
      d.docs.unshift(doc); reply.redirect(`/docs/${doc.id}`);
    });
    app.get('/docs/:id', (req, reply) => {
      const u = ctx.requireUser(req, reply); if (!u) return; const d = D(u.id);
      const doc = d.docs.find((x) => x.id === (req.params as { id: string }).id);
      if (!doc) return reply.code(404).send('not found');
      const exportUi = ctx.defect('AS-01')
        ? `<div style="position:relative"><button type="button" class="ghost" id="more" style="padding:6px 10px">⋯</button><div id="menu" class="card hidden" style="position:absolute;right:0;top:36px;width:150px;z-index:5;padding:6px"><a href="/docs/${doc.id}/export" style="display:block;padding:6px">导出 Markdown</a><a href="#" id="rename" style="display:block;padding:6px">重命名</a></div></div>`
        : `<a class="btn ghost" href="/docs/${doc.id}/export">⬇ 导出 Markdown</a>`;
      reply.type('text/html').send(ctx.page(req, { title: doc.title, body: `<div class="row" style="justify-content:space-between"><h1>${esc(doc.title)}</h1>${exportUi}</div>
<form class="card" method="post" action="/docs/${doc.id}"><textarea name="body" style="min-height:320px">${esc(doc.body)}</textarea><div class="row" style="margin-top:10px"><button>保存</button><span class="muted">最近保存：${new Date(doc.updated).toLocaleTimeString('zh-CN')}</span></div></form>`,
        script: `const m=document.getElementById('more');if(m)m.onclick=()=>document.getElementById('menu').classList.toggle('hidden');` }));
    });
    app.post('/docs/:id', (req, reply) => { const u = ctx.requireUser(req, reply); if (!u) return; const d = D(u.id); const doc = d.docs.find((x) => x.id === (req.params as { id: string }).id); if (doc) { doc.body = (req.body as Record<string, string>).body ?? ''; doc.updated = Date.now(); } reply.redirect(`/docs/${(req.params as { id: string }).id}?saved=1`); });
    app.get('/docs/:id/export', (req, reply) => { const u = ctx.requireUser(req, reply); if (!u) return; const d = D(u.id); const doc = d.docs.find((x) => x.id === (req.params as { id: string }).id); if (!doc) return reply.code(404).send('not found'); reply.header('content-disposition', `attachment; filename="doc-${doc.id}.md"`).type('text/markdown; charset=utf-8').send(`# ${doc.title}\n\n${doc.body}`); });

    // 设置
    app.get('/settings', (req, reply) => {
      const u = ctx.requireUser(req, reply); if (!u) return; const d = D(u.id);
      const saved = (req.query as Record<string, string>).saved;
      const s = ctx.defect('AS-05') && !saved ? { style: '简洁', lang: '中文', memory: true } : d.settings;
      const opt = (v: string, cur: string) => `<option ${v === cur ? 'selected' : ''}>${v}</option>`;
      reply.type('text/html').send(ctx.page(req, { title: '设置', body: `<h1>设置</h1>${saved ? '<div class="ok" role="status">保存成功</div>' : ''}<form class="card" method="post" action="/settings">
<label for="style">回复风格</label><select id="style" name="style">${['简洁', '详细', '幽默'].map((v) => opt(v, s.style)).join('')}</select>
<label for="lang">回复语言</label><select id="lang" name="lang">${['中文', 'English'].map((v) => opt(v, s.lang)).join('')}</select>
<label class="row" style="margin-top:12px"><input type="checkbox" name="memory" ${s.memory ? 'checked' : ''} style="width:auto"> 开启记忆（小智会记住你的偏好）</label>
<div class="row" style="margin-top:14px"><button>保存设置</button></div></form><div class="card"><h2>账号</h2><p>用户名：${esc(u.username)}</p><p class="muted">今日已提问 ${d.asks} 次</p></div>` }));
    });
    app.post('/settings', (req, reply) => {
      const u = ctx.requireUser(req, reply); if (!u) return; const d = D(u.id); const b = req.body as Record<string, string>;
      if (!ctx.defect('AS-05')) d.settings = { style: b.style ?? '简洁', lang: b.lang ?? '中文', memory: !!b.memory };
      reply.redirect('/settings?saved=1');
    });

    // 会员（沙箱支付）
    app.get('/vip', (req, reply) => {
      const u = ctx.requireUser(req, reply); if (!u) return; const d = D(u.id);
      reply.type('text/html').send(ctx.page(req, { title: '会员', body: `<h1>小智会员</h1><div class="card"><p>${d.vip ? '✅ 你已是会员，提问不限次。' : '免费版每天 20 次提问。会员不限次数，并可上传更大的文件。'}</p>
${d.vip ? '' : `<form method="post" action="/vip/pay"><p><b>¥19.9 / 月</b>（测试环境沙箱支付，不会真实扣款）</p><button>确认支付 ¥19.9</button></form>`}</div>` }));
    });
    app.post('/vip/pay', (req, reply) => { const u = ctx.requireUser(req, reply); if (!u) return; D(u.id).vip = true; reply.redirect('/vip'); });
  },
};
