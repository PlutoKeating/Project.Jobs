import { existsSync } from 'node:fs';
import { z } from 'zod';
import { configPath } from './paths.ts';
import { readYaml } from './yamlio.ts';

export const PuxConfigSchema = z.object({
  vendor_isolation: z.enum(['strict', 'warn']).default('warn'),
  budgets: z.object({ max_steps_per_session: z.number(), max_sessions: z.number(), concurrency: z.number(), round_size: z.number() }),
  guards: z.object({
    loop_repeat_n: z.number().default(3),
    novelty_budget_k: z.number().default(8),
    saturation_m: z.number().default(4),
    max_consecutive_violations: z.number().default(4),
    trust_abandon_threshold: z.number().default(0.15),
  }),
  sampler_weights: z.object({ uncovered_feature: z.number(), open_hypothesis: z.number(), low_trust: z.number(), near_new_issue: z.number(), uncovered_segment: z.number(), uncovered_scenario: z.number(), repeat_penalty: z.number() }),
  severity: z.record(z.string(), z.string()),
  thresholds: z.object({
    seeded_recall_min: z.number(), false_positive_max: z.number(), behavior_diversity_min: z.number(),
    trust_high: z.object({ min_n: z.number(), max_ci_width: z.number(), min_value: z.number() }),
    trust_medium: z.object({ min_n: z.number() }),
  }),
  memory: z.object({ alpha_relevance: z.number(), beta_recency: z.number(), gamma_importance: z.number(), recency_half_life_h: z.number(), top_k: z.number() }),
  human_takeover: z.object({ timeout_min: z.number().default(10), open_headed: z.boolean().default(true) }),
  safety: z.object({ child_personas_enabled: z.boolean().default(false), child_rubric_file: z.string(), sandbox_payment_domains: z.array(z.string()).default([]) }),
  perception: z.object({ glance_max_elements: z.number().default(8), scan_min_font_px: z.number().default(15), scan_max_text_len: z.number().default(60) }),
  report: z.object({ fold_below_severity: z.string().default('P3') }),
  demos: z.object({ clean_port_base: z.number(), seeded_port_base: z.number() }),
});
export type PuxConfig = z.infer<typeof PuxConfigSchema>;

let cached: PuxConfig | undefined;
export function loadConfig(): PuxConfig {
  if (cached) return cached;
  const base = readYaml(configPath('pux.config.yaml'));
  const localPath = configPath('pux.config.local.yaml');
  const local = existsSync(localPath) ? readYaml<Record<string, unknown>>(localPath) : {};
  cached = PuxConfigSchema.parse(deepMerge(base as Record<string, unknown>, local));
  return cached;
}

function deepMerge(a: Record<string, unknown>, b: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...a };
  for (const [k, v] of Object.entries(b ?? {})) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && typeof a[k] === 'object' ? deepMerge(a[k] as Record<string, unknown>, v as Record<string, unknown>) : v;
  }
  return out;
}
