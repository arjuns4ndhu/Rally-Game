# Sideways

A free browser rally game: a new procedurally generated gravel stage every day, drifting arcade handling, ghosts and a past-stages calendar. Plain HTML and ES modules, with Three.js from a CDN. There's no build step.

## Run locally

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

ES modules need a web server, so opening `index.html` straight from the file system won't work.

## Controls

| Action | Keyboard | Touch |
| --- | --- | --- |
| Throttle / brake | W / S or ↑ / ↓ | GO / BRAKE |
| Steer | A / D or ← / → | ◀ ▶ |
| Handbrake | Space | HB |
| Camera (chase / bonnet / far) | C | CAM |
| Racing line assist on/off | G | pause menu |
| Restart stage (practice: reset car) | R | RESET |
| Back to last checkpoint (+5 s) | T | pause menu |
| Pause | Esc | II |
| Mute | M | speaker button |
| Pace-note signs on / off | pause menu | pause menu |
| Tuning panel (dev) | ? | |

Driving: tap the brake while turning to kick the rear out. Hold the throttle to keep the drift going. Lift off to rotate more. Counter-steer to straighten up or flick into the next corner. Holding the brake slows you down, even mid-slide; keep holding it once stopped to reverse.

## Build status

1. **Car driving and drifting**: done. Keys 1–5 switch cars.
2. **Seeded stages**: done. A 2–3 km point-to-point gravel stage from a seed: today's date for the daily stage, or a random seed. Hairpins, sweepers, chicanes, esses and straights, with seeded hills and elevation. Each stage has 2–3 jumps and 2–3 crests, with warning boards. There are five sectors with split times and deltas against your best, and best times are saved per stage. Trees and big rocks are solid: a hard hit is a crash, and like going more than 25 m off the road or getting stuck, it puts you back at the last checkpoint with a 5 s penalty. R always restarts from the start. The practice loop is still there, now with a jump and a crest. Hairpin-tight corners are announced the way a real stage would: 3-2-1 brake boards at 150, 100 and 50 m, red chevrons round the outside, and dark braking marks on the approach.
3. HUD polish, countdown, settings
4. Garage: paint, wheel styles, 3D preview
5. **Ghost car**: done. Your best run on each stage is recorded and replayed as a see-through car; toggle it in the pause menu. Past-stages calendar still to do.

Five cars, each modelled on a rally icon's shape and character (no real names or badges):

| Key | Car | Based on | Character |
| --- | --- | --- | --- |
| 1 | Stiletto V6 | 70s mid-engine wedge (Stratos-style) | short, light RWD; twitchy and tail-happy |
| 2 | Pocket 1275 | 60s mini (original Mini-style) | tiny front-drive; nimble, low power |
| 3 | Quadra 5T | 80s turbo coupé (Quattro-style) | 4WD, huge torque, nose-heavy |
| 4 | Vector WRC | 00s world-rally hatch (Focus WRC-style) | grippy, balanced 4WD |
| 5 | Dune Raider | rally-raid SUV (Cayenne/Macan Dakar-style) | heavy and tall, barely slowed off-road |

## Layout

```
index.html        page shell, import map, HUD / overlay markup
css/style.css     retro-arcade theme
src/car.js        vehicle physics (pure JS, testable in Node)
src/carModel.js   low-poly car meshes
src/track.js      road centreline, nearest-point queries, ribbon mesh, jumps/crests
src/stagegen.js   seeded stage generator, stage names, landform noise
src/terrain.js    heightfield terrain that hugs the road
src/gates.js      start / sector / finish gantries, warning boards
src/scenery.js    sky, lights, trees, rocks, fences, hills
src/camera.js     camera rigs
src/particles.js  dust
src/tyremarks.js  racing-line tracks + your own tyre marks
src/ghost.js      ghost recording, compact storage and playback
src/pacenotes.js  pace notes worked out from the road
src/paceicons.js  DiRT-style pace-note signs (SVG corner arrows)
src/audio.js      Web Audio engine / tyre synthesis
src/input.js      keyboard + touch
src/rng.js        seeded PRNG + date seeds
tools/make-artifact.py  writes a copy for hosting as a claude.ai artifact
```
