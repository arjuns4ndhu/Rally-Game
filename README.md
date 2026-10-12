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
| Reset car | R | RESET |
| Pause | Esc | II |
| Tuning panel (dev) | ? | |

Driving: tap the brake while turning to kick the rear out. Hold the throttle to keep the drift going. Lift off to rotate more. Counter-steer to straighten up or flick into the next corner. Braking at a standstill engages reverse.

## Build status

1. **Car driving and drifting on a test road**: current build. Keys 1–4 switch between the four cars.
2. Seeded daily stage generation, sectors, off-road respawn
3. HUD, menus, countdown, finish screen, settings
4. Garage: four cars, paint, wheel styles
5. Ghost replays and past-stages calendar

## Layout

```
index.html        page shell, import map, HUD / overlay markup
css/style.css     retro-arcade theme
src/car.js        vehicle physics (pure JS, testable in Node)
src/carModel.js   low-poly car meshes
src/track.js      road centreline, nearest-point queries, ribbon mesh
src/scenery.js    sky, lights, trees, rocks, fences, hills
src/camera.js     camera rigs
src/particles.js  dust
src/audio.js      Web Audio engine / tyre synthesis
src/input.js      keyboard + touch
src/rng.js        seeded PRNG + date seeds
tools/make-artifact.py  writes a copy for hosting as a claude.ai artifact
```
