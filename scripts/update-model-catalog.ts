// 更新随包的模型目录快照（config/models/catalog.json）。装好的 Jobs 在拉不到 models.dev 时用它。
//   npx tsx scripts/update-model-catalog.ts [本地 api.json 路径]
import { readFileSync, writeFileSync } from 'node:fs';
import { configPath } from '@pux/core';
import { fetchCatalog, normalizeCatalog } from '@pux/llm';

const local = process.argv[2];
const cat = local ? normalizeCatalog(JSON.parse(readFileSync(local, 'utf8'))) : await fetchCatalog();
const out = configPath('models', 'catalog.json');
writeFileSync(out, JSON.stringify(cat));
console.log(`${cat.providers.length} 家供应商、${cat.providers.reduce((n, p) => n + p.models.length, 0)} 个模型 → ${out}`);
process.exit(0);
