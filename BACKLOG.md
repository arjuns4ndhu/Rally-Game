# Backlog

Ideas saved for later.

- **More cars.** A 90s rally saloon, a small buggy, a pickup. Each needs a loft body in `src/loftcar.js`, a spec in `src/car.js` that keeps the cars' times within about 1% (check with the bot balance run in `tests/`), garage stats, and skins.
- **Rally-raid / desert dunes stage type.** Big open sand with no fixed road: checkpoint gates to find, dunes to crest, soft sand that bogs you down. It needs its own stage generator (open terrain plus a route of gates), a sand surface and dune terrain, and pace notes that point to the next gate.
- **Connect ElevenLabs for the co-driver voice.** Needs an ElevenLabs API key stored as an environment secret (never pasted in chat). Then follow `.claude/skills/codriver-voice` to generate the clips and switch "Signs + spoken calls" back on.
- **"Crash-out" co-driver.** A second, optional voice pack: a co-driver who loses it and rants at you, like the viral rally-game clips ("you blithering idiot!"). It reacts to crashes, respawns, big slides, hitting walls, slow sectors, and the occasional surprised compliment. It needs its own phrase list of reactions, not just pace notes, and two versions: a swearing one behind an "explicit language" setting that's off by default (needed for app store age ratings), and a clean one. Generate both with ElevenLabs, as above.
