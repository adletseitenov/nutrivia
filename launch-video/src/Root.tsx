import React, {useEffect, useState} from 'react';
import {AbsoluteFill, Composition, continueRender, delayRender} from 'remotion';
import {fontsReady} from './lib/fonts';
import {f, FPS, SCENES, TOTAL} from './lib/timeline';
import {Grain, Scene} from './lib/ui';
import {AdviceScene, PhotoScene, StreakScene, TrainerScene} from './scenes/Product';
import {BusinessScene, EndScene} from './scenes/Closing';
import {Hook, Problem, Reveal, Tension} from './scenes/Opening';
import {Soundtrack} from './Soundtrack';

const Launch: React.FC = () => {
  const [h] = useState(() => delayRender('fonts'));
  useEffect(() => { fontsReady.then(() => continueRender(h)); }, [h]);
  const S = SCENES;
  return (
    <AbsoluteFill style={{background: '#000'}}>
      <Scene start={S.hook[0]} end={S.hook[1]} enter={0}><Hook /></Scene>
      <Scene start={S.problem[0]} end={S.problem[1]}><Problem /></Scene>
      <Scene start={S.tension[0]} end={S.tension[1]} exit={0}><Tension /></Scene>
      <Scene start={S.reveal[0]} end={S.reveal[1]} enter={0}><Reveal /></Scene>
      <Scene start={S.photo[0]} end={S.photo[1]}><PhotoScene /></Scene>
      <Scene start={S.advice[0]} end={S.advice[1]}><AdviceScene /></Scene>
      <Scene start={S.streak[0]} end={S.streak[1]}><StreakScene /></Scene>
      <Scene start={S.trainer[0]} end={S.trainer[1]}><TrainerScene /></Scene>
      <Scene start={S.business[0]} end={S.business[1]}><BusinessScene /></Scene>
      <Scene start={S.end[0]} end={S.end[1]} exit={0}><EndScene /></Scene>
      <Grain opacity={0.07} />
      <Soundtrack />
    </AbsoluteFill>
  );
};

export const Root: React.FC = () => (
  <Composition id="Launch" component={Launch} durationInFrames={f(TOTAL)} fps={FPS} width={1920} height={1080} />
);
