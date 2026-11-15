# 校准（内部工具）

**现状**：产品决策是校准「先不管」。Jobs 对外给出的人数与结论一律标注为模拟，不带可信度等级；本文描述的工具只在仓库里用（`pnpm jobs dev …`），用来回答「虚拟人到底能不能发现已知的问题」。重塑（只看截图、Midscene 定位、应用内模型路由）之后，这些校准**还没有重新跑过**；重塑之前的一次记录在 [`history/CALIBRATION_RECORD_2026-11-14.md`](history/CALIBRATION_RECORD_2026-11-14.md)，不代表现在的系统。

校准用的是「指派式批次」：指定一个产品版本，让一批人带着任务去用（而不是像发布那样等他们自己遇到）。产出 `calibration_results`：在什么人群、什么场景、什么问题类型上，模拟结论有多可信。

## 可信度等级（阈值在 `config/pux.config.yaml` → `thresholds`）

| 等级 | 规则（默认） |
|---|---|
| high | n ≥ 20，95% 置信区间宽度 ≤ 0.3，指标 ≥ 0.7（误报率取 1 − 值） |
| medium | n ≥ 5 |
| low | 数据表明系统性偏离（检出率 < 0.36、误报率 > 0.45、秩相关 < 0.2），或样本过少 |
| unknown | 没有校准数据（默认） |

额外规则：「每一步」与「归纳」两个模型组的首选模型出自同一家厂商时（评审和被评审的想法可能有同样的偏见），评审相关结论最高只到 medium；无障碍扫描客观检出的问题至少为 medium。

## 0. 跑一个批次

```bash
pnpm demos                                                    # 示例产品：干净版 5401–5411，植入缺陷版 5501–5511
pnpm jobs init                                                # 会注册示例产品（demo-<id>@clean / @seeded）
pnpm jobs dev product crawl --app demo-notes@seeded           # 爬取并归纳功能、任务、假设 → data/apps/…/product.yaml
pnpm jobs dev product import data/apps/demo-notes/seeded/product.yaml --auto-confirm
pnpm jobs dev study create --app demo-notes@seeded --sessions 6 --steps 30
pnpm jobs dev study run <study_id>                            # 进程内分轮运行；结束时自动合成问题、校准、出报告
```

常用参数（`study create`）：`--round`（每轮几人）、`--concurrency`、`--locale zh-CN|en-US|mixed`、`--personas <id,…>`、`--tasks <key,…>`、`--worlds <id,…>`（用 `config/worlds/` 里手写的场景而不是居民此刻的处境，便于复现）、`--mix <目标,好奇,压力,对抗>`、`--revisits 1,7`（隔几天回访）、`--judges 1–3`、`--no-replay`、`--no-interview`、`--headed`。其他命令：`study list | status <id> | resume <id> | finalize <id>`。报告写到 `data/reports/<study_id>/`。

自己的产品：准备一个植入了 5–10 个已知问题的测试版本，`pnpm jobs dev app add --name x --version seeded --url … --seeded defects.yaml [--reset-url …]`。

## 1. 已知缺陷（完全客观）

- 示例产品的 `seeded` 版本自带缺陷清单（`demos/kit/src/apps/*.ts` 的 `defects`）。
- 批次结束时自动计算；也可以 `pnpm jobs dev calibrate seeded <study_id>`。
- 匹配：先用「归纳」模型组做语义匹配（同类别置信度 ≥ 0.5，跨类别 ≥ 0.75），再用关键词兜底（同类别且命中 ≥ 3 个关键词）。按类别输出检出率，附 Wilson 95% 置信区间。
- 误报率 =（没匹配上已知缺陷、且不属于「基线真实问题」的产品问题）/（产品问题 − 基线真实问题）。基线真实问题指：无障碍扫描客观检出的；同一产品的干净版本上也发现的（相同指纹）；或其复现路径在干净版本上重放也能复现的。它们不在植入清单里，但不是误报。建议对干净版本也跑一个批次建立基线。
- 人工分诊：`pnpm jobs dev issue confirm|reject <issue_id>`。确认的计入基线；驳回的计为确认误报。`false_positive_rate` 是**上界**（没分诊的按误报计），`false_positive_rate_lower` 是**下界**（只计驳回的）。分诊后重新执行 `calibrate seeded`。
- 验收阈值（可调）：检出率 ≥ 60%，误报率 ≤ 30%。

## 2. 真人基准

```bash
pnpm jobs dev calibrate human <study_id> examples/calibration/human-benchmark.example.yaml
```

```yaml
app: demo-assistant
participants:
  - { id: h1, segment: office_worker, task: 写周报, completed: true, steps: 9, stuck_points: [..], ratings: { satisfaction: 4.5, perceived_difficulty: 3 } }
```

输出：各人群完成率的偏差方向（模拟 − 真人，例如「模拟更宽容」）、人群间完成率与主观评分的 Spearman 秩相关（Fisher z 置信区间），并比较 raw / z-score / rank 三种归一化——只有确实优于原始分的才记为启用，写入 `data/learning.json`。

## 3. 埋点漏斗

CSV：`step,url_pattern,dropoff`（示例 `examples/calibration/funnel.example.csv`）。计算真实流失步骤与模拟放弃点的秩相关。

```bash
pnpm jobs dev calibrate funnel <study_id> examples/calibration/funnel.example.csv
```

## 4. 应用商店与社媒评论

纯文本文件。抽取真实抱怨并与模拟发现匹配：真实抱怨被模拟覆盖的比例，以及模拟独有的发现数。

```bash
pnpm jobs dev calibrate reviews <study_id> examples/calibration/reviews.example.txt
```

## 5. 学习回路与校准卡

`pnpm jobs dev calibrate learn <app>`（批次结束时也会自动执行）把校准结果写回 `data/learning.json`：`sampler_weights.low_trust`（低可信区域越多，补样权重越高）、`weak_categories`（检出率不达标的问题类型）、`persona_criticality`（真人基准显示模拟系统性更宽容时的修正量）、`normalization`（各维度启用的归一化方法）。它只影响校准批次的采样，不影响发布主线。

`pnpm jobs dev calibrate card <app>` 打印这个产品目前的校准结果汇总。

## 6. 防止自己评自己

1. 评审先只看动作、结果、错误码与截图；之后才看人物心里的话，两阶段的分数都入库。
2. 人物的自评与评审一致，只作内部指标，不作为可信度依据。
3. 已知缺陷给出客观的检出率与误报率；主观维度的可信度只来自真人基准。
4. 「每一步」与「归纳」出自同一家厂商时在批次上标注并降一级；`config/pux.config.yaml` 的 `vendor_isolation: strict` 会直接拒绝创建批次。
5. 持续记录模拟与真人的偏差方向。
