import React from 'react';
import {AbsoluteFill, Img, interpolate, Sequence} from 'remotion';
import {FONT} from '../lib/fonts';
import {C} from '../lib/theme';
import {f, SCENES, wordAt} from '../lib/timeline';
import {clamp, Count, Flash, Glow, Kinetic, lerp, media, Phone, Photo, Pill, useSpring, useT} from '../lib/ui';

const loc = (line: string, p: string, s: number, n = 0) => wordAt(line, p, n) - s;

/** Панель с фото и «сканированием» ИИ */
const ScanPanel: React.FC<{src: string; x: number; y: number; w: number; h: number; scanAt: number; pos?: string; children?: React.ReactNode}> = ({
  src, x, y, w, h, scanAt, pos = 'center', children,
}) => {
  const t = useT();
  const enter = useSpring(scanAt - 0.45, {damping: 16});
  const scan = lerp(t, scanAt, scanAt + 1.1);
  const scanOn = t >= scanAt && t <= scanAt + 1.25;
  const z = interpolate(t, [scanAt - 0.5, scanAt + 8], [1.12, 1.0], clamp);
  return (
    <div style={{position: 'absolute', left: x, top: y, width: w, height: h, borderRadius: 44, overflow: 'hidden', boxShadow: '0 40px 120px rgba(0,0,0,.55)',
      transform: `translateY(${(1 - enter) * 80}px) scale(${0.94 + 0.06 * enter})`, opacity: enter}}>
      <Img src={media(src)} style={{width: '100%', height: '100%', objectFit: 'cover', objectPosition: pos, transform: `scale(${z})`}} />
      <div style={{position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(0,0,0,0) 45%, rgba(0,0,0,.72) 100%)'}} />
      {scanOn ? (
        <>
          <div style={{position: 'absolute', left: 0, right: 0, top: `${scan * 100}%`, height: 4, background: '#fff', boxShadow: `0 0 30px 8px ${C.pink}, 0 0 80px 20px ${C.pink}88`}} />
          <div style={{position: 'absolute', left: 0, right: 0, top: 0, height: `${scan * 100}%`, background: `linear-gradient(180deg, transparent 70%, ${C.pink}30 100%)`}} />
          <div style={{position: 'absolute', inset: 0, backgroundImage: 'linear-gradient(rgba(255,255,255,.08) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.08) 1px, transparent 1px)',
            backgroundSize: '48px 48px', opacity: 1 - scan * 0.6}} />
        </>
      ) : null}
      {children}
    </div>
  );
};

/** Метка блюда, «прилипающая» к фото */
const Tag: React.FC<{at: number; x: number; y: number; title: string; sub: string; dot?: string}> = ({at, x, y, title, sub, dot = C.pink}) => {
  const s = useSpring(at, {damping: 12, stiffness: 170});
  return (
    <div style={{position: 'absolute', left: x, top: y, transform: `scale(${s})`, transformOrigin: 'left center', opacity: Math.min(1, s * 2)}}>
      <div style={{display: 'flex', alignItems: 'center', gap: 16}}>
        <div style={{width: 26, height: 26, borderRadius: 13, background: dot, boxShadow: `0 0 0 8px ${dot}44, 0 0 30px ${dot}`}} />
        <div style={{padding: '14px 24px', borderRadius: 22, background: 'rgba(10,9,18,0.72)', backdropFilter: 'blur(12px)', border: '1px solid rgba(255,255,255,.16)', fontFamily: FONT}}>
          <div style={{fontWeight: 800, fontSize: 32, color: '#fff', letterSpacing: '-0.02em'}}>{title}</div>
          <div style={{fontWeight: 500, fontSize: 24, color: C.muted, marginTop: 2}}>{sub}</div>
        </div>
      </div>
    </div>
  );
};

const [F0] = SCENES.photo;

/** 22.5–31.6: снимок → сканирование → настоящий разбор ИИ → база блюд */
export const PhotoScene: React.FC = () => {
  const t = useT();
  const w = (p: string, n = 0) => loc('s04_photo', p, F0, n);
  const shot = w('тарелку') + 0.35;
  const split = shot + 0.3;
  const scanAt = split + 0.35;
  const dishes = ['Плов', 'Бешбармак', 'Манты', 'Лагман', 'Баурсак', 'Сорпа', 'Куырдак', 'Казы', 'Самса', 'Шашлык', 'Кеспе', 'Чак-чак', 'Шубат', 'Курт', 'Оливье', 'Борщ'];
  const dishesAt = w('больше') - 0.1;
  return (
    <AbsoluteFill>
      {t < split ? (
        <AbsoluteFill>
          <Photo src="img/hand-photo.jpg" dur={split} zoom={[1.02, 1.14]} pos="50% 40%" />
          <AbsoluteFill style={{background: 'linear-gradient(90deg, rgba(0,0,0,.65), rgba(0,0,0,0) 60%)'}} />
          <div style={{position: 'absolute', left: 120, bottom: 150}}>
            <Kinetic text="Сфотографируй тарелку" at={0} times={[w('сфотограф'), w('тарелку')]} size={110} highlight={['тарелку']} />
          </div>
          <Flash at={shot} len={0.3} />
        </AbsoluteFill>
      ) : (
        <AbsoluteFill>
          <Glow />
          <ScanPanel src="img/plov.jpg" x={90} y={90} w={1060} h={720} scanAt={scanAt} pos="50% 55%">
            <Tag at={scanAt + 1.0} x={380} y={300} title="Плов с говядиной" sub="1½ пиалы · ≈ 450 г" />
            <Tag at={scanAt + 1.25} x={130} y={70} title="Салат из свежих овощей" sub="≈ 150 г" dot={C.green} />
            <div style={{position: 'absolute', left: 50, bottom: 40, fontFamily: FONT, color: '#fff'}}>
              <div style={{fontWeight: 900, fontSize: 120, letterSpacing: '-0.05em', lineHeight: 1, opacity: lerp(t, scanAt + 1.5, scanAt + 1.7)}}>
                <Count to={915} at={scanAt + 1.5} dur={1.0} /> <span style={{fontSize: 48, fontWeight: 800}}>ккал</span>
              </div>
              <div style={{fontWeight: 600, fontSize: 26, color: C.muted, marginTop: 6, opacity: lerp(t, scanAt + 2.0, scanAt + 2.3)}}>оценка по фото · белки 31 · углеводы 107 · жиры 41</div>
            </div>
          </ScanPanel>
          <div style={{position: 'absolute', right: 120, top: 70}}>
            <PhoneIn at={split + 0.1}>
              <Sequence from={f(split + 0.1)} layout="none">
                <Phone w={400} src="clips/review.mp4" trimBefore={10.1} />
              </Sequence>
            </PhoneIn>
          </div>
          <div style={{position: 'absolute', left: 90, top: 850, width: 1060}}>
            {t < dishesAt ? (
              <Kinetic text="ИИ узнаёт блюдо и порцию — калории считает наша база" at={0} size={44} weight={800}
                times={[w('искусств'), w('интеллект'), w('узнает'), w('блюдо'), w('порцию') - 0.1, w('порцию'), w('калори'), w('считает'), w('наша'), w('база')]}
                highlight={['калории', 'база']} out={dishesAt - 0.3} />
            ) : (
              <DishTicker dishes={dishes} at={dishesAt} />
            )}
          </div>
        </AbsoluteFill>
      )}
    </AbsoluteFill>
  );
};

const PhoneIn: React.FC<{at: number; children: React.ReactNode}> = ({at, children}) => {
  const s = useSpring(at, {damping: 15, stiffness: 110});
  const t = useT();
  const bob = Math.sin((t - at) * 1.3) * 7;
  return <div style={{transform: `translateY(${(1 - s) * 300 + bob}px) rotate(${(1 - s) * 8 + Math.sin((t - at) * 0.9) * 0.6}deg)`, opacity: Math.min(1, s * 1.6)}}>{children}</div>;
};

const DishTicker: React.FC<{dishes: string[]; at: number}> = ({dishes, at}) => {
  const t = useT();
  const shift = (t - at) * 90;
  return (
    <div style={{display: 'flex', alignItems: 'center', gap: 22}}>
      <Pill at={at} bg={C.pink} size={34} style={{fontWeight: 900}}>100+ блюд</Pill>
      <div style={{flex: 1, overflow: 'hidden', maskImage: 'linear-gradient(90deg, transparent, #000 8%, #000 85%, transparent)'}}>
        <div style={{display: 'flex', gap: 14, transform: `translateX(${-shift}px)`, opacity: lerp(t, at + 0.2, at + 0.5)}}>
          {[...dishes, ...dishes].map((d, i) => (
            <div key={i} style={{padding: '14px 26px', borderRadius: 999, background: C.card, border: `1px solid ${C.line}`, fontFamily: FONT, fontWeight: 700, fontSize: 30, color: '#fff', whiteSpace: 'nowrap'}}>{d}</div>
          ))}
        </div>
      </div>
    </div>
  );
};

const [A0] = SCENES.advice;

/** 31.6–38.9: совет на вечер → холодильник */
export const AdviceScene: React.FC = () => {
  const t = useT();
  const w = (p: string, n = 0) => loc('s05_advice', p, A0, n);
  const sw = w('если') - 0.15;
  return (
    <AbsoluteFill>
      <Glow a={C.violet} b={C.pink} />
      {t < sw ? (
        <>
          <div style={{position: 'absolute', left: 260, top: 70}}>
            <PhoneIn at={0.05}>
              <Phone w={400} src="clips/today.mp4" trimBefore={0.9} />
            </PhoneIn>
          </div>
          <div style={{position: 'absolute', left: 860, top: 330, width: 950}}>
            <Pill at={w('вечером')} size={30} bg="rgba(107,78,255,.35)">🌙 Вечером</Pill>
            <div style={{height: 30}} />
            <Kinetic text={'Подскажет, что съесть,\nчтобы уложиться в норму'} at={0} size={84}
              times={[w('подскажет'), w('что'), w('съесть'), w('чтобы'), w('уложиться'), w('свою') - 0.05, w('свою'), w('норму')]} highlight={['норму']} out={sw - 0.25} />
          </div>
        </>
      ) : (
        <>
          <ScanPanel src="img/products.jpg" x={90} y={150} w={980} h={650} scanAt={sw + 0.25} pos="50% 50%">
            <Tag at={sw + 1.2} x={520} y={250} title="Яйца" sub="распознано на фото" dot={C.violetSoft} />
            <Tag at={sw + 1.4} x={110} y={120} title="Молоко" sub="распознано на фото" dot={C.violetSoft} />
          </ScanPanel>
          <div style={{position: 'absolute', right: 150, top: 70}}>
            <PhoneIn at={sw + 0.1}>
              <Sequence from={f(sw + 0.1)} layout="none">
                <Phone w={400} src="clips/fridge.mp4" trimBefore={7.1} />
              </Sequence>
            </PhoneIn>
          </div>
          <div style={{position: 'absolute', left: 90, top: 840, width: 1100}}>
            <Kinetic text="Покажи холодильник — подберём блюдо" at={0} size={56} weight={900}
              times={[w('покажи'), w('холодильник'), w('холодильник') + 0.25, w('холодильник') + 0.5, w('холодильник') + 0.65]} highlight={['холодильник']} />
          </div>
        </>
      )}
    </AbsoluteFill>
  );
};

const [S0] = SCENES.streak;

/** 38.9–44.1: голубика растёт */
export const StreakScene: React.FC = () => {
  const t = useT();
  const w = (p: string, n = 0) => loc('s06_streak', p, S0, n);
  const names = ['Росток', 'Бутон', 'Цветок', 'Завязь', 'Голубика'];
  const swap = 2.7;
  return (
    <AbsoluteFill>
      <Glow a="#5b3cff" b={C.pink} base="#0b0918" />
      <div style={{position: 'absolute', left: 120, top: 150, width: 1000}}>
        <Kinetic text={'Фото каждый день —\nголубика растёт'} at={w('голубика') - 0.2} stagger={0.12} size={96} highlight={['голубика']} />
      </div>
      <div style={{position: 'absolute', left: 120, top: 560, display: 'flex', gap: 34, alignItems: 'flex-end'}}>
        {names.map((n, i) => {
          const s = useSpring(0.3 + i * 0.18, {damping: 11, stiffness: 150});
          const active = i <= 2;
          const cur = i === 2;
          const bob = cur ? Math.sin(t * 3.2) * 8 : 0;
          return (
            <div key={n} style={{display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, transform: `scale(${s}) translateY(${bob}px)`, opacity: Math.min(1, s * 1.5)}}>
              <div style={{width: 150, height: 150, borderRadius: 40, display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: cur ? 'rgba(245,0,83,.22)' : C.card, border: cur ? `4px solid ${C.pink}` : `1px solid ${C.line}`,
                boxShadow: cur ? `0 0 60px ${C.pink}66` : undefined}}>
                <Img src={media(`img/stage-${i + 1}.png`)} style={{width: 112, height: 112, imageRendering: 'pixelated', filter: active ? undefined : 'grayscale(1) brightness(.45)', opacity: active ? 1 : 0.5}} />
              </div>
              <div style={{fontFamily: FONT, fontWeight: 700, fontSize: 26, color: active ? '#fff' : C.muted}}>{n}</div>
            </div>
          );
        })}
      </div>
      <div style={{position: 'absolute', left: 120, top: 860}}>
        <Pill at={w('растет') - 0.1} size={34} bg={C.pink}>🔥 7 дней подряд · стадия 3 из 5</Pill>
      </div>
      <div style={{position: 'absolute', right: 150, top: 70}}>
        <PhoneIn at={0.05}>
          {t < swap ? (
            <Phone w={400} src="clips/streak.mp4" trimBefore={0.7} />
          ) : (
            <Sequence from={f(swap)} layout="none">
              <Phone w={400} src="clips/stageup.mp4" trimBefore={0} />
            </Sequence>
          )}
        </PhoneIn>
      </div>
      <Flash at={swap} len={0.25} color={C.pink} />
    </AbsoluteFill>
  );
};

const [T0] = SCENES.trainer;

/** 44.1–51.9: тренер получает фото в Telegram и проверяет */
export const TrainerScene: React.FC = () => {
  const t = useT();
  const w = (p: string, n = 0) => loc('s07_trainer', p, T0, n);
  const notifAt = 0.9;
  const notifOut = 3.1;
  const sent = 0.3 + (5.7 - 0.4) + 0.15;
  const nIn = useSpring(notifAt, {damping: 14, stiffness: 140});
  const nOut = lerp(t, notifOut, notifOut + 0.4);
  const toast = useSpring(sent + 0.2, {damping: 13, stiffness: 150});
  return (
    <AbsoluteFill>
      <Glow a={C.pink} b="#2b7fff" />
      <div style={{position: 'absolute', left: 120, top: 100, width: 760}}>
        <Kinetic text={'Тренер видит\nкаждый приём пищи'} at={0} size={92}
          times={[w('тренер'), w('видит'), w('питание'), w('своих'), w('клиентов')]} highlight={['каждый', 'приём', 'пищи']} />
        <div style={{height: 50}} />
        <div style={{display: 'flex', flexDirection: 'column', gap: 18, alignItems: 'flex-start'}}>
          <Pill at={w('telegram') - 0.05} size={32} bg="rgba(42,171,238,.28)">✈️ Новые фото — в Telegram</Pill>
          <Pill at={w('без')} size={32}>🚫 Без скриншотов в WhatsApp</Pill>
          <Pill at={sent + 0.3} size={32} bg="rgba(43,214,123,.25)">✅ Клиенту — проверенный разбор</Pill>
        </div>
      </div>
      <div style={{position: 'absolute', left: 930, top: 150, transform: 'scale(0.82)', transformOrigin: 'top left', opacity: 0.9}}>
        <Phone w={400} src="clips/review.mp4" trimBefore={12.5}>
          <div style={{position: 'absolute', left: 16, right: 16, top: 70, transform: `translateY(${(1 - toast) * -160}px)`, opacity: Math.min(1, toast * 1.5)}}>
            <Banner title="✅ Тренер проверил разбор" body="Плов с говядиной — 915 ккал. «Хороший выбор! Добавьте белка на ужин»" app="Nutrivia" />
          </div>
        </Phone>
        <div style={{textAlign: 'center', fontFamily: FONT, fontWeight: 700, fontSize: 30, color: C.muted, marginTop: 18}}>Клиент</div>
      </div>
      <div style={{position: 'absolute', left: 1340, top: 70}}>
        <Sequence from={f(0.3)} layout="none">
          <Phone w={400} src="clips/trainer.mp4" trimBefore={0.4} />
        </Sequence>
        <div style={{textAlign: 'center', fontFamily: FONT, fontWeight: 700, fontSize: 30, color: C.muted, marginTop: 18}}>Тренер</div>
        <div style={{position: 'absolute', left: -40, right: -40, top: 60, transform: `translateY(${(1 - nIn) * -220 - nOut * 220}px)`, opacity: Math.min(1, nIn * 1.6) * (1 - nOut)}}>
          <Banner title="📸 Новое фото на проверку" body="Ученик 1: плов с говядиной, салат — 915 ккал" app="Telegram · Nutrivia" big />
        </div>
      </div>
    </AbsoluteFill>
  );
};

const Banner: React.FC<{title: string; body: string; app: string; big?: boolean}> = ({title, body, app, big}) => (
  <div style={{borderRadius: big ? 34 : 26, padding: big ? '22px 26px' : '16px 18px', background: 'rgba(30,28,40,0.88)', backdropFilter: 'blur(20px)',
    border: '1px solid rgba(255,255,255,.14)', boxShadow: '0 30px 80px rgba(0,0,0,.5)', fontFamily: FONT, color: '#fff', display: 'flex', gap: big ? 18 : 12}}>
    <Img src={media('img/logo.png')} style={{width: big ? 64 : 44, height: big ? 64 : 44, borderRadius: big ? 16 : 11, imageRendering: 'pixelated'}} />
    <div style={{flex: 1}}>
      <div style={{fontSize: big ? 20 : 15, color: C.muted, fontWeight: 600}}>{app} · сейчас</div>
      <div style={{fontSize: big ? 30 : 20, fontWeight: 800, marginTop: 2}}>{title}</div>
      <div style={{fontSize: big ? 24 : 16, fontWeight: 500, color: 'rgba(255,255,255,.82)', marginTop: 2, lineHeight: 1.25}}>{body}</div>
    </div>
  </div>
);
