---
version: 1
slug: "apps-web"
primary_target: "apps/web"
related_targets: []
---

# Surface brief: apps/web（Jobs 网页）

Scope: 整个 apps/web（城、产品列表与产品页、人物、一次使用的回看、人工接管、模型接入页，以及页头的发布对话框、Terraria 与飞书浮层）。Visitor mode: Operate（世界页偏 Experience）。
Audience/job: 独立开发者与小团队把产品发布进城，围观居民怎么对待它，读一页人话的结论，调宣发、把手机递给几个人。
Content: 全部来自 /api/v1 的真实数据；不编造指标。约束：无说明性小字；PlutoKeating design system；中英双语。
FORM: 街道作导航（surface roll seed:47836745e72b75df，dealt 4/7/3，lead 4；用户目标要求不暂停，故未开决策页）。挑战方案「车站出发看板」并入「此刻」列表的行内重排与变化高亮。

## Direction contract
THESIS: 城市就是导航。每一页页脚是一条侧视像素街道（跟在内容后面，不盖住内容；与世界页同一份 town 布局），人物实时在上面走；点建筑进地点、点人进人物。拒绝「左侧栏 + KPI 卡片墙」的后台模板。
OWN-WORLD: PlutoKeating 暖炭黑底（#0e0f11/#17181c）+ 琥珀 #f0a35e 只用于「此刻发生的事」与选中态；石板灰绿 #7d8f8a 做次要数据；Inter + 思源黑体；像素块（crispEdges）只出现在城市与头像，界面本身是干净的细线与 10px 圆角。
STORY: 打开即看到这座城此刻的时间、谁在哪、谁正在用哪个产品；唯一的主动词是右上角的「发布」；向上是两个房间：产品、人，外加管理员的「模型」（一页草稿、一次保存）。产品页先是一句话结论，每句话可展开成说这话的人、原话与当时的屏幕；人数与宣发在右栏，技术信号单独在「工程附录」。
FIRST VIEWPORT: 世界页=整幅城市画布 + 右侧面板（已发布的产品，下面是出发看板式的「此刻」列表；行原地重排，变化行保持琥珀高亮）；点人物弹出人物卡（正在做/在想/刚才/接下来）。
SIGNATURE: 页脚街道地平线跨页出现、点人物从街道直接打开人物卡；人物气泡实时冒出。
RISK: 像素画布在小屏可读性；以横向拖动与缩放应对。
