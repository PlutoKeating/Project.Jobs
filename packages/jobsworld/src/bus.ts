// NATS 连接（JetStream + KV）
import { connect, type NatsConnection } from '@nats-io/transport-node';
import { jetstream, jetstreamManager } from '@nats-io/jetstream';
import { Kvm, type KV } from '@nats-io/kv';
import { logger } from '@pux/core';
import { KV_BUCKET, STREAM_LIVE, SUBJ } from './protocol.ts';

export const natsUrl = () => process.env.NATS_URL ?? `nats://127.0.0.1:${process.env.NATS_PORT ?? '54222'}`;

export interface Bus { nc: NatsConnection; kv: KV; publish: (subject: string, data: unknown) => void; close: () => Promise<void> }

const enc = new TextEncoder();
const dec = new TextDecoder();
export const decode = <T>(b: Uint8Array): T => JSON.parse(dec.decode(b)) as T;

export async function connectBus(name: string): Promise<Bus> {
  const nc = await connect({ servers: natsUrl(), name, maxReconnectAttempts: -1, reconnectTimeWait: 1000 });
  const jsm = await jetstreamManager(nc);
  try { await jsm.streams.info(STREAM_LIVE); }
  catch { await jsm.streams.add({ name: STREAM_LIVE, subjects: [SUBJ.liveAll], max_age: 24 * 3600 * 1e9, max_msgs_per_subject: 2000 }); logger.info('已创建 JetStream 流 JW_LIVE'); }
  const kv = await new Kvm(jetstream(nc)).create(KV_BUCKET, { history: 1 });
  return {
    nc, kv,
    publish: (subject, data) => nc.publish(subject, enc.encode(JSON.stringify(data))),
    close: async () => { await nc.drain(); },
  };
}

export async function kvGetJson<T>(kv: KV, key: string): Promise<T | undefined> {
  const e = await kv.get(key);
  if (!e || !e.value?.length) return undefined;
  return decode<T>(e.value);
}
export const kvPutJson = (kv: KV, key: string, v: unknown) => kv.put(key, enc.encode(JSON.stringify(v)));
