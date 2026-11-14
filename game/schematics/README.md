# game/schematics：自制地标蓝图（.TEditSch V5）

这里存放**许可证干净**（自制或明确允许再分发）的 TEdit 蓝图，构建镜像时会复制到 TShock 容器的 `/server/schematics/`。

- 格式：TEdit 导出的 `.TEditSch`（V5，兼容 V4），读取逻辑见 `game/shared/Schematics/TEditSchematic.cs`（移植自 TEdit，MS-PL）。
- 引用方式：城镇布局图元 `{ t: 'schematic', file: 'xxx.TEditSch', x, y }`，`x` 为蓝图左边界、`y` 为蓝图最底一行（城镇坐标，地面 y=0，所以贴地放置用 `y: -1`）。空气格不覆盖原有图格。
- 社区蓝图/地图（无许可证）**不要**放这里，用 `scripts/download-community-assets.sh` 下载到 `data/community/`（不入库），仅本机使用。
