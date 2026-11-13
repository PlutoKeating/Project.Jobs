import { loadConfig, type ActionRequest, type PersonaSpec, type UIElement } from '@pux/core';

export interface SafetyPolicy { child: boolean; allow_real_payment: boolean; sandbox_domains: string[] }

export const policyFor = (persona: PersonaSpec): SafetyPolicy => ({
  child: persona.kind === 'child' || persona.identity.age < 14,
  allow_real_payment: false,
  sandbox_domains: loadConfig().safety.sandbox_payment_domains,
});

const RULES: { tag: string; re: RegExp; child_only: boolean; desc: string }[] = [
  { tag: 'payment_submit', re: /(确认支付|立即支付|去支付|付款|支付\s*¥|提交订单并支付|pay now|confirm payment|place order|checkout and pay|purchase)/i, child_only: false, desc: '真实支付提交' },
  { tag: 'public_post', re: /(发布|公开分享|发帖|发表|post publicly|publish|share to)/i, child_only: true, desc: '公开发布内容' },
  { tag: 'add_stranger', re: /(加好友|添加好友|关注陌生|私信|add friend|follow|send friend request|direct message)/i, child_only: true, desc: '添加陌生人/私信' },
  { tag: 'external_message', re: /(发送给|转发给|分享给好友|send to|forward to)/i, child_only: true, desc: '对外发送消息' },
  { tag: 'face_upload', re: /(上传.*(照片|头像|自拍)|拍照上传|upload.*(photo|selfie|avatar))/i, child_only: true, desc: '上传含人脸的照片' },
  { tag: 'personal_info', re: /(真实姓名|学校|家庭住址|身份证|手机号|real name|school|home address|phone number)/i, child_only: true, desc: '提交真实个人信息' },
];

export interface PolicyDecision { allowed: boolean; tag?: string; reason?: string; needs_protection_check?: boolean }

/** UAP Policy Gate：在执行层硬性拦截高风险动作（不是只写在提示词里，§6.3） */
export function checkPolicy(req: ActionRequest, policy: SafetyPolicy, target: UIElement | undefined, pageUrl: string): PolicyDecision {
  const text = [req.intent_text, target?.name, target?.aria_label, typeof req.args?.text === 'string' ? req.args.text : '', ...(req.risk_tags ?? [])].filter(Boolean).join(' | ');
  const isSandbox = (() => { try { const h = new URL(pageUrl).hostname; return policy.sandbox_domains.some((d) => h === d || h.endsWith('.' + d)); } catch { return false; } })();
  const acting = ['click', 'key', 'type', 'upload', 'show_camera', 'long_press'].includes(req.verb);
  if (!acting) return { allowed: true };
  for (const r of RULES) {
    const tagged = req.risk_tags?.includes(r.tag);
    if (!tagged && !r.re.test(text)) continue;
    if (r.tag === 'payment_submit') {
      if (policy.child) return { allowed: false, tag: r.tag, reason: `儿童安全策略：禁止${r.desc}（只模拟到是否出现支付入口和家长验证）`, needs_protection_check: true };
      if (!isSandbox && !policy.allow_real_payment) return { allowed: false, tag: r.tag, reason: `非沙箱域名，禁止${r.desc}`, needs_protection_check: true };
      continue;
    }
    if (r.child_only && policy.child) {
      if (r.tag === 'personal_info' && req.verb !== 'type') continue;
      return { allowed: false, tag: r.tag, reason: `儿童安全策略：禁止${r.desc}`, needs_protection_check: true };
    }
  }
  return { allowed: true };
}
