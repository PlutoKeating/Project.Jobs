import { useSyncExternalStore } from 'react';

export type Lang = 'zh' | 'en';
const read = (): Lang => { try { return localStorage.getItem('jw.lang') === 'en' ? 'en' : 'zh'; } catch { return 'zh'; } };
let lang: Lang = read();
const subs = new Set<() => void>();
export function setLang(l: Lang) { lang = l; try { localStorage.setItem('jw.lang', l); } catch { /* */ } document.documentElement.lang = l === 'zh' ? 'zh-CN' : 'en'; for (const s of subs) s(); }
export const useLang = () => useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => lang);

const D = {
  'nav.world': ['城', 'City'], 'nav.products': ['产品', 'Products'], 'nav.people': ['人', 'People'], 'nav.human': ['接管', 'Takeover'],
  'publish': ['发布', 'Publish'], 'publish_title': ['发布到 JobsWorld', 'Publish to JobsWorld'], 'publishing': ['发布中…', 'Publishing…'], 'cancel': ['取消', 'Cancel'], 'f_url': ['网址', 'URL'], 'f_name': ['名字', 'Name'], 'f_tagline': ['一句话', 'One line'],
  'f_reached': ['看到', 'Saw it'], 'f_noticed': ['注意到', 'Noticed'], 'f_interested': ['有兴趣', 'Interested'], 'f_opened': ['打开过', 'Opened'], 'f_came_back': ['回来再用', 'Came back'], 'funnel': ['人数', 'People'], 'rating': ['评分', 'Rating'],
  'simulated_hint': ['这座城里实际发生的人数，不是对真实市场的预测', 'Head counts from this simulated city, not a forecast of the real market'], 'using_n': ['{n} 人在用', '{n} using it'], 'st_paused': ['已暂停', 'Paused'], 'st_ended': ['已结束', 'Ended'], 'no_products': ['还没有发布过产品', 'Nothing published yet'],
  'promotion': ['宣发强度', 'Promotion'], 'audience': ['投给谁', 'Audience'], 'age_min': ['最小年龄', 'Youngest'], 'age_max': ['最大年龄', 'Oldest'], 'years_old': ['岁', 'yrs'], 'anyone': ['任何人', 'Anyone'],
  'hand_phone': ['把手机递给几个人', 'Hand it to a few people'], 'hand_over': ['递过去', 'Hand it over'], 'invited_n': ['已请 {n} 人', '{n} invited'], 'want': ['想请他们做的一件事（可不填）', 'One thing to try (optional)'],
  'summarizing': ['正在归纳大家的反应…', 'Reading what people did…'], 'resummarize': ['重新归纳', 'Rewrite'], 'refreshing_report': ['有新的使用，正在重新归纳', 'New uses came in; rewriting'], 'used_n': ['{n} 人用过', '{n} used it'], 'one_thing': ['如果只改一件事', 'If you fix one thing'],
  'hurts': ['最让人难受的地方', 'What hurt most'], 'delights': ['让人高兴的地方', 'What delighted'], 'who_stays': ['会留下的人', 'Who stays'], 'who_leaves': ['会走的人', 'Who leaves'], 'why_not_opened': ['看到了却没点开', 'Saw it, did not open it'],
  'used_it': ['用过的人', 'Used it'], 'walked_past': ['注意到了没点开', 'Noticed, did not open'], 'visit_n': ['第 {n} 次', 'Visit {n}'], 'show_all': ['全部 {n} 人', 'All {n}'], 'voices': ['口碑', 'Word of mouth'], 'engineering': ['工程附录', 'Engineering'],
  'store_page': ['商店页', 'Store page'], 'no_rating': ['还没有评分', 'No ratings yet'], 'reviews': ['评论', 'Reviews'], 'no_reviews': ['还没有人评论', 'No reviews yet'], 'posts': ['动态', 'Posts'],
  'experienced': ['他们亲身遇到的问题', 'Problems people ran into'], 'unseen': ['他们看不到的技术信号', 'Technical signals they never saw'], 'reproduced': ['已复现', 'Reproduced'], 'no_issues': ['还没有发现问题', 'No issues found yet'], 'spent': ['已花', 'Spent'], 'end': ['结束', 'End'],
  'feishu': ['飞书', 'Feishu / Lark'], 'fs_connect': ['用飞书扫码接入', 'Connect by scanning with Feishu'], 'fs_scan': ['用飞书扫一扫', 'Scan with Feishu'], 'fs_connected': ['已接入', 'Connected'], 'fs_test': ['发一条试试', 'Send a test'], 'fs_sent': ['已发送', 'Sent'], 'fs_disconnect': ['断开', 'Disconnect'],
  'agents': ['接入 coding agent', 'Connect a coding agent'], 'ag_granted': ['已授权', 'Authorized'], 'ag_admin': ['管理员', 'admin'], 'ag_viewer': ['访客', 'viewer'], 'ag_last_used': ['最近使用 {t}', 'Last used {t}'], 'ag_revoke': ['撤销授权', 'Revoke'],
  'ag_local_only': ['只有这台机器上的 agent 能连上。要让别处接入，把 JOBS_PUBLIC_URL 设成对外的 https 地址', 'Only agents on this machine can connect. Set JOBS_PUBLIC_URL to the public https address to allow others'], 'ag_disabled': ['JOBS_PUBLIC_URL 需要是 https 地址，远程接入未启用', 'JOBS_PUBLIC_URL must be an https URL; remote access is off'],
  'examples': ['示例', 'Examples'], 'g_tshock': ['Terraria（原版）', 'Terraria (vanilla)'], 'g_tml': ['tModLoader', 'tModLoader'], 'g_run': ['在装了 Jobs 的机器上运行', 'Run on the machine where Jobs is installed'],
  'nav.models': ['模型', 'Models'], 'm_title': ['模型', 'Models'], 'm_save': ['保存', 'Save'], 'm_saving': ['保存中…', 'Saving…'], 'm_discard': ['放弃改动', 'Discard'], 'm_confirm': ['确认保存', 'Confirm'], 'm_back': ['返回', 'Back'],
  'm_dirty': ['有未保存的改动', 'Unsaved changes'], 'm_version': ['第 {n} 版', 'Version {n}'], 'm_behind': ['{who} 还在第 {n} 版', '{who} still on version {n}'], 'm_conflict': ['别人刚保存了第 {n} 版', 'Someone just saved version {n}'], 'm_take_theirs': ['载入最新版本', 'Load the latest'], 'm_keep_mine': ['以我的草稿为准', 'Keep my draft'],
  'm_use_step': ['每一步', 'Every step'], 'm_use_think': ['归纳', 'Summaries'], 'm_use_locate': ['定位', 'Locating'], 'm_use_embed': ['向量', 'Embeddings'], 'm_use_image': ['画图', 'Images'], 'm_none': ['没有可用的模型', 'No model available'],
  'm_add': ['添加供应商', 'Add a provider'], 'm_custom': ['自定义连接', 'Custom connection'], 'm_search_provider': ['搜索供应商', 'Search providers'], 'm_from_catalog': ['来自目录 · {d}', 'From catalog · {d}'], 'm_refresh': ['更新目录', 'Refresh catalog'],
  'm_conn': ['连接', 'Connection'], 'm_name': ['名字', 'Name'], 'm_base': ['地址', 'Base URL'], 'm_protocol': ['协议', 'Protocol'], 'm_creds': ['凭证', 'Credentials'], 'm_paste_key': ['粘贴 API Key', 'Paste API key'], 'm_paste_json': ['粘贴 Google 凭证 JSON，或 {"file": "容器里的凭证文件路径"}', 'Paste Google credentials JSON, or {"file": "path to a credentials file in the container"}'], 'm_add_cred': ['加入', 'Add'], 'm_new': ['新', 'new'],
  'm_models': ['模型', 'Models'], 'm_search_model': ['搜索模型', 'Search models'], 'm_only_selected': ['仅看已选', 'Selected only'], 'm_custom_model': ['自定义模型标识', 'Custom model id'], 'm_vision': ['看图', 'Vision'], 'm_remove': ['删除连接', 'Remove connection'], 'm_more': ['还有 {n} 个，搜索以缩小范围', '{n} more — search to narrow'],
  'm_n_creds': ['{n} 把凭证', '{n} keys'], 'm_n_models': ['{n} 个模型', '{n} models'], 'm_order': ['顺序', 'Order'], 'm_test': ['测试', 'Test'], 'm_stale_test': ['待复核', 'Recheck'], 'm_history': ['版本', 'Versions'], 'm_rollback': ['回滚到这一版', 'Roll back to this'],
  'm_up': ['上移', 'Move up'], 'm_down': ['下移', 'Move down'], 'm_top': ['置顶', 'Move to top'], 'm_bottom': ['置底', 'Move to bottom'], 'm_drag': ['拖动排序', 'Drag to reorder'], 'm_moved': ['{name}：第 {n} 位', '{name}: position {n}'],
  'm_added': ['新增', 'Added'], 'm_removed': ['移除', 'Removed'], 'm_order_changed': ['顺序有变化', 'Order changed'], 'm_effective': ['此刻可用', 'Available now'], 'm_no_change': ['没有实质变化', 'No effective change'], 'm_unknown_cost': ['价格未知', 'Price unknown'],
  'right_now': ['此刻', 'Right now'], 'ties': ['家人与熟人', 'Family and people they know'], 'need_hunger': ['饿', 'Hunger'], 'need_energy': ['精力', 'Energy'], 'need_social': ['有人说话', 'Company'], 'need_stress': ['压力', 'Stress'], 'need_mood': ['心情', 'Mood'], 'phone_at_hand': ['手机在手边', 'Phone at hand'],
  'now': ['此刻', 'Right now'], 'using': ['正在用', 'Using'], 'thinking': ['在想', 'Thinking'], 'doing': ['在做', 'Doing'], 
  'action': ['操作', 'Action'], 'step': ['第 {n} 步', 'Step {n}'], 'open_person': ['看这个人', 'Open profile'], 'open_session': ['看这次使用', 'Open session'], 'replay': ['回放', 'Replay'],
  'nobody_using': ['此刻没人在用软件', 'No one is using an app right now'], 'everyone': ['所有人', 'Everyone'],
  'sessions': ['次使用', 'sessions'], 'memories': ['记忆', 'Memories'], 'history': ['用过的软件', 'Apps used'], 'today': ['今天的日程', 'Today'], 'profile': ['画像', 'Profile'],
  'family': ['家人', 'Family'], 'story': ['经历', 'Story'], 'values': ['在意', 'Values'], 'motivations': ['想要', 'Wants'], 'beliefs': ['相信', 'Believes'],
  'digital_literacy': ['数字素养', 'Digital literacy'], 'ai_familiarity': ['AI 熟悉度', 'AI familiarity'], 'trust_in_ai': ['信任 AI', 'Trusts AI'], 'privacy': ['隐私敏感', 'Privacy'], 'price': ['价格敏感', 'Price'], 'patience': ['耐心', 'Patience'],
  'generate': ['生成新人物', 'Generate people'], 'steps': ['步数', 'Steps'], 'search': ['搜索', 'Search'], 'target_user': ['目标用户', 'Target user'],
  'completion': ['完成率', 'Completion'], 'again': ['还会再用', 'Would return'], 
  'verdict': ['结论', 'Verdict'], 
  'simulated': ['模拟估计', 'Simulated'], 
  'timeline': ['时间线', 'Timeline'], 'interview': ['访谈', 'Interview'], 'ask_placeholder': ['问问 Ta…', 'Ask them…'], 'ask': ['问', 'Ask'], 'judges': ['评审', 'Judges'], 
  'takeover': ['接管', 'Take over'], 'resolved': ['已处理', 'Done'], 'no_tasks': ['没有需要人工处理的任务', 'Nothing needs a human'],
  'passcode': ['口令', 'Passcode'], 'enter': ['进入', 'Enter'], 'bad_passcode': ['口令不对', 'Wrong passcode'], 'logout': ['退出', 'Sign out'],
  'pause': ['暂停', 'Pause'], 'resume': ['继续', 'Resume'], 'event': ['制造事件', 'Make it happen'], 'game': ['用 Terraria 进入', 'Join in Terraria'], 'copied': ['已复制', 'Copied'],
  'up_new': ['新版本 {v}', 'New {v}'], 'up_title': ['有新版本了', 'A new version is out'], 'up_from_to': ['当前 {a}，最新 {b}', 'You have {a}; latest is {b}'], 'up_notes': ['看看改了什么', 'What changed'],
  'up_now': ['立即升级', 'Update now'], 'up_hint': ['先自动备份数据库，再换上新版本；期间服务会中断几分钟，口令和数据都不变', 'Backs up the database first, then switches over. The service pauses for a few minutes; passcodes and data stay'],
  'up_manual': ['在装了 Jobs 的机器上运行这一行（升级前会自动备份数据库）', 'Run this on the machine where Jobs is installed (it backs up the database first)'],
  'up_running': ['正在升级：拉取新镜像、备份数据库、重启服务…', 'Updating: pulling, backing up, restarting…'], 'up_failed': ['升级没有成功，旧版本还在运行，数据没有动', 'The update failed. The old version is still running and data is untouched'],
  'up_slow': ['比预想的久。可以在那台机器上运行 jobsworld logs 看看', 'Taking longer than expected. Run jobsworld logs on that machine'], 'up_retry': ['再试一次', 'Try again'],
  'empty_sessions': ['还没有人用过', 'No one has used it yet'], 'error': ['出错了', 'Something went wrong'], 'retry': ['重试', 'Retry'],
  'all': ['全部', 'All'], 'live': ['直播中', 'Live'], 'persona': ['人物', 'Person'], 
  'expectation_broken': ['预期落空', 'Expectation broken'], 
  'n_people': ['{n} 人', '{n} people'], 'n_sessions': ['{n} 次', '{n} runs'], 
} as const;
type Key = keyof typeof D;

export function t(key: Key, vars?: Record<string, string | number>, l: Lang = lang): string {
  let s: string = D[key][l === 'zh' ? 0 : 1];
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, String(v));
  return s;
}
export function useT() { const l = useLang(); return { t: (k: Key, v?: Record<string, string | number>) => t(k, v, l), lang: l }; }

const LABELS: Record<string, [string, string]> = {
  office_worker: ['上班族', 'Office worker'], student: ['学生', 'Student'], senior: ['长辈', 'Senior'], busy_parent: ['忙碌的父母', 'Busy parent'], skeptic: ['怀疑派', 'Skeptic'], freeloader: ['白嫖党', 'Freeloader'], expert: ['专家', 'Expert'],
  child_primary_low: ['低年级小学生', 'Young child'], child_primary_high: ['高年级小学生', 'Older child'],
  teen: ['中学生', 'Teen'], professional: ['医护与教师', 'Healthcare & teachers'], blue_collar: ['工人与司机', 'Workers & drivers'], service_worker: ['服务业', 'Service worker'], freelancer: ['自由职业', 'Freelancer'], homemaker: ['全职在家', 'Homemaker'], job_seeker: ['待业', 'Between jobs'],
  tie_spouse: ['伴侣', 'Partner'], tie_parent_child: ['亲子', 'Parent / child'], tie_grandparent: ['祖孙', 'Grandparent'], tie_sibling: ['兄弟姐妹', 'Sibling'], tie_roommate: ['室友', 'Roommate'], tie_colleague: ['同事', 'Colleague'], tie_classmate: ['同学', 'Classmate'], tie_friend: ['朋友', 'Friend'], tie_neighbor: ['邻居', 'Neighbor'],
  provider_off: ['连接已停用', 'Connection off'], no_credential: ['没有启用的凭证', 'No enabled key'], no_vision: ['不能看图', 'No vision'], cooling: ['暂时不可用', 'Cooling down'], wrong_family: ['定位方式不同', 'Different locating family'],
  auth: ['凭证无效', 'Invalid key'], not_found: ['模型不存在或无权限', 'Model not found'], rate_limit: ['限流或额度不足', 'Rate limited'], transient: ['暂时连不上', 'Temporarily unreachable'], context: ['内容太长', 'Too long'], capability: ['不支持这项能力', 'Unsupported'], content: ['被内容安全拒绝', 'Blocked'], bad_request: ['请求被拒绝', 'Rejected'],
  cap_text: ['文字', 'Text'], cap_vision: ['看图', 'Vision'], cap_json: ['结构化', 'JSON'], cap_embed: ['向量', 'Embedding'], cap_image: ['画图', 'Image'], inst_world: ['世界服务', 'World service'], inst_api: ['接口', 'API'],
  live: ['此时此地', 'Here and now'], phone: ['手机', 'Phone'], computer: ['电脑', 'Computer'],
  ch_store: ['应用商店', 'App store'], ch_ad: ['广告', 'Ad'], ch_billboard: ['广告牌', 'Billboard'], ch_feed: ['动态', 'Feed'], ch_word_of_mouth: ['熟人说起', 'Word of mouth'], ch_recall: ['自己想起', 'Remembered it'], ch_invite: ['受邀', 'Invited'],
  re_unnoticed: ['没注意', 'Did not notice'], re_ignored: ['没在意', 'Ignored it'], re_not_for_me: ['觉得不适合自己', 'Not for me'], re_curious_later: ['有点兴趣，回头再说', 'Curious, maybe later'], re_opened: ['点开了', 'Opened it'],
  v_works: ['多数人用得下去', 'Most people get through'], v_mixed: ['有人行，有人不行', 'Works for some'], v_not_yet: ['多数人用不下去', 'Most people give up'], v_too_early: ['还太早', 'Too early to say'],
  hero: ['手写', 'Handwritten'], synthetic: ['生成', 'Generated'], child: ['儿童', 'Child'],
  goal: ['有目的', 'Goal'], curiosity: ['好奇', 'Curious'], stress: ['压力下', 'Under stress'], adversarial: ['对抗', 'Adversarial'],
  success: ['完成', 'Done'], gave_up: ['放弃', 'Gave up'], resource_exhausted: ['没时间/没电了', 'Ran out'], stalled: ['卡住', 'Stalled'], blocked: ['被拦住', 'Blocked'], sim_error: ['模拟出错', 'Sim error'],
  running: ['进行中', 'Running'], waiting_human: ['等人工', 'Needs human'], finished: ['已结束', 'Finished'], evaluated: ['已评估', 'Evaluated'], planned: ['排队中', 'Planned'], failed: ['失败', 'Failed'], done: ['完成', 'Done'], created: ['已创建', 'Created'], evaluating: ['评估中', 'Evaluating'], cancelled: ['已取消', 'Cancelled'],
  open: ['待确认', 'Open'], confirmed: ['已确认', 'Confirmed'], rejected: ['已驳回', 'Rejected'], folded: ['已合并', 'Merged'],
  high: ['高', 'High'], medium: ['中', 'Medium'], low: ['低', 'Low'], unknown: ['未校准', 'Uncalibrated'], mid: ['中', 'Mid'],
  target: ['目标用户', 'Target users'], general: ['泛人群', 'General public'],
  segment: ['人群', 'Segment'], age: ['年龄', 'Age'], gender: ['性别', 'Gender'], digital_literacy: ['数字素养', 'Digital literacy'], ai_familiarity: ['AI 熟悉度', 'AI familiarity'], scenario: ['场景', 'Scenario'], mode: ['模式', 'Mode'], target_user: ['目标与否', 'Target or not'],
  recommend: ['推荐', 'Recommend'], promising: ['有潜力', 'Promising'], mixed: ['毁誉参半', 'Mixed'], not_ready: ['还不行', 'Not ready'],
  idle: ['日常', 'Daily life'], travel: ['在路上', 'On the move'], session: ['在用软件', 'Using an app'], replay: ['回放', 'Replay'],
  weak_network: ['信号变差', 'Weak signal'], crowd: ['人挤人', 'Crowded'], rain: ['下雨', 'Rain'], power_cut: ['停电', 'Power cut'], noise: ['很吵', 'Noisy'],
  home: ['家', 'Home'], school: ['学校', 'School'], park: ['公园', 'Park'], bus_stop: ['公交站', 'Bus stop'], subway: ['地铁', 'Subway'], office: ['写字楼', 'Office'], cafe: ['咖啡店', 'Café'], restaurant: ['餐馆', 'Restaurant'], shop: ['超市', 'Market'], library: ['图书馆', 'Library'], hospital: ['医院', 'Hospital'], factory: ['工厂', 'Factory'], road: ['马路', 'Road'], street: ['街上', 'Street'],
  episodic: ['经历', 'Episode'], belief: ['看法', 'Belief'], trust: ['信任', 'Trust'], habit: ['习惯', 'Habit'], commerce: ['消费', 'Spending'],
  click: ['点击', 'Click'], type: ['输入', 'Type'], scroll: ['滚动', 'Scroll'], select: ['选择', 'Select'], hover: ['悬停', 'Hover'], navigate: ['打开页面', 'Navigate'], back: ['返回', 'Back'], wait: ['等待', 'Wait'], press: ['按键', 'Press'], upload: ['上传', 'Upload'], act: ['操作', 'Act'], give_up: ['放弃', 'Give up'], help: ['求助', 'Ask for help'], step_away: ['走开一下', 'Step away'],
  timeout: ['超时', 'Timed out'], error: ['出错', 'Error'], no_effect: ['没反应', 'No effect'],
  office_deadline: ['赶方案的下午', 'Office deadline'], commute_late_boss: ['迟到的通勤早晨', 'Late commute'], en_workday: ['工作日', 'Workday'], evening_home_kid: ['带娃的晚上', 'Evening with kid'], kids_after_school: ['放学后', 'After school'], matrix_stress: ['随机压力处境', 'Random stress'], bedtime_scroll: ['睡前刷手机', 'Bedtime scroll'],
  office_home: ['上班族', 'Office'], commute: ['通勤', 'Commute'], idle_weekend: ['周末', 'Weekend'], home_evening: ['晚上在家', 'Evening at home'], bedtime: ['睡前', 'Bedtime'], lunch_break: ['午休', 'Lunch break'], matrix: ['随机处境', 'Random'], kids: ['放学后', 'After school'],
};
export function label(key: string | null | undefined, l: Lang = lang): string {
  if (!key) return '—';
  const v = LABELS[key];
  return v ? v[l === 'zh' ? 0 : 1] : key;
}
export function useLabel() { const l = useLang(); return (k: string | null | undefined) => label(k, l); }
