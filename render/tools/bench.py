import bpy, time
prefs = bpy.context.preferences.addons['cycles'].preferences
prefs.compute_device_type = 'OPTIX'
prefs.get_devices()
for d in prefs.devices: d.use = (d.type == 'OPTIX')
sc = bpy.context.scene
sc.render.engine = 'CYCLES'
sc.cycles.device = 'GPU'
sc.cycles.samples = 256
sc.cycles.use_denoising = True
sc.cycles.denoiser = 'OPENIMAGEDENOISE'
sc.render.resolution_x, sc.render.resolution_y = 2560, 1440
sc.render.resolution_percentage = 100
sc.render.use_motion_blur = True
# a glass slab in front of the default cube, so the bench includes transmission
bpy.ops.mesh.primitive_plane_add(size=3, location=(0,-2,1), rotation=(1.5708,0,0))
slab = bpy.context.object
m = bpy.data.materials.new('glass'); m.use_nodes = True
b = m.node_tree.nodes['Principled BSDF']
b.inputs['Transmission Weight'].default_value = 1.0
b.inputs['IOR'].default_value = 1.52
b.inputs['Roughness'].default_value = 0.02
slab.data.materials.append(m)
mod = slab.modifiers.new('solid','SOLIDIFY'); mod.thickness = 0.0047
sc.render.filepath = '/home/datguy/drive-yours/render/bench.png'
sc.render.image_settings.file_format = 'PNG'
t=time.time(); bpy.ops.render.render(write_still=True); print("BENCH seconds:", round(time.time()-t,1))
