import { useEffect, useRef, useState } from "react";
import { subscribeTicker, useReducedMotion } from "../system/motion";
import { useLang } from "../system/i18n";
import { SONG } from "../system/music";
import { _releaseAudio, _setEnergy } from "../system/musicEnergy";
import "./MusicPlayer.css";

/* Local bilingual copy (the central dictionary is a later integration step). */
const COPY = {
  en: {
    play: "Play",
    pause: "Pause",
    missing: "(audio file missing — see public/audio/README.txt)",
  },
  zh: {
    play: "播放",
    pause: "暂停",
    missing: "（音频文件缺失 — 见 public/audio/README.txt）",
  },
} as const;

interface AnalyserState {
  analyser: AnalyserNode;
  data: Uint8Array<ArrayBuffer>;
  smoothed: number;
}

export default function MusicPlayer() {
  const { lang } = useLang();
  const reduced = useReducedMotion();
  const copy = COPY[lang];

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);
  const analyserRef = useRef<AnalyserState | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);

  const [playing, setPlaying] = useState(false);
  const [needsGesture, setNeedsGesture] = useState(false);
  const [missing, setMissing] = useState(false);

  /* Wiring: autoplay attempt, one-time gesture retry, analyser setup. */
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    /* Lazily build the Web Audio graph on the first successful play.
       createMediaElementSource + AudioContext generally need a user gesture,
       so everything is wrapped in try/catch — any failure simply keeps the
       synthetic breath fallback driving the energy signal. */
    const setupAnalyser = () => {
      if (analyserRef.current) return;
      try {
        const Ctor =
          window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext })
            .webkitAudioContext;
        if (!Ctor) return;
        const ctx = audioCtxRef.current ?? new Ctor();
        audioCtxRef.current = ctx;
        if (ctx.state === "suspended") void ctx.resume();
        const source = ctx.createMediaElementSource(audio);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        analyser.connect(ctx.destination); // keep the track audible
        analyserRef.current = {
          analyser,
          data: new Uint8Array(analyser.frequencyBinCount),
          smoothed: 0,
        };
      } catch {
        analyserRef.current = null;
      }
    };

    const onPlay = () => {
      setPlaying(true);
      setNeedsGesture(false);
      setupAnalyser();
    };
    const onPause = () => {
      setPlaying(false);
      _releaseAudio(); // hand energy back to the synthetic breath
    };
    const onError = () => setMissing(true); // mp3 404 — stay visible, unbroken

    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("error", onError);

    /* 默认播放: attempt autoplay on mount; if the browser autoplay policy
       rejects the promise, retry once on the first user gesture anywhere. */
    let gestureRetry: (() => void) | null = null;
    const removeGestureRetry = () => {
      if (!gestureRetry) return;
      window.removeEventListener("pointerdown", gestureRetry);
      window.removeEventListener("keydown", gestureRetry);
      gestureRetry = null;
    };
    const tryPlay = () => {
      audio
        .play()
        .then(() => removeGestureRetry())
        .catch(() => setNeedsGesture(true));
    };
    gestureRetry = () => tryPlay();
    window.addEventListener("pointerdown", gestureRetry);
    window.addEventListener("keydown", gestureRetry);
    tryPlay();

    return () => {
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("error", onError);
      removeGestureRetry();
      _releaseAudio();
    };
  }, []);

  /* Per-frame work on the shared ticker: hairline progress + RMS → energy. */
  useEffect(
    () =>
      subscribeTicker(() => {
        const audio = audioRef.current;
        if (barRef.current && audio && audio.duration > 0) {
          const p = Math.min(1, audio.currentTime / audio.duration);
          barRef.current.style.transform = `scaleX(${p})`;
        }
        const st = analyserRef.current;
        if (st && audio && !audio.paused) {
          st.analyser.getByteTimeDomainData(st.data);
          let sum = 0;
          for (let i = 0; i < st.data.length; i++) {
            const v = (st.data[i] - 128) / 128;
            sum += v * v;
          }
          const rms = Math.min(1, Math.sqrt(sum / st.data.length) * 3);
          /* attack-fast / release-slow envelope (~0.3 s release @60fps) */
          const k = rms > st.smoothed ? 0.5 : 0.055;
          st.smoothed += (rms - st.smoothed) * k;
          _setEnergy(st.smoothed);
        }
      }),
    [],
  );

  const toggle = () => {
    const audio = audioRef.current;
    if (!audio || missing) return;
    if (audio.paused) {
      void audio.play().catch(() => setNeedsGesture(true));
    } else {
      audio.pause();
    }
  };

  /* Reduced motion: audio keeps playing (sound is not motion),
     only the spinning indicator stops. */
  const spinning = playing && !reduced;

  return (
    <div className="music-player" data-missing={missing || undefined}>
      <span
        className={`music-player__disc${spinning ? " is-spinning" : ""}`}
        aria-hidden="true"
      />
      <div className="music-player__body">
        <div className="music-player__title">
          {SONG.title} feat. {SONG.artist} ({SONG.mix})
        </div>
        <div className="music-player__progress">
          <div ref={barRef} className="music-player__progress-bar" />
        </div>
      </div>
      <button
        type="button"
        className="music-player__toggle"
        onClick={toggle}
        disabled={missing}
        aria-label={playing ? copy.pause : copy.play}
        title={missing ? copy.missing : playing ? copy.pause : copy.play}
      >
        <span
          className={`music-player__icon music-player__icon--${
            playing ? "pause" : "play"
          }`}
          aria-hidden="true"
        />
      </button>
      {needsGesture && !playing && (
        <span className="music-player__hint" aria-hidden="true">
          ♪
        </span>
      )}
      <audio ref={audioRef} src={SONG.src} loop preload="auto" />
    </div>
  );
}
