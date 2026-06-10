# AutoCut — Silence & Filler-Word Remover for DaVinci Resolve 20 / 21

AutoCut is a Resolve scripting plugin that takes raw talking-head footage and
turns it into a rough cut that's ready for editing:

- **Removes silent moments** — anything quieter than a configurable dB
  threshold for longer than a configurable duration.
- **Removes filler words** — "um", "uh", "er", "ahh", "hmm", etc., detected
  with word-level Whisper transcription (fully local, no cloud).
- **Smooth cuts** — configurable padding is kept around every spoken phrase so
  words are never clipped, and micro-cuts shorter than 0.2s are skipped so the
  result doesn't feel choppy.
- **Non-destructive** — your source clips and existing timelines are never
  touched. Each processed clip gets a brand-new `<clip name> - AutoCut`
  timeline assembled from only the kept segments.

Works with DaVinci Resolve 20 and 21 (the scripting API used here is stable
across 18+). Running scripts from the **Workspace → Scripts** menu works in
both the free version and Studio; running the script from *outside* Resolve
requires Studio.

---

## Installation

### 1. Install ffmpeg

AutoCut uses ffmpeg for silence detection and audio extraction.

- **Windows:** download from <https://www.gyan.dev/ffmpeg/builds/> and either
  add the `bin` folder to your PATH or unzip to `C:\ffmpeg\bin`.
- **macOS:** `brew install ffmpeg`
- **Linux:** `sudo apt install ffmpeg`

You can also set the `FFMPEG_PATH` environment variable to the full path of
the ffmpeg executable.

### 2. (Optional but recommended) Install faster-whisper

This enables filler-word removal. Resolve runs scripts with your system
Python 3, so install it there:

```
pip3 install faster-whisper
```

The first run downloads the chosen Whisper model (~75 MB for `base`).
Without faster-whisper, AutoCut still works — it just removes silences only.

### 3. Copy the script into Resolve's Scripts folder

Copy `auto_cut.py` to the **Utility** scripts folder:

| OS      | Path |
|---------|------|
| Windows | `%APPDATA%\Blackmagic Design\DaVinci Resolve\Support\Fusion\Scripts\Utility` |
| macOS   | `~/Library/Application Support/Blackmagic Design/DaVinci Resolve/Fusion/Scripts/Utility` |
| Linux   | `~/.local/share/DaVinciResolve/Fusion/Scripts/Utility` |

Restart Resolve (or it will appear next time you open the menu).

---

## Usage

1. Open your project and **select one or more clips in the Media Pool**
   (the original camera files — not timelines or compound clips).
2. Go to **Workspace → Scripts → auto_cut**.
3. Adjust settings in the dialog (defaults work well for normal speech):

   | Setting | Default | Meaning |
   |---|---|---|
   | Threshold (dB) | `-34` | Audio below this counts as silence. Noisier rooms need a higher value (e.g. `-30`). |
   | Min silence (sec) | `0.5` | Pauses shorter than this are kept (natural breathing room). |
   | Keep padding (ms) | `150` | Audio kept on each side of speech so cuts feel smooth. |
   | Remove filler words | on | Requires faster-whisper. |
   | Filler word list | `um, uh, …` | Comma-separated, lowercase. Add `like, so, you know` at your own risk (false positives). |
   | Whisper model | `base` | `tiny` = fastest, `medium` = most accurate filler detection. |
   | Language | `en` | Blank = auto-detect. |

4. Click **Run AutoCut**. Progress is printed to the Console
   (**Workspace → Console**).
5. A new timeline named `<clip name> - AutoCut` opens with only the kept
   segments. Edit from there.

---

## Tuning tips

- **Words getting clipped?** Increase *Keep padding* to 200–250 ms.
- **Too many tiny cuts / choppy feel?** Increase *Min silence* to 0.7–1.0 s.
- **Background hum being kept as "speech"?** Raise the threshold toward
  `-28`…`-30` dB.
- **Fillers being missed?** Whisper's smaller models sometimes "clean up"
  filler words instead of transcribing them. Switch the model to `small` or
  `medium`. The script already primes the decoder to keep fillers, but no
  model catches 100% of them.
- **Multi-camera / external audio:** run AutoCut on the clip whose audio you
  trust, then use the resulting timeline as your cut reference.

## Limitations

- Operates on Media Pool source clips (needs the file on disk) — not on
  timelines, compound clips, or Fusion clips.
- Filler-word detection accuracy depends on the Whisper model and audio
  quality; it errs on the side of keeping words when unsure.
- Cuts are hard cuts. If you want crossfades on every joint, select all clips
  in the resulting timeline and apply a 2-frame audio crossfade
  (Edit page → right-click → Add Transition).
