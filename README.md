# stacked-slice-renderer

The UI8 fly-demo technique as a standalone demo: ocean + islands
rendered as **stacked offset horizontal pixel layers with parallax**,
plus three cameras cycled on Space.

By Sean Steuer — Program Manager, AI Strategy & Operational
Transformation at Netflix. This is a game-component demo, not a Netflix
project. Everything in it is fictional and illustrative.

## What it is

- A **single-file HTML/Canvas demo** ([`index.html`](index.html)):
  open it in any browser. Zero network requests — no external scripts,
  fonts, images or fetches. The ship, sun and islands are all drawn
  from rectangles.
- The same core as a **Godot 4 GDScript module**
  ([`stacked_slice_renderer.gd`](stacked_slice_renderer.gd)): drop it
  onto a Node2D and it renders the same scene in Godot.
- An honest explanation of the technique in
  [`TECHNICAL.md`](TECHNICAL.md).

## What it is NOT

- **Not Mode 7.** Mode 7 is a hardware affine texture transform with
  rotation and scaling. This demo has no texture mapping, no rotation
  and no real 3D projection — it is flat horizontal strips whose
  offset, colour and texture speed all depend on depth. The
  difference is explained in `TECHNICAL.md`, and the demo does not
  claim otherwise.
- Not a game: no heightmap, no collision, no designed world. Islands
  respawn procedurally and deterministically; they are filler, not a
  map.

## Quick start

```bash
# HTML demo — just open it (no server, no build step)
open index.html            # macOS
# or: xdg-open index.html  # Linux
# or double-click it in a file manager

# Run the headless tests (Node 16+, no dependencies)
node test_slice_math.js

# Syntax-check the inline script (the test harness does this too)
node --check /tmp/slice-script.js   # see "Tests" below
```

Controls in the demo (v2 — the demo is flyable now): **mouse** steers,
**click** rolls, hold **mouse** / **W** for thrust, **Shift**
afterburner, **↑** dives, **↓** climbs, **Space** cycles the camera
(chase → overhead → cockpit, 1.4 s transition), **[** / **]** change
pixel size. No gamepad or touch support yet.

## The three cameras

| Camera | What you see |
|---|---|
| chase | Voxel-stack jet from behind (13 slices, banking reveals side faces), bright blue sea receding to the horizon |
| overhead | **True top-down world view**: ocean fills the screen, islands and clouds mapped from world coordinates, jet centred at the same 8 px size as chase view |
| cockpit | Same scene behind a dark frame + HUD: altitude, speed, heading, artificial horizon, radar, reticle |

## How it works (short version)

The screen is divided into 4 px horizontal strips. Each strip has a
depth (0 at the horizon, 1 at the bottom). Its horizontal offset is a
sway + wave ripple, both scaled by depth, so near strips move more
than far ones — that difference *is* the parallax. Its colour goes
deep blue → bright teal with depth, and its wave-dash texture scrolls
faster with depth, so the near sea flows towards you. Islands are
projected from a distance `z` (far = small, at the horizon; near =
large, low on screen) and drawn row by row with the *same* slice
offset as the ocean at that row, so they sit in the water instead of
floating over it. Full version: [`TECHNICAL.md`](TECHNICAL.md).

## Godot 4 module — public interface

Copy [`stacked_slice_renderer.gd`](stacked_slice_renderer.gd) into a
Godot 4 project (e.g. `res://scripts/`), attach it to a Node2D, and
run. Space cycles the camera, Up/Down change speed. Full drop-in
steps are in the header comment of the `.gd` file.

This interface is explicit and stable — a later game repo will reuse
this module, so it is documented here, not just in the code:

**Exported properties** (Inspector-editable): `mode` (`OCEAN` /
`SPACE` — SPACE is a starfield backdrop: 3 star layers at 0.2× /
0.5× / 1.0× parallax plus nebula wisps), `slice_height` (int, 4),
`horizon_y` (float, 70), `speed` (float, 1.0), `altitude` (float, 110),
`camera_mode` (`CHASE` / `OVERHEAD` / `COCKPIT`),
`pixel_size` (int, 3), `view_transition_seconds` (float, 1.4),
`ocean_deep` / `ocean_shallow` / `sky_top` / `sky_horizon` (Color),
`viewport_size` (Vector2, 320×180),
`islands` (Array[Dictionary], each `{"x": -0.55, "z": 20.0, "r": 16.0, "h": 14.0}`),
`clouds` (Array[Dictionary], each with an `active` flag).

**Public functions**: `slice_depth(y)`, `slice_offset(y)`,
`slice_texture_offset(y)`, `ocean_color(depth)`,
`project_island(island)` → `{x, y, r, h, visible}`,
`cycle_camera()`, `set_speed(value)`, `sky_darkness()`.

The module draws no ship marker — it is a backdrop, and the game
draws its own ship.

> **Unverified:** the GDScript was reviewed for syntax plausibility
> but was **not executed in Godot** in this environment (no Godot
> runtime here). Before shipping, attach it in Godot 4.x, run the
> scene, press Space and confirm the camera cycles and the islands
> scroll.

## Tests

```bash
node test_slice_math.js
```

The harness reads `index.html`, asserts it makes zero network
requests (no `src=`/`href=` to http, no `@import`, no `fetch`/XHR),
extracts the single inline `<script>`, executes it headlessly in a
Node VM with no `document` (the render loop never starts there), and
asserts on the pure functions: depth endpoints and clamping,
near-slices-move-more-than-far, texture offset wrapping to [0,16),
ocean colour endpoints, island projection (far = high + small, near =
low + large, out-of-range = not visible), the camera cycle,
deterministic `hash01`, and `step()` advancing time and islands —
plus the v2 coverage: reference params, jet width (2.5% of screen),
clouds, altitude clamps and sky darkening, 1.4 s camera transitions,
pixel size, steering/bank/roll, afterburner ×1.8, and a render probe
that records what `step()` actually draws per camera (jet width,
flame, clouds, HUD text, stars at altitude, contrails in a bank).

Syntax-check the extracted script separately:

```bash
python3 -c "
import re
html = open('index.html').read()
js = re.search(r'<script>(.*?)</script>', html, re.S).group(1)
open('/tmp/slice-script.js','w').write(js)
"
node --check /tmp/slice-script.js
```

## Files

| File | What it is |
|---|---|
| `index.html` | Single-file demo (HTML + CSS + JS, zero network) |
| `stacked_slice_renderer.gd` | Godot 4 module, same core in GDScript |
| `TECHNICAL.md` | Honest explanation of the technique |
| `test_slice_math.js` | Headless Node tests for the slice maths |
| `README.md`, `LICENSE`, `.gitignore` | This file, MIT, ignores |

## License

MIT — see [LICENSE](LICENSE).
