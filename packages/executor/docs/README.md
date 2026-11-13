# @pux/executor（UAP 执行层）

- `session.ts`：`BrowserSession implements Executor`。每个 Session 一个独立浏览器（Stagehand `localBrowser.launch`，Playwright `connectOverCDP` 接入），注入观测脚本，采集 console/网络/弹窗，CDP screencast 录像。
  - `observe()`：元素抽取（可交互元素、标题、文本块、图片；遮挡、对比度、字号）、state_id（URL 模板 + 结构骨架哈希）、截图/a11y/axe/rrweb 证据。
  - `act()`：目标解析（ref / a11y / text / selector / coords / visual：Stagehand observe 或 Midscene aiLocate）→ Policy Gate → 按 MotorProfile 执行（落点抖动、逐字输入与错字修正、双击风险）→ 成功标准轮询 → 错误分层（产品 5xx/JS 错误/无反馈/目标过小，执行器，模拟器，环境，注入）。
  - 打断：`switchAway`/`returnBack`（visibilityState 覆盖 + 生命周期冻结）、`closeTab`/`reopenLast`；`setNetwork`（CDP 限速）；`setGeolocation`；`takeoverUrl`（DevTools 远程画面，供人工接管）。
- `policy.ts`：Policy Gate 规则（支付提交、公开发布、加陌生人、对外发送、上传人脸、提交真实个人信息；儿童更严格；成人仅允许沙箱域名支付）。
- `modality.ts`：语音（Gemini TTS → wav → fake audio capture）、相机（图片/生成图 → y4m → fake video capture）。
- `evidence.ts`：证据登记（MinIO 内容寻址 + `evidence` 表）与 `evidence_links`。
- `page-scripts.ts`：注入脚本（DOM 变更计数、通知拦截、可见性控制、元素抽取）。
