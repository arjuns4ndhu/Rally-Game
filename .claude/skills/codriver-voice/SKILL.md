---
name: codriver-voice
description: Give Sideways' co-driver a real recorded voice, or change what the co-driver says. Use when asked to record, generate, replace or improve the co-driver's voice or pace-note calls, add new spoken phrases (a new note type, a new distance call), or check the voice lines cover everything the game can say.
---

# Co-driver voice

The game reads pace notes aloud when **Pause → Driving → Co-driver** is set to **Signs + spoken calls**. `src/voice.js` (`CoDriverVoice`) plays each call one of two ways:

1. **Recorded clips** (the good version). If `voice/manifest.json` exists, every phrase in a call is looked up there and the clips are played back to back through the game's mixer. That gives one consistent rally voice that fits the mix, follows mute and volume, and works offline.
2. **Browser speech synthesis** (the fallback). It's used if there's no manifest, or if any phrase in a call has no clip. It works everywhere, but sounds like a sat-nav and differs by browser.

The job of this skill is to make and maintain option 1.

## How a call is put together

`src/pacenotes.js` builds each note's spoken text in `say`. Phrases are separated by commas, and notes joined by "into" are spoken as one call. For example:

- `left three, long, into, hairpin right, don't cut`
- `right five, 150`

`voice.js` lowercases the call, strips `!` and splits on commas. Each piece is a **phrase**, the unit you record.

**The source of truth for phrases is `tools/voice-lines.json`.** Each entry gives:
- `phrase`: the exact key, as it appears in a call
- `file`: the clip's file name
- `speak`: how to say it (for example, "150" is spoken "one fifty")

The test `co-driver phrases are all in tools/voice-lines.json` in `tests/run.js` fails when the game can say something the list lacks. Keep it passing: when you add a phrase to `pacenotes.js`, add it to the JSON in the same change.

## Making the clips

### Direction (the same for any method)
- **Voice:** one calm, clipped British co-driver, about 30–50 years old. The delivery is urgent but even, never shouting. Think of someone reading notes in the car at speed: no "um", no sing-song.
- **Length:** under ~0.9 s per phrase. Numbers are short and punchy ("three", not "number three").
- **Consistency:** record or generate everything in one session, with the same settings and the same voice.
- **Distances** are said as rally crews say them: 50 → "fifty", 100 → "one hundred", 150 → "one fifty".

### Option A: AI text-to-speech (needs an API key from the user)
Use the **threejs-audio-generator** skill (ElevenLabs). It needs the user's ElevenLabs API key in an environment variable. **Never ask for the key in chat and never paste it anywhere.** Point the user at the environment's secrets settings instead (use the `read_documentation` tool, topic `environment.secrets`).

- Generate one file per entry in `tools/voice-lines.json`, using its `speak` text and its `file` name.
- Use one voice ID for everything, with stability set fairly high (about 0.6–0.7) so the lines match.
- Generate 2–3 takes of any line that sounds off, and keep the best.

### Option B: the user records it themselves
Ask them to record each `speak` line once in a quiet room, from any recorder app, and drop the files in `voice/raw/`. Then process them as in "Clean-up" below.

### Clean-up (both options)
With ffmpeg, for each file:

```sh
ffmpeg -i in.wav -af "silenceremove=start_periods=1:start_threshold=-45dB,areverse,silenceremove=start_periods=1:start_threshold=-45dB,areverse,loudnorm=I=-16:TP=-1.5" -ac 1 -ar 44100 -b:a 96k out.mp3
```

- Mono, 44.1 kHz, about 96 kbps MP3.
- Trimmed tight at both ends: gaps between clips are added in code (40 ms).
- Loudness about −16 LUFS so every phrase sits at the same level.

## Installing

1. Put the clips in `voice/`, named as in `tools/voice-lines.json`.
2. Write `voice/manifest.json`:
   ```json
   { "phrases": { "left one": "left-one.mp3", "hairpin right": "hairpin-right.mp3", "150": "150.mp3" } }
   ```
   Build it from `tools/voice-lines.json`, which has the same keys, so nothing is missed:
   ```sh
   python3 -c "import json; d=json.load(open('tools/voice-lines.json')); json.dump({'phrases': {p['phrase']: p['file'] for p in d['phrases']}}, open('voice/manifest.json','w'), indent=1)"
   ```
3. **Hosting:**
   - `tools/make-single.sh` and `tools/make-artifact.py` copy `voice/` alongside `music/` when it exists.
   - When publishing the claude.ai artifact, add every `voice/*` file to the `files` map, as with `src/*.js`.
   - The service worker (`sw.js`) caches same-origin files as they're used, so no list change is needed there.
4. **Check in the browser:**
   - Set **Co-driver → Signs + spoken calls** and drive a Classic.
   - Every call should be the recorded voice.
   - If one call sounds like speech synthesis, a phrase in it has no clip. Log `call.split(',')` in `voice.js` `speak()` to see which.

## Changing what the co-driver says

- New note types belong in `buildPaceNotes()` in `src/pacenotes.js`: give each item a `say`.
- Keep phrases reusable. Prefer adding a short phrase ("caution") to the list over a whole new sentence per situation.
- Add every new phrase to `tools/voice-lines.json` and record its clip. The test will remind you.
- Don't change existing phrase keys without renaming the clips and the manifest to match.
