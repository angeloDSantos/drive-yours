"""Render one still from render/scene.blend with rig overrides.

    flatpak run org.blender.Blender -b render/scene.blend --python render/shot.py -- \
        --cam CAM_S2 --set teardown=1 vlt=0.05 rim_t=0.4 --res 50 --samples 128 \
        --out render/out/s2_fan.png

--set takes any RIG custom property. --frame renders that frame of the timeline.
--mb 0/1 and --dof 0/1 override motion blur and depth of field (lookdev stills
use both off so the geometry can be read; the sequence turns them back on).
"""
import bpy, sys, os, time

ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
def arg(name, default=None):
    return ARGS[ARGS.index(name) + 1] if name in ARGS else default

sc = bpy.context.scene
rig = bpy.data.objects["RIG"]
if "--set" in ARGS:
    i = ARGS.index("--set") + 1
    while i < len(ARGS) and not ARGS[i].startswith("--"):
        k, v = ARGS[i].split("="); rig[k] = float(v); i += 1
if arg("--cam"): sc.camera = bpy.data.objects[arg("--cam")]
if arg("--res"): sc.render.resolution_percentage = int(arg("--res"))
if arg("--samples"): sc.cycles.samples = int(arg("--samples"))
if arg("--exposure"): sc.view_settings.exposure = float(arg("--exposure"))
if arg("--frame"): sc.frame_set(int(arg("--frame")))
if arg("--lens"): sc.camera.data.lens = float(arg("--lens"))
if arg("--fstop"): sc.camera.data.dof.aperture_fstop = float(arg("--fstop"))
if arg("--mb") is not None: sc.render.use_motion_blur = bool(int(arg("--mb")))
if arg("--dof") is not None: sc.camera.data.dof.use_dof = bool(int(arg("--dof")))
out = arg("--out", "render/out/frame.png")
if not os.path.isabs(out): out = os.path.join(os.path.dirname(bpy.data.filepath), "..", out)
sc.render.filepath = os.path.abspath(out)
# make sure drivers see the new property values
bpy.context.view_layer.update(); sc.frame_set(sc.frame_current)
t = time.time()
bpy.ops.render.render(write_still=True)
print("RENDERED", sc.render.filepath, "in", round(time.time() - t, 1), "s",
      "rig", {k: round(float(rig[k]), 3) for k in rig.keys()})
