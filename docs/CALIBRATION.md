# 校准与可信度

核心产出 `CalibrationResult` 回答：在什么人群（segment）、什么场景（scenario_class）、什么维度或问题类型（dimension）上，模拟结论有多可信。没有数据时一律为 `unknown`。

## 可信度等级（阈值在 `config/pux.config.yaml` → `thresholds`）

| 等级 | 规则（默认） |
|---|---|
| high | n ≥ 20，95% CI 宽度 ≤ 0.3，指标 ≥ 0.7（误报率取 1−值） |
| medium | n ≥ 5 |
| low | 数据表明系统性偏离（检出率 < 0.36、误报率 > 0.45、秩相关 < 0.2），或样本过少 |
| unknown | 没有校准数据（默认） |

额外规则：厂商隔离未满足（本机只有 Gemini）时，评审相关结论最高只到 medium；axe-core 客观规则检出的问题至少为 medium。

## 1. 已知缺陷注入（MVP 主要校准源，完全客观）

- 内置 Demo 的 `seeded` 版本自带缺陷清单（`demos/kit/src/apps/*.ts` 的 `defects`）。
- 自有产品：准备一个植入 5–10 个已知问题的测试版本，`pnpm pux app add --name x --version seeded --url … --seeded defects.yaml`。
- Study 结束时自动执行；也可 `pnpm pux calibrate seeded <study>`。
- 匹配：judge.meta 语义匹配（同类别置信度 ≥ 0.5，跨类别 ≥ 0.75）+ 关键词兜底（同类别且 ≥ 3 个关键词）；按类别输出检出率，附 Wilson 95% CI。
- 误报率 =（未匹配已知缺陷、且不属于「基线真实问题」的产品问题）/（产品问题 − 基线真实问题）。基线真实问题指 axe-core 客观规则检出的问题，或同一 App 干净版本上也发现的问题（相同 fingerprint），或其复现路径在干净版本上重放也能复现：它们不在植入清单里，但并非误报，会在校准详情中单独列出。建议对干净版本也跑一次 Study 以建立基线。
- 验收阈值（可调）：检出率 ≥ 60%，误报率 ≤ 30%。

## 2. 真人基准

```bash
pnpm pux calibrate human <study_id> examples/calibration/human-benchmark.example.yaml
```

文件格式（YAML 或 JSON）：

```yaml
app: demo-assistant
participants:
  - { id: h1, segment: office_worker, task: 写周报, completed: true, steps: 9, stuck_points: [..], ratings: { satisfaction: 4.5, perceived_difficulty: 3 } }
```

输出：各人群完成率的**偏差方向**（模拟 − 真人，例如「模拟更宽容」）、人群间完成率与主观评分的 Spearman 秩相关（Fisher z 置信区间），并在校准集上比较 **raw / z-score / rank** 三种归一化，只有确实优于原始分的方法才会被记为启用（spec §12.3），写入 `data/learning.json`。

## 3. 埋点漏斗

CSV：`step,url_pattern,dropoff`（示例 `examples/calibration/funnel.example.csv`）。计算真实流失步骤与模拟放弃点的秩相关。

```bash
pnpm pux calibrate funnel <study_id> examples/calibration/funnel.example.csv
```

## 4. 应用商店 / 社媒评论

纯文本文件。抽取真实抱怨并与模拟发现匹配：输出真实抱怨被模拟覆盖的比例，以及模拟独有发现数。

```bash
pnpm pux calibrate reviews <study_id> examples/calibration/reviews.example.txt
```

## 5. Learning

`pnpm pux calibrate learn <app>`（Study 结束时也会自动执行）把校准结果写回 `data/learning.json`：

- `sampler_weights.low_trust`：低可信/未知区域越多，补样权重越高；
- `weak_categories`：检出率不达标的问题类型；
- `persona_criticality`：真人基准显示模拟系统性更宽容时的修正量；
- `normalization`：各维度启用的分数归一化方法。

## 6. 自我循环对策（spec §12.2）

1. 厂商隔离：在 `pux.config.yaml` 声明 family，`createStudy` 校验（strict 拒绝 / warn 标注降级）。
2. 客观优先：评审第一阶段只看动作、结果、错误码与截图；第二阶段才看独白，两阶段分数都入库。
3. Persona 自评与评审的一致只作内部指标，不作为可信度依据。
4. 已知缺陷注入：客观测量检出率与误报率。
5. 主观维度的可信度只来自真人基准。
6. 偏差检测：持续记录模拟与真人的偏差方向。
