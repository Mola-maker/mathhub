import { ICP_NUMBER } from "../system/music";
import "./FooterNote.css";

/* FooterNote — one centered metadata line in normal flow, after the last
   scene. ICP_NUMBER lives in src/system/music.ts; REPLACE it with the real
   filing number (the site owner must supply it). */
export default function FooterNote() {
  return (
    <footer className="footer-note">
      <p className="footer-note__line">© 2026 molamaker · {ICP_NUMBER}</p>
    </footer>
  );
}
