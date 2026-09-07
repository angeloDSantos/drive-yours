import bpy
prefs = bpy.context.preferences.addons['cycles'].preferences
out = []
for t in ('OPTIX','CUDA'):
    try:
        prefs.compute_device_type = t
        prefs.get_devices()
        devs = [(d.name, d.type, d.use) for d in prefs.devices if d.type == t]
        out.append((t, devs))
    except Exception as e:
        out.append((t, 'ERR '+str(e)))
print("GPUPROBE", out)
