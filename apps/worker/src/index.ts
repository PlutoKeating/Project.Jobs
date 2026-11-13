// Temporal worker：主队列（规划/评估/合成）+ 本进程专属队列（持有浏览器的 Session 步骤）
import { NativeConnection, Worker } from '@temporalio/worker';
import { createRequire } from 'node:module';
import { env, logger } from '@pux/core';
import * as activities from './activities.ts';
import { MAIN_QUEUE } from './client.ts';

const require = createRequire(import.meta.url);
const connection = await NativeConnection.connect({ address: env.temporalAddress });
const workflowsPath = require.resolve('./workflows.ts');
const mainWorker = await Worker.create({ connection, namespace: env.temporalNamespace, taskQueue: MAIN_QUEUE, workflowsPath, activities, maxConcurrentActivityTaskExecutions: 8 });
const hostWorker = await Worker.create({ connection, namespace: env.temporalNamespace, taskQueue: activities.HOST_QUEUE, activities, maxConcurrentActivityTaskExecutions: 6 });
logger.info({ main: MAIN_QUEUE, host: activities.HOST_QUEUE, address: env.temporalAddress }, 'Temporal worker 已启动');
await Promise.all([mainWorker.run(), hostWorker.run()]);
