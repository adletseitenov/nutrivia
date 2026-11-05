import {Audio} from '@remotion/media';
import React from 'react';
import {interpolate, Sequence, staticFile} from 'remotion';
import {DROP, f, FPS, SCENES, TOTAL, VO, voEnd, wordAt} from './lib/timeline';

const a = (p: string) => staticFile(`media/audio/${p}`);
const lines = Object.keys(VO);

/** Громкость музыки: вступление, «прижатие» под голос, подъём на сбросе, затухание в конце */
function musicVol(t: number) {
  let duck = 1;
  for (const l of lines) {
    const s = VO[l], e = voEnd(l);
    const d = interpolate(t, [s - 0.25, s, e, e + 0.35], [1, 0.28, 0.28, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
    duck = Math.min(duck, d);
  }
  const base = interpolate(t, [0, 0.8, 16.9, DROP - 0.05, DROP, DROP + 1.5, TOTAL - 3.5, TOTAL - 0.2], [0, 0.55, 0.55, 0.75, 0.95, 0.62, 0.62, 0],
    {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  return base * duck;
}

const Sfx: React.FC<{at: number; file: string; vol?: number}> = ({at, file, vol = 0.35}) => (
  <Sequence from={f(at)} durationInFrames={f(3.2)} layout="none">
    <Audio src={a(`sfx-${file}.wav`)} volume={vol} />
  </Sequence>
);

export const Soundtrack: React.FC = () => {
  // те же формулы моментов, что в сценах
  const hookCut = wordAt('s01_hook', 'плова') + 0.05;
  const shot = wordAt('s04_photo', 'тарелку') + 0.35;
  const scanAt = shot + 0.65;
  const fridgeScan = wordAt('s05_advice', 'если') - 0.15 + 0.25;
  const T0 = SCENES.trainer[0];
  const sent = T0 + 0.3 + (5.7 - 0.4) + 0.15;
  const B = (p: string) => wordAt('s08_business', p);
  return (
    <>
      <Audio src={a('music.mp3')} volume={(fr) => musicVol(fr / FPS)} />
      {lines.map((l) => (
        <Sequence key={l} from={f(VO[l])} layout="none">
          <Audio src={a(`${l}.mp3`)} volume={0.85} />
        </Sequence>
      ))}
      <Sfx at={hookCut - 0.05} file="whoosh" vol={0.3} />
      {[0.25, 0.45, 0.65].map((d) => <Sfx key={d} at={hookCut + d} file="pop" vol={0.3} />)}
      <Sfx at={SCENES.problem[0] - 0.15} file="whoosh" vol={0.28} />
      <Sfx at={SCENES.tension[0]} file="riser" vol={0.32} />
      <Sfx at={DROP} file="impact" vol={0.4} />
      <Sfx at={SCENES.photo[0] - 0.1} file="whoosh" vol={0.28} />
      <Sfx at={shot} file="shutter" vol={0.6} />
      <Sfx at={scanAt} file="whoosh" vol={0.22} />
      <Sfx at={scanAt + 1.0} file="pop" vol={0.3} />
      <Sfx at={scanAt + 1.25} file="pop" vol={0.3} />
      {[0, 0.12, 0.24, 0.36, 0.5, 0.66, 0.84].map((d) => <Sfx key={d} at={scanAt + 1.5 + d} file="tick" vol={0.16} />)}
      <Sfx at={SCENES.advice[0] - 0.1} file="whoosh" vol={0.25} />
      <Sfx at={fridgeScan} file="whoosh" vol={0.22} />
      <Sfx at={fridgeScan + 0.95} file="pop" vol={0.28} />
      <Sfx at={fridgeScan + 1.15} file="pop" vol={0.28} />
      <Sfx at={SCENES.streak[0] - 0.1} file="whoosh" vol={0.25} />
      {[0, 1, 2, 3, 4].map((i) => <Sfx key={i} at={SCENES.streak[0] + 0.3 + i * 0.18} file="pop" vol={0.18} />)}
      <Sfx at={SCENES.streak[0] + 2.7} file="impact" vol={0.25} />
      <Sfx at={SCENES.trainer[0] - 0.1} file="whoosh" vol={0.25} />
      <Sfx at={T0 + 0.9} file="ding" vol={0.4} />
      <Sfx at={sent + 0.2} file="ding" vol={0.32} />
      <Sfx at={SCENES.business[0] - 0.1} file="whoosh" vol={0.25} />
      <Sfx at={B('две')} file="pop" vol={0.3} />
      <Sfx at={B('дальше')} file="pop" vol={0.3} />
      <Sfx at={B('разбор')} file="pop" vol={0.3} />
      <Sfx at={SCENES.end[0] - 0.1} file="impact" vol={0.35} />
    </>
  );
};
