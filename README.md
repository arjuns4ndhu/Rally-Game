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
| Tuning panel (dev) | ? | |

Driving: tap the brake while turning to kick the rear out. Hold the throttle to keep the drift going. Lift off to rotate more. Counter-steer to straighten up or flick into the next corner. Braking at a standstill engages reverse.

## Build status

1. **Car driving and drifting**: done. Keys 1–4 switch cars.
2. **Seeded stages**: done. A 2–3 km point-to-point gravel stage from a seed: today's date for the daily stage, or a random seed. Hairpins, sweepers, chicanes, esses and straights, with seeded hills and elevation. Each stage has 2–3 jumps and 2–3 crests, with warning boards. There are five sectors with split times and deltas against your best, and best times are saved per stage. Going more than 25 m off the road puts you back at the last checkpoint with a 5 s penalty. The practice loop is still there, now with a jump and a crest.
3. HUD polish, countdown, settings
4. Garage: paint, wheel styles, 3D preview
5. Ghost replays and past-stages calendar

The four cars are original designs that borrow classic rally-era silhouettes (80s hatch, 70s wedge coupé, boxy V8 saloon, 90s 4WD saloon) with no real makes or badges.

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
src/audio.js      Web Audio engine / tyre synthesis
src/input.js      keyboard + touch
src/rng.js        seeded PRNG + date seeds
tools/make-artifact.py  writes a copy for hosting as a claude.ai artifact
```
