import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function findRoot(start: string): string {
  let dir = start;
  for (;;) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return process.cwd();
    dir = parent;
  }
}

/** 仓库根目录（含 pnpm-workspace.yaml） */
export const REPO_ROOT = process.env.PUX_ROOT ? resolve(process.env.PUX_ROOT) : findRoot(dirname(fileURLToPath(import.meta.url)));
export const CONFIG_DIR = join(REPO_ROOT, 'config');
export const DATA_DIR = process.env.PUX_DATA_DIR ? resolve(process.env.PUX_DATA_DIR) : join(REPO_ROOT, 'data');
export const dataPath = (...p: string[]) => join(DATA_DIR, ...p);
export const configPath = (...p: string[]) => join(CONFIG_DIR, ...p);
