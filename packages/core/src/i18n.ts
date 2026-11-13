export type Lang = 'zh' | 'en';
export const langOf = (locale: string): Lang => (locale.startsWith('en') ? 'en' : 'zh');
/** 简单双语取值 */
export const L = (lang: Lang, zh: string, en: string) => (lang === 'en' ? en : zh);
