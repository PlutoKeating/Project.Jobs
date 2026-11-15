/**
 * 条款与条件。主体：PlutoKeating 以个人身份开发与运营；软件以 AGPL-3.0 发布。
 * 每一句都要与实际的代码和脚本相符（deploy/install.sh、docs/INSTALL.md、LICENSE）；改了这一页，同时改 src/site.mjs 的 POLICY_UPDATED 与 POLICY_VERSION。
 */
import { CONTACT_EMAIL, GITHUB_ISSUES, GITHUB_LICENSE, GITHUB_REPO, POLICY_UPDATED, POLICY_VERSION } from '../site.mjs';

export const terms = {
  zh: {
    title: '条款与条件',
    description: '使用 Jobs 的网站、安装脚本与软件的条款：主体、许可、安装脚本做什么、你的责任、模拟结果、第三方服务、无担保与责任限制。',
    heading: '条款与条件',
    lead: '使用本网站（jobs.plutokeating.beer）、运行这里提供的安装脚本，或安装、使用 Jobs 软件，即表示你接受以下条款。',
    meta: `最近更新 ${POLICY_UPDATED} · 版本 ${POLICY_VERSION}`,
    sections: [
      {
        heading: '1. 关于本网站与软件',
        paragraphs: [
          `本网站与 Jobs 软件由 PlutoKeating 以个人身份开发与运营，联系邮箱 [${CONTACT_EMAIL}](mailto:${CONTACT_EMAIL})。本网站用于介绍项目并提供安装脚本。Jobs 是一个装在你自己机器上的软件：它运行一座住着虚拟居民的小城，让居民用真实的浏览器去使用你发布进去的产品，并把结果整理成结论。`,
        ],
      },
      {
        heading: '2. 许可',
        paragraphs: [
          `Jobs 软件以 [GNU Affero General Public License v3.0](${GITHUB_LICENSE})（AGPL-3.0）发布，[源码在 GitHub](${GITHUB_REPO})。你对软件的复制、修改、分发与通过网络提供服务均受该许可证约束：修改后让别人通过网络使用时，要以同一许可证向他们提供对应的源码。`,
          '本网站的文字与页面在未另行注明时随仓库以同一许可证发布。软件内含的第三方组件按各自的许可证使用。第三方商标与名称归各自所有者所有。Terraria 是 Re-Logic 的商标；Jobs 是独立项目，与 Re-Logic、任何模型供应商或本网站提到的其他公司没有隶属或背书关系。',
        ],
      },
      {
        heading: '3. 安装脚本',
        paragraphs: ['本网站提供的一行安装命令会下载并执行一个脚本。它是公开的纯文本，[运行之前可以先读一遍](/install)。它会在你的机器上：'],
        bullets: [
          '检查 Docker；在 Linux 上没有 Docker 时，用 Docker 官方脚本安装（需要管理员权限，可以用环境变量关掉）。',
          '从 GitHub 的容器仓库与 Docker Hub 拉取镜像，在 `~/.jobs` 写入编排文件和一份只有你能读的配置，其中的口令与密钥在你的机器上随机生成。',
          '启动服务（随 Docker 自启），并把 `jobsworld` 命令放进 `/usr/local/bin`（没有权限时放 `~/.local/bin`）。',
          '在使用 systemd 且能免密取得管理员权限的 Linux 上，再装一个只负责开关游戏服的小监视单元。',
        ],
      },
      {
        heading: '4. 你的责任',
        paragraphs: ['Jobs 会在你的机器上自动运行浏览器、调用你接入的模型并产生费用。使用时请注意：'],
        bullets: [
          '只发布你自己拥有或已获授权测试的产品与网址。居民会像真人一样注册、填表、点按钮，包括付款按钮；请把它指向测试环境，不要指向存有真实用户数据或会产生真实交易的系统。',
          '不得用它给他人的网站制造负担、绕过访问限制、批量抓取，或从事任何违法、侵权的活动。因你发布的网址而产生的后果由你负责。',
          '模型调用不设花费上限。花了多少会一直显示在页头和产品页，但费用由你与你的模型供应商结算，由你自己控制。',
          '默认情况下，装好的 Jobs 监听这台机器的所有网卡，流量是明文 HTTP，靠两个口令保护。是否对外开放、是否加 TLS、口令交给谁，由你决定并负责。',
        ],
      },
      {
        heading: '5. 模拟结果',
        paragraphs: [
          '居民是虚构的：名字、生平、看法与原话由模型生成，与任何真实的人相同纯属巧合。人数是这座城里实际发生的人数；人数、评分与结论都是模拟结果，不是对真实市场的预测，没有用真人数据校准，不取代真人用户研究，也不构成任何专业意见。',
          '模型生成的内容可能有错漏、偏见或让人不适的表达。请不要把模拟得到的人数或评价当作真实用户的数据对外宣称，也不要把它当作产品决策的唯一依据。',
        ],
      },
      {
        heading: '6. 第三方服务',
        paragraphs: [
          '安装与使用过程中会涉及第三方：Cloudflare（托管本网站）、GitHub（源代码与镜像）、Docker Hub（数据库、对象存储、事件总线的标准镜像）、你自行选择的模型供应商、models.dev（模型目录）、Google Fonts（装好的网页里的中文字体），以及你选择接入的飞书。这些服务各有其条款与隐私政策，与本项目无关。',
        ],
      },
      {
        heading: '7. 无担保',
        paragraphs: [
          '本网站与软件按「现状」提供，不作任何明示或默示的担保，包括但不限于适销性、特定用途适用性与不侵权。Jobs 仍在快速迭代，版本之间可能有不兼容的改动；请自行备份重要数据。',
        ],
      },
      {
        heading: '8. 责任限制',
        paragraphs: [
          '在法律允许的最大范围内，作者不对因使用或无法使用本网站或软件而产生的任何直接、间接、附带、特殊或后果性损害承担责任，包括数据丢失、设备损坏、模型调用费用、业务中断，或依据模拟结果作出的决定所带来的损失。本条款不排除依法不得排除的责任。',
        ],
      },
      {
        heading: '9. 变更',
        paragraphs: ['本条款可能随项目演进而更新，更新后的版本在本页发布即生效，页首标注日期与版本。'],
      },
      {
        heading: '10. 联系',
        paragraphs: [`关于本条款的问题，请发邮件到 [${CONTACT_EMAIL}](mailto:${CONTACT_EMAIL})，或在 [GitHub Issues](${GITHUB_ISSUES}) 提出。`],
      },
    ],
  },
  en: {
    title: 'Terms & Conditions',
    description: 'Terms for using the Jobs website, install script and software: operator, licence, what the installer does, your responsibilities, simulated results, third-party services, no warranty and limitation of liability.',
    heading: 'Terms & Conditions',
    lead: 'By using this website (jobs.plutokeating.beer), running the install script offered here, or installing and using the Jobs software, you accept the following terms.',
    meta: `Last updated ${POLICY_UPDATED} · Version ${POLICY_VERSION}`,
    sections: [
      {
        heading: '1. About the site and the software',
        paragraphs: [
          `This website and the Jobs software are built and run by PlutoKeating as an individual; contact [${CONTACT_EMAIL}](mailto:${CONTACT_EMAIL}). The website presents the project and serves the install script. Jobs is software that runs on your own machine: it runs a small town of virtual residents, lets them use the product you launch into it with a real browser, and turns what happened into a conclusion.`,
        ],
      },
      {
        heading: '2. Licence',
        paragraphs: [
          `The Jobs software is released under the [GNU Affero General Public License v3.0](${GITHUB_LICENSE}) (AGPL-3.0), with the [source on GitHub](${GITHUB_REPO}). Copying, modifying, distributing and offering the software over a network are governed by that licence: if you let others use a modified version over a network, you must offer them the corresponding source under the same licence.`,
          'Unless stated otherwise, the text and pages of this website are published with the repository under the same licence. Third-party components inside the software are used under their own licences. Third-party trademarks and names belong to their respective owners. Terraria is a trademark of Re-Logic; Jobs is an independent project and is not affiliated with or endorsed by Re-Logic, any model provider or any other company mentioned on this website.',
        ],
      },
      {
        heading: '3. The install script',
        paragraphs: ['The one-line install command on this website downloads and runs a script. It is public plain text, and [you can read it before running it](/install). On your machine it will:'],
        bullets: [
          'Check for Docker; on Linux without Docker, install it with Docker’s official script (this needs administrator rights and can be switched off with an environment variable).',
          'Pull images from GitHub’s container registry and Docker Hub, and write the compose files and a configuration only you can read into `~/.jobs`; the passcodes and keys in it are generated at random on your machine.',
          'Start the services (they come back up with Docker) and put the `jobsworld` command in `/usr/local/bin`, or in `~/.local/bin` when it lacks permission.',
          'On Linux with systemd and passwordless administrator rights, also install a small watcher unit whose only job is switching the game servers on and off.',
        ],
      },
      {
        heading: '4. Your responsibilities',
        paragraphs: ['Jobs runs browsers on your machine by itself, calls the models you connect and incurs cost. When you use it:'],
        bullets: [
          'Launch only products and URLs you own or are authorised to test. Residents sign up, fill in forms and press buttons the way people do, including pay buttons; point it at a test environment, not at a system that holds real user data or performs real transactions.',
          'Do not use it to burden other people’s websites, bypass access controls, scrape in bulk, or for anything unlawful or infringing. You are responsible for the consequences of the URLs you launch.',
          'There is no spending cap on model calls. What you have spent is always shown in the page header and on each product page, but the charges are between you and your model provider and are yours to control.',
          'By default an installed Jobs listens on every network interface of the machine, over plain HTTP, protected by two passcodes. Whether to expose it, whether to add TLS and whom to give the passcodes to are your decisions and your responsibility.',
        ],
      },
      {
        heading: '5. Simulated results',
        paragraphs: [
          'The residents are fictional: their names, life stories, opinions and words are generated by a model, and any resemblance to an actual person is coincidental. The head counts are what happened in this town; head counts, ratings and conclusions are all simulated results. They are not a forecast of a real market, have not been calibrated against real people, do not replace research with real users and are not professional advice of any kind.',
          'Model-generated content may contain errors, bias or wording some people find offensive. Do not present simulated head counts or reviews to others as data from real users, and do not treat them as the sole basis for a product decision.',
        ],
      },
      {
        heading: '6. Third-party services',
        paragraphs: [
          'Installation and use involve third parties: Cloudflare (hosting this website), GitHub (source code and images), Docker Hub (the standard images for the database, object storage and event bus), the model providers you choose, models.dev (the model catalog), Google Fonts (the Chinese typeface in the installed web page) and Feishu if you choose to connect it. Each has its own terms and privacy policy, independent of this project.',
        ],
      },
      {
        heading: '7. No warranty',
        paragraphs: [
          'The website and the software are provided “as is”, without warranty of any kind, express or implied, including but not limited to merchantability, fitness for a particular purpose and non-infringement. Jobs is changing quickly and versions may introduce incompatible changes; back up anything important yourself.',
        ],
      },
      {
        heading: '8. Limitation of liability',
        paragraphs: [
          'To the fullest extent permitted by law, the author is not liable for any direct, indirect, incidental, special or consequential damages arising from the use of or inability to use the website or the software, including loss of data, damage to devices, model charges, business interruption, or losses from decisions made on the basis of simulated results. Nothing in these terms excludes liability that cannot be excluded by law.',
        ],
      },
      {
        heading: '9. Changes',
        paragraphs: ['These terms may be updated as the project evolves. The updated version takes effect when published on this page, with the date and version shown at the top.'],
      },
      {
        heading: '10. Contact',
        paragraphs: [`Questions about these terms go to [${CONTACT_EMAIL}](mailto:${CONTACT_EMAIL}), or to [GitHub Issues](${GITHUB_ISSUES}).`],
      },
    ],
  },
};
