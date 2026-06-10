# ClearCut — FireCut-style editing assistant for DaVinci Resolve 20 / 21

ClearCut turns raw talking-head footage into an edit-ready rough cut, entirely
locally (no cloud, no subscription). It's a Python scripting plugin that runs
from Resolve's **Workspace → Scripts** menu.

| Feature | What it does |
|---|---|
| **Silence removal** | Cuts pauses below a dB threshold, with keep-padding so words are never clipped. |
| **Filler-word removal** | Cuts "um", "uh", "er", "hmm"… using local Whisper word-level timestamps. |
| **Repeated-take detection** | When you flub a line and re-record it, the earlier take is cut and the **last** take kept (transcript similarity). |
| **Cut preview** | Every proposed cut is listed — type, timestamps, the transcript text being removed — with a checkbox. Untick anything before applying. |
| **Auto captions** | Writes an `.srt` with timings **remapped to the new cut-down timeline** and imports it into the Media Pool. |
| **Chapter markers** | Long pauses become chapter boundaries: blue timeline markers titled from the transcript, plus a YouTube-ready `chapters.txt`. |

Everything is **non-destructive** — source clips and existing timelines are
never modified. Each clip gets a new `<clip name> - ClearCut` timeline.

Compatible with DaVinci Resolve 20 and 21, free and Studio (the scripting API
used is stable since 18.x). Running from *outside* Resolve requires Studio.

---

## Installation

**1. ffmpeg** (required — silence detection & audio extraction)

- Windows: <https://www.gyan.dev/ffmpeg/builds/> → add `bin` to PATH, or unzip to `C:\ffmpeg\bin`
- macOS: `brew install ffmpeg`
- Linux: `sudo apt install ffmpeg`

(Or set `FFMPEG_PATH` to the executable.)

**2. faster-whisper** (required for fillers / retakes / captions; silence-only works without it)

Resolve runs scripts with your system Python 3:

```
pip3 install faster-whisper
```

First run downloads the model (~75 MB for `base`, ~480 MB for `small`).

**3. Copy `clearcut.py` into Resolve's Utility scripts folder:**

| OS | Path |
|---|---|
| Windows | `%APPDATA%\Blackmagic Design\DaVinci Resolve\Support\Fusion\Scripts\Utility` |
| macOS | `~/Library/Application Support/Blackmagic Design/DaVinci Resolve/Fusion/Scripts/Utility` |
| Linux | `~/.local/share/DaVinciResolve/Fusion/Scripts/Utility` |

---

## Usage

1. Open **Workspace → Console** (progress prints there).
2. Select one or more **source clips in the Media Pool** (not timelines or
   compound clips — ClearCut needs the file on disk).
3. **Workspace → Scripts → clearcut**.
4. **Settings page** — toggle what to cut and the extras, then click
   **Analyze ▸**. Transcription is the slow part: roughly real-time ÷ 5 on CPU
   with the `base` model.
5. **Preview page** — every proposed cut is listed:
   - `Silence  0:12.40 → 0:14.10  1.9s pause`
   - `Filler   0:31.05 → 0:31.42  um`
   - `Retake   1:02.00 → 1:08.30  "So the first thing you want to…"`

   Untick any cut you want to keep, then **Apply — build timeline**.
6. You get:
   - a new `<clip> - ClearCut` timeline with only the kept segments,
   - blue **chapter markers** on it + `<clip>.chapters.txt` next to the source,
   - `<clip>.ClearCut.srt` next to the source, already imported into the
     Media Pool — drag it onto the timeline's subtitle track.

With multiple clips selected, the dialog runs once per clip (shown as
"2 of 5" in the title bar). **Skip clip** moves on; **Cancel all** stops.

---

## Settings guide

| Setting | Default | Notes |
|---|---|---|
| Threshold (dB) | `-34` | Noisy room → raise toward `-28`. |
| Min silence (s) | `0.5` | Raise to 0.7–1.0 for a calmer pace with fewer cuts. |
| Keep pad (ms) | `150` | Words getting clipped → raise to 200–250. |
| Filler list | `um, uh, …` | Comma-separated. Adding `like, so, you know` risks cutting real sentences. |
| Retake similarity | `0.75` (in script `DEFAULTS`) | Lower catches paraphrased re-takes but risks false positives. |
| Chapter gap (s) | `2.5` (in `DEFAULTS`) | A cut pause this long starts a new chapter. |
| Whisper model | `base` | `small`/`medium` catch noticeably more fillers and transcribe captions better, at the cost of speed. |

## How retake detection works

Whisper splits speech into sentence-like segments. ClearCut normalizes each
segment's text and compares it to the next two segments within a 20-second
window using sequence similarity. If a later segment is ≥75% similar, the
earlier one is proposed as a cut — on the assumption that you kept re-recording
until you got it right. Every retake cut shows the exact sentence in the
preview, so misfires are one click to untick.

## Limitations

- Cuts are hard cuts; add a 2-frame audio crossfade across the timeline
  afterwards if you want extra smoothness.
- Whisper misses some fillers by design (it likes to "clean up" speech); the
  `medium` model catches the most. The decoder is primed to keep fillers, but
  no model catches 100%.
- The preview lists cuts with timestamps and transcript text, but has no
  audio scrubbing — Resolve's scripting UI can't drive the player from a
  dialog. If unsure about a cut, leave it unticked; it's faster to delete a
  pause on the timeline than to recover one.
- SRT auto-import lands in the Media Pool; Resolve's API can't yet place it
  onto a subtitle track, so that last drag is manual.

## Standing this up as its own repo

This folder is fully self-contained. To extract it:

```
cp -r tools/resolve-clearcut ~/resolve-clearcut
cd ~/resolve-clearcut && git init && git add . && git commit -m "ClearCut v0.1"
```

## License

MIT — see [LICENSE](LICENSE).
