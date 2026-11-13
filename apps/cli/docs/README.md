# @pux/cli

`pnpm pux <command>`（入口 `src/index.ts`）。命令分组：`doctor`/`init`/`db`、`app`、`demo`、`product`、`persona`、`world`、`study`、`auto`、`report`、`issues`、`interview`、`calibrate`、`human`、`m0`、`console`、`worker`。详见 `pnpm pux --help` 与 `docs/QUICK_START.md`。

`m0.ts`：M0 执行器对比。以 Playwright 抽取的元素为真值，生成自然语言定位动作集，分别用 Stagehand 与 Midscene 定位，记录成功率、耗时与失败分类（`executor_comparisons` 表 + `data/reports/m0-*.md`）。
