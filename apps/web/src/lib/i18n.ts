import { useSyncExternalStore } from 'react';

export type Lang = 'zh' | 'en';
const read = (): Lang => { try { return localStorage.getItem('jw.lang') === 'en' ? 'en' : 'zh'; } catch { return 'zh'; } };
let lang: Lang = read();
const subs = new Set<() => void>();
export function setLang(l: Lang) { lang = l; try { localStorage.setItem('jw.lang', l); } catch { /* */ } document.documentElement.lang = l === 'zh' ? 'zh-CN' : 'en'; for (const s of subs) s(); }
export const useLang = () => useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => lang);

const D = {
  'nav.world': ['世界', 'World'], 'nav.people': ['人', 'People'], 'nav.apps': ['软件', 'Apps'], 'nav.studies': ['评测', 'Studies'], 'nav.human': ['接管', 'Takeover'],
  'right_now': ['此刻', 'Right now'], 'ties': ['家人与熟人', 'Family and people they know'], 'need_hunger': ['饿', 'Hunger'], 'need_energy': ['精力', 'Energy'], 'need_social': ['有人说话', 'Company'], 'need_stress': ['压力', 'Stress'], 'need_mood': ['心情', 'Mood'], 'phone_at_hand': ['手机在手边', 'Phone at hand'],
  'now': ['此刻', 'Right now'], 'using': ['正在用', 'Using'], 'thinking': ['在想', 'Thinking'], 'doing': ['在做', 'Doing'], 'before': ['刚才', 'Before'], 'next': ['接下来', 'Next'],
  'action': ['操作', 'Action'], 'step': ['第 {n} 步', 'Step {n}'], 'open_person': ['看这个人', 'Open profile'], 'open_session': ['看这次使用', 'Open session'], 'replay': ['回放', 'Replay'],
  'nobody_using': ['此刻没人在用软件', 'No one is using an app right now'], 'everyone': ['所有人', 'Everyone'],
  'sessions': ['次使用', 'sessions'], 'memories': ['记忆', 'Memories'], 'history': ['用过的软件', 'Apps used'], 'today': ['今天的日程', 'Today'], 'profile': ['画像', 'Profile'],
  'family': ['家人', 'Family'], 'story': ['经历', 'Story'], 'values': ['在意', 'Values'], 'motivations': ['想要', 'Wants'], 'beliefs': ['相信', 'Believes'],
  'digital_literacy': ['数字素养', 'Digital literacy'], 'ai_familiarity': ['AI 熟悉度', 'AI familiarity'], 'trust_in_ai': ['信任 AI', 'Trusts AI'], 'privacy': ['隐私敏感', 'Privacy'], 'price': ['价格敏感', 'Price'], 'patience': ['耐心', 'Patience'],
  'generate': ['生成新人物', 'Generate people'], 'steps': ['步数', 'Steps'], 'search': ['搜索', 'Search'], 'target_user': ['目标用户', 'Target user'],
  'used_by': ['用过的人', 'Who used it'], 'target': ['原本的目标客户', 'Intended for'], 'fit': ['实际谁更适配', 'Who it actually fits'], 'voices': ['他们说', 'What they said'], 'issues': ['问题', 'Issues'], 'trend': ['走势', 'Trend'],
  'completion': ['完成率', 'Completion'], 'sus': ['SUS', 'SUS'], 'again': ['还会再用', 'Would return'], 'satisfaction': ['满意度', 'Satisfaction'],
  'verdict': ['结论', 'Verdict'], 'make_verdict': ['生成结论', 'Write verdict'], 'regen': ['重新生成', 'Regenerate'], 'stale': ['数据已更新', 'Data changed'],
  'best_for': ['最适合', 'Best for'], 'struggles_for': ['用得吃力', 'Struggles'], 'strengths': ['做得好', 'Strengths'], 'weaknesses': ['做得差', 'Weaknesses'], 'next_steps': ['下一步', 'Next steps'],
  'simulated': ['模拟估计', 'Simulated'], 'trust': ['可信度', 'Trust'], 'single_vendor': ['单一模型厂商', 'Single model vendor'],
  'run_study': ['发起评测', 'Run a study'], 'new_project': ['灌入新项目', 'Add a product'], 'sessions_n': ['Session 数', 'Sessions'], 'steps_n': ['每次步数', 'Steps each'], 'start': ['开始', 'Start'],
  'timeline': ['时间线', 'Timeline'], 'interview': ['访谈', 'Interview'], 'ask_placeholder': ['问问 Ta…', 'Ask them…'], 'ask': ['问', 'Ask'], 'judges': ['评审', 'Judges'], 'video': ['录像', 'Recording'],
  'report_html': ['完整报告', 'Full report'], 'log': ['运行日志', 'Run log'], 'confirm': ['确认', 'Confirm'], 'reject': ['驳回', 'Reject'], 'reopen': ['重开', 'Reopen'],
  'takeover': ['接管', 'Take over'], 'resolved': ['已处理', 'Done'], 'no_tasks': ['没有需要人工处理的任务', 'Nothing needs a human'],
  'passcode': ['口令', 'Passcode'], 'enter': ['进入', 'Enter'], 'bad_passcode': ['口令不对', 'Wrong passcode'], 'logout': ['退出', 'Sign out'],
  'pause': ['暂停', 'Pause'], 'resume': ['继续', 'Resume'], 'event': ['制造事件', 'Make it happen'], 'game': ['用 Terraria 进入', 'Join in Terraria'], 'copied': ['已复制', 'Copied'],
  'empty_sessions': ['还没有人用过', 'No one has used it yet'], 'loading': ['加载中', 'Loading'], 'error': ['出错了', 'Something went wrong'], 'retry': ['重试', 'Retry'],
  'all': ['全部', 'All'], 'live': ['直播中', 'Live'], 'outcome': ['结局', 'Outcome'], 'mode': ['模式', 'Mode'], 'world': ['处境', 'Situation'], 'persona': ['人物', 'Person'], 'status': ['状态', 'Status'], 'app': ['软件', 'App'], 'version': ['版本', 'Version'], 'cost': ['成本', 'Cost'],
  'expectation_broken': ['预期落空', 'Expectation broken'], 'place': ['地点', 'Place'], 'people_here': ['这里的人', 'People here'],
  'n_people': ['{n} 人', '{n} people'], 'n_sessions': ['{n} 次', '{n} runs'], 'speed': ['倍速', 'Speed'], 'home': ['家', 'Home'],
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
  live: ['此时此地', 'Here and now'],
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
