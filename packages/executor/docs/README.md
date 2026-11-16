# @pux/executor（UAP 执行层）

虚拟人只通过两件事接触被测产品：**看截图**（`observe`）和**手上的动作**（`act`：点、滑、长按、拖、打字、按键）。DOM、无障碍树、网络与控制台只作为执行层的仪器和工程证据，其中任何文字都不进入人物的想法。

- `session.ts`：`BrowserSession implements Executor`。每次使用一个独立的 Chromium（Playwright 直接启动），注入观测脚本，采集浏览器的错误输出、网络请求与弹窗，用屏幕帧合成录像。同一个人在同一个产品上的登录状态（Cookie 等）跨次保留。
  - 设备：`mobile: true` 时是真正的移动端上下文（移动 UA、触屏、2 倍屏、390×844），交互走触屏事件；否则是 1280×800 的桌面浏览器。
  - `observe()`：视口截图（人物唯一的输入来源）；元素几何（位置、字号、对比度、屏幕上实际渲染的字 `vis_text`，不含 aria / alt / title）、state_id、a11y 快照、axe、rrweb 作为仪器与工程证据。原生弹窗（alert / confirm / prompt）不在页面截图里，按浏览器的样子画到截图上。
  - `act()`：目标 → 落点 → Policy Gate → 按人物的手注入 → 等页面安静 → 比较动作前后的截图。
    - 目标（`TargetRef.by = 'visual'`）：`text` 是人物照抄的、写在目标上的字，`value` 是人物对目标样子和位置的描述。先「借 DOM 换算落点」：照抄的字在视口内恰好对应唯一一个没被遮挡的可交互元素时直接取其位置（`matchVisibleText`）；否则由 Midscene `aiLocate` 看截图定位。Midscene 自己发模型请求：它被指到本进程里的 OpenAI 兼容入口（`@pux/llm` 的 `startLocalEndpoint`），由已保存的模型配置里勾选了「定位」的模型来回答；没有这样的模型时这一步报错。不会替人滚动到目标。
    - 结果状态按「人看到了什么」定：动作前后截图有肉眼可见的变化（`visualDelta`）或换了页面 → `success`，否则 `no_effect`。HTTP 5xx、JS 错误、「发了请求但屏幕没变」等错误码是工程信号，只挂在结果上。
    - `selector` / `a11y` / `text` / `coords` / `ref` 目标只用于干净重放（`executor: 'playwright'`，不调用模型）与弹窗按钮。
  - 几个应用（标签页）：`showTab(key, url?)` 切到另一个应用，没开过就新开并打开 `url`（例如城里给的邮箱 App），原来那个在后台（页面可见性 hidden），录像跟着切过去；`tab` 是当前应用（`main` 是被测产品）。
  - 打断：`switchAway` / `returnBack`（visibilityState 覆盖 + 生命周期冻结）、`closeTab` / `reopenLast`；`setNetwork`（CDP 限速）；`setGeolocation`；`takeoverUrl`（浏览器的远程调试画面，供人介入时接手，例如过验证码）。
- `humanize.ts`：人类化的手（纯函数）。鼠标轨迹（贝塞尔曲线、缓入缓出、偶尔冲过头再修正，时长按 Fitts 定律）；落点（精度、单手、目标大小决定离散程度；点偏过的人下一次更小心；触屏有手指容差）；打字节奏（按人物速度，邻键错字 + 回删）；滚轮分格；触屏滑动轨迹。真实耗时被压缩，模拟时钟按人物速度另行结算。
- `visual.ts`：两张截图之间肉眼可见的变化量；把原生弹窗画进截图。
- `page-scripts.ts`：注入脚本（DOM 变更计数、通知拦截、可见性控制、元素几何抽取）。`<select>` 的系统选项列表在无界面浏览器里拍不到，这里在页面里画一个样子相同的列表（点开 → 看见选项 → 点选），只替代系统控件的显示。
- `policy.ts`：Policy Gate 规则（支付提交、公开发布、加陌生人、对外发送、上传人脸、提交真实个人信息；儿童更严格；成人仅允许沙箱域名支付）。
- `modality.ts`：语音（合成 → wav → 假麦克风；「设置 › 模型」里接入了 Vertex 连接时用 Gemini 语音合成，否则用本机的 espeak）、相机（图片或画图模型生成的图 → y4m → 假摄像头；没有接入画图模型且没给图片时这个动作不生效）。
- `evidence.ts`：证据登记（MinIO 内容寻址 + `evidence` 表）与 `evidence_links`。
