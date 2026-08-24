/*
   music.ts — the one track the site plays, plus footer filing metadata.
*/

export const SONG = {
  title: "202",
  artist: "泉まくら",
  mix: "New Mix",
  src: "/mathhub/audio/202-new-mix.mp3",
} as const;
/* To enable audio: drop the mp3 into public/audio/
   (see public/audio/README.txt). Until then the player stays visible,
   progress stays at 0, and the synthetic breath keeps driving energy. */

/* ICP filing number shown in the footer.
   ⚠ REPLACE with the real filing number — the site owner MUST supply it.
   The value below is a placeholder, not a valid registration. */
export const ICP_NUMBER = "京ICP备00000000号-1";
