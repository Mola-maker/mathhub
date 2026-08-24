import { GeometryProvider } from "./system/geometry";
import { SceneShell } from "./system/scroll";
import { LanguageProvider, useLang } from "./system/i18n";
import Backdrop from "./system/Backdrop";
import Cursor from "./system/cursor";
import FooterNote from "./components/FooterNote";
import Scene1 from "./scenes/Scene1";
import Scene2 from "./scenes/Scene2";
import Scene3 from "./scenes/Scene3";
import Scene4 from "./scenes/Scene4";
import Scene5 from "./scenes/Scene5";
import Scene6 from "./scenes/Scene6";
import "./App.css";

/* 'EN / 中' — pure floating typography, no box. Each half is a
   button; the active half brightens to --paper. */
function LangToggle() {
  const { lang, setLang } = useLang();
  return (
    <span className="top__lang" role="group" aria-label="Language">
      <button
        type="button"
        className={`top__lang-half${lang === "en" ? " is-active" : ""}`}
        aria-pressed={lang === "en"}
        onClick={() => setLang("en")}
      >
        EN
      </button>
      <span className="top__lang-sep" aria-hidden="true" />
      <button
        type="button"
        className={`top__lang-half${lang === "zh" ? " is-active" : ""}`}
        aria-pressed={lang === "zh"}
        onClick={() => setLang("zh")}
      >
        中
      </button>
    </span>
  );
}

function Header() {
  const { t } = useLang();

  /* Wordmark + actions only — the anchor nav group was removed
     (the chapter titles duplicated the scroll narrative). The
     entry action now points at Scene 6, the real studio gateways. */
  return (
    <header className="top">
      <a className="top__wordmark" href="#scene-1">
        MathHub
      </a>
      <div className="top__actions">
        <LangToggle />
        <a className="top__enter" href="#scene-6">
          {t("header.enter")}
        </a>
      </div>
    </header>
  );
}

function Chapters() {
  const { t } = useLang();
  return (
    <main>
      <SceneShell id="scene-1" title={t("chapter.origin")}>
        {(progress) => <Scene1 progress={progress} />}
      </SceneShell>
      <SceneShell id="scene-2" title={t("chapter.gesture")}>
        {(progress) => <Scene2 progress={progress} />}
      </SceneShell>
      <SceneShell id="scene-3" title={t("chapter.entries")}>
        {(progress) => <Scene3 progress={progress} />}
      </SceneShell>
      <SceneShell id="scene-4" title={t("chapter.convergence")}>
        {(progress) => <Scene4 progress={progress} />}
      </SceneShell>
      <SceneShell id="scene-5" title={t("chapter.workspace")}>
        {(progress) => <Scene5 progress={progress} />}
      </SceneShell>
      <SceneShell id="scene-6" title={t("chapter.instruments")} length={120}>
        {(progress) => <Scene6 progress={progress} />}
      </SceneShell>
      {/* Author / 备案 line — normal document flow, right after
          the last chapter. */}
      <FooterNote />
    </main>
  );
}

export default function App() {
  return (
    <LanguageProvider>
      <GeometryProvider>
        {/* Scroll-linked background color journey — fixed, solid
            chapter tones crossfading via opacity, below all content. */}
        <Backdrop />
        {/* Custom dot + ring cursor — fine pointers only, renders
            null (native cursor stays) under reduced motion. */}
        <Cursor />
        <Header />
        <Chapters />
      </GeometryProvider>
    </LanguageProvider>
  );
}
