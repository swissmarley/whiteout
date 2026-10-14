# WHITEOUT

Co-op multiplayer FPS set in a snowed-in brick alley. Hold out against waves of gunmen,
rushers and armoured heavies with one very loud assault rifle.

Browser client (three.js, WebGL2) + authoritative Node server (WebSocket). No build step,
no asset files: every model, texture and sound is generated in code at load time.

**Play solo in the browser: <https://swissmarley.github.io/whiteout/>** (Chrome, Edge, Safari or
Firefox, keyboard and mouse). For co-op, run the server below.

## Run

```bash
npm install
```

```bash
npm start
```

Open <http://localhost:7070>. The server also prints a `network:` URL — anyone on the same
LAN can open that to join the same match (1–8 players). `PORT=8080 npm start` changes the port.

Use a regular browser tab (Chrome, Edge, Safari, Firefox). Embedded previews usually refuse
mouse capture, which an FPS needs.

## GitHub Pages

Every push to `main` runs the tests and publishes the client to GitHub Pages
(`.github/workflows/pages.yml`). Pages can only serve files, so when the page finds no game
server where it came from it hosts the match itself: the same `Game` the Node server runs,
ticking in the tab and talking to the client through a stand-in for the WebSocket
(`src/local.js`), JSON strings both ways. That match is solo; nobody else can join it.
`npm run build:pages` assembles the same site into `_site/`.

## Controls

| | |
|---|---|
| `W A S D` | move |
| `Shift` | sprint |
| `C` / `Ctrl` | crouch |
| `Space` | jump — or **vault / mantle** when there is a ledge in front of you |
| `LMB` / `RMB` | fire / aim down sights |
| `MMB` (click the wheel) / `V` | knife |
| `R` · `B` | reload · auto ↔ semi |
| `T` | weapon light |
| `F` | resupply at a green-lit ammo crate (nook in the SW, loading dock in the NE) |
| `Tab` · `Esc` | squad board · pause: settings (sensitivity, FOV, volume, graphics), back to the main menu |

Vaulting reads the real collision geometry: low thin obstacles (barriers, the courtyard wall)
are vaulted over, anything up to ~1.6 m is mantled onto. Jump at the van to pull yourself up
onto its roof; hop bonnet → roof on the cars.

## The match

Waves get bigger and meaner (rushers from wave 2, heavies from wave 4). Health regenerates
after 5 s without taking a hit. Dying spends a shared reinforcement ticket; clear a wave to
earn one back. Out of tickets with everybody down = overrun, and the match restarts.

The knife is for when they are already on you: the support hand leaves the rifle, draws, cuts
across the view and goes back, in a little under a second. It reaches about two metres, kills a
gunman or a rusher in one and takes three for a heavy. It interrupts a reload (the rounds count
only if the fresh magazine was already seated) and nothing else can be done with the hands
until it is over. `MAIN MENU` on the pause screen leaves the match without dropping the
connection; the fight carries on for the rest of the squad and `DEPLOY` puts you back in it.

## How hit registration works

The thing you see is the hitbox, and the server judges the frame you were looking at.

1. `shared/rig.js` turns one replicated state row (position, yaw, walk phase, crouch, aim…)
   into 16 capsules. The client poses one modelled mesh per capsule (head, neck, chest,
   stomach, three per limb), each shaped to stay within about 3 cm of its capsule; the
   server ray-tests the same capsules. Limbs, walk cycle and crouch are all hittable exactly
   as drawn.
2. Remote entities are rendered ~100 ms in the past, interpolated between two server
   snapshots. Every shot carries the two snapshot timestamps and the blend factor in use
   that frame (`net.view`), plus the full-precision ray.
3. The server looks those two snapshots up in its history, runs the identical interpolation
   (`lerpEnemy`) and rig code, and traces the identical ray against world + capsules. Snapshot
   numbers are rounded *before* they are stored and sent, so both sides compute from the same
   doubles.
4. The client shows blood / hit-marker instantly from its own trace; the kill confirmation
   comes from the server. If the rewind narrowly disagrees with a hit the client saw, a 6 cm
   favour-the-shooter pad is applied — claimed hits are still verified against walls.

A knife cut goes through the same steps with a different shape: instead of a line, a 20 cm
sphere swept along the aim line for 1.9 m (so it needs pointing, not a bullet's aim), stopped
by chain-link that a bullet would pass, and worth the same wherever it lands.

The corner of the HUD shows `HITREG confirmed/predicted` so you can watch it agree.

## Tests

```bash
npm test
```

Covers the shared geometry and rig, navigation reachability, and end-to-end cases over a real
WebSocket: per-body-part agreement between client prediction and server, a wall blocking a
claimed hit, a headshot on a sideways-sprinting target with 100 ms of interpolation plus
180 ms of added latency (must register by exact rewind, not by tolerance), the knife (reach,
one cut for a gunman, the sweep catching what a bullet on the same line misses, the rate limit,
chain-link), and leaving for the menu and deploying again on the same connection.

## Layout

```
server/   index.js   static host + WebSocket endpoint (one process)
          game.js    waves, AI, damage, lag-compensated shots, snapshots
          nav.js     0.5 m nav grid + A* built from the shared collision boxes
shared/   map.js     the alley: buildings, props, spawns, lights (pure data)
          rig.js     humanoid rig -> capsules (visuals == hitboxes)
          collide.js ray/box, ray/capsule, overlap queries
          constants.js  tuning, snapshot layout, interpolation
public/   index.html, style.css
          src/main.js     frame loop, shooting, network events
          src/world.js    buildings, windows, props, snow, lights, sky
          src/weapon.js   first-person rifle: handling, recoil, reload, flash, the knife cut
          src/rifle.js    the carbine model (receiver, handguard, optic, light, bolt, magazine)
          src/hands.js    first-person arms: gloved hands, jacket sleeves from cuff to upper arm
          src/knife.js    the fighting knife the support hand draws
          src/player.js   movement, collision, vault/mantle, camera
          src/actors.js   enemies + other players: posing on the rig, corpses
          src/bodies.js   character models, one mesh per rig capsule, and their weapons
          src/mesh.js     modelling toolkit: bevelled extrusions, lathes, lofts, surface material
          src/fx.js       snowfall, particles, tracers, decals, brass
          src/post.js     AO, bloom, lens pass (blood, damage, grain)
          src/audio.js    synthesised sound
          src/local.js    the match hosted in the page when there is no server (GitHub Pages)
          src/net.js, hud.js, input.js, textures.js
          vendor/three/   three.js r186 (only the files that are imported)
test/     hitreg.test.js, e2e.test.js
scripts/  pages.mjs       assembles the static site for GitHub Pages
```

## Models

The rifle, the hands and the characters are modelled in code rather than loaded from files, so
there is still nothing to build or fetch. `src/mesh.js` turns drawn profiles into geometry
(side views extruded with bevelled edges, lathed barrels and tubes, lofted limbs and torsos)
and gives every part face-weighted normals, box-projected UVs for the tiling detail maps, and
per-vertex colour, roughness and metalness, so a whole character is still one material.

The first-person arms are whole arms, not just what the camera normally sees: glove, wrist
strap, a cinched jacket cuff, a forearm that tapers to the wrist, a bent elbow and an upper arm
that ends out of frame in every weapon pose. Fingers are straight bones with a bend at each
joint. The support hand is not typed in as coordinates: `supportGrip()` lays each finger on a
helix round the handguard from its knuckle, so the grip can be turned, angled or slid along
the rifle and still close on it. It wears a watch face-in on the wrist, and the glove darkens
where it meets the handguard. That arm works the reload: the sleeve is one rigid piece that
carries the wrist from the handguard to the magazine, down and back up with it, and on to the
bolt release, while the hand turns inside the cuff and its fingers blend between poses (open,
closed round the magazine, thumb out) as morph targets, always opening before they close. Sleeve folds are one function used twice on the sweep, as `mod`
(the cloth pushed in and out) and as `tint` (the shadow inside each fold).

Fingers are not tubes: each is flatter across the back than underneath, swells over its
knuckles and creases under them, has a pad under every bone and a fuller one under the tip, and
narrows to the nail. The glove is stretch fabric on the back and leather on the pads, with a
moulded guard over the knuckles and a rib along the first bone of every finger that bends with
it.

The knife cut is the same arm moved freely instead of between stations on the rifle. It is
written in view space as a handful of keys (where the wrist is, which way the forearm runs,
which way the back of the hand faces, how far the wrist is cocked or snapped through) and
blended with a tangent at each key scaled by how fast the arm is still moving there, so it
hangs for an instant at the top of the wind-up and is at full speed through the middle. The
first and last keys ride on the rifle, which the firing hand has meanwhile dropped aside, so
the hand leaves from wherever it was (half-way through a reload, if need be) and lands back on
the handguard. The knife is drawn and put away while the hand is below the frame. The head
turns with the cut, and when the blade meets something time all but stops for a few frames.

Enemies and other players get the same treatment inside their hit capsules: the cap of the
shoulder, a sleeve that is fullest below the elbow and narrows to a bound cuff, the glove's
cuff, and a hand closed round its grip with four fingers and a thumb. Elbow pads, unit
patches and the heavy's arm plates sit on those profiles.

Character parts are sized from `segRadius()` and `BONE` in `shared/rig.js`, never the other
way round, and stay within about 3 cm of the capsules. Chest and stomach share one body
surface, flattened across the waist only as far as that allows; boot heels are the one place
that goes a little past it (3.5 cm, so boots stand flat). `actors.js` rolls each limb about its own bone so knee pads,
boots and elbows face the right way; it never moves a part off its capsule's axis.

## Living on an exFAT drive

This project was built on an exFAT volume, where macOS drops an AppleDouble `._name` twin
beside every file. The project is arranged so those can never matter:

- no bundler, no watcher, no globbing — nothing scans a directory for source files
- the static server refuses any path with a dot-prefixed segment
- `npm test` names its test files explicitly (a bare `node --test` would try to run `._*.test.js`)
- three.js is vendored as ~17 files instead of a 2,500-file package (128 KB clusters add up)
- `.npmrc` sets `bin-links=false` (exFAT has no symlinks); `.gitignore` lists `._*`

To sweep the twins away (safe — they only hold Finder metadata):

```bash
npm run clean:sidecars
```

If you put this under git on the same drive, run that before committing: sidecars inside
`.git/` can corrupt refs and pack indexes.

## Developer hooks

- `http://localhost:7070/?auto=1` joins immediately without the menu or mouse capture, and
  `?q=low|medium|high|ultra` forces a graphics preset. `window.__game` exposes the systems.
- `node server/index.js --debug` enables test-only commands (spawn an enemy, make the AI
  passive). The automated tests use these; a normal server ignores them.
