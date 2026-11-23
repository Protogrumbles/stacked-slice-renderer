# The technique, honestly

## What this is

A demo of the technique behind the UI8 "fly" demo (a pixel-art jet
flying over ocean and islands, as in UI8's Instagram reel): the scene
is rendered as **stacked horizontal pixel layers ("slices")**, each
offset horizontally by an amount that depends on its depth — and,
in v2, the jet itself is a **voxel stack**: horizontal cross-sections
stacked vertically, each shifted sideways when the jet banks, which
reveals side faces. That slice-shifting is the actual UI8 trick.

It is **not Mode 7**. Mode 7 (SNES) is a hardware affine transform:
it takes a flat texture and maps it onto a plane with rotation and
scaling, so the ground can rotate under the camera. This demo does
none of that. There is no texture mapping, no rotation of the ground
plane, and no real 3D projection. What it does is much simpler — and
that simplicity is the point: it is cheap, deterministic, and easy to
reason about.

## How stacked slices work

1. **The screen is divided into horizontal strips** — 4 px tall in
   this demo (`SLICE_HEIGHT`), from the horizon to the bottom of the
   screen. The sky above the horizon is drawn the same way.
2. **Each strip has a depth.** Depth is 0 at the horizon and 1 at the
   bottom of the screen: `depth = (y - horizonY) / (height - horizonY)`.
   Depth is the only "3D" quantity in the system.
3. **Each strip is offset horizontally** by a function of its depth:
   a slow sway (a sine of time, scaled by depth) plus a per-row wave
   ripple (also scaled by depth), plus the lateral world shift from
   turning (heading). Near strips move more than far strips. That
   difference in movement is the parallax that makes a stack of flat
   strips read as a receding plane.
4. **Each strip is coloured by its depth** — bright blue at the
   horizon, brighter still near the viewer — and its texture (the
   wave dashes) scrolls at a speed proportional to depth, so the near
   sea appears to flow towards the viewer faster than the far sea.
5. **Islands are drawn as stacked slices too.** An island is
   projected to a screen position and size from its distance `z`
   (far = small, at the horizon; near = large, low on screen), then
   drawn row by row: each row is a horizontal segment whose width
   follows the island's profile and whose horizontal offset is the
   *same* slice offset the ocean uses at that row. Because island and
   sea share the offset function, they move together and the island
   looks planted in the water instead of floating over it. Islands
   are terraced: three bands (bright green / green / sand) with a
   darker step line at each terrace boundary.
6. **Clouds are stacked slices too**, white on top with a grey-blue
   shadow underneath, on the same projection as islands. About half
   the cloud slots are active at any time (cloud density 0.45, as
   published). Flying through a cloud (z < 12) whites out the screen
   briefly.

## The voxel-stack jet

The jet is not a sprite image. It is 13 horizontal slices
(`JET_SLICES`), tail to nose, each with a half-width, an optional
wing span, and a role (hull / canopy / engine). The renderer stacks
them vertically and shifts each slice sideways by
`bank * index * sliceSpacing` (slice spacing 1, as published), then
draws a darker 1 px side face on the side the slices shift toward.
Banking therefore reveals side faces, exactly as the reference does
— that is the whole trick, and it is the one v1 was missing.

Colours are the reference jet colours: body `#545969`, accent
`#f0580e`, canopy `#1e8ca0`. The jet is 8 logical px wide — 2.5% of
the 320 px screen, matching the reference's ~2–3%. The flame is a
separate layer at the tail (style "realistic", as published):
flickering orange/yellow rows whose length depends on thrust.
Banking hard while thrusting draws white wingtip contrails; flying
below altitude 20 draws wake/spray at the bottom of the screen.

The jet model is the same shape `pixel-ship-factory` emits with
`voxel-stack` (same slice list, same spacing, same colours) — the
factory's `falcon` faction is this jet's palette.

## Flight model

The demo is flyable now (v1 was a screensaver). State: heading,
bank, altitude, speed, thrust, roll timer.

| Input | Action |
|---|---|
| Mouse position | Steer — the jet turns toward the cursor at 1.25 rad/s |
| Hold mouse / W | Thrust — speed rises toward 3× |
| S | Brake — speed falls toward 0.25× |
| Click (quick) | Barrel roll, 0.5 s |
| Shift (hold) | Afterburner — effective speed × 1.8 |
| Arrow Left / Right | Turn |
| Arrow Up | Dive (altitude down) |
| Arrow Down | Climb (altitude up) |
| Space | Cycle camera (1.4 s transition) |
| `[` / `]` | Pixel size down / up (1–6, default 3) |

Altitude runs 7–300 (ground clearance 7, ceiling 300, as
published); cruise is 110. Climbing moves the horizon up the screen
and shrinks the islands; diving does the opposite. Above altitude
~120 the sky darkens toward space and stars fade in (fully dark by
~220). There is no gamepad or touch support — mouse + keyboard only,
which the reference also offers but this demo does not implement.

## The three cameras

Space cycles through three views, with a **1.4 s transition** that
blends horizon and sway between views (the ship/view mode switches
at the halfway point). All three use the same slice maths; only the
parameters change:

| Camera | `horizonY` | Sway | View |
|---|---|---|---|
| chase | 70 | 6 | voxel-stack jet from behind, 2.6 jet lengths back, 12° up |
| overhead | 18 | 2 | **true top-down world view**: ocean fills the screen, islands and clouds mapped from world coordinates, jet centred at the same 8 px size as chase view |
| cockpit | 84 | 10 | frame + HUD (below) — you are inside the ship |

Jet size is constant across cameras and across pixel-size settings:
all geometry is in logical pixels, and the pixel size only changes
the display block size (canvas CSS width = 320 × pixel size).

### Cockpit HUD

Altitude, speed, and heading readouts; an artificial horizon gauge
that rolls with the bank (max 52°, as published); a radar with
island (green) and cloud (white) blips and the jet at the centre; a
targeting reticle. The horizon and radar roll with the jet, as in
the reference.

## Pixel size

`PIXEL_SIZE` (default 3) is the display block size: each logical
pixel is drawn as a 3×3 block, matching the original as published.
`[` / `]` change it from 1 to 6. The logical buffer stays 320×180,
so changing pixel size never changes the jet's size relative to the
screen — that is the framing fix: the overhead view used to draw
the jet as a 4 px dot, and the chase jet used to be ~7% of screen
width. Both are now the same 8 px.

## What the demo does NOT do

- No Mode 7 / affine texture mapping, no ground rotation.
- No heightmap, no collision, no real 3D geometry. The voxel jet is
  a 13-slice approximation of the reference's run-length-encoded
  voxel model, not a full voxel model — it has no per-voxel depth
  buffer and the slices are flat rows, not a 3D volume.
- No gamepad or touch input (the reference has both).
- No enemies, no score, no missions — Free Fly only, as in the
  reference's Free Fly mode.
- No sprites loaded from files — the ship, sun, islands and clouds
  are all drawn from rectangles. The demo makes zero network requests.
- Islands and clouds respawn deterministically (a hashed seed
  counter), so the demo never runs out of them, but their positions
  are not a designed world — they are procedural filler.

## The maths, in one place

Pure functions, in `index.html` (and mirrored in
`stacked_slice_renderer.gd` where the module supports them):

- `sliceDepth(y, horizonY, height)` — 0 at the horizon, 1 at the bottom.
- `sliceOffset(y, time, params, lateral)` — sway + wave + turn drift, all scaled by depth.
- `sliceTextureOffset(y, time, speed, params)` — texture scroll, scaled
  by depth, wrapping every 16 px (the dash spacing).
- `oceanColor(depth)` — bright blue → brighter blue interpolation.
- `projectIsland(island, params)` — distance `z` → screen `{x, y, r, h}` (also used for clouds).
- `nextCamera(camera)` — chase → overhead → cockpit → chase.
- `jetWidthPx()` — chase jet width on screen (8 px = 2.5%).
- `skyDarkness(altitude)` — 0 below 120, rising to 0.7 by 220.
- `altScale(altitude)` — island/cloud apparent size vs altitude.
- `currentCameraParams()` — the in-effect camera params, blended
  through the 1.4 s transition, with the altitude horizon shift.
- `setPixelSize(n)` / `getPixelSize()` — display block size, 1–6.
- `hash01(n)` — deterministic 0..1 hash, for sparkle and respawns.

These are tested headlessly by `test_slice_math.js` (Node, no
dependencies): depth endpoints, near-slices-move-more-than-far,
texture wrapping, island projection (far = high + small, near = low +
large), camera cycle, reference params, jet width, clouds, altitude
clamps, camera transitions, pixel size, steering/bank/roll,
afterburner ×1.8, and a render probe that records what `step()`
actually draws per camera (jet width, flame, clouds, HUD text,
stars at altitude) — the probe is the parity check, not a screenshot.

## The Godot module

`stacked_slice_renderer.gd` is the same core in GDScript, with two
modes:

- **OCEAN** (default) — the same ocean/islands/clouds slice renderer
  as the HTML demo, with the same public functions and parameters.
- **SPACE** — a starfield backdrop for the Escape Velocity game:
  three star layers scrolling at 0.2×/0.5×/1.0× parallax, two
  nebula-wisp layers, no ocean. This is the DESIGN.md §2 mapping
  (ocean → starfield, clouds → nebula, islands → planets) implemented
  instead of copied verbatim.

The module no longer draws a demo ship marker: it is a backdrop, and
the game draws its own ship. Camera transitions (1.4 s) are
implemented in the module too, blending horizon between views.
`pixel_size` (default 3) sets the size of the star squares in SPACE
mode. The module was reviewed for syntax plausibility but was NOT
executed inside Godot here — verify in Godot 4.x before shipping.

## Where this is going

This renderer is the visual core for the Escape Velocity game repo
(a modern Escape Velocity-style game, Godot 4 for the full game).
The Godot module is the same core in GDScript, so the game can drop
it in and build on it. The HTML demo stays as the reference
implementation you can open in any browser and the testable spec for
the maths.
