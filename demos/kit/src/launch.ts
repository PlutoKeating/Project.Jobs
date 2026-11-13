// 启动全部 Demo（每个 App 一个干净版 + 一个植入缺陷版）
import { createDemoApp } from './framework.ts';
import { DEMO_APPS, demoPort } from './catalog.ts';

const only = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const host = process.env.DEMO_HOST ?? '127.0.0.1';
const apps = DEMO_APPS.filter((a) => !only.length || only.includes(a.id));
for (const def of apps) {
  for (const seeded of [false, true]) {
    const port = demoPort(def.id, seeded);
    const { listen } = createDemoApp(def, { port, seeded, host });
    await listen();
    console.log(`${seeded ? '🐞 seeded' : '✅ clean '}  ${def.id.padEnd(10)} ${def.name.padEnd(8)} http://${host}:${port}/  (${seeded ? def.defects.length + ' 个已知缺陷' : '无植入缺陷'})`);
  }
}
console.log(`\n共启动 ${apps.length * 2} 个实例。Ctrl+C 退出。`);
