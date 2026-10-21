# Sideways

A free browser rally game: a new procedurally generated gravel stage every day, drifting arcade handling, ghosts and a past-stages calendar. Plain HTML and ES modules, with Three.js from a CDN. There's no build step.

## Run locally

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

ES modules need a web server, so opening `index.html` straight from the file system won't work.

### Install it / play offline

Served from a real web address (https, or localhost), the game is an installable app: **Install** appears on the title screen in Chrome and Edge, and on iPhone use Share → **Add to Home Screen**. Once installed (or after one visit), a service worker (`sw.js`) keeps the game, Three.js and the fonts cached so it starts with no connection; music tracks are cached the first time they play. After an update the cached copy is used once more, then the new one next launch. The claude.ai artifact and the one-file `dist/sideways.html` can't be installed, because both run inside another page.

## Tests

```sh
npm i -D playwright   # once (or use a global install)
node tests/run.js
```

Starts a local server, opens the game in headless Chromium and checks: it boots with no errors, every car builds in every style, every stage type builds, no scenery sits in the road, a stage starts and the clock runs, a test driver finishes a Classic, a tarmac and a river stage and the cars' times stay close, the pause menu and stage-code copy/paste, the random stage setup, controller and phone steering input, steering sensitivity / dead zone / rumble / handbrake assist, endurance weather changes, crowd noise and canyon echo, the replay director and clip saving, the new stage types, a career rally through to the season podium, shared ghosts, that Auto graphics steps down on a slow machine, phone and tablet layouts on four emulated devices, and that the game boots offline once the service worker is installed.

Run one test with `ONLY="part of its name" node tests/run.js`.

The phone layout test emulates screen sizes, touch and user agents in desktop Chromium. It can't test a real phone's GPU, Safari quirks or how it feels in the hand: try those on a real device (Settings → Display → **Show frame rate** helps).

## Controls

| Action | Keyboard | Controller | Touch |
| --- | --- | --- | --- |
| Throttle / brake | W / S or ↑ / ↓ | RT / LT (analogue) | GO / BRAKE |
| Steer | A / D or ← / → | Left stick (analogue) | arrows, tilt or drag (pause menu → Driving → Steering) |
| Handbrake | Space | A or X | HB |
| Camera (chase / cockpit / bonnet / far / drone) | C | Y | CAM |
| Mini map on/off | N | pause menu | pause menu |
| Racing line assist on/off | G | LB | pause menu |
| Restart stage (practice: reset car) | R | Back | RESET |
| Back to last checkpoint (+5 s) | T | RB | pause menu |
| Pause | Esc | Start | II |
| Mute | M | | speaker button |
| Pace-note signs on / off | pause menu | pause menu | pause menu |
| Tuning panel (dev) | ? | | |

In the menus a controller moves with the D-pad or stick; A picks, B goes back.

**Replay** (after a finish): ← / → or LB / RB slower / faster (¼× to 2×), Space or A pause, C or Y change camera (TV cams, chase, helicopter, wheel cam, bonnet, drone), D auto slow motion on jumps and big slides, V or X record a clip (press again to stop; you get a video to save or share), Esc or B exit.

The driving keys can be rebound in the pause menu (arrow keys always work too). The pause menu also has a **Big touch buttons** option.

Driving: tap the brake while turning to kick the rear out. Hold the throttle to keep the drift going. Lift off to rotate more. Counter-steer to straighten up or flick into the next corner. Holding the brake slows you down, even mid-slide; keep holding it once stopped to reverse.

## Features

- **Career**: seasons of four rallies, three stages each, against seven rival drivers. Your rally time is your three stage times added up; points for the rally result (25, 18, 15 …); no free retries (restarting a stage costs 10 s). Win the title to move up from Rookie to Pro to Legend class, where the rivals are quicker. Each season ends on a **podium** with the top three cars and confetti.
- **Stage types** (Random stage → Stage type): gravel, **tarmac** (sealed roads with painted lines, grippy, one jump at most), **night forest** (dense woods, always at night, dust drifting in the headlight beams) and **river crossings** (two to four fords: the road dips into a shallow river that slows you and throws up spray; pace notes call "water splash"). Their codes are 4000000–4899999.
- **Stages**: a seeded 2–3 km point-to-point gravel stage every day, plus random stages, 5–8 km **endurance** stages (the light and weather change as you go: the sun sets, rain or fog rolls in, and the co-driver warns you) and a practice loop. Every stage has a **stage code** (shown in the pause menu); type one on the title screen to drive that exact road. Five scenery themes (forest, canyon, snow, alpine, autumn), each stage with its own hills, jumps, crests and five timed sectors. Some stages hide a **shortcut**: a rough track across where the road doubles back.
- **Weather and time of day** from the seed: clear, overcast, dusk, fog, rain (snowfall on snow stages) and night with working headlights. Rain cuts grip and darkens the gravel, with streaks and splashes drawn on the GPU.
- **Surfaces**: sealed tarmac sections, mud, puddles that splash, ice on snow stages and soft sand in the canyon.
- **Hazards**: rare fallen trees and landslides, some already blocking part of the road, some that happen as you approach (same spot every attempt).
- **Race flow**: 3-2-1-GO standing start, splits and deltas per sector, a live +/- gap to your ghost, a finish screen with a replay (TV-style trackside cameras and drone shots) and a **Copy result** button.
- **Shared ghosts**: on claude.ai your best run on every stage code is uploaded with your time; press **Race** next to anyone on the finish-screen leaderboard to race their ghost. **Copy result** includes the stage code so friends can try to beat it.
- **Ghost** of your own best run on each stage, mini map, chase drone (C cycles to the drone camera), pace-note signs, racing-line tyre tracks and an optional line assist.
- **Garage**: six cars with stat bars, paint swatches or any colour, five wheel styles, a rotating 3D preview. The cars have real wheel wells, glowing brake discs and lamp halos at night. Crashes dent the bodywork (looks only) and throw sparks.
- **Unlockables**: special paints (gold, neon, midnight, hot pink), gold wheels and a sixth car, the Brutale S4, earned with Classic medals and finishes.
- **Cockpit camera** with a steering wheel and shift lights.
- **Trackside**: crowds behind tape at hairpins, jumps, the start and the finish who cheer and jump back as you pass, duck when you fly a jump over them and run if you slide at them; photographers whose flashes go off as you pass (bright at night); marshals at the checkpoints, hay bales on the outside of sharp corners and a TV helicopter over the finish. You hear the crowd roar and whistle as you go by, and the engine echoes between canyon walls.
- **Feel settings** (pause menu → Driving): steering sensitivity, stick dead zone, controller rumble (crashes, landings, rough ground; Android phones buzz on big hits), and a beginner **handbrake assist** that swings the tail round at hairpins for you and catches spins.
- **Leaderboard**: when played on claude.ai, a shared top-5 per stage on the finish screen, under a racing name you choose.
- **Driving school**: nine guided steps on the practice loop, from throttle to holding a drift.
- **Music**: a synthesised chiptune on the menus and a finish fanfare.
- **Classic stages**: five fixed stages, one per theme, the same for everyone and never rotated, so you can compare times with friends. Hazard-free, with bronze/silver/gold target times.
- **Past stages** calendar back to launch, a weekly **championship** of five stages (one per theme, total of your bests; some weeks are night, rain or fog weeks) and lifetime **stats**.
- **Retro look**: chunky faceted meshes, blocky textures, low-res pixel rendering (Light 360 / Heavy 240 lines), dithered reduced colour and PS1-style vertex wobble, each switchable in the pause menu.
- **Graphics** setting (Auto/High/Medium/Low) for phones; volume, mute, scanlines.

Best times, ghosts, stats and settings live in your browser's localStorage. No accounts, no ads.

Six cars, each modelled on a rally icon from photos: real proportions, built from cross-sections along the car, with period-style stripe liveries (no real names, badges or sponsor logos):

| Key | Car | Based on | Character |
| --- | --- | --- | --- |
| 1 | Stiletto V6 | 70s mid-engine wedge (Stratos HF) | short, light RWD; sharp and tail-happy |
| 2 | Pocket 1275 | 60s mini (Mini Cooper S works car) | tiny front-drive; nimble, low power. Styles: **Rally** or **Armchair** (lime green, black bonnet, a passenger in an armchair on the roof; crash and he falls off, ending the run) |
| 3 | Quadra 5T | 80s turbo coupé (Sport quattro S1 E2) | 4WD, huge torque, nose-heavy |
| 4 | Vector WRC | 00s world-rally hatch (2001 Focus WRC) | grippy, balanced 4WD |
| 5 | Dune Raider | rally-raid SUV (Cayenne "Dakar") | heavy and tall, barely slowed off-road |
| 6 | Brutale S4 | 80s Group B hatch (Delta S4), unlockable | 4WD, savage power, a handful |

## Layout

```
index.html        page shell, import map, HUD / overlay markup
css/style.css     retro-arcade theme
src/car.js        vehicle physics (pure JS, testable in Node)
src/carModel.js   car meshes: wheels, lamps, details, cockpit
src/loftcar.js    car bodies lofted from cross-sections (shapes and liveries)
src/track.js      road centreline, nearest-point queries, ribbon mesh, jumps/crests
src/stagegen.js   seeded stage generator, stage names, landform noise
src/terrain.js    heightfield terrain that hugs the road
src/gates.js      start / sector / finish gantries, warning boards
src/scenery.js    sky, lights, trees, rocks, fences, hills
src/camera.js     camera rigs + replay TV director
src/particles.js  dust
src/tyremarks.js  racing-line tracks + your own tyre marks
src/ghost.js      ghost recording, compact storage and playback
src/pacenotes.js  pace notes worked out from the road
src/paceicons.js  DiRT-style pace-note signs (SVG corner arrows)
src/audio.js      Web Audio engine / tyre synthesis
src/input.js      keyboard (rebindable) + touch
src/school.js     driving school steps
src/trackside.js  crowds, hay bales, TV helicopter
src/leaderboard.js shared leaderboard (claude.ai artifact database)
src/retro.js      retro look: facets, pixel pass, dithering, wobble
src/rng.js        seeded PRNG + date seeds
src/weather.js    weather / time of day, rain and snow
src/surfaces.js   tarmac sections, mud, puddles, ice, sand
src/hazards.js    fallen trees and landslides
src/drone.js      chase drone
src/minimap.js    HUD mini map
src/menus.js      garage, calendar, championship, stats pages
src/career.js     career seasons: calendar, rival times, points, promotion
src/podium.js     end-of-season podium scene
src/stats.js      lifetime stats
src/themes.js     stage themes (sky, light, ground, road, trees, hills)
sw.js             service worker: offline cache
manifest.webmanifest, icons/  installable app
tools/make-artifact.py  writes a copy for hosting as a claude.ai artifact
tools/make-single.sh    builds one self-contained HTML file in dist/
```
