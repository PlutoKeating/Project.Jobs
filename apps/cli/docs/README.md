# @pux/cli

`jobs <command>`（仓库内 `pnpm jobs`；入口 `src/index.ts`）。

| 文件 | 说明 |
|---|---|
| `src/user.ts` | 日常命令，全部经 HTTP 调本机的 Jobs 服务：`publish`、`ls`、`status`、`report`、`promote`、`invite`、`people`、`ask`、`clock`、`mcp` |
| `src/mcp.ts` | `jobs mcp`：给 coding agent 用的 MCP 服务（stdio，`@modelcontextprotocol/sdk`）。工具：`publish_product`、`list_products`、`product_status`、`product_report`、`set_promotion`、`invite_people`、`ask_person` |
| `src/client.ts` | HTTP 客户端（`JOBS_API`，默认 `http://127.0.0.1:7777`；`JOBS_KEY` 作为 Bearer 口令）与纯文本排版：`funnelLine`、`reportText`（终端与 coding agent 读同一份） |
| `src/index.ts` | 运维命令，直接访问数据库：`doctor`、`init`、`db`、`persona`、`world`；`dev` 分组收纳内部校准用的指派式批次（`app`、`demo`、`product`、`study`、`issue`、`calibrate`、`human`） |

详见 `jobs --help` 与 `docs/QUICK_START.md`。
