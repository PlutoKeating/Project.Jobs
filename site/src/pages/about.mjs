/** 关于页。事实依据 README.md（它怎么工作、人口从哪来、定位声明）、PRODUCT.md、LICENSE。 */
import { CONTACT_EMAIL, GITHUB_ISSUES, GITHUB_LICENSE, GITHUB_REPO } from '../site.mjs';
import { shell } from '../shell.mjs';

export const about = {
  zh: {
    title: '关于',
    description: 'Jobs 是什么、怎么工作、不是什么、由谁开发与运营，以及它用到的开源项目与数据。',
    heading: '关于 Jobs',
    lead: '把产品发布到一座住着两百位虚拟居民的城里，看他们自己怎么对待它。',
    meta: shell.zh.tribute,
    sections: [
      {
        heading: '这是什么',
        paragraphs: [
          'Jobs 是给独立开发者和小团队用的：产品刚做出来，还没有任何真实用户，想在发出去之前，先看到一群各不相同的人第一次遇到它时会发生什么。',
          '你给它一个网址、一个名字、一句话。JobsWorld 里的居民按各自的日程过日子，在应用商店、广告和熟人口中遇到你的产品，自己决定看不看、用不用、留不留、跟谁说。过一会儿回来，读一页人话的结论。',
        ],
      },
      {
        heading: '它怎么工作',
        bullets: [
          '遇到：居民手机在手边时会刷到广告、逛到商店、看到别人发的动态；路上瞥见广告牌；熟人当面提起。多数曝光根本没被注意到。',
          '决定：只有注意到的人，才由他自己说要不要点开。忙、累、对不上自己的事，就划过去。没有人被指派去测试。',
          '使用：点开的人在自己此时此地的处境里用，只看得到屏幕截图，不知道这是测试。需要注册时，用城里发给他的邮箱和手机号。',
          '之后：写不写评论、跟谁说、过几天回不回来，都由这次经历决定；口碑沿着关系网传开。',
          '结论：好不好用、最让人难受的地方、谁会留下谁会走、看到的人为什么没点开、最该改的一件事。每一句都能点开看是谁说的、原话和当时的屏幕。',
        ],
      },
      {
        heading: '它不是什么',
        bullets: [
          '不是对真实市场的预测。所有人数都是这座城里实际发生的人数，是模拟，还没有用真人数据校准。',
          '不取代真人用户研究。合成用户的反馈偏浅、偏正面、缺少长尾。',
          '不是托管服务。它装在你自己的机器上，模型由你接入，数据留在你那里。',
          '居民不是真人。名字、生平和看法由模型写成，与任何真实的人相同纯属巧合。',
        ],
      },
      {
        heading: '居民从哪来',
        paragraphs: [
          '中国人群按一张手工设定的条件抽样表生成（家庭类型、年龄、学历、职业、收入），数值是依据公开汇总数据的量级取的近似值。英语区人群从 [NVIDIA Nemotron-Personas-USA](https://huggingface.co/datasets/nvidia/Nemotron-Personas-USA)（CC BY 4.0，基于美国人口普查分布的合成人口）随机抽样，再拼成家庭。数字素养、视力、耐心这类数值由规则推导，模型只写名字、生平和看法。',
        ],
      },
      {
        heading: '谁在做',
        paragraphs: [
          `Jobs 由 PlutoKeating 以个人身份开发与运营，不是公司。这个网站只用来介绍项目、放安装脚本。问题和建议请到 [GitHub Issues](${GITHUB_ISSUES})，其他事情发邮件到 [${CONTACT_EMAIL}](mailto:${CONTACT_EMAIL})。`,
        ],
      },
      {
        heading: '开源与致谢',
        paragraphs: [
          `Jobs 以 [GNU Affero General Public License v3.0](${GITHUB_LICENSE}) 发布，[源码在 GitHub](${GITHUB_REPO})。它建立在这些项目之上，各自按自己的许可证使用：`,
        ],
        bullets: [
          '浏览器与界面理解：Playwright、Midscene、axe-core、rrweb。',
          '服务与存储：Fastify、PostgreSQL 与 pgvector、MinIO、NATS、Drizzle。',
          '网页：React、TanStack Router 与 Query、Tailwind CSS、PixiJS、Lucide。',
          '游戏端：TShock、tModLoader；蓝图读取移植自 TEdit（Microsoft Public License）。Terraria 是 Re-Logic 的商标，Jobs 与 Re-Logic 没有隶属关系。',
          '数据：models.dev 的模型目录；NVIDIA Nemotron-Personas-USA（CC BY 4.0）。',
          '字体：Inter 与思源黑体（Noto Sans CJK SC），均为 SIL Open Font License 1.1。',
        ],
      },
    ],
  },
  en: {
    title: 'About',
    description: 'What Jobs is, how it works, what it is not, who builds and runs it, and the open-source projects and data it relies on.',
    heading: 'About Jobs',
    lead: 'Launch a product into a town of two hundred virtual residents and watch what they make of it.',
    meta: shell.en.tribute,
    sections: [
      {
        heading: 'What it is',
        paragraphs: [
          'Jobs is for independent developers and small teams whose product is freshly built and has no real users yet. Before sending it out, they want to see what happens when a crowd of very different people meets it for the first time.',
          'You give it a URL, a name and one line. The residents of JobsWorld live by their own schedules, come across your product in the app store, in ads and from people they know, and decide for themselves whether to look, to use it, to stay and whom to tell. Come back a little later and read a one-page conclusion in plain language.',
        ],
      },
      {
        heading: 'How it works',
        bullets: [
          'Encounter: with a phone at hand, residents scroll past ads, browse the store and see what others post; they glimpse a billboard on the way; someone they know brings it up. Most exposures are never noticed.',
          'Decision: only someone who noticed it gets to say whether they open it. Busy, tired or simply not their thing, and they scroll on. Nobody is assigned to test.',
          'Use: whoever opens it uses it in the situation they are in at that moment, sees only screenshots, and does not know it is a test. When sign-up is needed they use the email address and phone number the town issued them.',
          'Afterwards: whether they write a review, whom they tell and whether they come back in a few days all follow from that experience; word of mouth travels along their relationships.',
          'Conclusion: whether it works, what hurt most, who stays and who leaves, why people who saw it did not open it, and the one thing to fix first. Every sentence opens to who said it, their words and the screen at that moment.',
        ],
      },
      {
        heading: 'What it is not',
        bullets: [
          'It is not a forecast of a real market. Every head count is what happened in this town: a simulation that has not been calibrated against real people.',
          'It does not replace research with real users. Feedback from synthetic users runs shallow, runs positive and misses the long tail.',
          'It is not a hosted service. It runs on your own machine, with models you connect, and the data stays with you.',
          'The residents are not real people. Their names, life stories and opinions are written by a model; any resemblance to an actual person is coincidental.',
        ],
      },
      {
        heading: 'Where the residents come from',
        paragraphs: [
          'The Chinese population is generated from a hand-set conditional sampling table (household type, age, education, occupation, income) whose values approximate the scale of published aggregate statistics. The English-speaking population is sampled at random from [NVIDIA Nemotron-Personas-USA](https://huggingface.co/datasets/nvidia/Nemotron-Personas-USA) (CC BY 4.0, a synthetic population based on US census distributions) and then assembled into households. Values such as digital literacy, eyesight and patience are derived by rules; the model writes only names, life stories and opinions.',
        ],
      },
      {
        heading: 'Who is behind it',
        paragraphs: [
          `Jobs is built and run by PlutoKeating as an individual, not a company. This website only presents the project and serves the install script. Bugs and suggestions go to [GitHub Issues](${GITHUB_ISSUES}); for anything else, write to [${CONTACT_EMAIL}](mailto:${CONTACT_EMAIL}).`,
        ],
      },
      {
        heading: 'Open source and thanks',
        paragraphs: [
          `Jobs is released under the [GNU Affero General Public License v3.0](${GITHUB_LICENSE}), with the [source on GitHub](${GITHUB_REPO}). It stands on these projects, each used under its own licence:`,
        ],
        bullets: [
          'Browser and interface understanding: Playwright, Midscene, axe-core, rrweb.',
          'Services and storage: Fastify, PostgreSQL with pgvector, MinIO, NATS, Drizzle.',
          'Web: React, TanStack Router and Query, Tailwind CSS, PixiJS, Lucide.',
          'Game side: TShock and tModLoader; the schematic reader is ported from TEdit (Microsoft Public License). Terraria is a trademark of Re-Logic, and Jobs is not affiliated with Re-Logic.',
          'Data: the models.dev model catalog; NVIDIA Nemotron-Personas-USA (CC BY 4.0).',
          'Type: Inter and Noto Sans CJK SC, both under the SIL Open Font License 1.1.',
        ],
      },
    ],
  },
};
