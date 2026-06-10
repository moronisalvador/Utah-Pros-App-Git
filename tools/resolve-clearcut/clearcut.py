#!/usr/bin/env python3
"""
ClearCut — a FireCut-style editing assistant for DaVinci Resolve 20 / 21
=========================================================================

Analyzes selected Media Pool clips and prepares them for editing:

  1. SILENCE REMOVAL      ffmpeg silencedetect, with keep-padding so cuts
                          never clip words.
  2. FILLER-WORD REMOVAL  "um", "uh", "er", "hmm"... via faster-whisper
                          word-level timestamps (fully local).
  3. REPEATED-TAKE        when you re-record the same sentence, the earlier
     DETECTION            take(s) are cut and the last one is kept
                          (transcript similarity).
  4. CUT PREVIEW          every proposed cut is listed with type, timestamps
                          and transcript text — untick any cut you want to
                          keep before applying.
  5. AUTO CAPTIONS        writes an .srt with timings remapped to the NEW
                          cut-down timeline, and imports it into the
                          Media Pool.
  6. CHAPTER MARKERS      long pauses become chapter boundaries: colored
                          timeline markers + a YouTube-ready chapters .txt.

Everything is non-destructive: source clips and existing timelines are never
modified. Each clip gets a new "<clip name> - ClearCut" timeline.

Run from inside Resolve:  Workspace -> Scripts -> clearcut
Install / docs: see README.md next to this file.
"""

import difflib
import os
import re
import shutil
import subprocess
import sys
import tempfile

# ---------------------------------------------------------------------------
# Defaults (all editable in the dialog)
# ---------------------------------------------------------------------------

DEFAULTS = {
    "cut_silence": True,
    "silence_db": -34.0,       # below this level (dBFS) counts as silence
    "min_silence": 0.50,       # seconds of silence before it becomes a cut
    "keep_pad_ms": 150,        # audio kept around speech so cuts feel smooth

    "cut_fillers": True,
    "filler_words": "um, uh, uhh, umm, er, erm, ah, ahh, hmm, mm, mhm",
    "filler_pad_ms": 80,

    "cut_retakes": True,
    "retake_similarity": 0.75,  # 0..1 — how alike two takes must be
    "retake_window_s": 20.0,    # retake must start within this many seconds

    "make_captions": True,
    "make_chapters": True,
    "chapter_gap_s": 2.5,       # a cut pause this long starts a new chapter

    "whisper_model": "base",    # tiny | base | small | medium
    "language": "en",           # "" = auto-detect
}

MIN_KEEP_SEC = 0.25   # keep-segments shorter than this merge into the cut
MIN_CUT_SEC = 0.20    # cuts shorter than this are skipped (avoids choppiness)

CUT_TYPE_LABEL = {"silence": "Silence", "filler": "Filler", "retake": "Retake"}


def log(msg):
    print("[ClearCut] %s" % msg)


# ---------------------------------------------------------------------------
# Resolve API access
# ---------------------------------------------------------------------------

def get_resolve():
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
    env = os.environ.get(name.upper() + "_PATH")
    if env and os.path.isfile(env):
        return env
    found = shutil.which(name)
    if found:
        return found
    for c in ["/usr/local/bin/" + name, "/opt/homebrew/bin/" + name,
              "C:\\ffmpeg\\bin\\" + name + ".exe",
              "C:\\Program Files\\ffmpeg\\bin\\" + name + ".exe"]:
        if os.path.isfile(c):
            return c
    return None


def media_duration(ffprobe, path):
    if not ffprobe:
        return None
    try:
        out = subprocess.run(
            [ffprobe, "-v", "error", "-show_entries", "format=duration",
             "-of", "default=noprint_wrappers=1:nokey=1", path],
            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
            text=True, check=True).stdout.strip()
        return float(out)
    except Exception:
        return None


def detect_silences(ffmpeg, path, noise_db, min_dur):
    """[(start, end), ...] silence spans in seconds via silencedetect."""
    proc = subprocess.run(
        [ffmpeg, "-hide_banner", "-nostats", "-i", path,
         "-af", "silencedetect=noise=%gdB:d=%g" % (noise_db, min_dur),
         "-f", "null", "-"],
        stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True)
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
    if start is not None:
        spans.append((start, float("inf")))
    return spans


def extract_wav(ffmpeg, path):
    fd, wav = tempfile.mkstemp(suffix=".wav", prefix="clearcut_")
    os.close(fd)
    subprocess.run(
        [ffmpeg, "-hide_banner", "-y", "-i", path,
         "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", wav],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
    return wav


# ---------------------------------------------------------------------------
# Transcription (one pass, reused by fillers / retakes / captions)
# ---------------------------------------------------------------------------

def transcribe(ffmpeg, path, model_size, language):
    """Return {'words': [(s, e, text)], 'segments': [(s, e, text)]} or None."""
    try:
        from faster_whisper import WhisperModel
    except ImportError:
        log("faster-whisper not installed — filler/retake/caption features "
            "disabled for this run. See README.md.")
        return None

    wav = None
    try:
        wav = extract_wav(ffmpeg, path)
        log("Transcribing with Whisper '%s'... (this is the slow part)" % model_size)
        model = WhisperModel(model_size, device="auto", compute_type="auto")
        seg_iter, _info = model.transcribe(
            wav,
            language=language or None,
            word_timestamps=True,
            condition_on_previous_text=False,
            # Prime the decoder so it transcribes fillers instead of
            # silently cleaning them up.
            initial_prompt="Um, uh, er, ah, hmm... so, um, yeah.")
        words, segments = [], []
        for seg in seg_iter:
            text = (seg.text or "").strip()
            if text:
                segments.append((seg.start, seg.end, text))
            for w in (seg.words or []):
                words.append((w.start, w.end, w.word.strip()))
        log("Transcribed %d segment(s), %d word(s)." % (len(segments), len(words)))
        return {"words": words, "segments": segments}
    except Exception as e:
        log("Transcription failed (%s) — continuing with silence cuts only." % e)
        return None
    finally:
        if wav and os.path.exists(wav):
            os.remove(wav)


# ---------------------------------------------------------------------------
# Cut detection
# ---------------------------------------------------------------------------

_STRIP = re.compile(r"[^a-z' ]")


def _norm(text):
    return re.sub(r"\s+", " ", _STRIP.sub("", text.lower())).strip()


def filler_cuts(words, filler_set, pad_s):
    cuts = []
    for s, e, txt in words:
        token = _norm(txt).replace(" ", "")
        if token in filler_set:
            cuts.append({"type": "filler", "start": max(0.0, s - pad_s),
                         "end": e + pad_s, "label": txt.strip() or token})
    return cuts


def retake_cuts(segments, similarity, window_s, pad_s=0.05):
    """Cut earlier takes when a later, similar take follows soon after."""
    cuts = []
    for i, (s, e, text) in enumerate(segments):
        a = _norm(text)
        if len(a.split()) < 3:
            continue
        for j in range(i + 1, min(i + 3, len(segments))):
            s2, _e2, text2 = segments[j]
            if s2 - e > window_s:
                break
            b = _norm(text2)
            if len(b.split()) < 3:
                continue
            if difflib.SequenceMatcher(None, a, b).ratio() >= similarity:
                snippet = text if len(text) <= 60 else text[:57] + "..."
                cuts.append({"type": "retake", "start": max(0.0, s - pad_s),
                             "end": e + pad_s, "label": '"%s"' % snippet})
                break
    return cuts


def silence_cuts(silences, duration, keep_pad_s):
    cuts = []
    for s, e in silences:
        e = min(e, duration)
        s2, e2 = s + keep_pad_s, e - keep_pad_s
        if e2 - s2 >= MIN_CUT_SEC:
            cuts.append({"type": "silence", "start": s2, "end": e2,
                         "label": "%.1fs pause" % (e - s)})
    return cuts


def build_cut_plan(cfg, ffmpeg, path, duration, transcript):
    plan = []
    if cfg["cut_silence"]:
        sil = detect_silences(ffmpeg, path, cfg["silence_db"], cfg["min_silence"])
        plan += silence_cuts(sil, duration, cfg["keep_pad_ms"] / 1000.0)
    if transcript:
        if cfg["cut_fillers"]:
            fillers = {w.strip().lower() for w in cfg["filler_words"].split(",")
                       if w.strip()}
            plan += filler_cuts(transcript["words"], fillers,
                                cfg["filler_pad_ms"] / 1000.0)
        if cfg["cut_retakes"]:
            plan += retake_cuts(transcript["segments"],
                                cfg["retake_similarity"], cfg["retake_window_s"])
    plan = [c for c in plan if c["end"] - c["start"] >= MIN_CUT_SEC / 2]
    plan.sort(key=lambda c: c["start"])
    return plan


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


def keeps_from_cuts(cut_spans, duration):
    cuts = merge_spans([(max(0.0, s), min(e, duration)) for s, e in cut_spans])
    keeps, cursor = [], 0.0
    for s, e in cuts:
        if s - cursor >= MIN_KEEP_SEC:
            keeps.append((cursor, s))
        cursor = max(cursor, e)
    if duration - cursor >= MIN_KEEP_SEC:
        keeps.append((cursor, duration))
    return keeps


def remap_time(t, keeps):
    """Map a source-clip time to its position on the cut-down timeline."""
    acc = 0.0
    for s, e in keeps:
        if t < s:
            return acc
        if t <= e:
            return acc + (t - s)
        acc += e - s
    return acc


# ---------------------------------------------------------------------------
# Captions (SRT) — timings remapped to the new timeline
# ---------------------------------------------------------------------------

def _srt_time(t):
    ms = max(0, int(round(t * 1000)))
    h, rem = divmod(ms, 3600000)
    m, rem = divmod(rem, 60000)
    s, ms = divmod(rem, 1000)
    return "%02d:%02d:%02d,%03d" % (h, m, s, ms)


def build_caption_cues(words, keeps, filler_set):
    """Group kept words into subtitle cues with new-timeline timings."""
    kept = []
    for s, e, txt in words:
        token = _norm(txt).replace(" ", "")
        if token in filler_set:
            continue
        mid = (s + e) / 2.0
        if any(ks <= mid <= ke for ks, ke in keeps):
            kept.append((remap_time(s, keeps), remap_time(e, keeps), txt.strip()))

    cues, cur = [], []
    for w in kept:
        if cur and (w[0] - cur[-1][1] > 0.8
                    or w[1] - cur[0][0] > 4.5
                    or len(cur) >= 9):
            cues.append(cur)
            cur = []
        cur.append(w)
    if cur:
        cues.append(cur)
    return cues


def write_srt(path, cues):
    lines = []
    for i, cue in enumerate(cues, 1):
        text = " ".join(w[2] for w in cue).strip()
        lines += [str(i), "%s --> %s" % (_srt_time(cue[0][0]), _srt_time(cue[-1][1])),
                  text, ""]
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))


# ---------------------------------------------------------------------------
# Chapters
# ---------------------------------------------------------------------------

def detect_chapters(keeps, segments, chapter_gap_s):
    """[(new_time, title), ...] — a chapter starts after each long cut pause."""
    chapters = [(0.0, "Intro")]
    for i in range(1, len(keeps)):
        gap = keeps[i][0] - keeps[i - 1][1]
        if gap < chapter_gap_s:
            continue
        start_src = keeps[i][0]
        title = "Chapter %d" % (len(chapters) + 1)
        for s, _e, text in segments:
            if s >= start_src - 0.5:
                title = " ".join(text.split()[:6])
                break
        chapters.append((remap_time(start_src + 0.01, keeps), title))
    return chapters


def _yt_time(t):
    t = int(round(t))
    h, rem = divmod(t, 3600)
    m, s = divmod(rem, 60)
    return ("%d:%02d:%02d" % (h, m, s)) if h else ("%d:%02d" % (m, s))


def write_chapters_txt(path, chapters):
    with open(path, "w", encoding="utf-8") as f:
        for t, title in chapters:
            f.write("%s %s\n" % (_yt_time(t), title))


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


def build_timeline(project, media_pool, clip, keeps, fps):
    name = unique_timeline_name(project, "%s - ClearCut" % clip.GetName())
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
            entries.append({"mediaPoolItem": clip,
                            "startFrame": start_f, "endFrame": end_f})
    if not entries:
        log("ERROR: nothing left to keep — loosen the thresholds.")
        return None
    if not media_pool.AppendToTimeline(entries):
        log("ERROR: AppendToTimeline failed for '%s'." % name)
        return None
    log("Created timeline '%s' with %d segment(s)." % (name, len(entries)))
    return timeline


def add_chapter_markers(timeline, chapters, fps):
    ok = 0
    for t, title in chapters:
        if timeline.AddMarker(int(round(t * fps)), "Blue", title,
                              "ClearCut chapter", 1):
            ok += 1
    log("Added %d/%d chapter marker(s)." % (ok, len(chapters)))


# ---------------------------------------------------------------------------
# Per-clip pipeline
# ---------------------------------------------------------------------------

def analyze_clip(project, clip, cfg, ffmpeg, ffprobe):
    """Returns analysis dict or None."""
    name = clip.GetName()
    path = clip.GetClipProperty("File Path")
    if not path or not os.path.isfile(path):
        log("SKIP '%s': no file on disk (timelines/compounds unsupported)." % name)
        return None
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
            return None

    log("Analyzing '%s' (%.1fs @ %.3f fps)..." % (name, duration, fps))
    needs_transcript = cfg["cut_fillers"] or cfg["cut_retakes"] or \
        cfg["make_captions"]
    transcript = transcribe(ffmpeg, path, cfg["whisper_model"],
                            cfg["language"]) if needs_transcript else None
    plan = build_cut_plan(cfg, ffmpeg, path, duration, transcript)
    log("Proposing %d cut(s)." % len(plan))
    return {"clip": clip, "name": name, "path": path, "fps": fps,
            "duration": duration, "transcript": transcript, "plan": plan}


def apply_plan(project, media_pool, analysis, enabled_cuts, cfg):
    clip, fps = analysis["clip"], analysis["fps"]
    keeps = keeps_from_cuts([(c["start"], c["end"]) for c in enabled_cuts],
                            analysis["duration"])
    removed = analysis["duration"] - sum(e - s for s, e in keeps)
    log("Applying %d cut(s): removing %.1fs, keeping %d segment(s)."
        % (len(enabled_cuts), removed, len(keeps)))

    timeline = build_timeline(project, media_pool, clip, keeps, fps)
    if not timeline:
        return False

    transcript = analysis["transcript"]
    base = os.path.splitext(analysis["path"])[0]

    if cfg["make_captions"] and transcript:
        filler_set = {w.strip().lower() for w in cfg["filler_words"].split(",")
                      if w.strip()} if cfg["cut_fillers"] else set()
        cues = build_caption_cues(transcript["words"], keeps, filler_set)
        srt = base + ".ClearCut.srt"
        write_srt(srt, cues)
        log("Captions: %s (%d cues)" % (srt, len(cues)))
        try:
            media_pool.ImportMedia([srt])
            log("SRT imported to Media Pool — drag it onto a subtitle track.")
        except Exception:
            log("Could not import SRT automatically; import it manually.")

    if cfg["make_chapters"]:
        segments = transcript["segments"] if transcript else []
        chapters = detect_chapters(keeps, segments, cfg["chapter_gap_s"])
        add_chapter_markers(timeline, chapters, fps)
        txt = base + ".chapters.txt"
        write_chapters_txt(txt, chapters)
        log("YouTube chapters: %s" % txt)
    return True


# ---------------------------------------------------------------------------
# UI (Fusion UIManager) — settings page + cut-preview page
# ---------------------------------------------------------------------------

def fmt_t(t):
    m, s = divmod(t, 60.0)
    return "%d:%05.2f" % (int(m), s)


def get_ui():
    try:
        return fusion.UIManager, bmd.UIDispatcher(fusion.UIManager)
    except NameError:
        return None, None


def run_clip_dialog(ui, disp, project, media_pool, analysis_fn, apply_fn, cfg,
                    clip_name, clip_index, clip_total):
    """Settings -> Analyze -> preview tree -> Apply. Returns 'done'|'skip'|'abort'."""
    title = "ClearCut — %s  (%d of %d)" % (clip_name, clip_index, clip_total)
    win = disp.AddWindow(
        {"ID": "CCWin", "WindowTitle": title, "Geometry": [200, 120, 780, 580]},
        ui.VGroup({"Spacing": 6}, [
            ui.Stack({"ID": "Pages", "Weight": 1}, [
                # ---- Page 0: settings ----
                ui.VGroup({"Spacing": 6}, [
                    ui.Label({"Text": "<b>What to cut</b>", "Weight": 0}),
                    ui.CheckBox({"ID": "CutSilence", "Text": "Silences",
                                 "Checked": cfg["cut_silence"], "Weight": 0}),
                    ui.HGroup({"Weight": 0}, [
                        ui.Label({"Text": "    Threshold (dB) / Min silence (s) / Keep pad (ms)", "Weight": 2}),
                        ui.LineEdit({"ID": "SilenceDb", "Text": str(cfg["silence_db"]), "Weight": 1}),
                        ui.LineEdit({"ID": "MinSilence", "Text": str(cfg["min_silence"]), "Weight": 1}),
                        ui.LineEdit({"ID": "KeepPad", "Text": str(cfg["keep_pad_ms"]), "Weight": 1}),
                    ]),
                    ui.CheckBox({"ID": "CutFillers", "Text": "Filler words (needs faster-whisper)",
                                 "Checked": cfg["cut_fillers"], "Weight": 0}),
                    ui.LineEdit({"ID": "FillerWords", "Text": cfg["filler_words"], "Weight": 0}),
                    ui.CheckBox({"ID": "CutRetakes", "Text": "Repeated takes — keep the last take (needs faster-whisper)",
                                 "Checked": cfg["cut_retakes"], "Weight": 0}),
                    ui.Label({"Text": "<b>Extras</b>", "Weight": 0}),
                    ui.CheckBox({"ID": "MakeCaptions", "Text": "Generate captions (.srt, retimed to the new cut)",
                                 "Checked": cfg["make_captions"], "Weight": 0}),
                    ui.CheckBox({"ID": "MakeChapters", "Text": "Chapter markers + YouTube chapters .txt",
                                 "Checked": cfg["make_chapters"], "Weight": 0}),
                    ui.HGroup({"Weight": 0}, [
                        ui.Label({"Text": "Whisper model / language (blank = auto)", "Weight": 2}),
                        ui.ComboBox({"ID": "Model", "Weight": 1}),
                        ui.LineEdit({"ID": "Language", "Text": cfg["language"], "Weight": 1}),
                    ]),
                    ui.VGap(4),
                    ui.Label({"ID": "Status0", "Weight": 0,
                              "Text": "Click Analyze — progress prints to the Console (Workspace → Console)."}),
                    ui.HGroup({"Weight": 0}, [
                        ui.Button({"ID": "AbortBtn", "Text": "Cancel all"}),
                        ui.Button({"ID": "SkipBtn", "Text": "Skip clip"}),
                        ui.Button({"ID": "AnalyzeBtn", "Text": "Analyze ▸"}),
                    ]),
                ]),
                # ---- Page 1: cut preview ----
                ui.VGroup({"Spacing": 6}, [
                    ui.Label({"ID": "Summary", "Text": "", "Weight": 0}),
                    ui.Tree({"ID": "Cuts", "Weight": 1}),
                    ui.HGroup({"Weight": 0}, [
                        ui.Button({"ID": "BackBtn", "Text": "◂ Back"}),
                        ui.Button({"ID": "AllBtn", "Text": "Check all"}),
                        ui.Button({"ID": "NoneBtn", "Text": "Uncheck all"}),
                        ui.Button({"ID": "ApplyBtn", "Text": "Apply — build timeline"}),
                    ]),
                ]),
            ]),
        ]))

    items = win.GetItems()
    for m in ["tiny", "base", "small", "medium"]:
        items["Model"].AddItem(m)
    items["Model"].CurrentText = cfg["whisper_model"]
    items["Pages"].CurrentIndex = 0

    tree = items["Cuts"]
    tree.ColumnCount = 5
    hdr = tree.NewItem()
    for col, text in enumerate(["Apply", "Type", "Start", "End", "What"]):
        hdr.Text[col] = text
    tree.SetHeaderItem(hdr)
    tree.ColumnWidth[0] = 50
    tree.ColumnWidth[1] = 70
    tree.ColumnWidth[2] = 80
    tree.ColumnWidth[3] = 80

    state = {"result": "skip", "analysis": None}

    def read_settings():
        def num(text, fallback):
            try:
                return float(text)
            except ValueError:
                return fallback
        cfg["cut_silence"] = bool(items["CutSilence"].Checked)
        cfg["silence_db"] = num(items["SilenceDb"].Text, cfg["silence_db"])
        cfg["min_silence"] = num(items["MinSilence"].Text, cfg["min_silence"])
        cfg["keep_pad_ms"] = num(items["KeepPad"].Text, cfg["keep_pad_ms"])
        cfg["cut_fillers"] = bool(items["CutFillers"].Checked)
        cfg["filler_words"] = items["FillerWords"].Text
        cfg["cut_retakes"] = bool(items["CutRetakes"].Checked)
        cfg["make_captions"] = bool(items["MakeCaptions"].Checked)
        cfg["make_chapters"] = bool(items["MakeChapters"].Checked)
        cfg["whisper_model"] = items["Model"].CurrentText
        cfg["language"] = items["Language"].Text.strip()

    def populate_tree(plan, duration):
        while tree.TopLevelItemCount() > 0:
            tree.TakeTopLevelItem(0)
        for c in plan:
            it = tree.NewItem()
            it.Flags = {"ItemIsUserCheckable": True, "ItemIsEnabled": True,
                        "ItemIsSelectable": True}
            it.CheckState[0] = "Checked"
            it.Text[1] = CUT_TYPE_LABEL[c["type"]]
            it.Text[2] = fmt_t(c["start"])
            it.Text[3] = fmt_t(c["end"])
            it.Text[4] = c["label"]
            tree.AddTopLevelItem(it)
        removed = sum(c["end"] - c["start"] for c in plan)
        items["Summary"].Text = (
            "<b>%s</b> — %d proposed cut(s), ~%.1fs of %.1fs removed. "
            "Uncheck anything you want to keep, then Apply."
            % (clip_name, len(plan), removed, duration))

    def set_all(checked):
        for i in range(tree.TopLevelItemCount()):
            tree.TopLevelItem(i).CheckState[0] = "Checked" if checked else "Unchecked"

    def on_analyze(ev):
        read_settings()
        items["Status0"].Text = "Analyzing… watch the Console for progress."
        analysis = analysis_fn(cfg)
        if not analysis:
            items["Status0"].Text = "Analysis failed — see Console."
            return
        state["analysis"] = analysis
        populate_tree(analysis["plan"], analysis["duration"])
        items["Pages"].CurrentIndex = 1

    def on_apply(ev):
        analysis = state["analysis"]
        enabled = [c for i, c in enumerate(analysis["plan"])
                   if tree.TopLevelItem(i).CheckState[0] == "Checked"]
        state["result"] = "done" if apply_fn(analysis, enabled, cfg) else "skip"
        disp.ExitLoop()

    def on_close(ev):
        state["result"] = "abort"
        disp.ExitLoop()

    win.On.CCWin.Close = on_close
    win.On.AbortBtn.Clicked = on_close
    win.On.SkipBtn.Clicked = lambda ev: (state.update(result="skip"), disp.ExitLoop())
    win.On.AnalyzeBtn.Clicked = on_analyze
    win.On.BackBtn.Clicked = lambda ev: items["Pages"].__setattr__("CurrentIndex", 0)
    win.On.AllBtn.Clicked = lambda ev: set_all(True)
    win.On.NoneBtn.Clicked = lambda ev: set_all(False)
    win.On.ApplyBtn.Clicked = on_apply

    win.Show()
    disp.RunLoop()
    win.Hide()
    return state["result"]


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def get_selected_clips(media_pool):
    try:
        selected = media_pool.GetSelectedClips()
    except (AttributeError, TypeError):
        selected = None
    if not selected:
        return []
    if isinstance(selected, dict):
        selected = list(selected.values())
    return [c for c in selected if c and hasattr(c, "GetClipProperty")]


def main():
    rv = get_resolve()
    if not rv:
        log("ERROR: run this script from Workspace -> Scripts inside Resolve.")
        return 1
    ffmpeg = find_tool("ffmpeg")
    if not ffmpeg:
        log("ERROR: ffmpeg not found — install it or set FFMPEG_PATH (README).")
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

    cfg = dict(DEFAULTS)
    ui, disp = get_ui()
    done = 0

    for idx, clip in enumerate(clips, 1):
        if ui:
            result = run_clip_dialog(
                ui, disp, project, media_pool,
                lambda c, clip=clip: analyze_clip(project, clip, c, ffmpeg, ffprobe),
                lambda a, en, c: apply_plan(project, media_pool, a, en, c),
                cfg, clip.GetName(), idx, len(clips))
            if result == "abort":
                log("Cancelled.")
                break
            if result == "done":
                done += 1
        else:
            # Headless: apply every proposed cut with defaults.
            analysis = analyze_clip(project, clip, cfg, ffmpeg, ffprobe)
            if analysis and apply_plan(project, media_pool, analysis,
                                       analysis["plan"], cfg):
                done += 1

    log("Finished — %d of %d clip(s) processed." % (done, len(clips)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
