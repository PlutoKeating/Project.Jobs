# @pux/cli

装好之后的命令是 `jobsworld <command>`（仓库内开发用 `pnpm jobs <command>`；入口 `src/index.ts`）。`jobs` 这个名字只作为别名保留：它是 shell 的内建命令，在终端里直接敲不会到这里来。

| 文件 | 说明 |
|---|---|
| `src/user.ts` | 日常命令，全部经 HTTP 调本机的 Jobs 服务：`publish`、`ls`、`status`、`report`、`promote`、`invite`、`reset`（清零）、`remove`（下线，`--wipe` 连同经历一起删）、`people`、`ask`、`clock`、`mcp` |
| `src/mcp.ts` | `jobsworld mcp`：给同一台机器上的 coding agent 用的 MCP 服务（stdio，`@modelcontextprotocol/sdk`）。工具定义在 `@pux/engine/launch/tools`，与远程的 `/mcp` 同一份（`publish_product`、`list_products`、`product_status`、`product_report`、`invite_people`、`wait_for_people`、`mark_new_version`、`set_promotion`、`reset_product`、`remove_product`、`ask_person`）。Jobs 在别的机器或云端时不用它，直接把 `<JOBS_PUBLIC_URL>/mcp` 加给 agent（见 `docs/API.md` §2） |
| `src/client.ts` | HTTP 客户端（`JOBS_API`，默认 `http://127.0.0.1:7777`；`JOBS_KEY` 作为 Bearer 口令）与纯文本排版：`funnelLine`、`reportText`（终端与 coding agent 读同一份） |
| `src/index.ts` | 运维命令，直接访问数据库：`doctor`、`init`、`db`、`persona`、`world`；`dev` 分组收纳内部校准用的指派式批次（`app`、`demo`、`product`、`study`、`issue`、`calibrate`、`human`） |

详见 `jobsworld --help` 与 `docs/QUICK_START.md`。

版本号（`jobsworld -V`、MCP 服务的版本）读仓库根 `package.json`（`@pux/core` 的 `jobsVersion()`），不在这里另写。装好之后的 `jobsworld update`、`version`、`backup` 是宿主机上的壳 `deploy/jobs` 处理的，见 `docs/INSTALL.md`「升级」。
