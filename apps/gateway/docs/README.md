# @pux/gateway

单端口复用网关：`pnpm gateway`（`JW_HOST`/`JW_PORT`，默认 `0.0.0.0:7777`）。

读取每个连接的首包后决定去向（`src/sniff.ts`）：

| 首包 | 去向 |
|---|---|
| HTTP 方法（`GET `、`POST` …，含 WebSocket 升级） | API（`API_PORT`，默认 127.0.0.1:5320） |
| Terraria `ConnectRequest`（类型 1），版本串以 `Terraria` 开头 | TShock（`TSHOCK_HOST`/`TSHOCK_PORT`，默认 127.0.0.1:57777） |
| 版本串以 `tModLoader` 开头 | tModLoader 服务端（`TML_HOST`/`TML_PORT`，默认 127.0.0.1:57778） |
| 其他（含 TLS）或 5 秒内无法判定 | 断开 |

之后原样双向转发（首包会先补发给上游）。网关不终止 TLS，也不改写 HTTP 头。
