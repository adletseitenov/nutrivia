import React from 'react';
import {AbsoluteFill, Img, interpolate} from 'remotion';
import {FONT} from '../lib/fonts';
import {C} from '../lib/theme';
import {SCENES, TOTAL, wordAt} from '../lib/timeline';
import {clamp, Count, Glow, Kinetic, lerp, media, useSpring, useT} from '../lib/ui';

const [B0] = SCENES.business;

const Stat: React.FC<{at: number; big: React.ReactNode; label: string; accent?: boolean; note?: string}> = ({at, big, label, accent, note}) => {
  const s = useSpring(at, {damping: 13, stiffness: 140});
  return (
    <div style={{width: 520, height: 420, borderRadius: 48, padding: 44, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end',
      background: accent ? C.pink : 'rgba(255,255,255,0.06)', border: accent ? 'none' : `1px solid ${C.line}`,
      boxShadow: accent ? `0 40px 120px ${C.pink}55` : '0 30px 80px rgba(0,0,0,.4)',
      transform: `translateY(${(1 - s) * 120}px) scale(${0.9 + 0.1 * s})`, opacity: Math.min(1, s * 1.6), fontFamily: FONT, color: '#fff'}}>
      <div style={{fontWeight: 900, fontSize: 112, lineHeight: 0.95, letterSpacing: '-0.05em', whiteSpace: 'nowrap'}}>{big}</div>
      <div style={{fontWeight: 700, fontSize: 36, marginTop: 18, color: accent ? '#fff' : C.muted}}>{label}</div>
      {note ? <div style={{fontWeight: 500, fontSize: 24, marginTop: 10, color: accent ? 'rgba(255,255,255,.85)' : C.muted}}>{note}</div> : null}
    </div>
  );
};

/** 51.9–58.4: модель — 14 дней бесплатно, 2 000 ₸ в месяц, ИИ ≈ 2 ₸ за фото */
export const BusinessScene: React.FC = () => {
  const t = useT();
  const w = (p: string, n = 0) => wordAt('s08_business', p, n) - B0;
  return (
    <AbsoluteFill>
      <Glow a={C.pink} b={C.violet} base="#09080f" />
      <div style={{position: 'absolute', left: 140, top: 110}}>
        <Kinetic text="Модель" at={0.05} size={40} weight={800} color={C.pink} style={{textTransform: 'uppercase', letterSpacing: '0.12em'}} />
      </div>
      <div style={{position: 'absolute', left: 140, right: 140, top: 230, display: 'flex', justifyContent: 'space-between'}}>
        <Stat at={w('две')} big="14 дней" label="бесплатно" note="пробный период с регистрации" />
        <Stat at={w('дальше')} accent big={<><Count to={2000} at={w('дальше') + 0.15} dur={1.0} /> ₸</>} label="в месяц" note="подписка, оплата через Kaspi" />
        <Stat at={w('разбор')} big="≈ 2 ₸" label="ИИ-разбор одного фото" note="≈ 90 фото в месяц ≈ 180 ₸ на клиента" />
      </div>
      <div style={{position: 'absolute', left: 140, right: 140, bottom: 110, fontFamily: FONT, fontWeight: 700, fontSize: 34, color: C.muted, textAlign: 'center',
        opacity: lerp(t, w('тинге', 1), w('тинге', 1) + 0.4)}}>
        Калории считает своя база блюд — модель только называет блюда. Поэтому разбор дешёвый и предсказуемый.
      </div>
    </AbsoluteFill>
  );
};

const [E0] = SCENES.end;

/** 58.4–68: финал */
export const EndScene: React.FC = () => {
  const t = useT();
  const w = (p: string, n = 0) => wordAt('s09_end', p, n) - E0;
  const s = useSpring(0.05, {damping: 12, stiffness: 120});
  const dur = TOTAL - E0;
  const fadeOut = interpolate(t, [dur - 1.4, dur], [0, 1], clamp);
  return (
    <AbsoluteFill style={{background: C.pink, alignItems: 'center', overflow: 'hidden'}}>
      <AbsoluteFill style={{background: 'radial-gradient(60% 60% at 50% 40%, rgba(255,255,255,.18), transparent 70%)'}} />
      <Img src={media('img/logo.png')} style={{marginTop: 90, width: 400, height: 400, imageRendering: 'pixelated', borderRadius: 32,
        transform: `scale(${0.6 + 0.4 * s}) translateY(${Math.sin(t * 1.6) * 6}px)`, boxShadow: '0 30px 90px rgba(80,0,30,.4)'}} />
      <div style={{marginTop: 50}}>
        <Kinetic text="Сфотографируй — остальное сделаем мы" at={0} align="center" size={78}
          times={[w('сфотограф'), w('сфотограф') + 0.3, w('остальное'), w('сделаем'), w('мы')]} />
      </div>
      <div style={{marginTop: 40, display: 'flex', alignItems: 'center', gap: 22, fontFamily: FONT, color: '#fff', opacity: lerp(t, w('уже'), w('уже') + 0.4)}}>
        <div style={{width: 18, height: 18, borderRadius: 9, background: '#fff', boxShadow: '0 0 0 8px rgba(255,255,255,.3)', opacity: 0.6 + 0.4 * Math.sin(t * 5)}} />
        <div style={{fontWeight: 800, fontSize: 38}}>Уже работает</div>
        <div style={{fontWeight: 600, fontSize: 30, opacity: 0.85}}>nutrivia-production.up.railway.app</div>
      </div>
      <div style={{position: 'absolute', bottom: 40, display: 'flex', gap: 30}}>
        {[1, 2, 3, 4, 5].map((i) => {
          const b = useSpring(w('сфотограф') + 0.6 + i * 0.12, {damping: 9, stiffness: 160});
          return <Img key={i} src={media(`img/stage-${i}.png`)} style={{width: 92, height: 92, imageRendering: 'pixelated', transform: `scale(${b}) translateY(${Math.sin(t * 3 + i) * 5}px)`}} />;
        })}
      </div>
      <AbsoluteFill style={{background: '#000', opacity: fadeOut}} />
    </AbsoluteFill>
  );
};
