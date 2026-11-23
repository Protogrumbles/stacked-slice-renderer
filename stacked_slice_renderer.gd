# Stacked-slice renderer — Godot 4 module
# Same core as index.html, ported to GDScript. See TECHNICAL.md for the
# honest explanation of the technique (stacked slices, NOT Mode 7).
#
# Two modes:
#   OCEAN — the ocean / islands / clouds slice renderer from the
#     HTML demo, same maths, same parameters.
#   SPACE — a starfield backdrop for the Escape Velocity game: three
#     star layers at 0.2x / 0.5x / 1.0x parallax plus two nebula-wisp
#     layers. This is the DESIGN.md section 2 mapping (ocean becomes
#     starfield, clouds become nebula, islands become planets)
#     implemented, not copied verbatim.
#
# The module is a backdrop only: it draws no ship. The game draws
# its own ship. (Earlier versions drew a small demo ship marker in
# chase mode; that marker is removed.)
#
# Drop-in:
#   1. Copy this file into your Godot 4 project, e.g. res://scripts/
#      stacked_slice_renderer.gd
#   2. Add a Node2D to your scene and attach this script.
#   3. Set the exported properties in the Inspector (mode,
#      slice_height, horizon_y, speed, camera_mode, colours, islands).
#   4. Run. Space cycles the camera (chase -> overhead -> cockpit),
#      Up/Down change speed. Or call cycle_camera() / set_speed() from
#      your own input code.
#
# Public interface (the stable part a later game repo will reuse):
#   Properties (exported, Inspector-editable):
#     mode         : Mode     — OCEAN or SPACE (default OCEAN)
#     slice_height : int      — px per horizontal layer (default 4)
#     horizon_y    : float    — y where sea meets sky (default 70)
#     speed        : float    — forward speed multiplier (default 1.0)
#     altitude     : float    — 7..300, cruise 110 (default 110)
#     camera_mode  : CameraMode — CHASE, OVERHEAD or COCKPIT
#     pixel_size   : int      — display block size, 1..6 (default 3);
#                              in SPACE mode it sizes the far stars
#     view_transition_seconds : float — camera blend time (default 1.4)
#     ocean_deep   : Color    — ocean colour at the horizon
#     ocean_shallow: Color    — ocean colour at the bottom of the screen
#     sky_top      : Color    — sky colour at the top of the screen
#     sky_horizon  : Color    — sky colour at the horizon
#     viewport_size: Vector2  — logical resolution (default 320x180)
#     islands      : Array[Dictionary] — {x, z, r, h}; see below
#     clouds       : Array[Dictionary] — {x, z, r, h, active}
#   Functions:
#     slice_depth(y) -> float
#     slice_offset(y) -> float
#     slice_texture_offset(y) -> float
#     ocean_color(depth) -> Color
#     project_island(island) -> Dictionary {x, y, r, h, visible}
#     cycle_camera() -> void
#     set_speed(value) -> void
#     sky_darkness() -> float
#
# Island dictionaries: {"x": -0.55, "z": 20.0, "r": 16.0, "h": 14.0}
#   x: -1..1 across the world, z: distance ahead (0 = horizon,
#   100 = passing the camera), r: radius, h: height. Islands respawn
#   deterministically far away when they pass the camera.
#
# NOTE: this GDScript was reviewed for syntax plausibility but was NOT
# executed inside Godot here (no Godot runtime in this environment).
# Verify in Godot 4.x before shipping: attach it, run the scene, press
# Space and confirm the camera cycles and the islands scroll.
class_name StackedSliceRenderer
extends Node2D

enum Mode { OCEAN, SPACE }
enum CameraMode { CHASE, OVERHEAD, COCKPIT }

const VIEW_CHANGE_S := 1.4
const CRUISE_ALTITUDE := 110.0
const CEILING := 300.0
const GROUND_CLEARANCE := 7.0
const CLOUD_DENSITY := 0.45
const STAR_LAYERS := [0.2, 0.5, 1.0]
const STAR_COUNTS := [60, 40, 25]

@export var mode: Mode = Mode.OCEAN
@export var slice_height: int = 4
@export var horizon_y: float = 70.0
@export var speed: float = 1.0
@export var altitude: float = CRUISE_ALTITUDE
@export var camera_mode: CameraMode = CameraMode.CHASE
@export var pixel_size: int = 3
@export var view_transition_seconds: float = VIEW_CHANGE_S
@export var ocean_deep: Color = Color(0.063, 0.376, 0.706)
@export var ocean_shallow: Color = Color(0.247, 0.722, 0.863)
@export var sky_top: Color = Color(0.039, 0.118, 0.235)
@export var sky_horizon: Color = Color(0.392, 0.549, 0.745)
@export var viewport_size: Vector2 = Vector2(320, 180)
@export var islands: Array[Dictionary] = [
	{"x": -0.55, "z": 20.0, "r": 16.0, "h": 14.0},
	{"x": 0.35, "z": 45.0, "r": 22.0, "h": 18.0},
	{"x": -0.10, "z": 70.0, "r": 12.0, "h": 10.0},
	{"x": 0.70, "z": 88.0, "r": 18.0, "h": 12.0},
	{"x": -0.85, "z": 60.0, "r": 10.0, "h": 8.0},
]
@export var clouds: Array[Dictionary] = [
	{"x": -0.4, "z": 30.0, "r": 14.0, "h": 5.0, "active": true},
	{"x": 0.5, "z": 55.0, "r": 18.0, "h": 6.0, "active": true},
	{"x": 0.0, "z": 80.0, "r": 12.0, "h": 4.0, "active": false},
	{"x": -0.7, "z": 65.0, "r": 16.0, "h": 5.0, "active": true},
	{"x": 0.8, "z": 40.0, "r": 11.0, "h": 4.0, "active": false},
	{"x": -0.2, "z": 90.0, "r": 15.0, "h": 5.0, "active": true},
]

var _time: float = 0.0
var _island_seed: int = 1000
var _cloud_seed: int = 2000
var _transition_t: float = 1.0
var _transition_from: CameraMode = CameraMode.CHASE
var _transition_to: CameraMode = CameraMode.CHASE

# Camera parameters per view, mirroring CAMERA_PARAMS in index.html.
const CAMERA_PARAMS := {
	CameraMode.CHASE: {"horizon_y": 70.0, "sway": 6.0},
	CameraMode.OVERHEAD: {"horizon_y": 18.0, "sway": 2.0},
	CameraMode.COCKPIT: {"horizon_y": 84.0, "sway": 10.0},
}


func _ready() -> void:
	_apply_camera()


func _unhandled_input(event: InputEvent) -> void:
	if event.is_action_pressed("ui_cancel"):
		return
	if event is InputEventKey and event.pressed and not event.echo:
		var key_event := event as InputEventKey
		if key_event.keycode == KEY_SPACE:
			cycle_camera()
		elif key_event.keycode == KEY_UP:
			set_speed(speed + 0.25)
		elif key_event.keycode == KEY_DOWN:
			set_speed(speed - 0.25)


func _process(delta: float) -> void:
	_time += delta
	if _transition_t < 1.0:
		_transition_t = minf(1.0, _transition_t + delta / view_transition_seconds)
	for island in islands:
		island["z"] = float(island["z"]) - speed * delta * 6.0
		if float(island["z"]) <= 1.0:
			_island_seed += 1
			island["z"] = 95.0
			island["x"] = hash01(_island_seed) * 1.7 - 0.85
			island["r"] = 9.0 + hash01(_island_seed + 7) * 14.0
			island["h"] = 7.0 + hash01(_island_seed + 13) * 12.0
	for cloud in clouds:
		cloud["z"] = float(cloud["z"]) - speed * delta * 4.0
		if float(cloud["z"]) <= 1.0:
			_cloud_seed += 1
			cloud["z"] = 95.0
			cloud["x"] = hash01(_cloud_seed) * 1.7 - 0.85
			cloud["r"] = 10.0 + hash01(_cloud_seed + 5) * 16.0
			cloud["h"] = 4.0 + hash01(_cloud_seed + 11) * 5.0
			cloud["active"] = hash01(_cloud_seed + 21) < CLOUD_DENSITY
	queue_redraw()


func _draw() -> void:
	if mode == Mode.SPACE:
		_draw_space()
		return
	var params: Dictionary = _current_params()
	_draw_sky(params)
	_draw_ocean(params)
	for island in islands:
		_draw_island(island, params)
	for cloud in clouds:
		_draw_cloud(cloud, params)
	if camera_mode == CameraMode.COCKPIT:
		_draw_cockpit_frame()


func cycle_camera() -> void:
	_transition_from = camera_mode
	match camera_mode:
		CameraMode.CHASE:
			camera_mode = CameraMode.OVERHEAD
		CameraMode.OVERHEAD:
			camera_mode = CameraMode.COCKPIT
		_:
			camera_mode = CameraMode.CHASE
	_transition_to = camera_mode
	_transition_t = 0.0
	_apply_camera()
	queue_redraw()


func set_speed(value: float) -> void:
	speed = clampf(value, 0.25, 3.0)


func sky_darkness() -> float:
	return clampf((altitude - 120.0) / 100.0, 0.0, 0.7)


func slice_depth(y: float) -> float:
	var horizon: float = _effective_horizon()
	if viewport_size.y <= horizon:
		return 0.0
	return clampf((y - horizon) / (viewport_size.y - horizon), 0.0, 1.0)


func slice_offset(y: float) -> float:
	var depth := slice_depth(y)
	var sway := sin(_time * 0.6) * _effective_sway() * depth
	var wave := sin(y * 0.35 + _time * 1.7) * (1.0 + depth * 5.0)
	return sway + wave


func slice_texture_offset(y: float) -> float:
	var depth := slice_depth(y)
	return fposmod(_time * speed * 24.0 * depth, 16.0)


func ocean_color(depth: float) -> Color:
	return ocean_deep.lerp(ocean_shallow, clampf(depth, 0.0, 1.0))


func project_island(island: Dictionary) -> Dictionary:
	var horizon: float = _effective_horizon()
	var t := clampf(1.0 - float(island["z"]) / 100.0, 0.0, 1.0)
	var y := horizon + t * t * (viewport_size.y - horizon)
	var scale := 0.25 + t * 1.9
	var x := viewport_size.x / 2.0 + float(island["x"]) * 150.0 * (0.4 + t * 1.1)
	return {
		"x": x, "y": y,
		"r": float(island["r"]) * scale,
		"h": float(island["h"]) * scale,
		"visible": float(island["z"]) > 1.0 and float(island["z"]) < 100.0,
	}


static func hash01(n: int) -> float:
	var x := (n * 2654435761) & 0xFFFFFFFF
	x = (x ^ (x >> 13)) & 0xFFFFFFFF
	x = (x * 1274126177) & 0xFFFFFFFF
	x = (x ^ (x >> 16)) & 0xFFFFFFFF
	return float(x) / 4294967296.0


func _current_params() -> Dictionary:
	var from: Dictionary = CAMERA_PARAMS[_transition_from]
	var to: Dictionary = CAMERA_PARAMS[_transition_to]
	var t := _transition_t * _transition_t * (3.0 - 2.0 * _transition_t)
	var horizon := lerpf(float(from["horizon_y"]), float(to["horizon_y"]), t)
	# Altitude moves the horizon: climbing shows more sky. The shift
	# is scaled to the viewport height (the JS demo is 180 px tall).
	var shift := (altitude - CRUISE_ALTITUDE) * 0.08 * (viewport_size.y / 180.0)
	horizon = clampf(horizon - shift, 20.0 * (viewport_size.y / 180.0),
		130.0 * (viewport_size.y / 180.0))
	return {
		"horizon_y": horizon,
		"sway": lerpf(float(from["sway"]), float(to["sway"]), t),
	}


func _effective_horizon() -> float:
	return float(_current_params()["horizon_y"])


func _effective_sway() -> float:
	return float(_current_params()["sway"])


func _alt_scale() -> float:
	return clampf(1.15 - altitude / 300.0, 0.55, 1.15)


func _apply_camera() -> void:
	# Horizon follows the camera; the render loop reads it via
	# _current_params, so there is nothing else to apply here.
	pass


func _draw_sky(params: Dictionary) -> void:
	var horizon: float = params["horizon_y"]
	var dark := sky_darkness()
	var y := 0.0
	while y < horizon:
		var d := clampf(y / maxf(horizon, 1.0), 0.0, 1.0)
		var col := sky_top.lerp(sky_horizon, d).lerp(Color(0.016, 0.023, 0.063), dark)
		draw_rect(Rect2(0, y, viewport_size.x, slice_height), col)
		y += slice_height
	# Stars fade in as the sky darkens above altitude 120.
	if dark > 0.05:
		for i in range(40):
			var sx := hash01(i * 3 + 11) * viewport_size.x
			var sy := hash01(i * 7 + 5) * horizon
			var big := hash01(i * 13 + 2) > 0.8
			var size := 2.0 if big else 1.0
			draw_rect(Rect2(sx, sy, size, size), Color(1, 1, 1, dark))
	# Sun: a fixed square, for a horizon reference point.
	var sun_col := Color(0.788, 0.694, 0.514) if dark > 0.5 else Color(1.0, 0.914, 0.659)
	draw_rect(Rect2(viewport_size.x - 62, 18, 18, 18), sun_col)


func _draw_ocean(params: Dictionary) -> void:
	var y := float(params["horizon_y"])
	while y < viewport_size.y:
		var depth := slice_depth(y)
		var off := slice_offset(y)
		draw_rect(Rect2(0, y, viewport_size.x, slice_height), ocean_color(depth))
		var tex := slice_texture_offset(y)
		var dash := Color(1, 1, 1, 0.18) if depth > 0.5 else Color(0, 0, 0, 0.20)
		var x := -16.0
		while x < viewport_size.x + 16.0:
			var sparkle := hash01(int(y / slice_height) * 31 + int(_time * 2.0)) > 0.6
			draw_rect(Rect2(x + tex + off, y + 1, 7.0 if sparkle else 4.0, 1.0), dash)
			x += 16.0
		y += slice_height
	# Wake and spray when flying low over the sea.
	if altitude < 20.0:
		var wx := 0.0
		while wx < viewport_size.x:
			var spray := hash01(int(wx / 24.0) * 17 + int(_time * 6.0)) > 0.5
			draw_rect(Rect2(wx + (4.0 if spray else 0.0), viewport_size.y - 4.0,
				8.0 if spray else 5.0, 1.0), Color(1, 1, 1, 0.35))
			wx += 24.0


func _draw_island(island: Dictionary, params: Dictionary) -> void:
	var p := project_island(island)
	if not bool(p["visible"]) or float(p["r"]) < 1.0:
		return
	var horizon: float = params["horizon_y"]
	var s := _alt_scale()
	var r := float(p["r"]) * s
	var h := float(p["h"]) * s
	var dy := -h
	while dy <= 0.0:
		var y := float(p["y"]) + dy
		if y >= horizon and y < viewport_size.y:
			var f := 1.0 - (dy / h) * (dy / h)
			var half := maxf(1.0, r * sqrt(maxf(f, 0.0)))
			var off := slice_offset(y)
			var frac := -dy / h
			var colour := Color(0.306, 0.686, 0.369)
			if frac <= 0.66 and frac > 0.33:
				colour = Color(0.247, 0.561, 0.310)
			elif frac <= 0.33:
				colour = Color(0.851, 0.761, 0.478)
			var terrace := int(-dy) % 8 == 0 and frac <= 0.66
			if terrace:
				colour = Color(0.173, 0.420, 0.220)
			draw_rect(Rect2(float(p["x"]) - half + off, y, half * 2.0, 2.0), colour)
		dy += 2.0


func _draw_cloud(cloud: Dictionary, params: Dictionary) -> void:
	if not bool(cloud.get("active", true)):
		return
	var p := project_island(cloud)
	if not bool(p["visible"]) or float(p["r"]) < 1.0:
		return
	var horizon: float = params["horizon_y"]
	var s := _alt_scale()
	var r := float(p["r"]) * s
	var h := float(p["h"]) * s
	var dy := -h
	while dy <= 0.0:
		var y := float(p["y"]) + dy
		if y >= 0.0 and y < viewport_size.y:
			var f := 1.0 - (dy / h) * (dy / h)
			var half := maxf(1.0, r * sqrt(maxf(f, 0.0)))
			var off := slice_offset(y)
			var frac := -dy / h
			var colour := Color(0.957, 0.973, 1.0) if frac > 0.4 else Color(0.843, 0.894, 0.949)
			draw_rect(Rect2(float(p["x"]) - half + off, y, half * 2.0, 2.0), colour)
		dy += 2.0
	if float(cloud["z"]) < 12.0:
		draw_rect(Rect2(0, 0, viewport_size.x, viewport_size.y),
			Color(0.957, 0.973, 1.0, 0.30))


func _draw_cockpit_frame() -> void:
	draw_rect(Rect2(0, 0, viewport_size.x, 10), Color(0.063, 0.094, 0.125))
	draw_rect(Rect2(0, viewport_size.y - 10, viewport_size.x, 10), Color(0.063, 0.094, 0.125))
	draw_rect(Rect2(0, 0, 14, viewport_size.y), Color(0.063, 0.094, 0.125))
	draw_rect(Rect2(viewport_size.x - 14, 0, 14, viewport_size.y), Color(0.063, 0.094, 0.125))
	draw_colored_polygon(
		PackedVector2Array([
			Vector2(viewport_size.x / 2.0 - 14, viewport_size.y),
			Vector2(viewport_size.x / 2.0, viewport_size.y - 26),
			Vector2(viewport_size.x / 2.0 + 14, viewport_size.y),
		]),
		Color(0.169, 0.227, 0.282))


func _draw_space() -> void:
	# Deep space background.
	draw_rect(Rect2(0, 0, viewport_size.x, viewport_size.y), Color(0.012, 0.016, 0.043))
	# Nebula wisps: two slow layers, far tint and near streaks.
	var nebula_cols := [
		Color(0.10, 0.45, 0.50, 0.10),
		Color(0.85, 0.45, 0.15, 0.08),
		Color(0.55, 0.25, 0.65, 0.08),
		Color(0.15, 0.35, 0.65, 0.10),
	]
	for n in range(4):
		var par := 0.2 if n % 2 == 0 else 0.5
		var nx := fposmod(hash01(n * 41 + 3) * viewport_size.x + _time * speed * 4.0 * par,
			viewport_size.x + 320.0) - 160.0
		var ny := hash01(n * 23 + 7) * viewport_size.y
		draw_rect(Rect2(nx, ny, 320.0, 70.0), nebula_cols[n])
	# Stars: three layers at 0.2x / 0.5x / 1.0x parallax, scrolling
	# downward as the ship flies forward.
	for layer in range(3):
		var par2: float = STAR_LAYERS[layer]
		var count: int = STAR_COUNTS[layer]
		var size := float(mini(pixel_size, layer + 1))
		var alpha := 0.5 + 0.2 * float(layer)
		for i in range(count):
			var sx := hash01(i * 7 + layer * 131) * viewport_size.x
			var sy := fposmod(hash01(i * 13 + layer * 57) * viewport_size.y
				+ _time * speed * 12.0 * par2, viewport_size.y)
			draw_rect(Rect2(sx, sy, size, size), Color(1, 1, 1, alpha))
	if camera_mode == CameraMode.COCKPIT:
		_draw_cockpit_frame()
