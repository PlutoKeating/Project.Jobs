// 人物头像：image.gen 生成像素风头像存 MinIO；生成前/失败时返回确定性像素头像（SVG）
import { logger, type PersonaSpec } from '@pux/core';
import { eq, getDb, personaAvatars } from '@pux/db';
import { gateway } from '@pux/llm';
import { blobs } from '@pux/storage';
import { latestPersonas, pixelAvatarSvg } from '@pux/jobsworld';

const queue: PersonaSpec[] = [];
const failed = new Set<string>();
let busy = false;

export async function avatarFor(p: PersonaSpec): Promise<{ body: Buffer | string; mime: string }> {
  const [row] = await getDb().select().from(personaAvatars).where(eq(personaAvatars.persona_id, p.id));
  if (row) { try { return { body: await blobs().get(row.storage_ref), mime: row.mime }; } catch { /* 回退 */ } }
  if (process.env.JW_AVATAR_GEN !== '0' && !failed.has(p.id) && !queue.some((q) => q.id === p.id)) { queue.push(p); void drain(); }
  return { body: pixelAvatarSvg(p, 256), mime: 'image/svg+xml' };
}

function prompt(p: PersonaSpec) {
  const id = p.identity;
  return `Pixel art portrait, 32x32 pixel style upscaled, head and shoulders, facing slightly left, of a ${id.age}-year-old ${/女|female/i.test(id.gender) ? 'woman' : 'man'} who works as ${id.occupation} in ${id.region}. ${id.age < 13 ? 'A child.' : ''} Expressive but calm face, everyday clothes fitting the job. Muted warm palette, flat dark charcoal background (#17181c), crisp pixels, no text, no border, no watermark.`;
}

async function drain() {
  if (busy) return; busy = true;
  try {
    for (;;) {
      const p = queue.shift(); if (!p) break;
      const [row] = await getDb().select().from(personaAvatars).where(eq(personaAvatars.persona_id, p.id));
      if (row) continue;
      const img = await gateway().generateImage(prompt(p), { purpose: 'jobsworld_avatar' });
      if (!img) { failed.add(p.id); continue; }
      const mime = img[0] === 0x89 ? 'image/png' : 'image/jpeg';
      const put = await blobs().put(img, mime, mime === 'image/png' ? '.png' : '.jpg');
      await getDb().insert(personaAvatars).values({ persona_id: p.id, storage_ref: put.key, mime, source: 'image_gen' }).onConflictDoNothing();
      logger.info({ persona: p.id }, '头像已生成');
    }
  } catch (e) { logger.warn({ err: String((e as Error).message).slice(0, 200) }, '头像生成失败'); }
  finally { busy = false; }
}

/** 启动时为还没有头像的人物排队生成 */
export async function warmAvatars() {
  if (process.env.JW_AVATAR_GEN === '0') return;
  const have = new Set((await getDb().select({ id: personaAvatars.persona_id }).from(personaAvatars)).map((r) => r.id));
  for (const r of await latestPersonas()) if (!have.has(r.id)) queue.push(r.spec);
  void drain();
}
