/**
 * ════════════════════════════════════════════════
 * FILE: RecordingPlayer.jsx  (Admin Mobile — Lead Center call player)
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   A small play/pause + seek bar for listening to a call recording, styled to
 *   match the admin-mobile look. A hidden real audio element does the playing;
 *   this just draws our own button, scrubber, and running time on top of it.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (a presentational player)
 *   Rendered by:  src/components/admin-mobile/leads/LeadRow.jsx
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  ./leadFormat (fmtTime)
 *   Data:      reads → none · writes → none
 *
 * NOTES / GOTCHAS:
 *   - Copied in from src/pages/crm/CrmCallLog.jsx (that file is frozen for the
 *     admin-mobile wave — never edit it). Classes are renamed to the .am-audio-*
 *     vocabulary (defined in index.css §LEADS); the CRM .crm-audio styles/tokens
 *     are scoped to .crm-shell and would not resolve inside the tech shell.
 *   - `src` is a blob: URL created by the row (an <audio src> can't carry the
 *     Supabase auth header, so the row fetches the audio then hands us a blob URL).
 * ════════════════════════════════════════════════
 */
import { useState, useRef } from 'react';
import { fmtTime } from './leadFormat';

export default function RecordingPlayer({ src }) {
  const audioRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [cur, setCur] = useState(0);
  const [dur, setDur] = useState(0);

  const toggle = () => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) a.play(); else a.pause();
  };
  const onSeek = (e) => {
    const a = audioRef.current;
    if (a && dur) a.currentTime = (Number(e.target.value) / 100) * dur;
  };

  return (
    <div className="am-audio">
      <button type="button" className="am-audio-btn" onClick={toggle} aria-label={playing ? 'Pause' : 'Play'}>
        {playing ? '❚❚' : '▶'}
      </button>
      <input
        className="am-audio-seek" type="range" min="0" max="100" step="0.1"
        value={dur ? (cur / dur) * 100 : 0} onChange={onSeek} aria-label="Seek recording"
      />
      <span className="am-audio-time">{fmtTime(cur)} / {fmtTime(dur)}</span>
      <audio
        ref={audioRef} src={src} autoPlay className="am-audio-engine"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onTimeUpdate={(e) => setCur(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setDur(e.currentTarget.duration)}
        onEnded={() => setPlaying(false)}
      />
    </div>
  );
}
