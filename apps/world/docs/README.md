# @pux/world

JobsWorld 世界服务。启动：`pnpm world`（需要 `docker compose up -d nats`）。规则与契约在 `packages/jobsworld`。

- **时钟**：默认与现实 1:1；`jw.cmd.clock` 可暂停、调速（≤600×）、跳转。状态保存在 NATS KV `jobsworld.clock`，并每 5 秒写入 Postgres `world_kv`（引擎不连 NATS 也能读到）。有人正在使用产品时最多按 4× 推进：一次使用按自己的节奏走，世界不能跑到它前面太远。
- **居民**：`residents` / `households` 表里登记的每个人都住在城里（现有 201 人、113 户）。日程按职业大类和工作地点生成（`agendaFor`），周末不上班。
- **需求**：每个人的饿、精力、孤单、压力、心情每个世界分钟按规则推进（`tickNeeds`），并临时改写日程（`needOverride`）：饿极了去吃东西、困了早睡、闷了找人聊。在外面吃饭花钱，发薪日入账。需求与钱包每 30 秒落库。
- **日程意图补全**：只在需要时调用模型（有人点开这个人，或他开始使用产品），不为所有人每天各调一次。`JW_AGENDA_LLM=0` 关闭。
- **位置**：日程段 → 地点 → 落脚点（每 20 模拟分钟换一次）；通勤段沿地铁隧道或街道移动；睡觉时躺在自己家的床上。正在使用产品的人就在他处境里的那个地点。
- **Session 直播**：每 1.5 秒只读轮询 Postgres 中正在进行的 Session（状态是 `running` 但开始超过 3 小时的视为残留，不算正在使用），新步骤发布到 `jw.persona.<id>.live`，独白摘要发布到 `jw.persona.<id>.say`。
- **回放**：`jw.cmd.replay { session_id, speed }`，每 2.5 秒/倍速推进一步。
- **世界事件**：`jw.cmd.event { place_id, kind, minutes }` 写入 `world_events` 表。地点里的人会做出反应、压力上升；合并世界后，正在该地点使用产品的人会真的受到影响（断网、被打断、分心，见 `EVENT_EFFECT`）。
- **请求/应答**：`jw.town`（布局）、`jw.detail`（人物详情，含关系网）、`jw.ask`（Session 结束后的追问访谈）。
- **快照**：每秒发布 `jw.snapshot`（每个人带 `needs`、`wallet`、`phone`、`driven_by`），每 5 秒写入 KV `jobsworld.snapshot`。

环境变量：`NATS_URL`（默认 `nats://127.0.0.1:54222`）、`JW_MAX_VISIBLE`（默认 60）、`JW_AGENDA_LLM`。
