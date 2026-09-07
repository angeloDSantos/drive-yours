"""Build the Drive Yours Blender scene from scratch.

    flatpak run org.blender.Blender -b --python render/build_scene.py -- --out render/scene.blend

The scene is code: nothing in it is hand-modelled, so it can be rebuilt after
every change and the .blend stays out of git. What it makes:

  * The rear door window, cut to the silhouette the site already traced from the
    cabin plate (glass-hero/index.html, path #win), curved like real door glass.
  * Seven plies cut from that one outline: outer glass, PVB, inner glass, then the
    film stack (adhesive, nano-ceramic, PET, hardcoat). Real thicknesses, with a
    render floor for the films so their edges exist for the camera.
  * Materials: dispersive glass, milky PVB, tint as volume absorption whose density
    is driven from one property `vlt` on the RIG empty (Beer-Lambert, calibrated by
    render/calibrate.py), iridescent PET, glossy hardcoat.
  * The teardown rig: RIG["teardown"] 0..1 lifts the pane into the cabin, turns it
    three-quarter and fans the plies along their normals. Every ply keeps the
    silhouette because every ply is the same mesh outline.
  * A stand-in set: door card with quilted leather and the amber strip, chrome
    handle, rubber and chrome window surrounds, headliner, seat, wet pavement and a
    river parapet outside, the Tower Bridge plate on a distant card, the night
    HDRI for reflections, key / fill / travelling rim lights.
  * Cameras CAM_S2 (interior) and CAM_S3 (exterior), Cycles on OptiX, compositor.

The purchased car body drops into this scene later; the window and its rig are
the part that has to be exact and are built here.
"""
import bpy, bmesh, math, sys, os
from mathutils import Vector
from mathutils.geometry import delaunay_2d_cdt

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
def arg(name, default):
    return ARGS[ARGS.index(name) + 1] if name in ARGS else default
OUT = arg("--out", os.path.join(ROOT, "render", "scene.blend"))

# ----------------------------------------------------------------------------
# The window outline, from glass-hero/index.html path #win (1163 x 423 units,
# viewed from inside the cabin: front edge / B-pillar on the left, roof arch
# sweeping down to the C-pillar on the right, beltline along the bottom).
# ----------------------------------------------------------------------------
WIN_SVG = [(0,29),(8.3,11),(20,2.8),(115,0.6),(280,0),(439,5),(575,13.6),(661,22.9),
    (770,40.4),(850,58.5),(915,77.7),(977,101),(1039,130.5),(1111,173.8),(1135.4,195),
    (1156,226),(1162.6,248),(1163,275),(1163,407),(1103.3,407.6),(1043.3,408),(983.3,410),
    (923.3,410.6),(863.3,411),(803.3,411.6),(743.3,413),(683.3,413),(623.3,413.4),
    (563.3,414.6),(503.3,415.6),(443.3,416),(383.3,417),(323.3,416),(263.3,417),
    (203.3,418),(143.3,420),(83.3,422),(23.3,422.6),(0,423)]
WIN_W = 1.00                      # metres along the beltline
SCALE = WIN_W / 1163.0
WIN_H = 423 * SCALE               # 0.364 m
BELT_Z = 0.95                     # beltline height above the ground
CENTRE = Vector((WIN_W / 2, 0.0, BELT_Z + WIN_H / 2))   # STACK origin
R_CURVE = 2.2                     # cylinder radius of the door glass, axis along X
Z_AXIS_OFF = -0.15                # axis sits low so the top leans in more than the bottom

# Plies, outside (street, +Y) to inside (cabin, -Y). Thickness in metres.
FILM_FLOOR = 0.00035
PLIES = [
    ("Outer glass",   2.1e-3,  "glass"),
    ("PVB interlayer",0.76e-3, "pvb"),
    ("Inner glass",   1.6e-3,  "glass"),
    ("Adhesive",      10e-6,   "adhesive"),
    ("Ceramic film",  36e-6,   "ceramic"),
    ("PET ply",       23e-6,   "pet"),
    ("Hardcoat",      4e-6,    "hardcoat"),
]

def outline_2d():
    """Outline in STACK-local (x, z), metres, centred, y=0. Smoothed on the arch,
    resampled to even spacing, counter-clockwise seen from inside (-Y)."""
    pts = [Vector((x * SCALE - WIN_W / 2, (423 - y) * SCALE - WIN_H / 2)) for x, y in WIN_SVG]
    # Chaikin on the arch only (indices 2..17), corners elsewhere stay crisp.
    def chaikin(seg):
        out = [seg[0]]
        for a, b in zip(seg[:-1], seg[1:]):
            out += [a.lerp(b, 0.25), a.lerp(b, 0.75)]
        out.append(seg[-1]); return out
    arch = pts[2:18]
    for _ in range(3): arch = chaikin(arch)
    pts = pts[:2] + arch + pts[18:]
    # resample every ~12 mm around the closed loop
    loop = pts + [pts[0]]
    length = sum((b - a).length for a, b in zip(loop[:-1], loop[1:]))
    n = int(length / 0.012)
    step = length / n
    out, acc, i = [pts[0].copy()], 0.0, 0
    target = step
    while len(out) < n:
        a, b = loop[i], loop[i + 1]
        seg = (b - a).length
        if acc + seg >= target:
            out.append(a.lerp(b, (target - acc) / seg)); target += step
        else:
            acc += seg; i += 1
    # SVG y grows downward, we flipped it, so the loop is now counter-clockwise
    # in (x, z) as seen from -Y (inside the cabin). Keep it that way.
    area = sum(p.x * q.y - q.x * p.y for p, q in zip(out, out[1:] + out[:1]))
    if area < 0: out.reverse()
    return out

def inside(pt, poly):
    x, y, c = pt.x, pt.y, False
    for p, q in zip(poly, poly[1:] + poly[:1]):
        if (p.y > y) != (q.y > y) and x < (q.x - p.x) * (y - p.y) / (q.y - p.y) + p.x:
            c = not c
    return c

def curve_point(x, z):
    """Map a flat (x, z) onto the door-glass cylinder. Returns point, outward normal."""
    dz = z - Z_AXIS_OFF
    y = -R_CURVE + math.sqrt(max(R_CURVE * R_CURVE - dz * dz, 0.0))
    n = Vector((0.0, y + R_CURVE, dz)).normalized()
    return Vector((x, y, z)), n

def ply_mesh(name, thickness, outline, grid=0.02):
    """A solid ply: triangulated curved faces, quad side wall, sharp side edges."""
    xs = [p.x for p in outline]; zs = [p.y for p in outline]
    interior = []
    x = min(xs) + grid / 2
    while x < max(xs):
        z = min(zs) + grid / 2
        while z < max(zs):
            v = Vector((x, z))
            if inside(v, outline) and min((v - o).length for o in outline) > grid * 0.45:
                interior.append(v)
            z += grid
        x += grid
    verts2 = outline + interior
    res = delaunay_2d_cdt(verts2, [], [list(range(len(outline)))], 1, 1e-6)
    v2, faces, orig = res[0], res[2], res[3]
    n_out = len(outline)
    front, back, normals = [], [], []
    for v in v2:
        p, n = curve_point(v.x, v.y)
        front.append(p + n * (thickness / 2)); back.append(p - n * (thickness / 2))
    N = len(v2)
    verts = front + back
    polys = []
    for f in faces:
        polys.append(tuple(f))                       # front, outward
        polys.append(tuple(reversed([i + N for i in f])))
    # outline vertex order in the output
    ring = [orig[i][0] for i in range(n_out)]
    for a, b in zip(ring, ring[1:] + ring[:1]):
        polys.append((b, a, a + N, b + N))
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in verts], [], polys)
    me.update()
    # consistent outward normals: Cycles decides volume enter/exit from the
    # geometric normal, and inward normals leave the ray "inside" the tint forever
    bm = bmesh.new(); bm.from_mesh(me)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me); bm.free(); me.update()
    side_start = 2 * len(faces)
    for i, p in enumerate(me.polygons):
        p.use_smooth = i < side_start
    ring_set = set(ring)
    for e in me.edges:
        a, b = e.vertices
        if (a in ring_set and b in ring_set) or (a - N in ring_set and b - N in ring_set):
            e.use_edge_sharp = True
    me.validate()
    ob = bpy.data.objects.new(name, me)
    bev = ob.modifiers.new("Bevel", "BEVEL")
    bev.width = min(0.0002, thickness * 0.25); bev.segments = 2
    bev.limit_method = "ANGLE"; bev.angle_limit = math.radians(40); bev.use_clamp_overlap = True
    return ob

def strip_mesh(name, inner, outer, y, smooth=True):
    """Quad strip between two loops of equal length, laid in the plane y."""
    n = len(inner)
    verts = [(p.x, y, p.y) for p in inner] + [(p.x, y, p.y) for p in outer]
    polys = [(i, (i + 1) % n, n + (i + 1) % n, n + i) for i in range(n)]
    me = bpy.data.meshes.new(name); me.from_pydata(verts, [], polys); me.update()
    for p in me.polygons: p.use_smooth = smooth
    return bpy.data.objects.new(name, me)

def offset_loop(loop, d):
    """Offset a closed 2-D loop outward by d (per-vertex bisector)."""
    n = len(loop); out = []
    for i in range(n):
        p, q, r = loop[i - 1], loop[i], loop[(i + 1) % n]
        t1 = (q - p).normalized(); t2 = (r - q).normalized()
        n1 = Vector((t1.y, -t1.x)); n2 = Vector((t2.y, -t2.x))   # outward for CCW loop
        nb = (n1 + n2)
        nb = nb.normalized() if nb.length > 1e-6 else n1
        cos_half = max(nb.dot(n1), 0.3)
        out.append(q + nb * (d / cos_half))
    return out

def project_to_rect(loop, rect):
    """Project each loop point radially from the origin onto the rectangle
    (x0, x1, z0, z1). Same count as the loop, so a strip can join them."""
    x0, x1, z0, z1 = rect; out = []
    for p in loop:
        d = p.normalized() if p.length > 1e-9 else Vector((1, 0))
        ts = []
        if d.x > 1e-9: ts.append(x1 / d.x)
        if d.x < -1e-9: ts.append(x0 / d.x)
        if d.y > 1e-9: ts.append(z1 / d.y)
        if d.y < -1e-9: ts.append(z0 / d.y)
        out.append(d * min(ts))
    return out

def box(name, size, loc, bevel=0.0):
    bm = bmesh.new(); bmesh.ops.create_cube(bm, size=1.0)
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    ob = bpy.data.objects.new(name, me); ob.scale = size; ob.location = loc
    if bevel:
        b = ob.modifiers.new("Bevel", "BEVEL"); b.width = bevel; b.segments = 4
    return ob

def plane(name, sx, sy, loc, rot=(0, 0, 0)):
    me = bpy.data.meshes.new(name)
    me.from_pydata([(-sx/2,-sy/2,0),(sx/2,-sy/2,0),(sx/2,sy/2,0),(-sx/2,sy/2,0)], [], [(0,1,2,3)])
    ob = bpy.data.objects.new(name, me); ob.location = loc; ob.rotation_euler = rot
    return ob

def link(ob, coll):
    coll.objects.link(ob); return ob

# ----------------------------------------------------------------------------
# Materials
# ----------------------------------------------------------------------------
def new_mat(name):
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes): nt.nodes.remove(n)
    out = nt.nodes.new("ShaderNodeOutputMaterial"); out.location = (600, 0)
    return m, nt, out

def shadow_transparent(nt, surface_socket, out):
    """Shadow and diffuse rays pass straight through: no caustic noise, the
    interior is lit through the glass, the volume still tints the shadow."""
    lp = nt.nodes.new("ShaderNodeLightPath"); lp.location = (0, 300)
    add = nt.nodes.new("ShaderNodeMath"); add.operation = "MAXIMUM"; add.location = (200, 300)
    nt.links.new(lp.outputs["Is Shadow Ray"], add.inputs[0])
    nt.links.new(lp.outputs["Is Diffuse Ray"], add.inputs[1])
    tr = nt.nodes.new("ShaderNodeBsdfTransparent"); tr.location = (200, 150)
    mix = nt.nodes.new("ShaderNodeMixShader"); mix.location = (400, 0)
    nt.links.new(add.outputs[0], mix.inputs[0])
    nt.links.new(surface_socket, mix.inputs[1])
    nt.links.new(tr.outputs[0], mix.inputs[2])
    nt.links.new(mix.outputs[0], out.inputs["Surface"])

def dispersive_glass(nt, ior=1.52, spread=0.012, rough=0.02):
    """Three glass lobes at IOR-spread, IOR, IOR+spread carrying R, G, B."""
    add1 = nt.nodes.new("ShaderNodeAddShader"); add1.location = (-200, 0)
    add2 = nt.nodes.new("ShaderNodeAddShader"); add2.location = (0, 0)
    for k, (col, di) in enumerate((((1,0,0,1), -spread), ((0,1,0,1), 0.0), ((0,0,1,1), spread))):
        g = nt.nodes.new("ShaderNodeBsdfGlass"); g.location = (-500, 200 - 200 * k)
        g.inputs["Color"].default_value = col; g.inputs["IOR"].default_value = ior + di
        g.inputs["Roughness"].default_value = rough
        if k == 0: nt.links.new(g.outputs[0], add1.inputs[0])
        elif k == 1: nt.links.new(g.outputs[0], add1.inputs[1])
        else: nt.links.new(g.outputs[0], add2.inputs[1])
    nt.links.new(add1.outputs[0], add2.inputs[0])
    return add2.outputs[0]

def mat_glass(name):
    m, nt, out = new_mat(name)
    shadow_transparent(nt, dispersive_glass(nt), out)
    return m

def principled_transmission(nt, ior, rough, coat=0.0, film_nm=0.0, film_ior=1.4, color=(1,1,1,1)):
    p = nt.nodes.new("ShaderNodeBsdfPrincipled"); p.location = (-200, 0)
    p.inputs["Base Color"].default_value = color
    p.inputs["Transmission Weight"].default_value = 1.0
    p.inputs["IOR"].default_value = ior; p.inputs["Roughness"].default_value = rough
    p.inputs["Coat Weight"].default_value = coat
    if film_nm:
        p.inputs["Thin Film Thickness"].default_value = film_nm
        p.inputs["Thin Film IOR"].default_value = film_ior
    return p

def mat_pvb(name):
    m, nt, out = new_mat(name)
    p = principled_transmission(nt, 1.48, 0.05, color=(1.0, 0.985, 0.96, 1))
    shadow_transparent(nt, p.outputs[0], out)
    return m

def mat_adhesive(name):
    m, nt, out = new_mat(name)
    p = principled_transmission(nt, 1.47, 0.04)
    shadow_transparent(nt, p.outputs[0], out); return m

def mat_ceramic(name, thickness, rig, glass=False):
    """Tint as absorption. density = -ln(vlt / clear) / t, so the whole stack
    transmits `vlt` once `clear` (the stack's transmission with no tint) is
    measured by render/calibrate.py and stored on RIG["clear_t"]."""
    m, nt, out = new_mat(name)
    if glass: shadow_transparent(nt, dispersive_glass(nt), out)
    else:
        p = principled_transmission(nt, 1.57, 0.01)
        shadow_transparent(nt, p.outputs[0], out)
    va = nt.nodes.new("ShaderNodeVolumeAbsorption"); va.location = (200, -300)
    va.inputs["Color"].default_value = (0.0, 0.006, 0.02, 1)   # sigma = density*(1-colour): near black, a hair cool
    nt.links.new(va.outputs[0], out.inputs["Volume"])
    fc = va.inputs["Density"].driver_add("default_value")
    d = fc.driver; d.type = "SCRIPTED"
    for vname, path in (("vlt", '["vlt"]'), ("clear", '["clear_t"]')):
        v = d.variables.new(); v.name = vname; v.type = "SINGLE_PROP"
        v.targets[0].id_type = "OBJECT"; v.targets[0].id = rig; v.targets[0].data_path = path
    d.expression = f"-log(max(min(vlt / clear, 0.999), 0.001)) / {thickness:.6g}"
    return m

def mat_pet(name):
    m, nt, out = new_mat(name)
    p = principled_transmission(nt, 1.57, 0.01, film_nm=380.0, film_ior=1.38)
    shadow_transparent(nt, p.outputs[0], out); return m

def mat_hardcoat(name):
    m, nt, out = new_mat(name)
    p = principled_transmission(nt, 1.50, 0.0, coat=1.0)
    shadow_transparent(nt, p.outputs[0], out); return m

def mat_leather(name, quilt=True):
    m, nt, out = new_mat(name)
    p = nt.nodes.new("ShaderNodeBsdfPrincipled"); p.location = (300, 0)
    p.inputs["Base Color"].default_value = (0.012, 0.011, 0.011, 1)
    p.inputs["Roughness"].default_value = 0.42
    p.inputs["Sheen Weight"].default_value = 0.15
    p.inputs["Specular IOR Level"].default_value = 0.6
    nt.links.new(p.outputs[0], out.inputs["Surface"])
    tc = nt.nodes.new("ShaderNodeTexCoord"); tc.location = (-900, 0)
    grain = nt.nodes.new("ShaderNodeTexNoise"); grain.location = (-600, -250)
    grain.inputs["Scale"].default_value = 900.0; grain.inputs["Detail"].default_value = 6.0
    nt.links.new(tc.outputs["Object"], grain.inputs["Vector"])
    bump = nt.nodes.new("ShaderNodeBump"); bump.location = (100, -250)
    bump.inputs["Strength"].default_value = 0.08; bump.inputs["Distance"].default_value = 0.0005
    nt.links.new(grain.outputs["Fac"], bump.inputs["Height"])
    if quilt:
        # diamond quilting: two wave textures at +-45 degrees multiplied, softened
        mp = nt.nodes.new("ShaderNodeMapping"); mp.location = (-700, 200)
        mp.inputs["Rotation"].default_value = (0, math.radians(45), 0)
        mp.inputs["Scale"].default_value = (1, 1, 1)
        nt.links.new(tc.outputs["Object"], mp.inputs["Vector"])
        w1 = nt.nodes.new("ShaderNodeTexWave"); w1.location = (-450, 300)
        w1.bands_direction = "X"; w1.wave_profile = "SIN"; w1.inputs["Scale"].default_value = 9.0
        w2 = nt.nodes.new("ShaderNodeTexWave"); w2.location = (-450, 100)
        w2.bands_direction = "Z"; w2.wave_profile = "SIN"; w2.inputs["Scale"].default_value = 9.0
        nt.links.new(mp.outputs[0], w1.inputs["Vector"]); nt.links.new(mp.outputs[0], w2.inputs["Vector"])
        mul = nt.nodes.new("ShaderNodeMath"); mul.operation = "MULTIPLY"; mul.location = (-250, 200)
        nt.links.new(w1.outputs["Fac"], mul.inputs[0]); nt.links.new(w2.outputs["Fac"], mul.inputs[1])
        pw = nt.nodes.new("ShaderNodeMath"); pw.operation = "POWER"; pw.location = (-100, 200)
        pw.inputs[1].default_value = 0.6
        nt.links.new(mul.outputs[0], pw.inputs[0])
        qb = nt.nodes.new("ShaderNodeBump"); qb.location = (100, 0)
        qb.inputs["Strength"].default_value = 0.6; qb.inputs["Distance"].default_value = 0.007
        nt.links.new(pw.outputs[0], qb.inputs["Height"]); nt.links.new(bump.outputs[0], qb.inputs["Normal"])
        nt.links.new(qb.outputs[0], p.inputs["Normal"])
    else:
        nt.links.new(bump.outputs[0], p.inputs["Normal"])
    return m

def mat_simple(name, color, rough, metallic=0.0, coat=0.0, emission=None, strength=0.0):
    m, nt, out = new_mat(name)
    p = nt.nodes.new("ShaderNodeBsdfPrincipled"); p.location = (300, 0)
    p.inputs["Base Color"].default_value = color; p.inputs["Roughness"].default_value = rough
    p.inputs["Metallic"].default_value = metallic; p.inputs["Coat Weight"].default_value = coat
    p.inputs["Coat Roughness"].default_value = 0.03
    if emission:
        p.inputs["Emission Color"].default_value = emission
        p.inputs["Emission Strength"].default_value = strength
    nt.links.new(p.outputs[0], out.inputs["Surface"]); return m

def mat_wet_ground(name):
    m, nt, out = new_mat(name)
    p = nt.nodes.new("ShaderNodeBsdfPrincipled"); p.location = (300, 0)
    p.inputs["Base Color"].default_value = (0.02, 0.02, 0.022, 1)
    p.inputs["Specular IOR Level"].default_value = 0.7
    tc = nt.nodes.new("ShaderNodeTexCoord"); tc.location = (-800, 0)
    n1 = nt.nodes.new("ShaderNodeTexNoise"); n1.location = (-500, 100)
    n1.inputs["Scale"].default_value = 3.0; n1.inputs["Detail"].default_value = 8.0
    nt.links.new(tc.outputs["Object"], n1.inputs["Vector"])
    ramp = nt.nodes.new("ShaderNodeValToRGB"); ramp.location = (-250, 100)
    ramp.color_ramp.elements[0].position = 0.42; ramp.color_ramp.elements[1].position = 0.6
    ramp.color_ramp.elements[0].color = (0.05, 0.05, 0.05, 1)    # puddle: mirror
    ramp.color_ramp.elements[1].color = (0.55, 0.55, 0.55, 1)    # wet stone
    nt.links.new(n1.outputs["Fac"], ramp.inputs[0])
    nt.links.new(ramp.outputs[0], p.inputs["Roughness"])
    n2 = nt.nodes.new("ShaderNodeTexNoise"); n2.location = (-500, -200)
    n2.inputs["Scale"].default_value = 60.0; n2.inputs["Detail"].default_value = 10.0
    nt.links.new(tc.outputs["Object"], n2.inputs["Vector"])
    b = nt.nodes.new("ShaderNodeBump"); b.location = (0, -200)
    b.inputs["Strength"].default_value = 0.25; b.inputs["Distance"].default_value = 0.01
    nt.links.new(n2.outputs["Fac"], b.inputs["Height"])
    mul = nt.nodes.new("ShaderNodeMath"); mul.operation = "MULTIPLY"; mul.location = (-100, 50)
    nt.links.new(ramp.outputs[0], mul.inputs[0]); mul.inputs[1].default_value = 1.0
    nt.links.new(b.outputs[0], p.inputs["Normal"])
    nt.links.new(p.outputs[0], out.inputs["Surface"]); return m

def mat_plate(name, path, strength):
    m, nt, out = new_mat(name)
    img = bpy.data.images.load(path)
    tex = nt.nodes.new("ShaderNodeTexImage"); tex.image = img; tex.location = (-300, 0)
    tc = nt.nodes.new("ShaderNodeTexCoord"); tc.location = (-600, 0)
    nt.links.new(tc.outputs["Generated"], tex.inputs["Vector"])   # the card has no UVs
    em = nt.nodes.new("ShaderNodeEmission"); em.location = (100, 0)
    em.inputs["Strength"].default_value = strength
    nt.links.new(tex.outputs["Color"], em.inputs["Color"])
    nt.links.new(em.outputs[0], out.inputs["Surface"]); return m

# ----------------------------------------------------------------------------
# Drivers
# ----------------------------------------------------------------------------
def drive(ob, path, index, expr, rig, names=("teardown",)):
    fc = ob.driver_add(path, index) if index is not None else ob.driver_add(path)
    d = fc.driver; d.type = "SCRIPTED"
    for nm in names:
        v = d.variables.new(); v.name = nm; v.type = "SINGLE_PROP"
        v.targets[0].id_type = "OBJECT"; v.targets[0].id = rig; v.targets[0].data_path = f'["{nm}"]'
    d.expression = expr
    return d

# ----------------------------------------------------------------------------
# Build
# ----------------------------------------------------------------------------
def build():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.name = "DriveYours"
    sc.unit_settings.system = "METRIC"; sc.unit_settings.length_unit = "MILLIMETERS"

    C = {}
    for nm in ("Glass", "Rig", "Set", "Outside", "Lights", "Cameras"):
        C[nm] = bpy.data.collections.new(nm); sc.collection.children.link(C[nm])

    # -- rig -----------------------------------------------------------------
    rig = bpy.data.objects.new("RIG", None); rig.empty_display_type = "PLAIN_AXES"
    rig.location = CENTRE; link(rig, C["Rig"])
    rig["teardown"] = 0.0; rig["vlt"] = 0.05; rig["clear_t"] = 0.9173
    rig["fan_gap"] = 0.06; rig["fan_twist"] = 4.0; rig["lift"] = 0.16; rig["turn"] = 55.0
    rig["rim_t"] = 0.5; rig["window"] = 1.0
    for k, (lo, hi, desc) in {
        "teardown": (0, 1, "0 pane in the door, 1 fully exploded"),
        "vlt": (0.01, 1, "visible light transmission of the whole stack"),
        "clear_t": (0.5, 1, "measured transmission of the untinted stack, set by calibrate.py"),
        "fan_gap": (0, 0.2, "metres between plies at teardown 1"),
        "fan_twist": (0, 15, "degrees of twist per ply at teardown 1"),
        "lift": (0, 1, "metres the pane comes into the cabin"),
        "turn": (0, 90, "degrees the pane turns toward three-quarter"),
        "rim_t": (0, 1, "position of the passing headlight along its path"),
        "window": (0, 1, "shot 3: 0 glass down in the door, 1 closed"),
    }.items():
        ui = rig.id_properties_ui(k); ui.update(min=lo, max=hi, soft_min=lo, soft_max=hi, description=desc)

    stack = bpy.data.objects.new("STACK", None); stack.empty_display_type = "CUBE"
    stack.empty_display_size = 0.1; stack.location = CENTRE; link(stack, C["Rig"])
    # detach: into the cabin (-Y), then turn toward three-quarter
    drive(stack, "location", 1, "CENTRE_Y - lift * min(max(teardown / 0.35, 0), 1)".replace("CENTRE_Y", f"{CENTRE.y:.4f}"), rig, ("teardown", "lift"))
    drive(stack, "location", 0, f"{CENTRE.x:.4f} + 0.08 * min(max(teardown / 0.35, 0), 1)", rig, ("teardown",))
    drive(stack, "rotation_euler", 2, "radians(turn) * min(max(teardown / 0.35, 0), 1)", rig, ("teardown", "turn"))
    drive(stack, "rotation_euler", 0, "radians(-6) * min(max(teardown / 0.35, 0), 1)", rig, ("teardown",))

    # -- window plies ----------------------------------------------------------
    outline = outline_2d()
    mats = {
        "glass": mat_glass("Glass ply"), "pvb": mat_pvb("PVB"), "adhesive": mat_adhesive("Adhesive"),
        "pet": mat_pet("PET"), "hardcoat": mat_hardcoat("Hardcoat"),
    }
    total = 0.0; thick = []
    for nm, t, kind in PLIES:
        tr = t if kind in ("glass", "pvb") else max(t, FILM_FLOOR)
        thick.append(tr); total += tr
    mats["ceramic"] = mat_ceramic("Ceramic tint", thick[4], rig)
    # One solid for the assembled pane (teardown <= 0.3). Seven coincident solids
    # confuse Cycles' volume stack, and bonded layers have no air interfaces anyway.
    pane = ply_mesh("PANE assembled", total, outline)
    pane.data.materials.append(mat_ceramic("Laminated pane", total, rig, glass=True))
    pane.parent = stack; pane["thickness_render_m"] = total
    drive(pane, "hide_render", None, "teardown > 0.3", rig, ("teardown",))
    drive(pane, "hide_viewport", None, "teardown > 0.3", rig, ("teardown",))
    link(pane, C["Glass"])
    y = total / 2
    for i, ((nm, t, kind), tr) in enumerate(zip(PLIES, thick)):
        yc = y - tr / 2; y -= tr
        ob = ply_mesh(f"P{i} {nm}", tr, outline)
        ob.data.materials.append(mats[kind])
        ob.parent = stack
        ob["ply_index"] = i; ob["thickness_real_m"] = t; ob["thickness_render_m"] = tr
        # fan: from the middle ply outward, along the normal, with a little twist
        drive(ob, "location", 1, f"{yc:.6f} + ({i} - 3) * (0.0006 + fan_gap * min(max((teardown - 0.3) / 0.7, 0), 1))", rig, ("teardown", "fan_gap"))
        drive(ob, "hide_render", None, "teardown <= 0.3", rig, ("teardown",))
        drive(ob, "hide_viewport", None, "teardown <= 0.3", rig, ("teardown",))
        drive(ob, "rotation_euler", 2, f"radians(fan_twist) * ({i} - 3) * min(max((teardown - 0.3) / 0.7, 0), 1)", rig, ("teardown", "fan_twist"))
        link(ob, C["Glass"])

    # -- the door and cabin (stand-in until the car model arrives) -------------
    leather_q = mat_leather("Leather quilted"); leather = mat_leather("Leather", quilt=False)
    rubber = mat_simple("Rubber", (0.01, 0.01, 0.01, 1), 0.55)
    chrome = mat_simple("Chrome", (0.9, 0.9, 0.9, 1), 0.12, metallic=1.0)
    paint = mat_simple("Black paint", (0.004, 0.004, 0.005, 1), 0.08, coat=1.0)
    headliner = mat_simple("Headliner", (0.03, 0.03, 0.03, 1), 0.8)
    amber = mat_simple("Amber strip", (1, 0.5, 0.15, 1), 0.5, emission=(1.0, 0.42, 0.10, 1), strength=25.0)

    # window surround as a strip from the outline to an expanded rectangle,
    # so the aperture is exactly the glass silhouette. Local to STACK centre.
    xs = [p.x for p in outline]; zs = [p.y for p in outline]
    rect = (min(xs) - 0.06, max(xs) + 0.06, min(zs) - 0.06, max(zs) + 0.06)
    ring_out = project_to_rect(outline, rect)
    def world(loop): return [Vector((p.x + CENTRE.x, p.y + CENTRE.z)) for p in loop]
    inner_w = world(outline); ring_w = world(ring_out)
    seal_in = strip_mesh("Door frame inner", inner_w, ring_w, -0.03); seal_in.data.materials.append(rubber)
    seal_out = strip_mesh("Door frame outer", inner_w, ring_w, 0.012); seal_out.data.materials.append(paint)
    link(seal_in, C["Set"]); link(seal_out, C["Set"])
    # chrome trim outside and rubber lip inside, tubes along an offset outline
    for nm, d, depth, yy, mat in (("Chrome trim", 0.012, 0.005, 0.014, chrome), ("Rubber lip", 0.006, 0.004, -0.012, rubber)):
        cu = bpy.data.curves.new(nm, "CURVE"); cu.dimensions = "3D"
        cu.bevel_depth = depth; cu.bevel_resolution = 6; cu.fill_mode = "FULL"
        sp = cu.splines.new("POLY"); loop = offset_loop(outline, d); sp.points.add(len(loop) - 1)
        for pt, p in zip(sp.points, loop): pt.co = (p.x + CENTRE.x, yy, p.y + CENTRE.z, 1.0)
        sp.use_cyclic_u = True; sp.use_smooth = True
        ob = bpy.data.objects.new(nm, cu); ob.data.materials.append(mat); link(ob, C["Set"])

    x0, x1, z0, z1 = rect[0] + CENTRE.x, rect[1] + CENTRE.x, rect[2] + CENTRE.z, rect[3] + CENTRE.z
    CAR_X0, CAR_X1, FLOOR, ROOF, SILL = -0.6, 1.9, 0.40, 1.50, 0.28
    def wall_pieces(prefix, yy, mat_lower, mat_upper, lower_z):
        """Flat pieces around the window rectangle so the wall has the hole."""
        pieces = [
            (f"{prefix} below", (CAR_X0, CAR_X1, lower_z, z0), mat_lower),
            (f"{prefix} above", (CAR_X0, CAR_X1, z1, ROOF), mat_upper),
            (f"{prefix} front", (CAR_X0, x0, z0, z1), mat_upper),
            (f"{prefix} rear", (x1, CAR_X1, z0, z1), mat_upper),
        ]
        for nm, (a, b, c, d), mat in pieces:
            me = bpy.data.meshes.new(nm)
            me.from_pydata([(a, yy, c), (b, yy, c), (b, yy, d), (a, yy, d)], [], [(0, 1, 2, 3)])
            ob = bpy.data.objects.new(nm, me); ob.data.materials.append(mat); link(ob, C["Set"])
    wall_pieces("Door card", -0.03, leather_q, headliner, FLOOR)
    wall_pieces("Door skin", 0.012, paint, paint, SILL)
    # interior door card: a real slab with the quilting, proud of the wall
    card = box("Door card slab", (WIN_W + 0.3, 0.05, 0.42), (CENTRE.x, -0.075, BELT_Z - 0.26), bevel=0.02)
    card.data.materials.append(leather_q); link(card, C["Set"])
    # amber strip along the beltline, and its light
    strip = box("Amber strip", (WIN_W + 0.05, 0.004, 0.006), (CENTRE.x, -0.045, BELT_Z - 0.035))
    strip.data.materials.append(amber); link(strip, C["Set"])
    handle = box("Door handle", (0.17, 0.035, 0.03), (CENTRE.x - 0.25, -0.10, BELT_Z - 0.20), bevel=0.012)
    handle.data.materials.append(chrome); link(handle, C["Set"])
    # cabin shell
    for nm, sx, sy, loc, rot, mat in (
        ("Headliner", CAR_X1 - CAR_X0, 1.6, ((CAR_X0 + CAR_X1) / 2, -0.85, ROOF), (0, 0, 0), headliner),
        ("Floor", CAR_X1 - CAR_X0, 1.6, ((CAR_X0 + CAR_X1) / 2, -0.85, FLOOR), (0, 0, 0), headliner),
        ("Far door", CAR_X1 - CAR_X0, ROOF - FLOOR, ((CAR_X0 + CAR_X1) / 2, -1.65, (FLOOR + ROOF) / 2), (math.radians(90), 0, 0), leather),
        ("Rear bulkhead", 1.6, ROOF - FLOOR, (CAR_X1, -0.85, (FLOOR + ROOF) / 2), (math.radians(90), 0, math.radians(90)), leather),
    ):
        ob = plane(nm, sx, sy, loc, rot); ob.data.materials.append(mat); link(ob, C["Set"])
    seat = box("Rear seat", (0.55, 0.62, 0.30), (1.45, -0.52, FLOOR + 0.15), bevel=0.05)
    seat.data.materials.append(leather_q); link(seat, C["Set"])
    back = box("Seat back", (0.55, 0.16, 0.62), (1.62, -0.52, FLOOR + 0.55), bevel=0.05)
    back.data.materials.append(leather_q); link(back, C["Set"])

    # -- outside ----------------------------------------------------------------
    ground = plane("Pavement", 60, 14, (0.5, 5.0, 0.0)); ground.data.materials.append(mat_wet_ground("Wet pavement")); link(ground, C["Outside"])
    parapet = box("River parapet", (60, 0.5, 0.95), (0.5, 12.0, 0.475)); parapet.data.materials.append(mat_simple("Granite", (0.12, 0.12, 0.11, 1), 0.6)); link(parapet, C["Outside"])
    plate_path = os.path.join(ROOT, "render", "env", "tower_bridge_plate.webp")
    if os.path.exists(plate_path):
        card = plane("Tower Bridge plate", 80, 45, (0.5, 45.0, 1.1), (math.radians(90), 0, 0))
        card.data.materials.append(mat_plate("Tower Bridge plate", plate_path, 2.2)); link(card, C["Outside"])

    # world: night river HDRI for reflections
    w = bpy.data.worlds.new("Night"); sc.world = w; w.use_nodes = True
    wn = w.node_tree; bg = wn.nodes["Background"]
    hdr = os.path.join(ROOT, "render", "env", "shanghai_bund_4k.hdr")
    if os.path.exists(hdr):
        env = wn.nodes.new("ShaderNodeTexEnvironment"); env.image = bpy.data.images.load(hdr); env.location = (-400, 0)
        mp = wn.nodes.new("ShaderNodeMapping"); mp.location = (-600, 0)
        mp.inputs["Rotation"].default_value = (0, 0, math.radians(200))
        tc = wn.nodes.new("ShaderNodeTexCoord"); tc.location = (-800, 0)
        wn.links.new(tc.outputs["Generated"], mp.inputs["Vector"]); wn.links.new(mp.outputs[0], env.inputs["Vector"])
        wn.links.new(env.outputs[0], bg.inputs["Color"])
        bg.inputs["Strength"].default_value = 0.12
    else:
        bg.inputs["Color"].default_value = (0.01, 0.012, 0.02, 1)

    # -- lights -------------------------------------------------------------------
    def light(nm, kind, loc, energy, color, size=1.0, spot=None, aim=None):
        ld = bpy.data.lights.new(nm, kind); ld.energy = energy; ld.color = color
        if kind == "AREA": ld.size = size; ld.shape = "DISK"
        if kind == "SPOT" and spot: ld.spot_size = math.radians(spot); ld.spot_blend = 0.4
        ob = bpy.data.objects.new(nm, ld); ob.location = loc; link(ob, C["Lights"])
        ob.visible_camera = False                      # lights light, they are not seen
        if aim is not None:
            d = Vector(aim) - Vector(loc); ob.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
        return ob
    light("Key streetlamp", "AREA", (-1.6, 3.8, 3.6), 70, (1.0, 0.86, 0.68), size=0.8, aim=(0.5, 0, 1.1))
    light("Fill city", "AREA", (4.0, 9.0, 7.0), 120, (0.55, 0.72, 1.0), size=5.0, aim=(0.5, 0, 1.1))
    light("Cabin top", "AREA", (0.6, -0.7, ROOF - 0.02), 20, (1.0, 0.92, 0.8), size=0.5, aim=(0.5, -0.4, 0.8))
    rim = light("Rim headlight", "AREA", (-6, 6.0, 0.75), 900, (1.0, 0.95, 0.85), size=0.35, aim=(0.5, 0, 1.1))
    drive(rim, "location", 0, "-7 + 14 * rim_t", rig, ("rim_t",))

    # -- cameras --------------------------------------------------------------------
    def camera(nm, loc, aim, lens, fstop, focus):
        cd = bpy.data.cameras.new(nm); cd.lens = lens; cd.sensor_width = 36
        cd.dof.use_dof = True; cd.dof.aperture_fstop = fstop; cd.dof.focus_distance = focus
        ob = bpy.data.objects.new(nm, cd); ob.location = loc
        d = Vector(aim) - Vector(loc); ob.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
        link(ob, C["Cameras"]); return ob
    # interior: from the seat, looking at the door. The plate's framing needs a
    # wider lens than the 50 mm in the direction doc; noted for QA.
    s2 = camera("CAM_S2", (0.60, -1.38, 1.10), (0.50, 0.0, 1.05), 28, 2.8, 1.38)
    s2.data.dof.focus_object = stack
    s3 = camera("CAM_S3", (1.9, 3.3, 1.55), (0.5, 0.0, 1.10), 85, 2.8, 3.8)
    sc.camera = s2

    # -- render ----------------------------------------------------------------------
    prefs = bpy.context.preferences.addons["cycles"].preferences
    try:
        prefs.compute_device_type = "OPTIX"; prefs.get_devices()
        for d in prefs.devices: d.use = (d.type == "OPTIX")
    except Exception as e:
        print("OPTIX setup failed:", e)
    sc.render.engine = "CYCLES"; cy = sc.cycles
    cy.device = "GPU"; cy.samples = 256; cy.use_denoising = True; cy.denoiser = "OPENIMAGEDENOISE"
    cy.max_bounces = 32; cy.transmission_bounces = 32; cy.glossy_bounces = 8; cy.transparent_max_bounces = 32
    cy.caustics_reflective = False; cy.caustics_refractive = False; cy.blur_glossy = 1.0
    cy.volume_max_steps = 64; cy.volume_step_rate = 1.0
    sc.render.resolution_x, sc.render.resolution_y = 2560, 1440; sc.render.resolution_percentage = 50
    sc.render.use_motion_blur = True; sc.render.motion_blur_shutter = 0.5
    sc.render.fps = 24; sc.frame_start = 1; sc.frame_end = 240
    sc.render.image_settings.file_format = "PNG"; sc.render.image_settings.color_depth = "16"
    sc.view_settings.view_transform = "AgX"; sc.view_settings.look = "AgX - Medium High Contrast"
    sc.view_settings.exposure = 0.3
    sc.render.film_transparent = False

    # compositor: bloom on the city lights, vignette, blacks pulled to the site's ink
    try:
        nt = bpy.data.node_groups.new("DY Comp", "CompositorNodeTree")
        if hasattr(sc, "compositing_node_group"): sc.compositing_node_group = nt
        else:
            sc.use_nodes = True; nt = sc.node_tree
            for n in list(nt.nodes): nt.nodes.remove(n)
        rl = nt.nodes.new("CompositorNodeRLayers"); rl.location = (-600, 0)
        glare = nt.nodes.new("CompositorNodeGlare"); glare.location = (-300, 0)
        glare.inputs["Type"].default_value = "Bloom"
        for k, v in (("Threshold", 1.2), ("Strength", 0.12), ("Size", 0.6), ("Quality", "High")):
            if k in glare.inputs: glare.inputs[k].default_value = v
        if hasattr(sc, "compositing_node_group"):
            nt.interface.new_socket("Image", in_out="OUTPUT", socket_type="NodeSocketColor")
            comp = nt.nodes.new("NodeGroupOutput")
        else:
            comp = nt.nodes.new("CompositorNodeComposite")
        comp.location = (300, 0)
        nt.links.new(rl.outputs["Image"], glare.inputs["Image"]); nt.links.new(glare.outputs["Image"], comp.inputs[0])
    except Exception as e:
        print("compositor setup skipped:", e)

    bpy.ops.wm.save_as_mainfile(filepath=OUT)
    print("SCENE SAVED", OUT, "plies", len(PLIES), "stack thickness mm", round(total * 1000, 3))

build()
