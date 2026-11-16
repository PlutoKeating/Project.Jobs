import { newId, sha256 } from '@pux/core';
import { evidence, evidenceLinks, getDb } from '@pux/db';
import { blobs } from '@pux/storage';

export type EvidenceKind = 'screenshot' | 'perceived_screenshot' | 'a11y' | 'dom' | 'video' | 'har' | 'console' | 'action' | 'monologue' | 'world_event'
  | 'judge_rationale' | 'replay_result' | 'rrweb' | 'axe' | 'crawl' | 'interview' | 'ai_turn' | 'network' | 'email';

export interface EvidenceCtx { study_id?: string; session_id?: string; step_idx?: number; persona_id?: string }

const EXT: Record<string, string> = { 'image/jpeg': '.jpg', 'image/png': '.png', 'video/mp4': '.mp4', 'application/json': '.json', 'text/plain': '.txt', 'text/html': '.html', 'audio/wav': '.wav', 'message/rfc822': '.eml' };

/** Evidence Engine：统一登记证据（只追加、不修改；内容哈希去重存储） */
export async function putEvidence(kind: EvidenceKind, ctx: EvidenceCtx, payload: { data?: Buffer | string; mime?: string; inline?: unknown }): Promise<string> {
  const id = newId('ev');
  let storage_ref: string | undefined; let hash: string; let bytes: number | undefined;
  if (payload.data !== undefined) {
    const mime = payload.mime ?? 'application/octet-stream';
    const r = await blobs().put(payload.data, mime, EXT[mime] ?? '');
    storage_ref = r.key; hash = r.hash; bytes = r.bytes;
  } else {
    hash = sha256(JSON.stringify(payload.inline ?? null));
  }
  await getDb().insert(evidence).values({ id, kind, storage_ref, inline: payload.inline as never, mime: payload.mime, hash, bytes, study_id: ctx.study_id, session_id: ctx.session_id, step_idx: ctx.step_idx, persona_id: ctx.persona_id });
  return id;
}

export async function linkEvidence(evidence_id: string, subject_type: 'issue' | 'judgment' | 'hypothesis' | 'calibration', subject_id: string, role: 'primary' | 'supporting' | 'counter' = 'supporting') {
  await getDb().insert(evidenceLinks).values({ evidence_id, subject_type, subject_id, role }).onConflictDoNothing();
}
