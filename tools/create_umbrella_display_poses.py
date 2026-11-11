"""Export static open, half-open and closed poses from the animated umbrella.

Run with Blender in background mode after create_blender_umbrella.py. The
evaluated meshes keep the same radial UVs as the animated production model.
"""
import os
import bpy

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCE = os.path.join(ROOT, 'assets', 'models', 'west-lake-umbrella.blend')
OUTPUT = os.path.join(ROOT, 'assets', 'models', 'west-lake-umbrella-display.glb')

bpy.ops.wm.open_mainfile(filepath=SOURCE)
scene = bpy.context.scene
source_meshes = [obj for obj in scene.objects if obj.type == 'MESH']
exported = []
for pose, frame in [('open', 1), ('half', 19), ('closed', 36)]:
    scene.frame_set(frame)
    graph = bpy.context.evaluated_depsgraph_get()
    graph.update()
    groups = {'canopy': [], 'frame': []}
    for obj in source_meshes:
        evaluated = obj.evaluated_get(graph)
        mesh = bpy.data.meshes.new_from_object(evaluated, preserve_all_data_layers=True, depsgraph=graph)
        if not mesh.vertices:
            bpy.data.meshes.remove(mesh)
            continue
        kind = 'canopy' if obj.name == 'silk-canopy' else 'frame'
        copy = bpy.data.objects.new('Display part', mesh)
        scene.collection.objects.link(copy)
        copy.matrix_world = evaluated.matrix_world.copy()
        groups[kind].append(copy)
    for kind, objects in groups.items():
        # One shared material per part keeps the exported pose to two draw calls.
        mat = bpy.data.materials.get('SilkDisplay') or bpy.data.materials.new('SilkDisplay') if kind == 'canopy' else bpy.data.materials.get('BambooDisplay') or bpy.data.materials.new('BambooDisplay')
        for obj in objects:
            obj.data.materials.clear()
            obj.data.materials.append(mat)
            for polygon in obj.data.polygons:
                polygon.material_index = 0
        anchor_mesh = bpy.data.meshes.new('Display origin')
        anchor = bpy.data.objects.new('Display-%s-%s' % (pose, kind), anchor_mesh)
        scene.collection.objects.link(anchor)
        bpy.ops.object.select_all(action='DESELECT')
        anchor.select_set(True)
        for obj in objects:
            obj.select_set(True)
        bpy.context.view_layer.objects.active = anchor
        bpy.ops.object.join()
        # The street views the umbrellas at a distance; retain their silhouette
        # and UVs while avoiding millions of repeated triangles at runtime.
        # Keep the canopy's radial UV grid intact. Decimating across the wrap
        # seam collapsed neighboring UVs and made the artwork look overprinted.
        if kind == 'frame':
            reduction=anchor.modifiers.new('Web display detail','DECIMATE')
            reduction.ratio=.32
            bpy.ops.object.modifier_apply(modifier=reduction.name)
        exported.append(anchor)

bpy.ops.object.select_all(action='DESELECT')
for obj in exported:
    obj.select_set(True)
bpy.context.view_layer.objects.active = exported[0]
bpy.ops.export_scene.gltf(filepath=OUTPUT, export_format='GLB', use_selection=True,
                          export_yup=True, export_animations=False, export_materials='EXPORT',
                          export_normals=True, export_texcoords=True)
print('Exported display poses:', OUTPUT, flush=True)
