#!/usr/bin/env python3
"""
AutoCut for DaVinci Resolve 20 / 21
===================================

Automatically removes silent moments and filler words ("um", "uh", "er",
"hmm", ...) from selected Media Pool clips and assembles a new, cut-down
timeline that is ready for editing.

How it works
------------
1. You select one or more clips in the Media Pool.
2. The script analyses each clip's audio:
     - silences      -> ffmpeg `silencedetect`
     - filler words  -> faster-whisper (word-level timestamps), optional
3. It computes the "keep" segments (with configurable padding so cuts
   don't clip the start/end of words) and appends them as subclips to a
   brand-new timeline named "<clip name> - AutoCut".

The original clips and timelines are never modified.

Install / usage: see README.md next to this file.

Run from inside Resolve:  Workspace -> Scripts -> auto_cut
"""

import os
import re
import shutil
import subprocess
import sys
import tempfile

# ---------------------------------------------------------------------------
# Defaults (editable in the dialog at runtime)
# ---------------------------------------------------------------------------

DEFAULTS = {
    "silence_db": -34.0,      # audio below this level (dBFS) counts as silence
    "min_silence": 0.50,      # seconds of silence before we cut it
    "keep_pad_ms": 150,       # padding kept around speech so cuts feel smooth
    "remove_fillers": True,
    "filler_words": "um, uh, uhh, umm, er, erm, ah, ahh, hmm, mm, mhm",
    "filler_pad_ms": 80,      # small padding around each removed filler word
    "whisper_model": "base",  # tiny | base | small | medium
    "language": "en",         # "" = auto-detect
}

MIN_KEEP_SEC = 0.25   # keep-segments shorter than this get merged into the cut
MIN_CUT_SEC = 0.20    # cut-segments shorter than this are left in (avoids choppiness)


# ---------------------------------------------------------------------------
# Resolve API access
# ---------------------------------------------------------------------------

def get_resolve():
    """Return the Resolve scripting object, whether run inside or outside Resolve."""
    try:
        return resolve  # injected when run from Workspace -> Scripts
    except NameError:
        pass
    try:
        import DaVinciResolveScript as dvr  # external execution (Studio only)
        return dvr.scriptapp("Resolve")
    except ImportError:
        return None


# ---------------------------------------------------------------------------
# ffmpeg helpers
# ---------------------------------------------------------------------------

def find_tool(name):
    """Locate ffmpeg/ffprobe on PATH or via FFMPEG_PATH / common install dirs."""
    env = os.environ.get(name.upper() + "_PATH")
    if env and os.path.isfile(env):
        return env
    found = shutil.which(name)
    if found:
        return found
    candidates = [
        "/usr/local/bin/" + name,
        "/opt/homebrew/bin/" + name,
        "C:\\ffmpeg\\bin\\" + name + ".exe",
        "C:\\Program Files\\ffmpeg\\bin\\" + name + ".exe",
    ]
    for c in candidates:
        if os.path.isfile(c):
            return c
    return None


def media_duration(ffprobe, path):
    if ffprobe:
        try:
            out = subprocess.run(
                [ffprobe, "-v", "error", "-show_entries", "format=duration",
                 "-of", "default=noprint_wrappers=1:nokey=1", path],
                stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                text=True, check=True,
            ).stdout.strip()
            return float(out)
        except Exception:
            pass
    return None


def detect_silences(ffmpeg, path, noise_db, min_dur):
    """Return [(start, end), ...] silence spans in seconds using silencedetect."""
    cmd = [
        ffmpeg, "-hide_banner", "-nostats", "-i", path,
        "-af", "silencedetect=noise=%gdB:d=%g" % (noise_db, min_dur),
        "-f", "null", "-",
    ]
    proc = subprocess.run(cmd, stdout=subprocess.DEVNULL,
                          stderr=subprocess.PIPE, text=True)
    spans, start = [], None
    for line in proc.stderr.splitlines():
        m = re.search(r"silence_start:\s*([\d.]+)", line)
        if m:
            start = float(m.group(1))
            continue
        m = re.search(r"silence_end:\s*([\d.]+)", line)
        if m and start is not None:
            spans.append((start, float(m.group(1))))
            start = None
    if start is not None:  # silence runs to end of file
        spans.append((start, float("inf")))
    return spans


def extract_wav(ffmpeg, path):
    """Extract 16 kHz mono WAV for Whisper. Caller deletes the temp file."""
    fd, wav = tempfile.mkstemp(suffix=".wav", prefix="autocut_")
    os.close(fd)
    subprocess.run(
        [ffmpeg, "-hide_banner", "-y", "-i", path,
         "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", wav],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True,
    )
    return wav


# ---------------------------------------------------------------------------
# Filler word detection (optional — degrades gracefully if whisper missing)
# ---------------------------------------------------------------------------

def detect_fillers(ffmpeg, path, filler_set, pad_s, model_size, language, log):
    try:
        from faster_whisper import WhisperModel
    except ImportError:
        log("faster-whisper not installed — skipping filler-word removal "
            "(silence cuts still applied). See README.md to enable it.")
        return []

    wav = None
    try:
        wav = extract_wav(ffmpeg, path)
        log("Transcribing with Whisper (%s)... this can take a while." % model_size)
        model = WhisperModel(model_size, device="auto", compute_type="auto")
        segments, _info = model.transcribe(
            wav,
            language=language or None,
            word_timestamps=True,
            condition_on_previous_text=False,
            # Priming the decoder with fillers makes Whisper far more likely
            # to actually transcribe them instead of cleaning them up.
            initial_prompt="Um, uh, er, ah, hmm... so, um, yeah.",
        )
        spans = []
        strip = re.compile(r"[^a-z']")
        for seg in segments:
            for w in (seg.words or []):
                token = strip.sub("", w.word.lower())
                if token in filler_set:
                    spans.append((max(0.0, w.start - pad_s), w.end + pad_s))
        log("Found %d filler word(s)." % len(spans))
        return spans
    except Exception as e:
        log("Filler detection failed (%s) — continuing with silence cuts only." % e)
        return []
    finally:
        if wav and os.path.exists(wav):
            os.remove(wav)


# ---------------------------------------------------------------------------
# Segment math
# ---------------------------------------------------------------------------

def merge_spans(spans):
    spans = sorted(s for s in spans if s[1] > s[0])
    merged = []
    for s, e in spans:
        if merged and s <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(merged[-1][1], e))
        else:
            merged.append((s, e))
    return merged


def compute_keep_segments(silences, fillers, duration, keep_pad_s):
    cuts = []
    # Shrink each silence by the keep-padding so we never clip speech.
    for s, e in silences:
        e = min(e, duration)
        s2, e2 = s + keep_pad_s, e - keep_pad_s
        if e2 - s2 >= MIN_CUT_SEC:
            cuts.append((s2, e2))
    cuts.extend(f for f in fillers if f[1] - f[0] >= MIN_CUT_SEC / 2)
    cuts = merge_spans(cuts)

    # Invert cuts -> keeps.
    keeps, cursor = [], 0.0
    for s, e in cuts:
        if s - cursor >= MIN_KEEP_SEC:
            keeps.append((cursor, min(s, duration)))
        cursor = max(cursor, e)
    if duration - cursor >= MIN_KEEP_SEC:
        keeps.append((cursor, duration))
    return keeps, cuts


# ---------------------------------------------------------------------------
# Resolve timeline assembly
# ---------------------------------------------------------------------------

def unique_timeline_name(project, base):
    existing = set()
    for i in range(1, int(project.GetTimelineCount()) + 1):
        tl = project.GetTimelineByIndex(i)
        if tl:
            existing.add(tl.GetName())
    if base not in existing:
        return base
    n = 2
    while "%s %d" % (base, n) in existing:
        n += 1
    return "%s %d" % (base, n)


def build_timeline(project, media_pool, clip, keeps, fps, log):
    name = unique_timeline_name(project, "%s - AutoCut" % clip.GetName())
    timeline = media_pool.CreateEmptyTimeline(name)
    if not timeline:
        log("ERROR: could not create timeline '%s'." % name)
        return None
    project.SetCurrentTimeline(name)

    entries = []
    for s, e in keeps:
        start_f = int(round(s * fps))
        end_f = int(round(e * fps)) - 1
        if end_f > start_f:
            entries.append({
                "mediaPoolItem": clip,
                "startFrame": start_f,
                "endFrame": end_f,
            })
    if not entries:
        log("ERROR: nothing left to keep — try a lower silence threshold.")
        return None
    appended = media_pool.AppendToTimeline(entries)
    if not appended:
        log("ERROR: AppendToTimeline failed for '%s'." % name)
        return None
    log("Created timeline '%s' with %d segment(s)." % (name, len(entries)))
    return timeline


# ---------------------------------------------------------------------------
# Per-clip processing
# ---------------------------------------------------------------------------

def process_clip(project, media_pool, clip, cfg, ffmpeg, ffprobe, log):
    name = clip.GetName()
    path = clip.GetClipProperty("File Path")
    if not path or not os.path.isfile(path):
        log("SKIP '%s': no file path (timelines/compounds not supported)." % name)
        return False

    try:
        fps = float(clip.GetClipProperty("FPS"))
    except (TypeError, ValueError):
        fps = float(project.GetSetting("timelineFrameRate") or 24)

    duration = media_duration(ffprobe, path)
    if not duration:
        try:
            duration = float(clip.GetClipProperty("Frames")) / fps
        except (TypeError, ValueError):
            log("SKIP '%s': could not determine duration." % name)
            return False

    log("Analyzing '%s' (%.1fs @ %.3f fps)..." % (name, duration, fps))

    silences = detect_silences(ffmpeg, path, cfg["silence_db"], cfg["min_silence"])
    log("Found %d silence span(s)." % len(silences))

    fillers = []
    if cfg["remove_fillers"]:
        filler_set = {w.strip().lower() for w in cfg["filler_words"].split(",") if w.strip()}
        fillers = detect_fillers(ffmpeg, path, filler_set,
                                 cfg["filler_pad_ms"] / 1000.0,
                                 cfg["whisper_model"], cfg["language"], log)

    keeps, cuts = compute_keep_segments(
        silences, fillers, duration, cfg["keep_pad_ms"] / 1000.0)
    removed = sum(e - s for s, e in cuts)
    log("Removing %.1fs across %d cut(s); keeping %d segment(s)."
        % (removed, len(cuts), len(keeps)))

    return build_timeline(project, media_pool, clip, keeps, fps, log) is not None


def get_selected_clips(media_pool):
    try:
        selected = media_pool.GetSelectedClips()
    except (AttributeError, TypeError):
        selected = None
    if not selected:
        return []
    if isinstance(selected, dict):
        selected = list(selected.values())
    # Only items that look like media pool clips with a file path.
    return [c for c in selected if c and hasattr(c, "GetClipProperty")]


# ---------------------------------------------------------------------------
# Settings dialog (Fusion UIManager) — falls back to defaults if unavailable
# ---------------------------------------------------------------------------

def show_dialog(cfg):
    try:
        fu = fusion          # injected when run inside Resolve
        ui = fu.UIManager
        disp = bmd.UIDispatcher(ui)
    except NameError:
        print("AutoCut: UI not available, running with default settings.")
        return cfg

    win = disp.AddWindow(
        {"ID": "AutoCutWin", "WindowTitle": "AutoCut — Remove Silence & Fillers",
         "Geometry": [300, 200, 460, 380]},
        ui.VGroup({"Spacing": 6}, [
            ui.Label({"Text": "<b>Silence removal</b>", "Weight": 0}),
            ui.HGroup({"Weight": 0}, [
                ui.Label({"Text": "Threshold (dB)", "Weight": 1}),
                ui.LineEdit({"ID": "SilenceDb", "Text": str(cfg["silence_db"]), "Weight": 1}),
            ]),
            ui.HGroup({"Weight": 0}, [
                ui.Label({"Text": "Min silence (sec)", "Weight": 1}),
                ui.LineEdit({"ID": "MinSilence", "Text": str(cfg["min_silence"]), "Weight": 1}),
            ]),
            ui.HGroup({"Weight": 0}, [
                ui.Label({"Text": "Keep padding (ms)", "Weight": 1}),
                ui.LineEdit({"ID": "KeepPad", "Text": str(cfg["keep_pad_ms"]), "Weight": 1}),
            ]),
            ui.Label({"Text": "<b>Filler words</b>", "Weight": 0}),
            ui.CheckBox({"ID": "RemoveFillers", "Text": "Remove filler words (needs faster-whisper)",
                         "Checked": cfg["remove_fillers"], "Weight": 0}),
            ui.LineEdit({"ID": "FillerWords", "Text": cfg["filler_words"], "Weight": 0}),
            ui.HGroup({"Weight": 0}, [
                ui.Label({"Text": "Whisper model", "Weight": 1}),
                ui.ComboBox({"ID": "Model", "Weight": 1}),
            ]),
            ui.HGroup({"Weight": 0}, [
                ui.Label({"Text": "Language (blank = auto)", "Weight": 1}),
                ui.LineEdit({"ID": "Language", "Text": cfg["language"], "Weight": 1}),
            ]),
            ui.VGap(8),
            ui.Label({"ID": "Hint", "Weight": 0,
                      "Text": "Select clip(s) in the Media Pool, then click Run.\n"
                              "A new '<clip> - AutoCut' timeline is created per clip."}),
            ui.HGroup({"Weight": 0}, [
                ui.Button({"ID": "CancelBtn", "Text": "Cancel"}),
                ui.Button({"ID": "RunBtn", "Text": "Run AutoCut"}),
            ]),
        ]),
    )
    items = win.GetItems()
    for m in ["tiny", "base", "small", "medium"]:
        items["Model"].AddItem(m)
    items["Model"].CurrentText = cfg["whisper_model"]

    state = {"run": False}

    def close(ev):
        disp.ExitLoop()

    def run(ev):
        state["run"] = True
        disp.ExitLoop()

    win.On.AutoCutWin.Close = close
    win.On.CancelBtn.Clicked = close
    win.On.RunBtn.Clicked = run
    win.Show()
    disp.RunLoop()
    win.Hide()

    if not state["run"]:
        return None

    def num(text, fallback):
        try:
            return float(text)
        except ValueError:
            return fallback

    cfg = dict(cfg)
    cfg["silence_db"] = num(items["SilenceDb"].Text, cfg["silence_db"])
    cfg["min_silence"] = num(items["MinSilence"].Text, cfg["min_silence"])
    cfg["keep_pad_ms"] = num(items["KeepPad"].Text, cfg["keep_pad_ms"])
    cfg["remove_fillers"] = bool(items["RemoveFillers"].Checked)
    cfg["filler_words"] = items["FillerWords"].Text
    cfg["whisper_model"] = items["Model"].CurrentText
    cfg["language"] = items["Language"].Text.strip()
    return cfg


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    def log(msg):
        print("[AutoCut] %s" % msg)

    rv = get_resolve()
    if not rv:
        log("ERROR: could not connect to DaVinci Resolve. Run this script from "
            "Workspace -> Scripts inside Resolve.")
        return 1

    ffmpeg = find_tool("ffmpeg")
    if not ffmpeg:
        log("ERROR: ffmpeg not found. Install it and/or set FFMPEG_PATH. "
            "See README.md.")
        return 1
    ffprobe = find_tool("ffprobe")

    project = rv.GetProjectManager().GetCurrentProject()
    if not project:
        log("ERROR: no project open.")
        return 1
    media_pool = project.GetMediaPool()

    clips = get_selected_clips(media_pool)
    if not clips:
        log("ERROR: select one or more clips in the Media Pool first.")
        return 1

    cfg = show_dialog(DEFAULTS)
    if cfg is None:
        log("Cancelled.")
        return 0

    ok = 0
    for clip in clips:
        try:
            if process_clip(project, media_pool, clip, cfg, ffmpeg, ffprobe, log):
                ok += 1
        except Exception as e:
            log("ERROR processing '%s': %s" % (clip.GetName(), e))
    log("Done — %d of %d clip(s) processed." % (ok, len(clips)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
