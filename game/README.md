# game：JobsWorld 游戏端（TShock 插件 + 共享 C# 源码）

把世界服务（`apps/world`）通过 NATS 发布的城镇、人物、想法气泡、时钟呈现在 Terraria 里。玩家用**原版 Terraria 1.4.5.8** 客户端连入 TShock 服务器旁观；tModLoader 1.4.4 版本的 mod 后续复用 `shared/` 源码。

## 目录

```
game/
├── shared/                     # 与 tModLoader mod 共用的纯 C# 源码（无 NuGet 依赖、无 TShock/OTAPI API）
│   ├── Nats/NatsClient.cs        # 极简 NATS 核心协议客户端：CONNECT/PUB/SUB/UNSUB/MSG/HMSG/PING/PONG、请求-应答、自动重连
│   ├── Protocol/Messages.cs      # jw.* 消息 DTO（对应 packages/jobsworld/src/protocol.ts）
│   ├── Town/TownLayout.cs        # 城镇布局与图元 DTO（对应 town.ts）、建镇标记
│   ├── Town/ITileWriter.cs       # 图格写入适配接口（各游戏端各实现一份）
│   ├── Town/TileIds.cs           # 原版图格/背景墙 ID、建筑风格材质、家具映射
│   ├── Town/TownBuilder.cs       # 图元 → 程序化积木（平整、地表、建筑、窗、门、家具、树、路灯、水池、地铁…）
│   ├── Schematics/TEditSchematic.cs  # .TEditSch V4/V5 读取与粘贴（移植自 TEdit，MS-PL，许可证见 TEdit-LICENSE.txt）
│   └── Personas/                 # 假玩家调度（槽位、插值、气泡限流）、/jw 文本与时钟换算、发布相关命令（`LaunchCommands.cs`，两个游戏端共用）
├── tshock/                     # TShock 6.2.1 插件（见 tshock/README.md）
└── schematics/                 # 可入库的自制 .TEditSch 地标（构建镜像时复制进容器）
```

相关文件：`infra/game/tshock/Dockerfile`、`infra/game/tshock/entrypoint.sh`、`docker-compose.yml` 中的 `tshock` 服务（`profiles: [game]`）、`scripts/jw-probe.ts`、`scripts/download-community-assets.sh`。

## 架构

```
apps/world ──NATS──▶ jw.town（请求/应答，~84KB）  ──▶ TownBuilder ──ITileWriter──▶ 世界图格
           ──NATS──▶ jw.snapshot（1Hz）            ──▶ FakePlayerDirector ──IFakePlayerHost──▶ PlayerActive/PlayerInfo/PlayerUpdate
           ──NATS──▶ jw.persona.*.say              ──▶ 头顶气泡（以假玩家身份发聊天）
           ──NATS──▶ jw.clock（1Hz）               ──▶ Main.time / dayTime + SetTime
游戏内 /jw ──NATS──▶ jw.detail / jw.ask / jw.launches.get / jw.cmd.clock / jw.cmd.event / jw.cmd.replay / jw.cmd.publish / jw.cmd.promote / jw.cmd.invite
```

- **坐标**：城镇坐标 x 从城镇左端起，地面图格行 y=0，向上为负。世界坐标 = 原点 + 城镇坐标；原点首次建镇时以出生点为中心、地表取中位数，写进世界目录的 `<世界名>.jobsworld.json`，之后固定（可复现）。人物 `y` 为脚下那一行，玩家左上角像素 = `((ox+x)*16+8-10, (oy+y)*16-42)`。
- **重建条件**：布局 `version` 或 `TownBuilder.BuilderVersion` 变化时，在原位置重建（清空城镇上空、填平到 `ground_depth`）；否则跳过。管理员也可 `/jw rebuild`。
- **假玩家**：真正的“玩家”（出现在玩家列表、可定制外观、聊天显示在头顶），不是 NPC。服务器端槽位保持非活动，只向真实客户端同步，详见 `tshock/README.md`。

### tModLoader 端需要实现的接口

```csharp
// shared/Town/ITileWriter.cs —— 城镇构建与蓝图粘贴只通过它改世界（世界图格坐标）
int MaxTilesX { get; }  int MaxTilesY { get; }
bool IsSolid(int x, int y);
void ClearAll(int x, int y);  void ClearTile(int x, int y);
void SetBlock(int x, int y, ushort type, byte slope = 0, bool half = false);
void SetWall(int x, int y, ushort wall);
void SetLiquid(int x, int y, byte amount, byte liquidType);
void SetRaw(int x, int y, in RawTile t);                       // 蓝图原样写入
bool PlaceObject(int left, int bottom, ushort type, int style, int direction = 1);  // 多格物件，左下角定位
bool PlaceSmall(int x, int y, ushort type, int style);         // 火把等
bool PlaceTree(int x, int groundY, int seed);
bool SetSignText(int left, int top, string text);
void FrameRange(int x0, int y0, int x1, int y1);

// shared/Personas/FakePlayerDirector.cs —— 假玩家发包
void Spawn(int slot, PersonaLive p, float px, float py, int dir);
void UpdateInfo(int slot, PersonaLive p);
void Move(int slot, float px, float py, float vx, float vy, int dir);
void Despawn(int slot);
void Say(int slot, string text, byte r, byte g, byte b);
```

tML 的 `Tile` 是结构体（`HasTile`/`TileType`/`WallType`/`LiquidAmount`…），不能照搬 OTAPI 的 `ITile` 写法；`WorldGen.PlaceObject`、`TileObjectData.GetTileData`、`Sign.ReadSign/TextSign`、`WorldGen.GrowTree` 两边同名可用。csproj 里用 `<Compile Include="../shared/**/*.cs" />` 引入共享源码。

## 构建与运行

宿主机不需要 .NET SDK，全部在 Docker 里构建（镜像构建阶段下载 TShock 6.2.1 for 1.4.5.8 发布包并编译插件）。前提：`nats` 与世界服务（`apps/world`）已在运行。

```bash
# 构建并只启动游戏服（不会重建 / 重启其他依赖容器）
docker compose --profile game up -d --build --no-deps tshock
docker logs -f pux-tshock-1          # 首次会生成小世界并建镇，看到“城镇构建完成”即可
```

- 端口：`127.0.0.1:${TSHOCK_PORT:-57777}`（只绑本机；对外由 gateway 的 `0.0.0.0:7777` 转发）。
- 环境变量（`.env`）：`TSHOCK_PORT`、`JW_GAME_PASSWORD`（游戏服密码，可空）、`JW_ADMIN_PASSCODE`（`/jw login` 口令，可空则禁用）。
- 数据：命名卷 `pux_tshockdata` 挂在 `/data`（`tshock/` 配置与 SQLite、`worlds/` 世界与建镇标记、`logs/`）。删除该卷即可从新世界重来。
- 握手版本串：原版 1.4.5.8 客户端发送的 ConnectRequest(1) 为 **`Terraria326`**（`Main.curRelease = 326`）。

## 游戏内命令

所有人：

| 命令 | 说明 |
|---|---|
| `/jw who` | 所有人物：地点 + 正在做什么（使用软件的排在前面） |
| `/jw goto <地点\|人名>` | 传送到地点（id、中文名、英文名或类型均可）或人物身边 |
| `/jw follow <人名>` | 跟随（每秒检查，远了就传送过去）；再输一次或 `/jw follow off` 取消 |
| `/jw info <人名>` | 详情：职业、当前活动、打算、身心状态（很饿、很累、心情不好…，手机是否在手边）、上一段/下一段日程；在用软件时显示软件、步数、独白、动作。tModLoader 的人物面板另显示熟人 |
| `/jw ask <人名> <问题>` | Session 结束后的追问访谈（走 `jw.ask`；正在用软件时提示忙，没有完成过 Session 时提示无） |
| `/jw lang en\|zh` | 切换输出语言（默认中文；子命令也接受中文别名，如 `/jw 谁`） |
| `/jw launches` | 已发布的产品和各自的人数：看到 → 注意到 → 有兴趣 → 打开过 → 回来再用，此刻几人在用，宣发强度，评分（`jw.launches.get`） |
| `/jw status` | NATS、城镇版本与原点、假玩家数量、世界时钟 |

管理员（TShock 权限 `jobsworld.admin`，或 `/jw login <口令>` 获得本次连接的权限，同时允许建造）：

| 命令 | NATS |
|---|---|
| `/jw clock pause\|resume\|speed <n>\|jump HH:MM` | `jw.cmd.clock` |
| `/jw event <地点> <weak_network\|crowd\|rain\|power_cut\|noise> [分钟]` | `jw.cmd.event` |
| `/jw replay <session_id>` | `jw.cmd.replay` |
| `/jw publish <网址> <名字> <一句话>` | 发布一个产品（`jw.cmd.publish`）；之后居民会自己遇到它 |
| `/jw promote <产品> <0-100\|pause\|resume\|end>` | 调宣发强度、暂停、继续、结束（`jw.cmd.promote`；产品可写名字或发布 id） |
| `/jw invite <产品> [人数]` | 把手机递给几个人，请他们现在就试（`jw.cmd.invite`，默认 3 人） |
| `/jw rebuild` | 按当前布局在原位置重建城镇 |
| `/jw paste <蓝图>` | 把 `/server/schematics/` 里的 `.TEditSch` 以自己脚下为左下角粘贴（调试用，不写入布局） |

旁观者舒适性：进服自动无敌（GodMode）、PvP 关闭、不刷敌怪、非管理员不能改地形；昼夜跟随世界时钟（04:30 天亮、19:30 天黑）。

## 蓝图与社区素材

- `game/schematics/` 只放许可证干净的自制蓝图，布局图元 `{ t: 'schematic', file, x, y }`（`y` 为蓝图最底一行）会粘贴它们。
- `scripts/download-community-assets.sh [all|tedit|ceteris]` 把 TEdit 示例与 CeterisParibus51 的社区蓝图下载到 `data/community/`（被 `.gitignore` 忽略）。这些素材多数无许可证：**只在本机使用，不提交、不打进镜像**。

## 验证（不需要游戏客户端）

```bash
npx tsx scripts/jw-probe.ts --port 57777 --secs 25 --cmd "/jw who" --cmd "/jw info 陈小敏"
# 管理员：--cmd "/jw login <口令>" --cmd "/jw event home_a noise 3"（触发人物反应气泡）
```

探针是一个最小的原版协议客户端：握手 `Terraria326` →（密码）→ PlayerInfo/ClientUUID/生命/魔力/Buff → 请求世界 → 请求出生分区 → SpawnPlayer，然后打印收到的 PlayerInfo(4)/PlayerActive(14)、每个玩家的 PlayerUpdate(13) 次数与位置、聊天（NetTextModule，含作者槽位）、SetTime(18)，并从图格分区（Deflate 解压）中解出告示牌文字。

### 已验证结果（2026-11-14，本机）

- 首次启动自动生成小世界（4200×1200），建镇约 0.1–0.2 秒：建筑 11、门 22、窗 345、家具 333、告示牌 15、树 7、长椅 5、路灯 8、火把 454、地铁隧道/站厅/台阶 3/站台/5 节车厢、公交亭、水池，无放置失败；原点 (1508, 291)，出生点设在公园。第二次启动识别标记并跳过构建；构建器版本变化时在原位置自动重建。
- 探针以原版协议连入：收到 16 个假玩家（slot 254→239，人物名如“陈小敏”“Emily Carter”）的 PlayerActive + PlayerInfo，持续收到 PlayerUpdate，走动中的人物位置平滑变化；后加入的客户端同样收到全部假玩家。
- 气泡：`/jw event home_a noise 3` 后收到作者为假玩家槽位的聊天（如 `[#246] 陈小敏: 这也太吵了`，黄色 confused）；正在跑 Session 的人物独白也以气泡出现，按语气着色，同一人 6 秒内最多一条。
- 图格分区中解出“幸福里公寓 A 座 / Sunny Court A”“人民广场地铁站 / People's Square Station”“公交站 / Bus Stop”等告示牌文字。
- SetTime 每秒一次，与世界时钟一致（如 20:16 → 夜晚 time=2780）。
- `/jw who`、`/jw info`、`/jw goto`、`/jw follow`、`/jw login`、`/jw clock speed`、`/jw event`、`/jw rebuild`、`/jw paste`、`/jw lang en`、`/jw ask` 均走通。
- `.TEditSch` 读取器对下载的 432 个社区蓝图（V4/V5，版本 279）全部解析成功。

未验证：真实 Terraria 图形客户端里的观感（外观颜色、头顶气泡渲染、门/家具样式）、GodMode 与禁建造在真实客户端上的表现、`/jw replay`。

## 排错

| 现象 | 处理 |
|---|---|
| 日志反复“获取城镇布局失败” | 世界服务未运行或 NATS 不通；容器内 NATS 地址为 `nats://nats:4222`（compose 默认网络） |
| 客户端提示版本不符 | 必须是原版 1.4.5.8（`Terraria326`）；tModLoader 客户端连 tML 服务端 |
| 看不到人物 | `/jw status` 看假玩家数量；世界服务的 `jw.snapshot` 是否在发（`nats sub jw.snapshot`） |
| 想换新世界 | `docker compose --profile game rm -sf tshock` 后 `docker volume rm pux_tshockdata` 再启动 |
| 城镇被改坏 | 管理员 `/jw rebuild` |

---

## tModLoader 端（game/tmodloader）

> 本节由 tModLoader 端维护，详细说明见 [`tmodloader/README.md`](tmodloader/README.md)。

- **版本**：tModLoader 稳定版 `v2026.09.3.1`（Terraria 1.4.4.9），握手版本串 **`tModLoader v2026.9.3.1!2026.9.3`**（gateway 按 `tModLoader` 前缀分流）。
- **构建**：`docker compose --profile game up -d --build --no-deps tml`。镜像构建时把 `game/shared` 复制到 `tmodloader/JobsWorld/Shared/`，再用 tModLoader 自带的 Roslyn（`dotnet tModLoader.dll -server -build`）编译出 `JobsWorld.tmod`，不需要 .NET SDK；共享源码不在 mod 目录里重复入库。
- **端口与数据**：`127.0.0.1:${TML_PORT:-57778}`，命名卷 `pux_tmldata`。
- **适配实现**：`Server/TmlTileWriter.cs`（`ITileWriter`，tML `Tile` 结构体 API）、`Server/TmlFakePlayers.cs`（`IFakePlayerHost`，与 TShock 端同样只向真实客户端同步非活动槽位）；建镇、假玩家调度、命令文本全部复用 `shared/`。
- **相对 TShock 端的差异**：平坦世界生成（`ModifyWorldGenTasks`）；客户端可悬停 / 点击人物打开面板（软件、步骤、在想、动作、实时截图、日程、跟随、追问、主页）和右上角 HUD（时钟、在用软件人数）；服务端逻辑挂在 `Main.OnTickForThirdPartySoftwareOnly`（无人在线时原版不跑 `Main.Update`）。
- **验证**：`node game/tmodloader/tools/tml-probe.mjs 127.0.0.1 57778`（完整走 tML 握手、进入世界，解析假玩家、气泡与 JobsWorld ModPacket）。
