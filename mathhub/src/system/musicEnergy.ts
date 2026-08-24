/*
   musicEnergy.ts — shared music-amplitude signal (0..1) for hero breathing.

   Sources, in priority order:
   1. Real audio: the MusicPlayer feeds smoothed analyser RMS via _setEnergy()
      while playback is running.
   2. Synthetic fallback: a slow "breath" sine on the shared ticker, so the
      hero keeps breathing when there is no audio file or nothing is playing.
*/

import { subscribeTicker } from "./motion";

type EnergyListener = (e: number) => void;

const listeners = new Set<EnergyListener>();

let energy = 0; // last emitted value, clamped 0..1
let realAudioActive = false; // true while the player's analyser drives the signal

/* Subscribe to energy updates (~30–60Hz via the shared ticker).
   Returns an unsubscribe function. */
export function subscribeEnergy(cb: EnergyListener): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/* Current energy, 0..1 (0 when silent). */
export function getEnergy(): number {
  return energy;
}

function emit(e: number): void {
  energy = e < 0 ? 0 : e > 1 ? 1 : e;
  listeners.forEach((cb) => {
    cb(energy);
  });
}

/* Player-internal: feed smoothed analyser RMS (0..1). The first call flips
   the source from the synthetic breath to the real audio signal. */
export function _setEnergy(e: number): void {
  realAudioActive = true;
  emit(e);
}

/* Player-internal: hand the signal back to the synthetic breath
   (playback paused/stopped or player unmounted). */
export function _releaseAudio(): void {
  realAudioActive = false;
}

/* Synthetic breath fallback: e = 0.35 + 0.2 · sin(t / 8s), driven by the ONE
   shared rAF ticker (never a private loop). Skipped while real audio plays. */
subscribeTicker((time) => {
  if (realAudioActive) return;
  emit(0.35 + 0.2 * Math.sin((time / 8000) * Math.PI * 2));
});
