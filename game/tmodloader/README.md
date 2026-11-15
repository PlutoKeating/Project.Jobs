# game/tmodloader：JobsWorld tModLoader mod

tModLoader 稳定版（1.4.4 线，当前 `v2026.09.3.1`，内核 Terraria 1.4.4.9）专用服务器上的 JobsWorld mod。功能与 TShock 插件一致（平坦世界 + 城镇、以假玩家出现的居民、头顶气泡、`/jw` 命令含发布相关的四个、旁观者保护、昼夜跟随世界时钟），另外因为客户端也装了 mod，多了**可点击的人物面板**和**右上角 HUD**。

## 目录

```
game/tmodloader/
├── JobsWorld/                  # mod 源码目录（目录名 = mod 名）
│   ├── build.txt / description.txt
│   ├── JobsWorldMod.cs           # Mod 入口：ModPacket 分派
│   ├── Common/Packets.cs         # 服务端 ↔ 客户端 ModPacket 协议、名册条目、环境变量
│   ├── Common/Spectator.cs       # 无敌、不刷怪、非管理员不能用挖掘/放置类物品
│   ├── World/FlatWorldGen.cs     # 新建世界时只保留 Reset，替换为一条平地
│   ├── Server/JwServerSystem.cs  # NATS、建镇、假玩家调度、昼夜、加入检测、拦截假玩家槽位与改图消息
│   ├── Server/JwServerNet.cs     # HUD / 名册广播，面板请求转 jw.detail / jw.ask
│   ├── Server/JwCommand.cs       # /jw 命令（CommandType.World：在服务器执行）；发布相关的交给 shared/Personas/LaunchCommands.cs
│   ├── Server/TmlTileWriter.cs   # ITileWriter 的 tML 实现（Tile 结构体 API）
│   ├── Server/TmlFakePlayers.cs  # IFakePlayerHost 的 tML 实现
│   └── Client/                   # JwClientSystem（悬停/点击、HUD）、PersonaPanel（UIState）、JwTextBox、DetailDto
└── tools/tml-probe.mjs         # 无界面 tModLoader 协议探针（Node，无依赖）
```

`game/shared/**`（NATS 客户端、城镇构建、`.TEditSch` 读取、假玩家调度、协议 DTO、命令文本）**不复制进仓库**：tModLoader 的 `-build` 会用自带 Roslyn 编译 mod 目录下的全部 `.cs`，所以镜像构建时把 `game/shared` 复制到 `JobsWorld/Shared/` 再编译（该目录已被 `.gitignore` / `.dockerignore` 忽略）。

## 构建与运行

前提：NATS 与世界服务已在运行。宿主机不需要 .NET。

```bash
# 从源码运行
docker compose --profile game up -d --build --no-deps tml
docker logs -f pux-tml-1        # 看到“城镇构建完成”“假玩家上线 #254 …”即可

# 装好的 Jobs：网页右上角手柄里的开关，或者
jobsworld game on tml           # 容器名 jobs-tml-1
```

- 镜像（`infra/game/tmodloader/Dockerfile`）：阶段 1 在 `dotnet/runtime:8.0` 里下载 GitHub 发布包 `tModLoader.zip`（构建参数 `TML_VERSION`），执行 `dotnet tModLoader.dll -server -build /src/JobsWorld -tmlsavedirectory /build-save` 得到 `JobsWorld.tmod`；阶段 2 只带 tModLoader 与 `.tmod`。
- 启动（`entrypoint.sh`）：把 `.tmod` 装进 `/data/tModLoader/Mods` 并写 `enabled.json`，生成 `serverconfig.txt`（端口 7777、`autocreate` 小世界、密码 `JW_GAME_PASSWORD`、最多 `JW_MAX_PLAYERS` 人），以 `-tmlsavedirectory /data/tModLoader` 启动。
- 端口：`127.0.0.1:${TML_PORT:-57778}`；对外由 gateway 的 `0.0.0.0:7777` 按握手版本串转发。
- 环境变量：`NATS_URL`（compose 内为 `nats://nats:4222`）、`JW_GAME_PASSWORD`、`JW_ADMIN_PASSCODE`、`JW_PASSCODE`（网页的访客口令；设置了才需要，用来给面板下发截图令牌）、`JW_API_BASE`（可空，见下文）、`JW_FAKE_MIN_SLOT`/`JW_FAKE_TOP_SLOT`（默认 180..254）、`JW_WORLD_NAME`、`JW_MAX_PLAYERS`。
- 数据：命名卷 `pux_tmldata`（装好的 Jobs 里是 `jobs_tmldata`）→ `/data`（`tModLoader/Worlds/` 世界与建镇标记 `jobsworld.jobsworld.json`、`logs/`）。删卷即从新世界重来。

### 握手版本串（gateway 分流依据）

tModLoader 客户端的 ConnectRequest(1) 负载是 `ModNet.NetVersionString = BuildInfo.versionedName + "!" + StableNetVersion`，稳定版为：

```
tModLoader v2026.9.3.1!2026.9.3
```

（`versionedName = $"tModLoader v{tMLVersion}"`，`Version` 会去掉前导零；`StableNetVersion` 取主.次.构建号。服务端只要求 `!` 后的网络兼容版本一致。）以 `tModLoader` 开头，`apps/gateway/src/sniff.ts` 据此路由到 tML。

## 客户端体验

玩家用 tModLoader（Steam 上的 tModLoader，稳定版）连 `服务器IP:7777`，加入时自动从服务器下载 JobsWorld mod（客户端设置“从服务器下载 mod”默认开启）。

- **人物**：每个可见人物都是一个假玩家（玩家列表里能看到，外观按年龄/性别/职业映射），位置每秒随 `jw.snapshot` 平滑移动；想法以该玩家身份发聊天，显示在头顶，按语气着色（愤怒红、困惑黄、开心绿），同一人 6 秒最多一条。
- **悬停**：鼠标移到人物上显示名字、年龄·职业、正在做什么 / 正在用的产品。
- **点击（左键或右键）打开面板**：名字、年龄·性别·职业、地点（楼层）、状态；身心状态（很饿、很累、心情不好…）与手机在不在手边；熟人；正在用产品时显示产品名、第几步、“在想”（心里的话）、动作、意图和**当前截图**；之前 / 现在 / 接下来三段日程及意图；最近记忆。打开期间每 2 秒刷新。按钮：
  - **跟随 / 取消跟随**：服务器每秒检查，远了就把你传送到他身边；
  - **传送过去**；
  - **问他**：输入框（支持中文输入法，Enter 提交、Esc 取消）→ 服务器请求 `jw.ask` → 回答显示在面板并进聊天栏（正在用产品时提示忙，从没用过任何产品时提示无）；
  - **打开主页**：`http://<主机>:<端口>/people/<id>`，复制到剪贴板、打印在聊天栏并尝试用浏览器打开。
- **截图**：客户端直接 HTTP 下载 `http://<连接的主机>:<连接的端口>/api/v1/evidence/<screenshot_ev>`（gateway 同一端口也提供 HTTP；后台线程下载，主线程创建纹理，失败只显示原因）。服务器设置了 `JW_API_BASE` 时改用该地址。网页开了访客口令（`JW_PASSCODE`）时，服务端在 `Hello` 里把截图令牌发给客户端（由口令算出，只对截图接口有效），客户端带着它下载；游戏服没拿到这个口令时接口返回 401，面板会提示“截图需要网页口令”。
- **状态栏**（右上角，小地图下方）：世界时钟（暂停 / 倍速）与“N 人正在用产品 · 共 M 人”。Terraria 昼夜按世界时钟流速推进（`ModifyTimeRate`），偏差超过 1.5 分钟时校正。

## 命令

与 TShock 端相同（文本来自 `shared/Personas/WorldText.cs`），中文默认，`/jw lang en` 切英文，子命令接受中文别名：

| 所有人 | 管理员（先 `/jw login <口令>`，口令为 `JW_ADMIN_PASSCODE`；服务器控制台视为管理员） |
|---|---|
| `/jw who`、`/jw goto <地点\|人名>`、`/jw follow <人名>\|off`、`/jw info <人名>`、`/jw ask <人名> <问题>`、`/jw launches`、`/jw lang en\|zh`、`/jw status` | `/jw publish <网址> <名字> <一句话>`、`/jw promote <产品> <0-100\|pause\|resume\|end>`、`/jw invite <产品> [人数]`、`/jw clock pause\|resume\|speed <n>\|jump HH:MM`、`/jw event <地点> <weak_network\|crowd\|rain\|power_cut\|noise> [分钟]`、`/jw replay <session_id>`、`/jw rebuild`、`/jw paste <蓝图>` |

旁观者保护：玩家无敌（`FreeDodge`/`ImmuneTo`/`PreKill`）、不刷敌怪（`EditSpawnRate`，每 10 秒清一次残留敌怪）、无血月/日食；非管理员的改图消息（挖/放/刷漆/液体/告示牌/电线/物件）在服务端 `HijackGetData` 丢弃并回发该处图格，客户端也禁止使用挖掘/放置类物品。

## 实现要点

- **主循环**：没有玩家在线时原版专用服务器不跑 `Main.Update`（`PostUpdateEverything` 不会被调用），所以服务端逻辑挂在 `Main.OnTickForThirdPartySoftwareOnly`（主线程、每帧），保证无人在线时也能建镇、跟踪人物。
- **假玩家**：同 TShock 端——服务器端槽位保持非活动，用原版 `NetMessage.SendData` 序列化 PlayerActive/SyncPlayer/装备/生命/PlayerControls 只发给真实客户端；服务器自己为这些槽位发出的玩家类数据包在 `HijackSendData` 拦截。加入检测轮询 `Netplay.Clients[i].State == 10`，立即与 3 秒后各补发一次全部假玩家、Hello、名册。
- **ModPacket 协议**（`Common/Packets.cs`）：服务端 → 客户端 `Hello`（API 基址、管理员、语言、地点名）、`Roster`（槽位 ↔ 人物）、`Hud`（每秒）、`Detail`（`jw.detail` 原始 JSON，超过 60KB 依次去掉记忆/历史/日程）、`AskAnswer`、`FollowState`；客户端 → 服务端 `DetailReq`、`AskReq`、`FollowReq`、`GotoReq`。
- **建镇**：首次以出生点为中心、地表中位数为原点，写 `<世界>.jobsworld.json`；布局 `version` 或 `TownBuilder.BuilderVersion` 变化时原位重建，否则跳过。出生点设在公园。

## 验证

不需要游戏客户端：

```bash
node game/tmodloader/tools/tml-probe.mjs 127.0.0.1 57778            # 直连 tml 容器
node game/tmodloader/tools/tml-probe.mjs 127.0.0.1 7777 --download  # 经 gateway，并请求下载 mod 文件
node game/tmodloader/tools/tml-probe.mjs 127.0.0.1 57778 --wait 60 --ask 周静 --cmd "/jw who" --cmd "/jw info 周静"
```

探针完整走一遍 tML 握手：ConnectRequest → SyncMods(251) 回空包 → 槽位(3) → PlayerInfo/UUID/生命/魔力 → 请求世界 → 请求分区 → SpawnPlayer，然后解析假玩家（14/4/13）、头顶气泡（NetTextModule 作者为假玩家槽位）、JobsWorld 的 ModPacket（Hello/Roster/Hud/Detail/AskAnswer），并发送聊天命令与 `DetailReq`/`AskReq`。

### 验证记录

2026-11-15（当前代码）：镜像重新编译通过（含发布相关的四个命令、面板里的身心状态与熟人）。这一天没有重新启动 tModLoader 服务端做进服验证；产品负责人确认已用真实客户端进过这座城并可用（没有逐项记录覆盖到哪些面板细节）。

2026-11-14（当时城里只有 16 个人，用无界面的协议探针）：

- 镜像构建：模组用 tML 自带的编译器编译 0 错误。
- 启动：`Terraria Server v1.4.4.9 - tModLoader v2026.9.3.1`，网络兼容版本 `2026.9.3`；模组加载、NATS 连接；平坦世界生成约 0.1 秒（4200×1200）；建镇约 0.24 秒，无放置失败，出生点在公园。重启后识别标记跳过构建；构建器版本变化时原位重建。
- 握手：`tModLoader v2026.9.3.1!2026.9.3` → 服务端回模组列表；版本不符的 tModLoader 客户端与原版客户端被拒。经网关 `127.0.0.1:7777` 结果相同（被路由到 tML）；原版握手串经网关去了 TShock。
- 进入世界后：收到全部假玩家的 PlayerActive + PlayerInfo + 持续 PlayerUpdate；`Hello`（城镇“乔布斯镇”）、名册、状态栏；`DetailReq` 收到 `jw.detail` 的 JSON；`/jw who`、`/jw status`、`/jw goto 地铁`、`/jw follow`、`/jw info`、`/jw lang en` 回复正确；面板的追问在 60 秒内收到回答（会产生一次模型调用）。
- 气泡：向 NATS 发布 `jw.persona.<id>.say` 后探针收到作者为该假玩家槽位的聊天；管理员 `/jw login` → `/jw event home_a noise 3` 后收到多个人的反应气泡。
- 模组下载：探针请求 `JobsWorld` 后收到 `.tmod` 分块（客户端可以从服务器自动下载模组）。
- 截图接口：经网关 `GET /api/v1/evidence/<id>` 返回图片；`/people/<id>` 返回 200。

### 没有用探针覆盖到的 / 限制

- 面板、状态栏、悬停提示、输入框（含中文输入法）、截图贴图、外观颜色与头顶气泡的实际渲染，探针看不到；只有产品负责人在真实客户端里的整体确认。
- 客户端无敌 / 禁用物品在真实客户端上的表现没有逐项验证（服务端的改图拦截在代码里，探针没有发送改图消息）。
- `/jw replay`、`/jw publish`、`/jw promote`、`/jw invite` 没有在 tModLoader 服务端上实际触发过；`/jw paste` 只编译通过（仓库内没有蓝图）。
- 假玩家槽位与真实玩家共用 0..254：`JW_FAKE_MIN_SLOT` 必须大于 `maxplayers`；同屏上限受槽位数限制（默认 75）。

## 排错

| 现象 | 处理 |
|---|---|
| 日志反复“获取城镇布局失败” | 世界服务未运行或 NATS 不通（容器内地址 `nats://nats:4222`） |
| 客户端提示版本不符 | 客户端 tModLoader 版本的网络兼容号必须与服务器一致（`2026.9.3`）；原版客户端请连 TShock |
| 客户端卡在下载 mod | 客户端设置里开启“从服务器下载 mod” |
| 面板截图一直失败 | 看面板里的原因；客户端不是经 gateway 连接时设置 `JW_API_BASE=http://<api 地址>` |
| 想换新世界 | 从源码运行：`docker compose --profile game rm -sf tml` 后 `docker volume rm pux_tmldata` 再启动（装好的 Jobs：在 `~/.jobs` 下执行，卷名 `jobs_tmldata`） |
