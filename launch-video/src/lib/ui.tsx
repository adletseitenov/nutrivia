import React from 'react';
import {AbsoluteFill, Easing, Img, interpolate, OffthreadVideo, Sequence, spring, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';
import {FONT} from './fonts';
import {C} from './theme';
import {f, FPS} from './timeline';

export const media = (p: string) => staticFile(`media/${p}`);

/** Время сцены в секундах (внутри Sequence) */
export const useT = () => useCurrentFrame() / FPS;

export const clamp = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;
export const ease = Easing.bezier(0.22, 1, 0.36, 1); // easeOutQuint-ish
export const easeInOut = Easing.bezier(0.65, 0, 0.35, 1);

/** Пружина от момента `at` (с, время сцены) → 0..1 (может чуть перелетать) */
export function useSpring(at: number, cfg: {damping?: number; stiffness?: number; mass?: number} = {}) {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  return spring({frame: frame - at * fps, fps, config: {damping: cfg.damping ?? 14, stiffness: cfg.stiffness ?? 120, mass: cfg.mass ?? 0.8}});
}

export const lerp = (t: number, a: number, b: number, from = 0, to = 1, e = ease) =>
  interpolate(t, [a, b], [from, to], {...clamp, easing: e});

/** Хвост сцены: она остаётся под следующей, пока та проявляется сверху, — без провала в чёрное */
const TAIL = 0.3;

/** Сцена: окно [start, end] глобального времени. Вход — проявление с лёгким зумом и размытием поверх предыдущей,
 *  выход — зум и размытие в хвосте (непрозрачность не падает: сверху уже следующая сцена). */
export const Scene: React.FC<{start: number; end: number; children: React.ReactNode; enter?: number; exit?: number; bg?: string}> = ({
  start, end, children, enter = 0.22, exit = TAIL, bg,
}) => (
  <Sequence from={f(start)} durationInFrames={f(end - start + exit) + 1} premountFor={30}>
    <SceneInner dur={end - start} enter={enter} exit={exit} bg={bg}>{children}</SceneInner>
  </Sequence>
);

const SceneInner: React.FC<{dur: number; enter: number; exit: number; bg?: string; children: React.ReactNode}> = ({dur, enter, exit, bg, children}) => {
  const t = useT();
  const inP = enter ? lerp(t, 0, enter) : 1;
  const outP = exit ? lerp(t, dur - 0.05, dur + exit, 0, 1, Easing.in(Easing.quad)) : 0;
  const scale = 1.06 - 0.06 * inP + 0.1 * outP;
  const blur = (1 - inP) * 14 + outP * 20;
  return (
    <AbsoluteFill style={{background: bg, opacity: Math.min(1, inP * 1.4), transform: `scale(${scale})`, filter: blur > 0.3 ? `blur(${blur}px)` : undefined}}>
      {children}
    </AbsoluteFill>
  );
};

/** Тёмный фон с медленными цветными пятнами */
export const Glow: React.FC<{a?: string; b?: string; base?: string}> = ({a = C.pink, b = C.violet, base = C.bg}) => {
  const t = useT();
  const x1 = 25 + Math.sin(t * 0.5) * 8, y1 = 30 + Math.cos(t * 0.4) * 10;
  const x2 = 75 + Math.cos(t * 0.45) * 8, y2 = 70 + Math.sin(t * 0.35) * 10;
  return (
    <AbsoluteFill style={{
      background: `radial-gradient(60% 70% at ${x1}% ${y1}%, ${a}33 0%, transparent 60%), radial-gradient(55% 65% at ${x2}% ${y2}%, ${b}38 0%, transparent 60%), ${base}`,
    }} />
  );
};

/** Плёночное зерно поверх всего — убирает «пластиковость» градиентов */
export const Grain: React.FC<{opacity?: number}> = ({opacity = 0.06}) => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{pointerEvents: 'none', opacity, mixBlendMode: 'overlay'}}>
      <svg width="100%" height="100%">
        <filter id={`g${frame % 4}`}>
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed={frame % 4} stitchTiles="stitch" />
        </filter>
        <rect width="100%" height="100%" filter={`url(#g${frame % 4})`} />
      </svg>
    </AbsoluteFill>
  );
};

/** Кинетический текст: слова выезжают снизу с размытием, по очереди */
export const Kinetic: React.FC<{
  text: string; at: number; size?: number; weight?: number; color?: string; stagger?: number; align?: 'left' | 'center';
  highlight?: string[]; hl?: string; style?: React.CSSProperties; lineHeight?: number; out?: number; times?: number[];
}> = ({text, at, times, size = 96, weight = 900, color = C.white, stagger = 0.06, align = 'left', highlight = [], hl = C.pink, style, lineHeight = 1.02, out}) => {
  const t = useT();
  const lines = text.split('\n');
  let i = 0;
  const o = out !== undefined ? 1 - lerp(t, out, out + 0.25) : 1;
  return (
    <div style={{fontFamily: FONT, fontWeight: weight, fontSize: size, lineHeight, letterSpacing: '-0.035em', color, textAlign: align, opacity: o, ...style}}>
      {lines.map((ln, li) => (
        <div key={li} style={{display: 'flex', flexWrap: 'wrap', justifyContent: align === 'center' ? 'center' : 'flex-start', gap: `0 ${size * 0.26}px`}}>
          {ln.split(' ').map((w) => {
            const k = i++;
            const st = times?.[k] ?? at + k * stagger;
            const p = lerp(t, st, st + 0.5);
            const isHl = highlight.some((h) => w.toLowerCase().startsWith(h));
            return (
              <span key={k} style={{display: 'inline-block', overflow: 'hidden', paddingBottom: size * 0.08, marginBottom: -size * 0.08}}>
                <span style={{display: 'inline-block', transform: `translateY(${(1 - p) * 100}%)`, opacity: p, filter: p < 1 ? `blur(${(1 - p) * 8}px)` : undefined, color: isHl ? hl : undefined}}>
                  {w}
                </span>
              </span>
            );
          })}
        </div>
      ))}
    </div>
  );
};

/** Маленькая подпись-«пилюля» */
export const Pill: React.FC<{children: React.ReactNode; at: number; style?: React.CSSProperties; bg?: string; color?: string; size?: number}> = ({
  children, at, style, bg = 'rgba(255,255,255,0.12)', color = C.white, size = 28,
}) => {
  const s = useSpring(at, {damping: 12, stiffness: 160});
  return (
    <div style={{display: 'inline-flex', alignItems: 'center', gap: 12, padding: `${size * 0.45}px ${size * 0.8}px`, borderRadius: 999, background: bg,
      backdropFilter: 'blur(14px)', border: `1px solid ${C.line}`, color, fontFamily: FONT, fontWeight: 700, fontSize: size,
      transform: `scale(${0.6 + 0.4 * s}) translateY(${(1 - s) * 20}px)`, opacity: Math.min(1, s * 1.5), whiteSpace: 'nowrap', ...style}}>
      {children}
    </div>
  );
};

const RATIO = 2532 / 1170;

/** iPhone: рамка, «островок», блик; внутри запись экрана (muted) или любой контент */
export const Phone: React.FC<{
  w?: number; src?: string; trimBefore?: number; still?: boolean; style?: React.CSSProperties; children?: React.ReactNode; tilt?: number; glare?: boolean;
}> = ({w = 400, src, trimBefore = 0, style, children, tilt = 0, glare = true}) => {
  const h = w * RATIO;
  const bezel = w * 0.035;
  const t = useT();
  return (
    <div style={{width: w + bezel * 2, height: h + bezel * 2, borderRadius: w * 0.16, background: '#050507', padding: bezel, position: 'relative',
      boxShadow: `0 ${w * 0.12}px ${w * 0.3}px rgba(0,0,0,0.55), 0 0 0 2px #2a2a33 inset, 0 0 0 ${w * 0.008}px #3a3a46`,
      transform: `perspective(2400px) rotateY(${tilt}deg)`, ...style}}>
      <div style={{width: w, height: h, borderRadius: w * 0.13, overflow: 'hidden', position: 'relative', background: C.bg}}>
        {src ? (
          <OffthreadVideo src={media(src)} trimBefore={f(trimBefore)} muted style={{width: '100%', height: '100%', objectFit: 'cover'}} />
        ) : null}
        {children}
        <div style={{position: 'absolute', top: w * 0.028, left: '50%', width: w * 0.3, height: w * 0.085, marginLeft: -w * 0.15, borderRadius: 999, background: '#000'}} />
        {glare ? (
          <div style={{position: 'absolute', inset: 0, background: `linear-gradient(${115 + Math.sin(t * 0.6) * 6}deg, rgba(255,255,255,0.10) 0%, rgba(255,255,255,0) 32%, rgba(255,255,255,0) 70%, rgba(255,255,255,0.05) 100%)`, pointerEvents: 'none'}} />
        ) : null}
      </div>
    </div>
  );
};

/** Фото на всю площадь с медленным наездом (Ken Burns) */
export const Photo: React.FC<{src: string; zoom?: [number, number]; dur: number; pos?: string; style?: React.CSSProperties; dim?: number}> = ({src, zoom = [1.05, 1.18], dur, pos = 'center', style, dim = 0}) => {
  const t = useT();
  const z = interpolate(t, [0, dur], zoom, clamp);
  return (
    <AbsoluteFill style={{overflow: 'hidden', ...style}}>
      <Img src={media(src)} style={{width: '100%', height: '100%', objectFit: 'cover', objectPosition: pos, transform: `scale(${z})`}} />
      {dim ? <AbsoluteFill style={{background: `rgba(5,4,10,${dim})`}} /> : null}
    </AbsoluteFill>
  );
};

/** Вспышка (затвор / переход) */
export const Flash: React.FC<{at: number; color?: string; len?: number}> = ({at, color = '#fff', len = 0.35}) => {
  const t = useT();
  const o = t < at ? 0 : interpolate(t, [at, at + 0.05, at + len], [0, 0.95, 0], clamp);
  return o > 0 ? <AbsoluteFill style={{background: color, opacity: o, pointerEvents: 'none'}} /> : null;
};

/** Счётчик чисел */
export const Count: React.FC<{to: number; at: number; dur?: number; from?: number; format?: (n: number) => string; style?: React.CSSProperties}> = ({
  to, at, dur = 0.9, from = 0, format = (n) => Math.round(n).toLocaleString('ru-RU'), style,
}) => {
  const t = useT();
  const v = interpolate(t, [at, at + dur], [from, to], {...clamp, easing: Easing.out(Easing.cubic)});
  return <span style={{fontVariantNumeric: 'tabular-nums', ...style}}>{format(v)}</span>;
};
