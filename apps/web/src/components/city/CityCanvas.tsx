// 侧视像素城市（PixiJS）。mode=full：可拖拽缩放的世界画布；mode=horizon：每页底部的街道地平线
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Application, Container, Graphics, Rectangle } from 'pixi.js';
import type { PersonaLive, TownLayout } from '../../lib/types.ts';
import { drawGround, drawPerson, drawStatic, drawWindows, extent } from './draw.ts';
import { C, skyAt } from './palette.ts';

export interface View { s: number; ox: number; oy: number; w: number; h: number }
interface Sprite { c: Container; body: Graphics; mark: Graphics; x: number; y: number; tx: number; ty: number; frame: number; key: string; live: PersonaLive }

interface Props {
  layout: TownLayout; personas: PersonaLive[]; minute: number; mode: 'full' | 'horizon';
  selectedId?: string | null; focusId?: string | null; focusPlace?: string | null;
  onSelect?: (id: string) => void; onPlace?: (id: string) => void;
  overlay?: (v: View) => ReactNode; className?: string;
}

export function CityCanvas({ layout, personas, minute, mode, selectedId, focusId, focusPlace, onSelect, onPlace, overlay, className }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const appRef = useRef<Application | null>(null);
  const world = useRef<Container | null>(null);
  const skyG = useRef<Graphics | null>(null);
  const winG = useRef<Graphics | null>(null);
  const peopleLayer = useRef<Container | null>(null);
  const sprites = useRef(new Map<string, Sprite>());
  const viewRef = useRef<View>({ s: 1, ox: 0, oy: 0, w: 0, h: 0 });
  const [view, setView] = useState<View>(viewRef.current);
  const [ready, setReady] = useState(false);
  const personasRef = useRef(personas);
  personasRef.current = personas;
  const cb = useRef({ onSelect, onPlace, selectedId });
  cb.current = { onSelect, onPlace, selectedId };
  const ext = extent(layout);

  const apply = (v: View) => {
    const fitS = Math.min(v.w / ext.width, v.h / ext.height);
    if (mode === 'horizon') { v.s = fitS; v.ox = (v.w - ext.width * v.s) / 2; v.oy = v.h - ext.bottom * v.s; }
    else {
      v.s = Math.max(Math.max(v.h / ext.height, v.w / ext.width), Math.min(14, v.s));
      const minOx = v.w - ext.width * v.s; v.ox = Math.min(0, Math.max(minOx, v.ox));
      const minOy = v.h - ext.bottom * v.s; const maxOy = -ext.top * v.s; v.oy = Math.min(maxOy, Math.max(minOy, v.oy));
    }
    viewRef.current = { ...v };
    if (import.meta.env.DEV) (window as unknown as { __jw: unknown }).__jw = { view: viewRef.current, ext };
    if (world.current) { world.current.scale.set(v.s); world.current.position.set(v.ox, v.oy); }
    setView({ ...v });
  };
  const initialFrame = () => {
    const v = viewRef.current;
    const busy = personasRef.current.find((p) => p.session && p.visible);
    const office = layout.places.find((p) => p.kind === 'office');
    const x = busy?.x ?? (office ? office.x + office.w / 2 : layout.width / 2);
    const s = Math.max(v.h / ext.height, 7);
    apply({ ...v, s, ox: v.w / 2 - x * s, oy: v.h - ext.bottom * s });
  };
  const centerOn = (x: number, y: number, s?: number) => {
    const v = { ...viewRef.current }; if (s) v.s = s;
    v.ox = v.w / 2 - x * v.s; v.oy = v.h * 0.62 - y * v.s; apply(v);
  };

  // 初始化 Pixi
  useEffect(() => {
    let disposed = false;
    const app = new Application();
    const el = host.current!;
    (async () => {
      await app.init({ resizeTo: el, backgroundAlpha: 0, antialias: false, resolution: Math.min(2, window.devicePixelRatio || 1), autoDensity: true });
      if (disposed) { app.destroy(true); return; }
      appRef.current = app;
      el.prepend(app.canvas);
      app.canvas.style.display = 'block';
      const sky = new Graphics(); skyG.current = sky; app.stage.addChild(sky);
      const w = new Container(); world.current = w; app.stage.addChild(w);
      const ground = new Graphics(); drawGround(ground, layout);
      const stat = new Graphics(); drawStatic(stat, layout);
      const win = new Graphics(); winG.current = win;
      const hits = new Container();
      for (const p of layout.places) {
        const h = new Graphics().rect(p.x, p.top, p.w, Math.max(4, p.bottom - p.top)).fill({ color: 0xffffff, alpha: 0.001 });
        h.eventMode = 'static'; h.cursor = 'pointer';
        h.on('pointertap', () => { if (!dragged) cb.current.onPlace?.(p.id); });
        hits.addChild(h);
      }
      const people = new Container(); peopleLayer.current = people;
      w.addChild(ground, stat, win, hits, people);
      // 视图
      const v0 = { s: mode === 'horizon' ? 1 : 6, ox: 0, oy: 0, w: el.clientWidth, h: el.clientHeight };
      apply(v0);
      if (mode === 'full') initialFrame();
      // 动画：插值移动、走路帧、标记呼吸
      let acc = 0;
      app.ticker.add((tk) => {
        if (el.clientWidth !== viewRef.current.w || el.clientHeight !== viewRef.current.h) { apply({ ...viewRef.current, w: el.clientWidth, h: el.clientHeight }); paintSky(); }
        const dt = tk.deltaMS / 1000; acc += tk.deltaMS;
        const step = acc > 220; if (step) acc = 0;
        for (const s of sprites.current.values()) {
          const k = Math.min(1, dt * 2.2);
          const moving = Math.abs(s.tx - s.x) > 0.05;
          s.x += (s.tx - s.x) * k; s.y = Math.abs(s.ty - s.y) > 3 ? s.ty : s.y + (s.ty - s.y) * k;
          s.c.position.set(s.x, s.y);
          if (step && (moving || s.live.pose === 'walk')) { s.frame++; drawPerson(s.body, s.live.appearance, moving ? 'walk' : s.live.pose, s.live.facing, s.frame); }
          s.mark.alpha = 0.55 + 0.45 * Math.sin(performance.now() / 380);
        }
      });
      setReady(true);
    })();
    // 拖拽平移、滚轮缩放（仅 full）
    let dragged = false; let down: { x: number; y: number; ox: number; oy: number } | null = null;
    const onDown = (e: PointerEvent) => { if (mode !== 'full') return; dragged = false; down = { x: e.clientX, y: e.clientY, ox: viewRef.current.ox, oy: viewRef.current.oy }; };
    const onMove = (e: PointerEvent) => { if (!down) return; const dx = e.clientX - down.x, dy = e.clientY - down.y; if (Math.abs(dx) + Math.abs(dy) > 4) { dragged = true; el.style.cursor = 'grabbing'; } if (dragged) apply({ ...viewRef.current, ox: down.ox + dx, oy: down.oy + dy }); };
    const onUp = () => { down = null; el.style.cursor = ''; setTimeout(() => { dragged = false; }, 0); };
    const onWheel = (e: WheelEvent) => {
      if (mode !== 'full') return; e.preventDefault();
      const v = viewRef.current; const r = el.getBoundingClientRect(); const mx = e.clientX - r.left, my = e.clientY - r.top;
      if (!e.ctrlKey && Math.abs(e.deltaX) > Math.abs(e.deltaY)) { apply({ ...v, ox: v.ox - e.deltaX }); return; }
      const ns = Math.min(14, Math.max(1, v.s * (e.deltaY < 0 ? 1.12 : 1 / 1.12)));
      const wx = (mx - v.ox) / v.s, wy = (my - v.oy) / v.s;
      apply({ ...v, s: ns, ox: mx - wx * ns, oy: my - wy * ns });
    };
    el.addEventListener('pointerdown', onDown); window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp); el.addEventListener('wheel', onWheel, { passive: false });
    const ro = new ResizeObserver(() => { if (!appRef.current) return; apply({ ...viewRef.current, w: el.clientWidth, h: el.clientHeight }); paintSky(); });
    ro.observe(el);
    return () => {
      disposed = true; ro.disconnect();
      el.removeEventListener('pointerdown', onDown); window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); el.removeEventListener('wheel', onWheel);
      sprites.current.clear();
      if (appRef.current) { appRef.current.destroy(true, { children: true }); appRef.current = null; }
      setReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout.version, mode]);

  // 天空与窗户随时钟
  const minuteKey = Math.floor(minute / 5);
  const paintSky = () => {
    const g = skyG.current; const v = viewRef.current; if (!g) return;
    const sky = skyAt(minute);
    g.clear();
    const bands = 14;
    for (let i = 0; i < bands; i++) {
      const k = i / (bands - 1);
      const c = ((((sky.top >> 16) & 255) * (1 - k) + ((sky.horizon >> 16) & 255) * k) << 16) | ((((sky.top >> 8) & 255) * (1 - k) + ((sky.horizon >> 8) & 255) * k) << 8) | (((sky.top & 255) * (1 - k) + (sky.horizon & 255) * k) | 0);
      g.rect(0, (v.h * i) / bands, v.w, v.h / bands + 1).fill(c & 0xffffff);
    }
    if (sky.night > 0.2) for (let i = 0; i < 60; i++) { const x = (i * 197) % Math.max(1, v.w); const y = (i * 89) % Math.max(1, v.h * 0.45); g.rect(x, y, 1.5, 1.5).fill({ color: C.star, alpha: 0.6 * sky.night * ((i % 3) / 3 + 0.4) }); }
    if (winG.current) drawWindows(winG.current, layout, sky.horizon, sky.night);
  };
  useEffect(() => { if (ready) paintSky(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [ready, minuteKey, view.w, view.h]);

  // 人物
  useEffect(() => {
    const layer = peopleLayer.current; if (!ready || !layer) return;
    const seen = new Set<string>();
    for (const p of personas) {
      if (!p.visible) continue;
      seen.add(p.id);
      let s = sprites.current.get(p.id);
      const key = `${p.pose}:${p.facing}:${!!p.session}:${cb.current.selectedId === p.id}`;
      if (!s) {
        const c = new Container(); const body = new Graphics(); const mark = new Graphics();
        c.addChild(mark, body);
        c.eventMode = 'static'; c.cursor = 'pointer';
        c.hitArea = mode === 'horizon' ? new Rectangle(-6, -14, 12, 16) : new Rectangle(-1.4, -3.6, 2.8, 3.8);
        c.on('pointertap', () => cb.current.onSelect?.(p.id));
        layer.addChild(c);
        s = { c, body, mark, x: p.x, y: p.y, tx: p.x, ty: p.y, frame: 0, key: '', live: p };
        sprites.current.set(p.id, s);
      }
      s.live = p; s.tx = p.x; s.ty = p.y;
      if (s.key !== key) {
        s.key = key;
        drawPerson(s.body, p.appearance, p.pose, p.facing, s.frame);
        s.mark.clear();
        const sel = cb.current.selectedId === p.id;
        if (mode === 'horizon') { if (p.session || sel) s.mark.rect(-1.5, -9, 3, 3).fill(sel ? 0xffffff : C.accent); }
        else {
          if (sel) s.mark.rect(-1.3, -3.5, 2.6, 3.7).stroke({ color: C.accentHi, width: 0.18 });
          if (p.session) { s.mark.poly([0, -4.8, 0.45, -4.3, 0, -3.8, -0.45, -4.3]).fill(C.accent); }
        }
      }
    }
    for (const [id, s] of sprites.current) if (!seen.has(id)) { s.c.destroy({ children: true }); sprites.current.delete(id); }
  }, [personas, ready, selectedId, mode]);

  // 聚焦
  useEffect(() => {
    if (!ready || mode !== 'full') return;
    if (focusId) { const p = personas.find((x) => x.id === focusId); if (p) centerOn(p.x, p.y - 2, Math.max(viewRef.current.s, 7)); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId, ready]);
  useEffect(() => {
    if (!ready || mode !== 'full' || !focusPlace) return;
    const pl = layout.places.find((p) => p.id === focusPlace); if (pl) centerOn(pl.x + pl.w / 2, Math.max((pl.top + pl.bottom) / 2, -20) + 6);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusPlace, ready]);

  return (
    <div className={className}>
      <div ref={host} className={`relative h-full w-full overflow-hidden select-none touch-none ${mode === 'full' ? 'cursor-grab' : ''}`}>
        {ready && overlay?.(view)}
      </div>
    </div>
  );
}

export const toScreen = (v: View, x: number, y: number) => ({ left: v.ox + x * v.s, top: v.oy + y * v.s });
