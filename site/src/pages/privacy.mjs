/**
 * 隐私政策。每一句都对应实际的代码，功能变了要同步改，并同时改 src/site.mjs 的 POLICY_UPDATED 与 POLICY_VERSION：
 * - 网站：site/（纯静态；localStorage 只有 jobs.theme 与 jobs.lang；字体自托管；_headers 的 CSP 不允许任何第三方来源）
 * - 安装脚本：deploy/install.sh（get.docker.com、GHCR、Docker Hub；口令与密钥本机生成）
 * - 数据在哪：deploy/compose.yml（三个 Docker 卷）、packages/llm/src/secrets.ts（凭证加密）
 * - 对外连接：packages/llm（你接入的模型供应商、models.dev 目录）、apps/api/src/feishu.ts（可选）、apps/web/index.html（Google Fonts）、
 *   packages/executor（无头浏览器访问你发布的网址）
 * - 没有任何统计或上报：仓库里没有分析 SDK，也没有指向作者服务器的请求
 */
import { CONTACT_EMAIL, GITHUB_ISSUES, POLICY_UPDATED, POLICY_VERSION, STORAGE_LANG, STORAGE_THEME } from '../site.mjs';

export const privacy = {
  zh: {
    title: '隐私政策',
    description: '本网站不设 Cookie、不做统计、不加载第三方资源；Jobs 装在你自己的机器上，数据留在你那里，作者接触不到。',
    heading: '隐私政策',
    lead: '本页说明本网站、安装脚本和装好的 Jobs 会接触到什么、不会接触到什么。文字按实际代码写，功能变化时同步更新。',
    meta: `最近更新 ${POLICY_UPDATED} · 版本 ${POLICY_VERSION}`,
    sections: [
      {
        heading: '1. 本网站',
        paragraphs: ['本网站（jobs.plutokeating.beer）是纯静态页面：不设置 Cookie，不加载统计脚本、广告，也不向任何第三方请求字体、脚本或图片。没有账号，没有表单，不收集你的任何信息。'],
        bullets: [
          `外观与语言偏好保存在你浏览器的 localStorage 里（键 \`${STORAGE_THEME}\` 与 \`${STORAGE_LANG}\`），只在你的设备上，随时可在浏览器中清除。`,
          '本网站托管在 Cloudflare。Cloudflare 作为托管与网络服务商可能按其隐私政策处理连接日志（如 IP 地址）；本项目不读取、不保存这些日志。',
          '下载安装脚本（`/install`）的请求不带任何身份，本站不记录是谁下载的。',
          '页面上指向 GitHub 的链接在你点击后由 GitHub 按其隐私政策处理。',
        ],
      },
      {
        heading: '2. 安装脚本',
        paragraphs: ['安装脚本只在你的机器上运行，不向作者发送任何东西。它会让你的机器连到这些地方，对方因此会看到你的 IP 地址：'],
        bullets: [
          'GitHub 的容器仓库（拉取 Jobs 的镜像）与 Docker Hub（拉取数据库、对象存储、事件总线的标准镜像）。',
          'get.docker.com：仅当你的 Linux 机器上没有 Docker、并且你没有关掉自动安装时。',
          '口令与密钥在你的机器上随机生成，写进只有你能读的 `~/.jobs/.env`，不会离开这台机器。',
        ],
      },
      {
        heading: '3. 装好的 Jobs：数据在哪',
        paragraphs: ['Jobs 是装在你自己机器上的软件，不是托管服务。作者没有任何途径接触你的实例：软件里没有统计、没有遥测，也不向作者的服务器发任何请求。'],
        bullets: [
          '居民、记忆、你发布的产品、每一次使用的过程（逐步的截图、录像、页面记录、居民的想法）、评论与结论，都存在你机器上的 Docker 卷里（数据库与对象存储）。每次升级之前，数据库会先导出一份到 `~/.jobs/backups`（只留最近 5 份）。',
          '你填入的模型凭证与飞书应用凭证加密后（AES-256-GCM）存在数据库里，密钥在 `~/.jobs/.env`，与数据库分开存放。',
          '谁拿到口令，谁就能看到这些内容：访客口令只能看，管理员口令可以发布、调整与接入模型。默认监听这台机器的所有网卡，流量是明文 HTTP；要放到公网上，请在前面加一层带 TLS 的反向代理。',
        ],
      },
      {
        heading: '4. 你的实例会连到哪里',
        paragraphs: ['装好的 Jobs 只在这些情况下向外连接：'],
        bullets: [
          '你接入的模型供应商：居民的每一步都要调用模型，发过去的内容包括居民的人物设定与处境、当时的屏幕截图（也就是你的产品在那一刻显示的内容）、你填写的产品名字与一句话。供应商如何处理这些内容，以它的条款与隐私政策为准。',
          '你发布的网址：居民用这台机器上的浏览器访问它，产品的服务器会看到来自这台机器的请求，以及居民注册时填写的虚构邮箱与手机号。',
          'models.dev：管理员在「模型」页刷新目录时，读取一份公开的模型目录，请求不带身份；平时用的是随软件自带的那份。',
          'Google Fonts：装好的网页会向 Google 请求中文字体，打开网页的人的浏览器因此会连到 Google。',
          '飞书（可选）：只有在你扫码接入之后。你发给机器人的话、它回你的内容和主动推送经过飞书。',
          'GitHub 的容器仓库与 Docker Hub：只在你升级，或第一次打开某个游戏服时拉取镜像。',
          'GitHub 的公开接口（检查新版本）：每 6 小时读一次本项目在 GitHub 上最新发布的版本号，好在网页上提示升级。请求不带身份，也不带这台机器或你的任何数据，只是一次普通的读取；GitHub 会看到来自这台机器的请求。在 `~/.jobs/.env` 里加 `JOBS_UPDATE_CHECK=0` 并运行 `jobsworld up` 即可关闭。',
        ],
      },
      {
        heading: '5. 居民与被测的产品',
        paragraphs: [
          '居民是虚构的：名字、生平和看法由模型写成，不对应任何真实的人；他们的邮箱与手机号是城里发的，不是真实的联系方式。',
          '居民看到什么，Jobs 就把什么截下来存在你的机器上，并发给你接入的模型供应商。请把它指向测试环境：不要让它使用会显示真实用户个人信息的系统。接收验证码的两个收件箱接口不需要登录，只能往居民的收件箱里投递消息，读不到任何东西。在「设置」里开通居民邮箱后，发给居民的真实邮件经你自己的 Cloudflare 账号转发到你的机器，原件和正文都存在你的机器上；Jobs 只收信，不发信。',
        ],
      },
      {
        heading: '6. 保存多久与如何删除',
        paragraphs: [
          '数据一直留在你的机器上，直到你删除。`jobsworld uninstall --purge` 会停止服务并删除全部数据卷；之后删掉 `~/.jobs` 目录即可。浏览器里的两项偏好在浏览器的站点数据里清除。',
        ],
      },
      {
        heading: '7. 未成年人',
        paragraphs: ['本网站与 Jobs 面向开发者，不面向未成年人，也不收集任何人的个人信息。'],
      },
      {
        heading: '8. 变更',
        paragraphs: ['本政策随功能变化而更新，更新后的版本在本页发布即生效，页首标注日期与版本。'],
      },
      {
        heading: '9. 联系',
        paragraphs: [`关于隐私的问题，请发邮件到 [${CONTACT_EMAIL}](mailto:${CONTACT_EMAIL})，或在 [GitHub Issues](${GITHUB_ISSUES}) 提出。`],
      },
    ],
  },
  en: {
    title: 'Privacy Policy',
    description: 'This website sets no cookies, runs no analytics and loads nothing from third parties. Jobs runs on your own machine; the data stays with you and is out of the author’s reach.',
    heading: 'Privacy Policy',
    lead: 'This page explains what this website, the install script and an installed Jobs touch and what they do not. It is written against the actual code and is updated when the behaviour changes.',
    meta: `Last updated ${POLICY_UPDATED} · Version ${POLICY_VERSION}`,
    sections: [
      {
        heading: '1. This website',
        paragraphs: ['This website (jobs.plutokeating.beer) is plain static pages. It sets no cookies, loads no analytics or ads, and requests no fonts, scripts or images from any third party. There are no accounts and no forms, and it collects nothing about you.'],
        bullets: [
          `Your appearance and language preferences are stored in your browser’s localStorage (keys \`${STORAGE_THEME}\` and \`${STORAGE_LANG}\`), on your device only, and can be cleared in the browser at any time.`,
          'This website is hosted on Cloudflare. As the hosting and network provider, Cloudflare may process connection logs (such as IP addresses) under its own privacy policy; this project does not read or keep those logs.',
          'The request that downloads the install script (`/install`) carries no identity, and this site does not record who downloaded it.',
          'Links to GitHub on these pages are handled by GitHub under its privacy policy once you follow them.',
        ],
      },
      {
        heading: '2. The install script',
        paragraphs: ['The install script runs only on your machine and sends nothing to the author. It makes your machine connect to the following, which therefore see your IP address:'],
        bullets: [
          'GitHub’s container registry (to pull the Jobs image) and Docker Hub (to pull the standard images for the database, object storage and event bus).',
          'get.docker.com: only when your Linux machine has no Docker and you have not switched automatic installation off.',
          'Passcodes and keys are generated at random on your machine, written to `~/.jobs/.env`, which only you can read, and never leave the machine.',
        ],
      },
      {
        heading: '3. An installed Jobs: where the data is',
        paragraphs: ['Jobs is software that runs on your own machine, not a hosted service. The author has no way to reach your instance: the software has no analytics, no telemetry and makes no request to any server of the author’s.'],
        bullets: [
          'Residents, memories, the products you launch, every use of them (step-by-step screenshots, video, page recordings and the resident’s thoughts), reviews and conclusions are all stored in Docker volumes on your machine (a database and an object store). Before every upgrade the database is also exported to `~/.jobs/backups` (the latest 5 are kept).',
          'The model credentials and Feishu app credentials you enter are stored encrypted (AES-256-GCM) in the database; the key is in `~/.jobs/.env`, kept apart from the database.',
          'Whoever holds a passcode can see this content: the visitor passcode can only look, and the administrator passcode can launch, adjust and connect models. By default it listens on every network interface of the machine over plain HTTP; before exposing it to the internet, put a reverse proxy with TLS in front of it.',
        ],
      },
      {
        heading: '4. Where your instance connects',
        paragraphs: ['An installed Jobs makes outbound connections only in these cases:'],
        bullets: [
          'The model providers you connect: every step a resident takes calls a model. What is sent includes the resident’s profile and situation, the screenshot at that moment (that is, whatever your product was showing), and the product name and one line you entered. How the provider handles this is governed by its own terms and privacy policy.',
          'The URL you launch: residents visit it with a browser on this machine, so the product’s server sees requests from this machine and the fictional email addresses and phone numbers residents sign up with.',
          'models.dev: when an administrator refreshes the catalog on the Models page, a public model catalog is fetched with no identity attached; otherwise the copy shipped with the software is used.',
          'Google Fonts: the installed web page requests a Chinese typeface from Google, so the browser of whoever opens the page connects to Google.',
          'Feishu (optional): only after you connect it by scanning the code. What you say to the bot, what it replies and what it pushes to you pass through Feishu.',
          'GitHub’s container registry and Docker Hub: only when you upgrade, or the first time you switch a game server on, to pull images.',
          'GitHub’s public API (update check): every 6 hours the instance reads the version number of this project’s latest release on GitHub so the web page can tell you an update is out. The request carries no identity and none of this machine’s or your data; it is a plain read, and GitHub sees a request from this machine. To turn it off, add `JOBS_UPDATE_CHECK=0` to `~/.jobs/.env` and run `jobsworld up`.',
        ],
      },
      {
        heading: '5. Residents and the product under test',
        paragraphs: [
          'The residents are fictional: their names, life stories and opinions are written by a model and correspond to no actual person; their email addresses and phone numbers are issued by the town and are not real contact details.',
          'Whatever a resident sees, Jobs captures and stores on your machine and sends to the model provider you connected. Point it at a test environment, and do not let it use a system that displays the personal information of real users. The two inbox endpoints that receive verification codes need no sign-in; they can only deliver messages into a resident’s inbox and cannot read anything. Once you turn on resident mail in Settings, real mail sent to residents is forwarded through your own Cloudflare account to your machine, where the original and its text are stored; Jobs only receives mail and never sends any.',
        ],
      },
      {
        heading: '6. Retention and deletion',
        paragraphs: [
          'The data stays on your machine until you delete it. `jobsworld uninstall --purge` stops the services and deletes every data volume; after that, remove the `~/.jobs` directory. The two browser preferences are cleared from the site data in your browser.',
        ],
      },
      {
        heading: '7. Minors',
        paragraphs: ['This website and Jobs are meant for developers, are not directed at minors, and collect no personal information about anyone.'],
      },
      {
        heading: '8. Changes',
        paragraphs: ['This policy is updated as the behaviour changes. The updated version takes effect when published on this page, with the date and version shown at the top.'],
      },
      {
        heading: '9. Contact',
        paragraphs: [`Questions about privacy go to [${CONTACT_EMAIL}](mailto:${CONTACT_EMAIL}), or to [GitHub Issues](${GITHUB_ISSUES}).`],
      },
    ],
  },
};
