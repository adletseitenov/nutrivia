import React from 'react';
import {AbsoluteFill, Img, interpolate, OffthreadVideo} from 'remotion';
import {FONT} from '../lib/fonts';
import {C} from '../lib/theme';
import {SCENES, wordAt} from '../lib/timeline';
import {clamp, Flash, Glow, Kinetic, lerp, media, Photo, useSpring, useT} from '../lib/ui';

const [H0] = SCENES.hook;
const local = (g: number, s: number) => g - s;

/** 0–5.7: казан с паром → пиала плова, «300? 600? 900?» */
export const Hook: React.FC = () => {
  const t = useT();
  const w = (p: string, n = 0) => local(wordAt('s01_hook', p, n), H0);
  const cut = w('плова') + 0.05;
  const z = interpolate(t, [0, cut], [1.08, 1.22], clamp);
  return (
    <AbsoluteFill style={{background: '#000'}}>
      {t < cut + 0.1 ? (
        <AbsoluteFill style={{overflow: 'hidden'}}>
          <OffthreadVideo src={media('kazan.mp4')} muted style={{width: '100%', height: '100%', objectFit: 'cover', objectPosition: '50% 62%', transform: `scale(${z})`}} />
          <AbsoluteFill style={{background: 'linear-gradient(90deg, rgba(0,0,0,.72) 0%, rgba(0,0,0,.25) 60%, rgba(0,0,0,.1) 100%)'}} />
        </AbsoluteFill>
      ) : (
        <AbsoluteFill>
          <Photo src="img/plov.jpg" dur={5.7 - cut} zoom={[1.18, 1.04]} pos="50% 55%" />
          <AbsoluteFill style={{background: 'linear-gradient(90deg, rgba(0,0,0,.78) 0%, rgba(0,0,0,.35) 55%, rgba(0,0,0,.05) 100%)'}} />
          <Guess at={cut + 0.25} x={1240} y={260} text="300 ккал?" />
          <Guess at={cut + 0.45} x={1430} y={520} text="600 ккал?" />
          <Guess at={cut + 0.65} x={1180} y={760} text="900 ккал?" />
        </AbsoluteFill>
      )}
      <Flash at={cut} len={0.25} />
      <div style={{position: 'absolute', left: 120, top: 330}}>
        <Kinetic text={'Сколько калорий\nв пиале плова?'} at={0} size={124}
          times={[w('сколько'), w('калорий'), w('в'), w('пиале'), w('плова')]} highlight={['плова']} />
        <div style={{height: 34}} />
        <Kinetic text="Ни один счётчик этого не скажет" at={0} size={46} weight={700} color={C.muted}
          times={[w('ни'), w('один'), w('счетчик'), w('этого'), w('не'), w('скажет')]} />
      </div>
    </AbsoluteFill>
  );
};

const Guess: React.FC<{at: number; x: number; y: number; text: string}> = ({at, x, y, text}) => {
  const s = useSpring(at, {damping: 11, stiffness: 170});
  const t = useT();
  const strike = lerp(t, 4.6, 5.0);
  return (
    <div style={{position: 'absolute', left: x, top: y, transform: `scale(${s}) rotate(${(1 - s) * -8}deg)`, opacity: Math.min(1, s * 2) * (1 - strike * 0.6)}}>
      <div style={{position: 'relative', fontFamily: FONT, fontWeight: 900, fontSize: 64, color: '#fff', padding: '14px 30px', borderRadius: 24,
        background: 'rgba(10,9,18,0.55)', backdropFilter: 'blur(10px)', border: '1px solid rgba(255,255,255,.18)', letterSpacing: '-0.03em'}}>
        {text}
        <div style={{position: 'absolute', left: 20, right: 20, top: '52%', height: 6, borderRadius: 3, background: C.pink, transform: `scaleX(${strike})`, transformOrigin: 'left'}} />
      </div>
    </div>
  );
};

const [P0] = SCENES.problem;

/** 5.7–16.9: вручную вбивают → плова нет → бросают */
export const Problem: React.FC = () => {
  const t = useT();
  const w = (p: string, n = 0) => local(wordAt('s02_problem', p, n), P0);
  const ph2 = w('плова') - 0.15, ph3 = w('поэтому') - 0.1;
  return (
    <AbsoluteFill>
      <Glow a="#ff2d6f" b="#3a2a7a" />
      <div style={{position: 'absolute', left: 120, top: 270}}>
        <Kinetic text="Проблема" at={0} size={36} weight={800} color={C.pink} style={{textTransform: 'uppercase', letterSpacing: '0.14em'}} />
      </div>
      <div style={{position: 'absolute', left: 120, top: 360, width: 860}}>
        {t < ph2 ? (
          <Kinetic text={'Каждый продукт\nвручную'} at={w('вручную') - 0.3} size={104} highlight={['вручную']} out={ph2 - 0.25} />
        ) : t < ph3 ? (
          <Kinetic text={'Плова, бешбармака\nи мантов — нет'} at={0} size={104}
            times={[w('плова'), w('бешбармака'), w('и'), w('мантов'), w('мантов') + 0.15, w('нет')]} highlight={['нет']} out={ph3 - 0.25} />
        ) : (
          <Kinetic text={'Бросают через\nнесколько дней'} at={0} size={104}
            times={[w('бросают'), w('через'), w('несколько'), w('дней')]} highlight={['несколько', 'дней']} />
        )}
      </div>
      <div style={{position: 'absolute', right: 150, top: 150}}>
        <MockApp ph2={ph2} ph3={ph3} />
      </div>
    </AbsoluteFill>
  );
};

/** Обычный счётчик калорий: серый, скучный, без бренда */
const MockApp: React.FC<{ph2: number; ph3: number}> = ({ph2, ph3}) => {
  const t = useT();
  const enter = useSpring(0, {damping: 16, stiffness: 160});
  const rows = [['Рис отварной', '150 г'], ['Говядина', '80 г'], ['Морковь', '40 г'], ['Лук', '20 г'], ['Масло', '15 г'], ['Нут', '30 г']];
  const query = 'бешбармак';
  const typed = query.slice(0, Math.max(0, Math.floor((t - ph2 - 0.2) / 0.06)));
  const font = {fontFamily: FONT, color: '#2b2b33'};
  return (
    <div style={{width: 600, height: 780, borderRadius: 44, background: '#ECECF1', padding: 36, boxShadow: '0 40px 120px rgba(0,0,0,.5)',
      transform: `translateY(${(1 - enter) * 60}px) rotate(${2 - enter * 4}deg)`, opacity: enter, overflow: 'hidden', position: 'relative', ...font}}>
      <div style={{fontWeight: 800, fontSize: 34, marginBottom: 24}}>Добавить продукт</div>
      <div style={{height: 64, borderRadius: 18, background: '#fff', display: 'flex', alignItems: 'center', padding: '0 22px', fontSize: 28, fontWeight: 500,
        color: t > ph2 ? '#2b2b33' : '#9a9aa6', border: t > ph2 ? `3px solid ${C.violet}` : '3px solid transparent'}}>
        🔍&nbsp;&nbsp;{t > ph2 ? typed : 'Поиск продукта'}{t > ph2 && Math.floor(t * 3) % 2 ? '|' : ''}
      </div>
      {t < ph2 ? (
        <div style={{marginTop: 22}}>
          {rows.map(([n, g], i) => {
            const p = lerp(t, 0.9 + i * 0.42, 1.25 + i * 0.42);
            return (
              <div key={n} style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: 74, borderRadius: 16, background: '#fff',
                marginBottom: 12, padding: '0 22px', fontSize: 28, fontWeight: 500, opacity: p, transform: `translateX(${(1 - p) * 40}px)`}}>
                <span>{n}</span><span style={{color: '#9a9aa6'}}>{g}</span>
              </div>
            );
          })}
        </div>
      ) : t < ph3 ? (
        <div style={{marginTop: 80, textAlign: 'center', opacity: lerp(t, ph2 + 0.9, ph2 + 1.2)}}>
          <div style={{fontSize: 90}}>🤷</div>
          <div style={{fontSize: 34, fontWeight: 800, marginTop: 16}}>Ничего не найдено</div>
          <div style={{fontSize: 26, color: '#9a9aa6', marginTop: 10}}>по запросу «{query}»</div>
        </div>
      ) : (
        <Week t={t - ph3} />
      )}
    </div>
  );
};

const Week: React.FC<{t: number}> = ({t}) => {
  const days = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
  return (
    <div style={{marginTop: 50}}>
      <div style={{fontSize: 30, fontWeight: 800, marginBottom: 26}}>Дневник питания</div>
      <div style={{display: 'flex', gap: 12}}>
        {days.map((d, i) => {
          const p = lerp(t, 0.15 + i * 0.16, 0.4 + i * 0.16);
          const ok = i < 2;
          return (
            <div key={d} style={{flex: 1, height: 120, borderRadius: 18, background: ok ? '#fff' : '#E0E0E7', display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center', gap: 10, opacity: p, transform: `scale(${0.8 + 0.2 * p})`}}>
              <div style={{fontSize: 22, color: '#9a9aa6', fontWeight: 700}}>{d}</div>
              <div style={{fontSize: 34}}>{ok ? '✅' : '—'}</div>
            </div>
          );
        })}
      </div>
      <div style={{marginTop: 40, fontSize: 28, color: '#9a9aa6', fontWeight: 500, opacity: lerp(t, 1.5, 1.9)}}>Последняя запись: 3 дня назад</div>
    </div>
  );
};

const [X0, X1] = SCENES.tension;

/** 16.9–19.9: тишина перед сбросом */
export const Tension: React.FC = () => {
  const t = useT();
  const d = X1 - X0;
  const z = interpolate(t, [0, d], [1, 1.12], clamp);
  const glow = lerp(t, d - 0.9, d, 0, 1);
  return (
    <AbsoluteFill style={{background: '#000', alignItems: 'center', justifyContent: 'center'}}>
      <AbsoluteFill style={{background: `radial-gradient(40% 50% at 50% 50%, ${C.pink}${Math.round(glow * 120).toString(16).padStart(2, '0')} 0%, transparent 70%)`}} />
      <div style={{transform: `scale(${z})`}}>
        <Kinetic text="Есть способ проще." at={0.35} stagger={0.14} size={120} align="center" highlight={['проще']} />
      </div>
    </AbsoluteFill>
  );
};

const [R0] = SCENES.reveal;

/** 19.9–22.5: сброс музыки — розовый экран, пиксельное лого */
export const Reveal: React.FC = () => {
  const t = useT();
  const s = useSpring(0, {damping: 9, stiffness: 140, mass: 0.7});
  const ring = (k: number) => lerp(t, k * 0.12, 0.9 + k * 0.12);
  return (
    <AbsoluteFill style={{background: C.pink, alignItems: 'center', justifyContent: 'center', overflow: 'hidden'}}>
      {[0, 1, 2].map((k) => (
        <div key={k} style={{position: 'absolute', width: 300 + ring(k) * 1500, height: 300 + ring(k) * 1500, borderRadius: '50%',
          border: `${10 - k * 3}px solid rgba(255,255,255,${0.35 * (1 - ring(k))})`}} />
      ))}
      <Img src={media('img/logo.png')} style={{width: 560, height: 560, imageRendering: 'pixelated', borderRadius: 40,
        transform: `scale(${0.4 + 0.6 * s}) rotate(${(1 - s) * -6}deg)`, boxShadow: '0 40px 120px rgba(80,0,30,.45)'}} />
      <div style={{position: 'absolute', bottom: 70, fontFamily: FONT, fontWeight: 800, fontSize: 44, color: '#fff', opacity: lerp(t, 1.0, 1.4),
        transform: `translateY(${(1 - lerp(t, 1.0, 1.4)) * 20}px)`, letterSpacing: '-0.02em'}}>
        Фото еды → калории и разбор
      </div>
      <Flash at={0} len={0.4} />
    </AbsoluteFill>
  );
};
export {R0};
