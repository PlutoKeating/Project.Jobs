import type { DemoAppDef } from './framework.ts';
import { assistant } from './apps/assistant.ts';
import { ledger } from './apps/ledger.ts';
import { planner } from './apps/planner.ts';
import { shop } from './apps/shop.ts';
import { LIGHT_APPS } from './apps/light.ts';

/** 全部 Demo 被测应用。顺序决定端口：clean = base+i+1，seeded = seededBase+i+1 */
export const DEMO_APPS: DemoAppDef[] = [assistant, ledger, planner, shop, ...LIGHT_APPS];
export const PORT_BASE = { clean: Number(process.env.DEMO_CLEAN_PORT_BASE ?? 5400), seeded: Number(process.env.DEMO_SEEDED_PORT_BASE ?? 5500) };
export const demoPort = (id: string, seeded: boolean) => (seeded ? PORT_BASE.seeded : PORT_BASE.clean) + DEMO_APPS.findIndex((a) => a.id === id) + 1;
export const demoUrl = (id: string, seeded: boolean, host = process.env.DEMO_HOST ?? '127.0.0.1') => `http://${host}:${demoPort(id, seeded)}/`;
export type { DemoAppDef, Defect } from './framework.ts';
