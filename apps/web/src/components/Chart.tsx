// ECharts 封装：颜色取自设计 token，主题切换时重绘；配色经 dataviz validate_palette.js 校验（暗/亮各一套）
import { useEffect, useRef, useState } from 'react';
import * as echarts from 'echarts/core';
import { BarChart, LineChart } from 'echarts/charts';
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components';
import { SVGRenderer } from 'echarts/renderers';
import type { EChartsCoreOption } from 'echarts/core';

echarts.use([BarChart, LineChart, GridComponent, LegendComponent, TooltipComponent, SVGRenderer]);

export const SERIES = { dark: ['#c9792f', '#3d9cc4'], light: ['#b0602e', '#1f7fae'] };

export function useThemeMode(): 'dark' | 'light' {
  const read = () => (document.documentElement.dataset.theme === 'light' || (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: light)').matches) ? 'light' : 'dark');
  const [m, setM] = useState<'dark' | 'light'>(read);
  useEffect(() => { const o = new MutationObserver(() => setM(read())); o.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] }); return () => o.disconnect(); }, []);
  return m;
}

export function tokens() {
  const cs = getComputedStyle(document.documentElement);
  const v = (n: string) => cs.getPropertyValue(n).trim();
  return { fg: v('--ds-color-fg'), muted: v('--ds-color-fg-muted'), subtle: v('--ds-color-fg-subtle'), border: v('--ds-color-border'), surface: v('--ds-color-surface'), danger: v('--ds-color-danger'), warning: v('--ds-color-warning'), accent: v('--ds-color-accent'), font: v('--ds-font-sans') };
}

export function Chart({ option, height = 240, label }: { option: (t: ReturnType<typeof tokens>, series: string[]) => EChartsCoreOption; height?: number; label: string }) {
  const el = useRef<HTMLDivElement>(null);
  const mode = useThemeMode();
  useEffect(() => {
    const c = echarts.init(el.current!, undefined, { renderer: 'svg' });
    const t = tokens();
    c.setOption({ textStyle: { fontFamily: t.font, color: t.muted }, animationDuration: 300, ...option(t, SERIES[mode]) });
    const ro = new ResizeObserver(() => c.resize()); ro.observe(el.current!);
    return () => { ro.disconnect(); c.dispose(); };
  }, [option, mode]);
  return <div ref={el} role="img" aria-label={label} style={{ height }} />;
}
