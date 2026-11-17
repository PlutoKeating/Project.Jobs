// 值得告诉开发者的事（一次使用结束、问题第一次出现、结论写好、需要人介入）：引擎在发生的那一刻往这里发一条。
// 世界服务把它转发到 NATS 的 jw.notice；API 进程里的推送器同时听这里（API 自己写结论时）和 NATS（世界服务里发生的）。
import { EventEmitter } from 'node:events';
import type { NoticeMsg } from '@pux/jobsworld';

const bus = new EventEmitter(); bus.setMaxListeners(20);
export function emitNotice(n: NoticeMsg) { try { bus.emit('notice', n); } catch { /* 推送出错不影响主流程 */ } }
export function onNotice(f: (n: NoticeMsg) => void) { bus.on('notice', f); return () => bus.off('notice', f); }
