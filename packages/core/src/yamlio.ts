import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import YAML from 'yaml';

export const readYaml = <T = unknown>(path: string): T => YAML.parse(readFileSync(path, 'utf8')) as T;
export const writeYaml = (path: string, data: unknown) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, YAML.stringify(data, { lineWidth: 120 })); };
export const readJson = <T = unknown>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;
export const writeJson = (path: string, data: unknown) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, JSON.stringify(data, null, 2)); };
export const listFiles = (dir: string, ext: RegExp) => existsSync(dir) ? readdirSync(dir, { recursive: true, withFileTypes: false }).map(String).filter((f) => ext.test(f)).map((f) => join(dir, f)) : [];
