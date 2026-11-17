# @pux/agent

Jobs Agent：飞书、网页聊天面板、`jobsworld chat` 共用的对话核心。决策与来由见 [`docs/DECISIONS_2026-11-17_FEISHU_AGENT.md`](../../../docs/DECISIONS_2026-11-17_FEISHU_AGENT.md)。

循环用 [Pi](https://github.com/earendil-works/pi) 的 `@earendil-works/pi-agent-core`（工具调用、`steer` 插话、`abort`、事件流）；**模型调用不走 Pi 自带的供应商**，而是经 `streamFn` 交给 `@pux/llm` 的 `gateway().converse('agent')`，所以「设置 › 模型」里的「对话」组、失败接替、花费记录都照旧。`@earendil-works/pi-ai` 只用到它的消息类型、事件流和系统提示 / 工具声明的回放函数。

| 文件 | 说明 |
|---|---|
| `src/hub.ts` | `AgentHub`：每个会话键（`feishu:<chat>[:<话题>]`、`web:<身份>`、`cli:<身份>`）同一时刻最多一轮。同一角色的人在它干活时又说话 → `steer` 插进去；角色不同 → 排队（访客借不到管理员这一轮的写权限）。`/new`、`/stop`。破坏性工具（`danger`：清零、下线）在 `beforeToolCall` 里拦下、发确认事件、记一行 `agent_actions`；`decide()` 执行（只能一次、30 分钟过期、只有管理员能确认）。`wait_for_people` 改成后台等（最多 60 分钟），等到了用渠道注册的 `proactive` 出口另起一轮。跟居民聊的模式（`talk_to_resident` 进入，「结束」退出并把聊过的内容记进对话）。对话超过门槛时把旧的压缩成摘要（「归纳」组），从一句用户的话开始保留 |
| `src/stream.ts` | Pi 的消息 ↔ 我们的对话消息（`toConv`：被停掉的工具调用补一个结果，出错的助手消息只留文字）；`makeStreamFn`：把 `converse()` 的文字增量、工具调用变成 Pi 的事件流，花费记到会话上 |
| `src/tools.ts` | Jobs 工具（`@pux/engine/launch/tools`，与 MCP、命令行同一份）→ `AgentTool`：zod → JSON Schema，按角色过滤，执行时用说话人的身份经 REST；对话里才有的工具：`show_evidence`（给用户看一张截图）、`talk_to_resident` |
| `src/prompt.ts` | 系统提示：此刻的时间、渠道、说话人与角色、已发布的产品、网页地址、主动性与确认的规矩、之前对话的摘要 |
| `src/store.ts` | `agent_sessions`、`agent_actions` 的存取（`DbStore`；测试用 `MemoryStore`）；存之前只保留最近两张图、截短旧的长工具结果 |

渠道只需要做两件事：把收到的话交给 `hub.send({ session, channel, actor, input, out })`，把 `out` 收到的事件（`start`、`text`、`step`、`image`、`confirm`、`mode`、`resident`、`notice`、`end`）画成自己的样子。
