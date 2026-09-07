"""Calibrate the tint so the render transmits what the button says.

    flatpak run org.blender.Blender -b render/scene.blend --python render/calibrate.py

Puts a white emitter behind the assembled pane, looks through it with an
orthographic camera, and measures transmitted / direct luminance in linear
light. First with no tint to find `clear_t` (Fresnel and dispersion losses of
the untinted laminate), then at VLT 70, 35, 20 and 5 to confirm each is within
one percent. Writes render/lookdev/calibration.md, stores clear_t on the RIG in
scene.blend and patches the default in build_scene.py so a rebuild keeps it.
"""
import bpy, os, re, math

ROOT = os.path.dirname(os.path.dirname(bpy.data.filepath))
OUTDIR = os.path.join(ROOT, "render", "lookdev"); os.makedirs(OUTDIR, exist_ok=True)
sc = bpy.context.scene
rig = bpy.data.objects["RIG"]; stack = bpy.data.objects["STACK"]
rig["teardown"] = 0.0

# only the pane, a white card and an ortho camera
for ob in sc.objects:
    ob.hide_render = ob.name not in ("PANE assembled",)
pane = bpy.data.objects["PANE assembled"]
for fc in list(pane.animation_data.drivers): pane.animation_data.drivers.remove(fc)
pane.hide_render = False
me = bpy.data.meshes.new("card"); me.from_pydata([(-2, 0, -1), (2, 0, -1), (2, 0, 3), (-2, 0, 3)], [], [(0, 1, 2, 3)])
card = bpy.data.objects.new("Cal card", me); sc.collection.objects.link(card)
card.location = (0.5, -0.6, 0)
m = bpy.data.materials.new("Cal white"); m.use_nodes = True
nt = m.node_tree
for n in list(nt.nodes): nt.nodes.remove(n)
out = nt.nodes.new("ShaderNodeOutputMaterial"); em = nt.nodes.new("ShaderNodeEmission")
em.inputs["Strength"].default_value = 1.0; nt.links.new(em.outputs[0], out.inputs["Surface"])
card.data.materials.append(m)
cd = bpy.data.cameras.new("cal"); cd.type = "ORTHO"; cd.ortho_scale = 1.6; cd.dof.use_dof = False
cam = bpy.data.objects.new("CAL cam", cd); sc.collection.objects.link(cam)
cam.location = (0.5, 2.0, stack.location.z); cam.rotation_euler = (math.radians(90), 0, math.radians(180))
sc.camera = cam
w = bpy.data.worlds.new("black"); w.use_nodes = True
w.node_tree.nodes["Background"].inputs["Color"].default_value = (0, 0, 0, 1); sc.world = w
sc.render.resolution_x, sc.render.resolution_y = 320, 180; sc.render.resolution_percentage = 100
sc.cycles.samples = 256; sc.cycles.use_denoising = False
sc.render.use_motion_blur = False; sc.render.use_compositing = False
sc.render.image_settings.file_format = "OPEN_EXR"; sc.render.image_settings.color_depth = "32"
sc.view_settings.view_transform = "Standard"; sc.view_settings.look = "None"; sc.view_settings.exposure = 0

def measure(tag):
    path = os.path.join(OUTDIR, f"cal_{tag}.exr"); sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    img = bpy.data.images.load(path); px = img.pixels[:]; W, H = img.size
    def patch(x0, x1, y0, y1):
        vals = []
        for y in range(y0, y1):
            for x in range(x0, x1):
                i = (y * W + x) * 4; vals.append((px[i] + px[i + 1] + px[i + 2]) / 3)
        return sum(vals) / len(vals)
    # ortho scale 1.6 m over 320 px: 200 px/m. Pane centre at frame centre.
    through = patch(W // 2 - 30, W // 2 + 30, H // 2 - 15, H // 2 + 15)
    direct = patch(10, 40, H // 2 - 15, H // 2 + 15)        # beside the pane, card only
    bpy.data.images.remove(img); os.remove(path)
    return through / direct

rig["vlt"] = 1.0; sc.frame_set(1)
clear = measure("clear")
rig["clear_t"] = clear
rows = []
for v in (0.70, 0.35, 0.20, 0.05):
    rig["vlt"] = v; sc.frame_set(1)
    t = measure(f"vlt{int(v * 100)}")
    rows.append((v, t))
    print(f"CAL vlt {v:.2f} measured {t:.4f} error {100 * (t - v):+.2f} pts")

md = ["# Tint calibration", "",
      f"Measured on {bpy.app.version_string}, Cycles, 256 samples, orthographic through the assembled laminate against a unit white emitter, linear light.", "",
      f"- Untinted laminate transmission (`clear_t`): **{clear:.4f}**",
      "- Absorption density in the ceramic volume: `-ln(vlt / clear_t) / thickness`", "",
      "| Button says | Render transmits | Error |", "|---|---|---|"]
for v, t in rows: md.append(f"| VLT {int(v * 100)} | {100 * t:.2f} % | {100 * (t - v):+.2f} pts |")
md.append(""); md.append("Acceptance: every row within 1 point. " + ("**Pass.**" if all(abs(t - v) <= 0.01 for v, t in rows) else "**Fail, see rows.**"))
open(os.path.join(OUTDIR, "calibration.md"), "w").write("\n".join(md) + "\n")

# keep the number: in the build script default and in the saved scene
bs = os.path.join(ROOT, "render", "build_scene.py"); src = open(bs).read()
src2 = re.sub(r'rig\["clear_t"\] = [0-9.]+', f'rig["clear_t"] = {clear:.4f}', src)
if src2 != src: open(bs, "w").write(src2)
print("CAL clear_t", round(clear, 4), "written", os.path.join(OUTDIR, "calibration.md"))
