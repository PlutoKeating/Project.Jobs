# game/tshock：JobsWorld TShock 插件

TShock 6.2.1（Terraria 1.4.5.8，原版客户端）服务端插件。总体架构、命令与验证记录见 [`../README.md`](../README.md)，这里只记 TShock 特有的实现要点。

## 文件

| 文件 | 说明 |
|---|---|
| `JobsWorld.TShock.csproj` | net9.0；`<Compile Include="../shared/**/*.cs" />` 共用源码；引用 TShock 发布包中的 `TShockAPI.dll`、`TerrariaServer.dll`、`OTAPI.dll`、`OTAPI.Runtime.dll`、`ModFramework.dll`（`Private=false`，不随插件输出） |
| `JobsWorldPlugin.cs` | 钩子、NATS 订阅、主线程消息泵、建镇、时间同步、旁观者保护 |
| `JwCommands.cs` | `/jw` 命令（中文默认，`/jw lang en` 切英文）。发布相关的四个命令交给 `shared/Personas/LaunchCommands.cs` |
| `TShockFakePlayers.cs` | `IFakePlayerHost` 实现：假玩家发包 |
| `TShockTileWriter.cs` | `ITileWriter` 实现：`Main.tile`（OTAPI `ITile`）+ `WorldGen.PlaceObject/PlaceTile/GrowTree` + `Sign` |

## 关键实现

- **主线程**：原版专用服在没有“完整连入”（State=10）的客户端时**不调用 `Main.Update`**，`GameUpdate` 钩子不触发，只调用 `Main.OnTickForThirdPartySoftwareOnly`。插件两处都挂 `Pump()`，所以空服时也能建镇、处理 NATS 消息。NATS 回调只入队，真正改世界 / 发包都在 `Pump()` 里。
- **假玩家不占服务器槽位**：`Main.player[slot].active` 始终为 `false`（原版 `Netplay` 会把无连接的槽位置为非活动；TShock 也假设活动玩家都有 `TSPlayer`）。只借用 `Main.player[slot]` 对象装外观和位置，用原版 `NetMessage.SendData` 序列化后发给真实客户端：`14(active=1) → 4 → 5（时装/手持，非空才发）→ 16 → 13`，之后 7.5Hz 发 `13`（静止时每 2 秒保活一次），移除时发 `14(active=0)`。服务器自己为这些槽位发出的玩家类数据包在 `NetSendData` 钩子里拦截。新玩家 `NetGreetPlayer` 时立即补发一次，3 秒后再补一次。
- **槽位**：真实玩家 `MaxSlots=16, ReservedSlots=0`（`Main.maxNetPlayers=16`，真实客户端只会落在 0–15）；假玩家从 254 向下分配，下限 `JW_FAKE_MIN_SLOT`（默认 180，最多 75 人）。
- **气泡**：`ChatHelper.BroadcastChatMessageAs(slot, NetworkText.FromLiteral(text), color)`，原版客户端把作者为玩家的聊天显示在其头顶。每人 6 秒最多一条，期间只保留最新一条待发。颜色：angry 红、confused 黄、happy 绿、neutral 白。
- **时间**：每秒按 `jw.clock.minute` 设置 `Main.dayTime/Main.time`（04:30 天亮、19:30 天黑，1 分钟 = 60 帧）并广播 `SetTime(18)`；同时关闭血月、日食。
- **旁观者保护**：进服即 `GodMode=true`（TShock 通过 Creative Powers 同步给客户端）；配置 `PvPMode=disabled`、`DefaultMaximumSpawns=0`、`DisableBuild=true`、关闭腐化/猩红/神圣蔓延；每 10 秒清理残留敌怪。`/jw login <口令>` 成功后本次连接获得 `jobsworld.admin` 与 `tshock.admin.antibuild`（可建造）。也可以给 TShock 用户组加 `jobsworld.admin` 权限。
- **建镇标记**：世界目录下 `<世界名>.jobsworld.json` 记录 `version`（布局版本）、`builder`（`TownBuilder.BuilderVersion`）与原点。两者一致则跳过；否则按原点重建（首次以出生点为中心、取地表中位数），保存世界并让在线客户端重新接收图格分区。

## 本地编译（不需要在宿主机装 .NET）

```bash
# 把 TShock 发布包解压到 game/tshock/.tshock/（已 gitignore），或直接用镜像构建
docker run --rm -v "$PWD/game:/src/game" -v "$PWD/game/tshock/.tshock:/tshock:ro" -w /src/game/tshock \
  mcr.microsoft.com/dotnet/sdk:9.0 dotnet build -c Release -p:TShockDir=/tshock/
```

## 运行时环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `NATS_URL` | `nats://127.0.0.1:4222`（compose 中为 `nats://nats:4222`） | 世界服务所在 NATS |
| `JW_ADMIN_PASSCODE` | 空 | `/jw login` 口令，空则禁用（装好的 Jobs 里就是管理员口令） |
| `JW_GAME_PASSWORD` | 空 | 游戏服密码（写入 TShock `ServerPassword`；装好的 Jobs 安装时随机生成，`jobsworld passcode` 可查） |
| `JW_WORLD_NAME` / `JW_WORLD_FILE` / `JW_WORLD_SIZE` | `JobsWorld` / `jobsworld` / `1` | 世界名、文件名、自动创建尺寸（1 小 / 2 中 / 3 大） |
| `JW_MAX_PLAYERS` | `16` | 真实玩家上限（TShock `MaxSlots`） |
| `JW_FAKE_TOP_SLOT` / `JW_FAKE_MIN_SLOT` | `254` / `180` | 假玩家槽位范围 |
| `JW_SCHEMATICS_DIR` | `/server/schematics` | `.TEditSch` 目录 |
