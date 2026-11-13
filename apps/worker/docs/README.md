# @pux/worker（Temporal 编排）

- `workflows.ts`：`studyWorkflow`（多轮：规划 → 子工作流并发执行 → 合成 → 饱和判断 → 回访 → 收尾）、`sessionWorkflow`（逐步执行；needs_human 时用 `condition` 等待 `humanResolved` Signal，超时记为 blocked）。
- `activities.ts`：规划、Session 启停与单步（Step = Activity，带 heartbeat）、评估、合成、收尾。
- 浏览器状态只存在于持有它的 worker 进程内：`claimHost()` 返回本进程专属队列（`pux-host-<hostname>-<pid>`），Session 的所有步骤都调度到该队列。worker 重启时正在进行的 Session 记为 sim_error。
- `client.ts`：`submitStudy`（workflowId = `study-<id>`，天然幂等）、`signalHuman`。

启动：`pnpm worker`；提交：`pnpm pux study run <id> --temporal`；UI：`http://127.0.0.1:58233`。
