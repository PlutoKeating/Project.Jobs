# @pux/world

JobsWorld 世界服务。启动：`pnpm world`（需要 `docker compose up -d nats`）。

- **时钟**：默认与现实 1:1；`jw.cmd.clock` 可暂停、调速（≤600×）、跳转。状态保存在 NATS KV `jobsworld.clock`。
- **日程**：每个人物每个模拟日一份（`persona_agendas` 表）。先由 `config/jobsworld/agenda.yaml` 按角色生成骨架，再用 `mind.slow` 在后台补全活动描述与意图（`JW_AGENDA_LLM=0` 关闭）。
- **位置**：规则驱动。日程段 → 地点 → 落脚点（每 20 模拟分钟换一次）；通勤段沿地铁隧道或街道移动；睡觉时躺在自己家的床上。
- **Session 直播**：每 1.5 秒只读轮询 Postgres 中 `running`/`waiting_human` 的 Session，新步骤发布到 `jw.persona.<id>.live`，独白摘要发布到 `jw.persona.<id>.say`。人物被放到 Session 世界模板对应的地点（`town.yaml` 的 `place_match`）。
- **回放**：`jw.cmd.replay { session_id, speed }`，每 2.5 秒/倍速推进一步。
- **世界事件**：`jw.cmd.event { place_id, kind, minutes }`，地点里的人会做出反应（只影响 JobsWorld 的呈现，不注入正在运行的 Session）。
- **请求/应答**：`jw.town`（布局）、`jw.detail`（人物详情）、`jw.ask`（Session 结束后的追问访谈）。
- **快照**：每秒发布 `jw.snapshot`，每 5 秒写入 KV `jobsworld.snapshot`。

环境变量：`NATS_URL`（默认 `nats://127.0.0.1:54222`）、`JW_MAX_VISIBLE`（默认 60）、`JW_AGENDA_LLM`。
