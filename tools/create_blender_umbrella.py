"""Create the editable Blender source and the animated GLB used by the H5 preview.

Run with:
  blender --background --python tools/create_blender_umbrella.py

The canopy UV square matches ThreeUmbrellaPreview's radial map: U grows right,
V grows toward the top of the 2D umbrella texture.
"""
import math
import os
import bpy
from mathutils import Matrix, Quaternion, Vector


ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, "assets", "models")
BLEND_PATH = os.path.join(OUT_DIR, "west-lake-umbrella.blend")
GLB_PATH = os.path.join(OUT_DIR, "west-lake-umbrella.glb")
RADIUS = 1.76
APEX = 0.22
APEX_OPEN = APEX
RUNNER_OPEN = -0.17
RUNNER_CLOSED = -1.74
RIB_COUNT = 36
CANOPY_RADIAL_STEPS = 88
# The cloth and every long split-bamboo rib share one folded target path.
FOLDED_BUNDLE_RADIUS = 0.075
# Let each pale bamboo rib pass just beyond the silk hem, as on the physical
# umbrella; the same rib still gathers into the shared closed bamboo bundle.
RIB_TIP_RADIUS = 1.025
FRAME_OPEN = 1
FRAME_CLOSED = 37
FOLD_POSE_COUNT = 8


def clean_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for block in bpy.data.materials:
        bpy.data.materials.remove(block)
    for block in bpy.data.actions:
        bpy.data.actions.remove(block)


def make_material(name, color, roughness=0.72, metallic=0.0, sheen=0.0):
    material = bpy.data.materials.new(name)
    material.diffuse_color = (*color, 1.0)
    material.use_nodes = True
    nodes = material.node_tree.nodes
    nodes.clear()
    shader = nodes.new("ShaderNodeBsdfPrincipled")
    output = nodes.new("ShaderNodeOutputMaterial")
    material.node_tree.links.new(shader.outputs["BSDF"], output.inputs["Surface"])
    shader.inputs["Base Color"].default_value = (*color, 1.0)
    shader.inputs["Roughness"].default_value = roughness
    shader.inputs["Metallic"].default_value = metallic
    if "Sheen Weight" in shader.inputs:
        shader.inputs["Sheen Weight"].default_value = sheen
    if "Sheen Roughness" in shader.inputs:
        shader.inputs["Sheen Roughness"].default_value = 0.78
    return material


def canopy_point(radius, angle):
    rib_pleat = math.cos(angle * RIB_COUNT) * 0.013 * radius ** 1.72
    secondary = math.sin(angle * 2.3 + 0.6) * 0.0022 + math.cos(angle * 5.1) * 0.0012
    edge_roll = -0.024 * smoothstep(0.86, 1.0, radius)
    height = APEX * (1 - radius * radius) + rib_pleat + secondary * radius ** 1.72 + edge_roll
    edge_wave = 0.004 * math.cos(angle * RIB_COUNT) * radius ** 8
    return Vector((math.cos(angle) * (RADIUS * radius + edge_wave), math.sin(angle) * (RADIUS * radius + edge_wave), height))


def smoothstep(edge0, edge1, value):
    t = max(0.0, min(1.0, (value - edge0) / (edge1 - edge0)))
    return t * t * (3.0 - 2.0 * t)


def folded_point(radius, angle):
    step = math.tau / RIB_COUNT
    spoke_index = round(angle / step)
    spoke = spoke_index * step
    delta = (angle - spoke + math.pi) % math.tau - math.pi
    pleat = delta / (step * 0.5)
    # 西湖绸伞收拢后应回成细长的圆竹束；把伞绸压成紧密纵向褶裥，
    # 不做现代折叠伞那种宽大的锥形伞包。
    # The silk gathers inside the split bamboo ribs instead of forming a
    # visible modern-umbrella fabric cone.
    profile = bundle_profile(radius)
    # The closed pose is made from these same long ribs and canopy vertices;
    # there is no separate bamboo sleeve that appears at the end of folding.
    target_radius = FOLDED_BUNDLE_RADIUS * profile + pleat * radius * 0.003
    target_angle = spoke + pleat * 0.024
    target_height = folded_height(radius)
    return Vector((math.cos(target_angle) * target_radius, math.sin(target_angle) * target_radius, target_height))


def folded_height(radius):
    """Shared longitudinal profile for the folded cloth and bamboo structure."""
    # The closed split-bamboo tips converge into the runner instead of passing
    # below it. A slightly curved profile keeps the bundle organic while its
    # final point remains physically attached to the small sliding cylinder.
    normalized = min(1.0, radius / RIB_TIP_RADIUS)
    return APEX_OPEN + (RUNNER_CLOSED - APEX_OPEN) * normalized


def bundle_point(radius, angle):
    """Position a support rib evenly between the long ribs in the gathered bundle."""
    bundle_radius = FOLDED_BUNDLE_RADIUS * bundle_profile(radius)
    return Vector((math.cos(angle) * bundle_radius, math.sin(angle) * bundle_radius, folded_height(radius)))


def bundle_profile(radius):
    """Keep a long round bundle with softly tapered, connected ends."""
    start = smoothstep(0.0, 0.09, radius)
    end = 1.0 - smoothstep(0.91, 1.0, radius)
    return 0.46 + 0.54 * min(start, end)


def articulated_curve(radii, angle, progress, height_offset=0.0):
    """Fold a painted radial line using constant-length bamboo segments."""
    radial = Vector((math.cos(angle), math.sin(angle), 0))
    original_r = 0.0
    original_z = APEX
    closed_r = 0.0
    result_r = 0.0
    result_z = APEX
    result = []
    for radius in radii:
        if radius <= 0:
            result.append(Vector((0, 0, APEX)))
            continue
        original = canopy_point(radius, angle) + Vector((0, 0, height_offset))
        next_r = original.dot(radial)
        dx, dz = next_r - original_r, original.z - original_z
        length = math.hypot(dx, dz)
        target_r = FOLDED_BUNDLE_RADIUS * bundle_profile(radius) * smoothstep(0, 0.07, radius)
        target_dx = max(-length * .999, min(length * .999, target_r - closed_r))
        open_angle = math.atan2(dz, dx)
        closed_angle = -math.acos(target_dx / max(length, 1e-9))
        segment_angle = open_angle + (closed_angle - open_angle) * progress
        result_r += math.cos(segment_angle) * length
        result_z += math.sin(segment_angle) * length
        result.append(Vector((result_r * radial.x, result_r * radial.y, result_z)))
        original_r, original_z, closed_r = next_r, original.z, target_r
    return result


def add_fold_poses(obj, pose_coordinates, suffix):
    """Interpolate neighbouring poses; the short steps keep ribs near rigid."""
    obj.shape_key_add(name="Basis", from_mix=False)
    shape_keys = obj.data.shape_keys
    for index, coordinates in enumerate(pose_coordinates, start=1):
        key = obj.shape_key_add(name=f"Fold {index:02d}", from_mix=False)
        for vertex, coordinate in zip(key.data, coordinates):
            vertex.co = coordinate
        for pose in range(FOLD_POSE_COUNT + 1):
            key.value = 1.0 if pose == index else 0.0
            frame = FRAME_OPEN + (FRAME_CLOSED - FRAME_OPEN) * pose / FOLD_POSE_COUNT
            key.keyframe_insert(data_path="value", frame=frame, group="Umbrella Fold")
        key.value = 0.0
    action = shape_keys.animation_data.action
    action.name = "Umbrella Fold" + suffix
    for curve in action.fcurves:
        for point in curve.keyframe_points:
            point.interpolation = "LINEAR"
    push_into_shared_nla(shape_keys, action)


def linear_to_srgb(value):
    value = max(0.0, min(1.0, value))
    return 12.92 * value if value <= 0.0031308 else 1.055 * value ** (1 / 2.4) - 0.055


def make_bamboo_grain(material, base_color):
    """Pack a restrained longitudinal bamboo grain texture for the GLB."""
    width, height = 256, 512
    image = bpy.data.images.new("Bamboo longitudinal grain", width=width, height=height, alpha=True)
    pixels = [0.0] * (width * height * 4)
    for y in range(height):
        v = y / max(1, height - 1)
        for x in range(width):
            u = x / max(1, width - 1)
            warp = 0.012 * math.sin(v * math.tau * 2.0) + 0.004 * math.sin(v * math.tau * 7.0 + u * 3.0)
            phase = (u + warp) * math.tau
            fibers = (
                0.022 * math.sin(phase * 7.0 + 0.18 * math.sin(v * math.tau * 3.0))
                + 0.010 * math.sin(phase * 17.0 + 0.12 * math.sin(v * math.tau * 5.0))
                + 0.004 * math.sin(phase * 39.0 + v * 2.7)
            )
            fiber_noise = 0.003 * math.sin(x * 12.9898 + y * 78.233) * math.sin(x * 0.071 + y * 0.013)
            node_phase = (v * 3.0) % 1.0
            node = math.exp(-((node_phase - 0.12) / 0.035) ** 2)
            tone = max(0.82, min(1.08, 0.97 + fibers + fiber_noise - node * 0.018))
            index = (y * width + x) * 4
            pixels[index] = linear_to_srgb(base_color[0] * tone)
            pixels[index + 1] = linear_to_srgb(base_color[1] * tone)
            pixels[index + 2] = linear_to_srgb(base_color[2] * tone)
            pixels[index + 3] = 1.0
    image.pixels.foreach_set(pixels)
    image.pack()
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    shader = next(node for node in nodes if node.type == "BSDF_PRINCIPLED")
    tex_coord = nodes.new("ShaderNodeTexCoord")
    tex_coord.label = "Bamboo UV"
    texture = nodes.new("ShaderNodeTexImage")
    texture.image = image
    texture.extension = "REPEAT"
    texture.interpolation = "Linear"
    texture.label = "Subtle bamboo fibers and nodes"
    links.new(tex_coord.outputs["UV"], texture.inputs["Vector"])
    links.new(texture.outputs["Color"], shader.inputs["Base Color"])


def radial_mesh(name, radial_steps, angular_steps, point_function, material, radius=RADIUS):
    vertices = []
    uvs = []
    faces = []
    for ri in range(radial_steps + 1):
        r = ri / radial_steps
        for ai in range(angular_steps + 1):
            angle = ai / angular_steps * math.tau
            point = point_function(r, angle)
            vertices.append(tuple(point))
            uvs.append((0.5 + 0.5 * r * math.cos(angle), 0.5 + 0.5 * r * math.sin(angle)))
    row = angular_steps + 1
    for ri in range(radial_steps):
        for ai in range(angular_steps):
            a = ri * row + ai
            b = a + 1
            c = a + row
            d = c + 1
            # radial × angular points upward (+Z) on the cloth's visible side.
            faces.append((a, c, d, b))
    mesh = bpy.data.meshes.new(name + "_Mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    uv_layer = mesh.uv_layers.new(name="CanopyUV")
    for polygon in mesh.polygons:
        polygon.use_smooth = True
        for loop_index in polygon.loop_indices:
            vertex_index = mesh.loops[loop_index].vertex_index
            uv_layer.data[loop_index].uv = uvs[vertex_index]
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    if material:
        mesh.materials.append(material)
    return obj


def tube_mesh(name, points, radius, material, sides=8):
    verts = []
    faces = []
    points = [Vector(point) for point in points]
    for index, point in enumerate(points):
        tangent = (points[min(index + 1, len(points) - 1)] - points[max(index - 1, 0)]).normalized()
        helper = Vector((0, 0, 1)) if abs(tangent.z) < 0.9 else Vector((0, 1, 0))
        axis_a = tangent.cross(helper).normalized()
        axis_b = tangent.cross(axis_a).normalized()
        for side in range(sides):
            angle = side / sides * math.tau
            offset = axis_a * math.cos(angle) * radius + axis_b * math.sin(angle) * radius
            verts.append(tuple(point + offset))
    for ring in range(len(points) - 1):
        for side in range(sides):
            a = ring * sides + side
            b = ring * sides + (side + 1) % sides
            c = (ring + 1) * sides + (side + 1) % sides
            d = (ring + 1) * sides + side
            faces.append((a, b, c, d))
    mesh = bpy.data.meshes.new(name + "_Mesh")
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    for polygon in mesh.polygons:
        polygon.use_smooth = True
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    mesh.materials.append(material)
    return obj


def bamboo_slat_mesh(name, points, width, thickness, material):
    """Build a flat bamboo rib instead of a generic round tube."""
    points = [Vector(point) for point in points]
    corners = ((-1, -1), (1, -1), (1, 1), (-1, 1))
    vertices = []
    faces = []
    for index, point in enumerate(points):
        tangent = (points[min(index + 1, len(points) - 1)] - points[max(index - 1, 0)]).normalized()
        width_axis = Vector((0, 1, 0))
        normal_axis = tangent.cross(width_axis).normalized()
        for width_sign, normal_sign in corners:
            vertex = point + width_axis * (width_sign * width * 0.5) + normal_axis * (normal_sign * thickness * 0.5)
            vertices.append(tuple(vertex))
    for ring in range(len(points) - 1):
        for side in range(4):
            a = ring * 4 + side
            b = ring * 4 + (side + 1) % 4
            c = (ring + 1) * 4 + (side + 1) % 4
            d = (ring + 1) * 4 + side
            faces.append((a, b, c, d))
    faces.append((3, 2, 1, 0))
    last = (len(points) - 1) * 4
    faces.append((last, last + 1, last + 2, last + 3))
    mesh = bpy.data.meshes.new(name + "_Mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    distances = [0.0]
    for index in range(1, len(points)):
        distances.append(distances[-1] + (points[index] - points[index - 1]).length)
    total_length = max(distances[-1], 1e-6)
    uv_layer = mesh.uv_layers.new(name="BambooGrainUV")
    for polygon in mesh.polygons:
        for loop_index in polygon.loop_indices:
            vertex_index = mesh.loops[loop_index].vertex_index
            ring = min(vertex_index // 4, len(points) - 1)
            corner = vertex_index % 4
            width_sign = corners[corner][0]
            uv_layer.data[loop_index].uv = (0.5 + width_sign * 0.5, distances[ring] / total_length)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    mesh.materials.append(material)
    return obj


def animate_rib_slats_closed(mesh_obj, sample_radii, rib_index, width, thickness):
    """Fold each split-bamboo rib into the slender, reassembled bamboo tube."""
    basis = mesh_obj.shape_key_add(name="Basis", from_mix=False)
    folded = mesh_obj.shape_key_add(name="Bundled", from_mix=False)
    step = math.tau / RIB_COUNT
    radial_angle = rib_index * step
    radial_axis = Vector((math.cos(radial_angle), math.sin(radial_angle), 0))
    width_axis = Vector((-math.sin(radial_angle), math.cos(radial_angle), 0))
    base_matrix = Matrix((
        (radial_axis.x, width_axis.x, 0),
        (radial_axis.y, width_axis.y, 0),
        (radial_axis.z, width_axis.z, 1),
    ))
    # Keep the rib pivot fixed and morph its vertices in the same world-space
    # path as the cloth. Rotating the pivot as well as morphing the rib caused
    # a mid-fold overshoot, so bamboo tips appeared longer than the canopy.
    closed_inverse = base_matrix.to_quaternion().inverted()
    corners = ((-1, -1), (1, -1), (1, 1), (-1, 1))
    base_positions = [Vector(tuple(mesh_obj.data.vertices[index * 4 + corner].co)) for index in range(len(sample_radii)) for corner in range(4)]
    centers = []
    for ring in range(len(sample_radii)):
        corners_local = base_positions[ring * 4:(ring + 1) * 4]
        centers.append(sum(corners_local, Vector()) / 4.0)
    segment_lengths = [(centers[index + 1] - centers[index]).length for index in range(len(centers) - 1)]
    hinge_length = centers[0].length
    target_heights = []
    target_radii = []
    previous_z = 0.0
    previous_radius = 0.0
    for ring, panel_radius in enumerate(sample_radii):
        target_radius = FOLDED_BUNDLE_RADIUS * bundle_profile(panel_radius)
        if ring == 0:
            target_z = -math.sqrt(max(hinge_length * hinge_length - target_radius * target_radius, 0.0))
        else:
            horizontal = target_radius - previous_radius
            target_z = previous_z - math.sqrt(max(segment_lengths[ring - 1] ** 2 - horizontal ** 2, 0.0))
        target_heights.append(target_z)
        target_radii.append(target_radius)
        previous_z = target_z
        previous_radius = target_radius
    for ring, panel_radius in enumerate(sample_radii):
        for corner, (width_sign, normal_sign) in enumerate(corners):
            # Rotate each slat into a vertical bundle while preserving every
            # centreline segment length. The final tip reaches the runner.
            folded.data[ring * 4 + corner].co = Vector((
                target_radii[ring] + normal_sign * thickness * 0.5,
                width_sign * width * 0.5,
                target_heights[ring]
            ))
    shape_keys = mesh_obj.data.shape_keys
    action = set_fold_action(shape_keys, f" Rib {rib_index + 1:02d}")
    folded.value = 0.0
    folded.keyframe_insert(data_path="value", frame=FRAME_OPEN, group="Umbrella Fold")
    folded.value = 1.0
    folded.keyframe_insert(data_path="value", frame=FRAME_CLOSED, group="Umbrella Fold")
    for curve in action.fcurves:
        for key in curve.keyframe_points:
            key.interpolation = "BEZIER"
            key.handle_left_type = "AUTO_CLAMPED"
            key.handle_right_type = "AUTO_CLAMPED"
    push_into_shared_nla(shape_keys, action)
    folded.value = 0.0


def animate_rib_seam_closed(mesh_obj, sample_radii, rib_index, tube_radius, sides=5):
    """Keep the decorative seam bonded to its matching bamboo slat at closure."""
    mesh_obj.shape_key_add(name="Basis", from_mix=False)
    folded = mesh_obj.shape_key_add(name="Bundled", from_mix=False)
    step = math.tau / RIB_COUNT
    radial_angle = rib_index * step
    radial_axis = Vector((math.cos(radial_angle), math.sin(radial_angle), 0))
    width_axis = Vector((-math.sin(radial_angle), math.cos(radial_angle), 0))
    base_matrix = Matrix((
        (radial_axis.x, width_axis.x, 0),
        (radial_axis.y, width_axis.y, 0),
        (radial_axis.z, width_axis.z, 1),
    ))
    # The seam follows the same folded cloth samples; a separate pivot rotation
    # would make it drift off the fabric between the open and closed poses.
    closed_inverse = base_matrix.to_quaternion().inverted()
    base_positions = [Vector(tuple(mesh_obj.data.vertices[index * sides + side].co)) for index in range(len(sample_radii)) for side in range(sides)]
    centers = []
    for ring in range(len(sample_radii)):
        corners_local = base_positions[ring * sides:(ring + 1) * sides]
        centers.append(sum(corners_local, Vector()) / sides)
    segment_lengths = [(centers[index + 1] - centers[index]).length for index in range(len(centers) - 1)]
    hinge_length = centers[0].length
    target_heights = []
    target_radii = []
    previous_z = 0.0
    previous_radius = 0.0
    for ring, panel_radius in enumerate(sample_radii):
        target_radius = FOLDED_BUNDLE_RADIUS * bundle_profile(panel_radius)
        if ring == 0:
            target_z = -math.sqrt(max(hinge_length * hinge_length - target_radius * target_radius, 0.0))
        else:
            horizontal = target_radius - previous_radius
            target_z = previous_z - math.sqrt(max(segment_lengths[ring - 1] ** 2 - horizontal ** 2, 0.0))
        target_heights.append(target_z)
        target_radii.append(target_radius)
        previous_z = target_z
        previous_radius = target_radius
    for ring, panel_radius in enumerate(sample_radii):
        for side in range(sides):
            side_angle = side / sides * math.tau
            folded.data[ring * sides + side].co = Vector((
                target_radii[ring] + math.sin(side_angle) * tube_radius,
                math.cos(side_angle) * tube_radius,
                target_heights[ring]
            ))
    shape_keys = mesh_obj.data.shape_keys
    action = set_fold_action(shape_keys, f" Seam {rib_index + 1:02d}")
    folded.value = 0.0
    folded.keyframe_insert(data_path="value", frame=FRAME_OPEN, group="Umbrella Fold")
    folded.value = 1.0
    folded.keyframe_insert(data_path="value", frame=FRAME_CLOSED, group="Umbrella Fold")
    for curve in action.fcurves:
        for key in curve.keyframe_points:
            key.interpolation = "BEZIER"
            key.handle_left_type = "AUTO_CLAMPED"
            key.handle_right_type = "AUTO_CLAMPED"
    push_into_shared_nla(shape_keys, action)
    folded.value = 0.0


def set_fold_action(id_data, name_suffix=""):
    anim = id_data.animation_data_create()
    action = bpy.data.actions.new("Umbrella Fold" + name_suffix)
    anim.action = action
    return action


def push_into_shared_nla(id_data, action):
    anim = id_data.animation_data
    if anim is None:
        return
    track = anim.nla_tracks.new()
    track.name = "Umbrella Fold"
    track.strips.new("Umbrella Fold", FRAME_OPEN, action)
    anim.action = None


def animate_key(data, path, index, start_value, end_value, action_name):
    action = set_fold_action(data, action_name)
    data.keyframe_insert(data_path=path, index=index, frame=FRAME_OPEN, group="Umbrella Fold")
    data.keyframe_insert(data_path=path, index=index, frame=FRAME_CLOSED, group="Umbrella Fold")
    for curve in action.fcurves:
        for key in curve.keyframe_points:
            key.interpolation = "BEZIER"
            key.handle_left_type = "AUTO_CLAMPED"
            key.handle_right_type = "AUTO_CLAMPED"
    push_into_shared_nla(data, action)
    return action


def add_cylinder(name, radius_top, radius_bottom, depth, location, material, vertices=16):
    bpy.ops.mesh.primitive_cone_add(vertices=vertices, radius1=radius_bottom, radius2=radius_top, depth=depth, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.data.materials.append(material)
    for polygon in obj.data.polygons:
        polygon.use_smooth = len(polygon.vertices) <= 4
    return obj


def make_handle_and_hardware(root, bamboo, bamboo_light, silk, runner_positions):
    # The shaft is one continuous bamboo core.  It overlaps the hub, gathered
    # rib bundle and grip so no thin exposed rod or floating connector appears
    # at either end of the closed umbrella.
    # The shaft stops at the canopy apex. Its previous top cap protruded above
    # the hub and read as a long spike in top-down views.
    shaft = add_cylinder("bamboo-shaft", 0.026, 0.022, 2.16, (0, 0, -0.86), bamboo, 16)
    shaft.parent = root
    grip = add_cylinder("straight-bamboo-grip", 0.034, 0.029, 0.74, (0, 0, -1.63), bamboo, 16)
    grip.parent = root
    for index, z in enumerate((-0.36, -0.73, -1.07, -1.34, -1.62, -1.91)):
        bpy.ops.mesh.primitive_torus_add(major_radius=0.027 if z > -1.5 else 0.032, minor_radius=0.0032, major_segments=20, minor_segments=6, location=(0, 0, z))
        ring = bpy.context.object
        ring.name = f"bamboo-internode-{index + 1:02d}"
        ring.data.materials.append(bamboo_light)
        ring.parent = root

    runner = add_cylinder("umbrella-runner", 0.069, 0.069, 0.054, (0, 0, RUNNER_OPEN), bamboo_light, 24)
    runner.parent = root
    for frame, height in runner_positions.items():
        runner.location.z = height
        runner.keyframe_insert(data_path="location", frame=frame, group="Umbrella Fold")
    runner_action = runner.animation_data.action
    for curve in runner_action.fcurves:
        for key in curve.keyframe_points:
            key.interpolation = "LINEAR"
    push_into_shared_nla(runner, runner_action)

    bpy.ops.mesh.primitive_cylinder_add(vertices=32, radius=0.132, depth=0.018, location=(0, 0, APEX + 0.009))
    rosette = bpy.context.object
    rosette.name = "silk-canopy-rosette"
    rosette.data.materials.append(silk)
    rosette.parent = root

    hub = add_cylinder("umbrella-hub", 0.088, 0.108, 0.04, (0, 0, APEX + 0.035), bamboo_light, 32)
    hub.parent = root
    add_cylinder("umbrella-finial-stem", 0.012, 0.015, 0.055, (0, 0, APEX + 0.082), bamboo, 16).parent = root
    bpy.ops.mesh.primitive_uv_sphere_add(segments=24, ring_count=14, radius=0.057, location=(0, 0, APEX + 0.118))
    finial = bpy.context.object
    finial.name = "umbrella-finial"
    finial.scale.z = 0.78
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    finial.data.materials.append(bamboo)
    finial.parent = root


def build_model():
    os.makedirs(OUT_DIR, exist_ok=True)
    clean_scene()
    silk = make_material("Silk Canopy", (0.91, 0.88, 0.80), 0.78, 0.0, 0.22)
    bamboo = make_material("Warm Bamboo", (0.39, 0.28, 0.15), 0.76, 0.0, 0.03)
    make_bamboo_grain(bamboo, (0.39, 0.28, 0.15))
    bamboo_light = make_material("Bamboo Grain", (0.68, 0.54, 0.33), 0.72, 0.0, 0.02)
    seam_material = make_material("Silk Rib Seam", (0.49, 0.40, 0.27), 0.88, 0.0, 0.0)
    edge_thread = make_material("Silk Edge Binding", (0.62, 0.57, 0.47), 0.9, 0.0, 0.0)

    root = bpy.data.objects.new("west-lake-silk-umbrella", None)
    bpy.context.collection.objects.link(root)
    root.empty_display_type = "PLAIN_AXES"
    root.empty_display_size = 0.22

    canopy = radial_mesh("silk-canopy", CANOPY_RADIAL_STEPS, 288, canopy_point, silk)
    canopy.parent = root
    radii = [ri / CANOPY_RADIAL_STEPS for ri in range(CANOPY_RADIAL_STEPS + 1)]
    canopy_poses = []
    for pose in range(1, FOLD_POSE_COUNT + 1):
        progress = pose / FOLD_POSE_COUNT
        coordinates = [None] * ((CANOPY_RADIAL_STEPS + 1) * 289)
        for ai in range(289):
            angle = ai / 288 * math.tau
            spoke_step = math.tau / RIB_COUNT
            spoke = round(angle / spoke_step) * spoke_step
            delta = (angle - spoke + math.pi) % math.tau - math.pi
            folded_angle = spoke + delta * (0.024 / (spoke_step * .5))
            current_angle = angle + (folded_angle - angle) * progress
            curve = articulated_curve(radii, angle, progress)
            for ri, point in enumerate(curve):
                radius = math.hypot(point.x, point.y)
                coordinates[ri * 289 + ai] = Vector((radius * math.cos(current_angle), radius * math.sin(current_angle), point.z))
        canopy_poses.append(coordinates)
    add_fold_poses(canopy, canopy_poses, " Cloth")

    # Keep the binding centered on the cloth edge, but make it read as fine
    # silk stitching instead of a separate golden wire ring.
    # Use the canopy's exact edge angles. A second angular wobble made the
    # binding drift away from the scalloped fabric boundary in oblique views.
    hem_points = [canopy_point(1.0, index / 288 * math.tau) for index in range(289)]
    hem = tube_mesh("stitched-canopy-hem", hem_points, 0.0032, edge_thread, sides=7)
    hem.parent = root
    hem_sides = 7
    hem_poses = []
    for pose, canopy_coordinates in enumerate(canopy_poses, start=1):
        offsets = 1.0 - .58 * pose / FOLD_POSE_COUNT
        coordinates = []
        for index, vertex in enumerate(hem.data.vertices):
            ai = index // hem_sides
            center = canopy_coordinates[CANOPY_RADIAL_STEPS * 289 + ai]
            coordinates.append(center + (vertex.co - hem_points[ai]) * offsets)
        hem_poses.append(coordinates)
    add_fold_poses(hem, hem_poses, " Hem")

    # Each long bamboo rib morphs along the canopy fold; the support struts and
    # runner follow the same frame range.
    rib_pivots = []
    rib_joints = []
    for rib in range(RIB_COUNT):
        angle = rib / RIB_COUNT * math.tau
        radial = Vector((math.cos(angle), math.sin(angle), 0))
        tangent = Vector((-math.sin(angle), math.cos(angle), 0))
        up = Vector((0, 0, 1))
        base_matrix = Matrix(((radial.x, tangent.x, up.x), (radial.y, tangent.y, up.y), (radial.z, tangent.z, up.z)))
        base_quat = base_matrix.to_quaternion()
        pivot = bpy.data.objects.new(f"RibPivot_{rib + 1:02d}", None)
        bpy.context.collection.objects.link(pivot)
        pivot.parent = root
        pivot.location = (0, 0, APEX)
        pivot.rotation_mode = "QUATERNION"
        pivot.rotation_quaternion = base_quat
        rib_pivots.append((pivot, base_quat, radial, tangent))

        # Follow the actual curved canopy underside. The former nearly-flat
        # line floated away from the cloth toward the rim, making the rib cage
        # look detached when viewed from below or during folding.
        line = []
        seam_line = []
        # Use the same radial sampling as the canopy mesh so bamboo slats and
        # seams track the fabric's fold without long straight shortcuts.
        rib_tip_step = round(RIB_TIP_RADIUS * CANOPY_RADIAL_STEPS)
        rib_sample_radii = tuple(index / CANOPY_RADIAL_STEPS for index in range(3, rib_tip_step + 1))
        seam_sample_radii = tuple(index / CANOPY_RADIAL_STEPS for index in range(3, 86))
        for panel_radius in rib_sample_radii:
            point = canopy_point(panel_radius, angle)
            inner = point + Vector((0, 0, 0.012))
            line.append(tuple(base_quat.inverted() @ (inner - Vector((0, 0, APEX)))))
        for panel_radius in seam_sample_radii:
            point = canopy_point(panel_radius, angle)
            outer = point + Vector((0, 0, 0.018))
            seam_line.append(tuple(base_quat.inverted() @ (outer - Vector((0, 0, APEX)))))
        rib_width = 0.014
        rib_thickness = 0.006
        main_rib = bamboo_slat_mesh(f"bamboo-main-rib-{rib + 1:02d}", line, rib_width, rib_thickness, bamboo)
        main_rib.parent = pivot
        seam = tube_mesh(f"silk-rib-seam-{rib + 1:02d}", seam_line, 0.0013, seam_material, 5)
        seam.parent = pivot
        slat_poses = []
        seam_poses = []
        joint_index = min(range(len(rib_sample_radii)), key=lambda index: abs(rib_sample_radii[index] * RADIUS - .48))
        joints = [base_quat @ Vector(line[joint_index]) + Vector((0, 0, APEX))]
        corners = ((-1, -1), (1, -1), (1, 1), (-1, 1))
        for pose in range(1, FOLD_POSE_COUNT + 1):
            progress = pose / FOLD_POSE_COUNT
            curve = articulated_curve(rib_sample_radii, angle, progress, .012)
            local_curve = [base_quat.inverted() @ (point - Vector((0, 0, APEX))) for point in curve]
            coordinates = []
            for index, point in enumerate(local_curve):
                tangent = (local_curve[min(index + 1, len(local_curve) - 1)] - local_curve[max(index - 1, 0)]).normalized()
                width_axis = Vector((0, 1, 0))
                normal_axis = tangent.cross(width_axis).normalized()
                coordinates.extend(point + width_axis * (ws * rib_width * .5) + normal_axis * (ns * rib_thickness * .5) for ws, ns in corners)
            slat_poses.append(coordinates)
            joints.append(curve[joint_index])
            seam_curve = articulated_curve(seam_sample_radii, angle, progress, .018)
            seam_local = [base_quat.inverted() @ (point - Vector((0, 0, APEX))) for point in seam_curve]
            seam_coordinates = []
            for index, point in enumerate(seam_local):
                old_center = Vector(seam_line[index])
                for side in range(5):
                    offset = seam.data.vertices[index * 5 + side].co - old_center
                    seam_coordinates.append(point + offset)
            seam_poses.append(seam_coordinates)
        add_fold_poses(main_rib, slat_poses, f" Rib {rib + 1:02d}")
        add_fold_poses(seam, seam_poses, f" Seam {rib + 1:02d}")
        rib_joints.append(joints)

        # The rib is already driven by a shape key whose target is sampled on
        # the folded canopy. Keep its parent frame fixed to avoid double motion.
        pivot.rotation_quaternion = base_quat

    def joint_at(joints, frame):
        position = (frame - FRAME_OPEN) / (FRAME_CLOSED - FRAME_OPEN) * FOLD_POSE_COUNT
        lower = min(FOLD_POSE_COUNT, int(position))
        upper = min(FOLD_POSE_COUNT, lower + 1)
        return joints[lower].lerp(joints[upper], position - lower)

    # Derive the slider path from a constant-length short rib attached to its
    # long-rib joint. This avoids a detached or upward-jumping support fan.
    anchor_radius = .05
    first = rib_joints[0][0]
    reference_length = math.hypot(math.hypot(first.x, first.y) - anchor_radius, first.z - RUNNER_OPEN)
    runner_positions = {}
    for frame in range(FRAME_OPEN, FRAME_CLOSED + 1):
        joint = joint_at(rib_joints[0], frame)
        horizontal = math.hypot(joint.x, joint.y) - anchor_radius
        runner_positions[frame] = joint.z - math.sqrt(max(0.0, reference_length ** 2 - horizontal ** 2))

    for rib, (pivot, base_quat, radial, tangent) in enumerate(rib_pivots):
        hinge_open = rib_joints[rib][0]
        start_open = radial * anchor_radius + Vector((0, 0, RUNNER_OPEN))
        brace_length = (hinge_open - start_open).length
        bpy.ops.mesh.primitive_cylinder_add(vertices=8, radius=0.0068, depth=1.0, location=(start_open + hinge_open) * .5)
        brace = bpy.context.object
        brace.name = f"bamboo-short-rib-{rib + 1:02d}"
        brace.parent = root
        brace.data.materials.append(bamboo_light)
        brace.rotation_mode = "QUATERNION"
        previous_rotation = None
        for frame in range(FRAME_OPEN, FRAME_CLOSED + 1):
            joint = joint_at(rib_joints[rib], frame)
            height = runner_positions[frame]
            vertical = joint.z - height
            horizontal = math.sqrt(max(0.0, brace_length ** 2 - vertical ** 2))
            anchor = max(-.065, min(.065, math.hypot(joint.x, joint.y) - horizontal))
            start = radial * anchor + Vector((0, 0, height))
            direction = joint - start
            rotation = Vector((0, 0, 1)).rotation_difference(direction.normalized())
            if previous_rotation is not None and previous_rotation.dot(rotation) < 0:
                rotation = Quaternion(tuple(-component for component in rotation))
            previous_rotation = rotation.copy()
            brace.location = (start + joint) * .5
            brace.rotation_quaternion = rotation
            brace.scale = (1.0, 1.0, direction.length)
            brace.keyframe_insert(data_path="location", frame=frame, group="Umbrella Fold")
            brace.keyframe_insert(data_path="rotation_quaternion", frame=frame, group="Umbrella Fold")
            brace.keyframe_insert(data_path="scale", frame=frame, group="Umbrella Fold")
        action = brace.animation_data.action
        for curve in action.fcurves:
            for key in curve.keyframe_points:
                key.interpolation = "LINEAR"
        push_into_shared_nla(brace, action)

    make_handle_and_hardware(root, bamboo, bamboo_light, silk, runner_positions)

    # Native source opens at the finished design pose and exposes the animation
    # as a single NLA track that GLB exports as a reversible clip.
    scene = bpy.context.scene
    scene.frame_start = FRAME_OPEN
    scene.frame_end = FRAME_CLOSED
    scene.render.fps = 30
    scene.frame_set(FRAME_OPEN)
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 16
    scene.world.color = (0.72, 0.72, 0.72)
    # Preserve any existing .blend1 recovery file when rebuilding the source.
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=BLEND_PATH)

    bpy.ops.object.select_all(action="DESELECT")
    root.select_set(True)
    bpy.context.view_layer.objects.active = root
    bpy.ops.export_scene.gltf(
        filepath=GLB_PATH,
        export_format="GLB",
        export_yup=True,
        export_animations=True,
        export_animation_mode="NLA_TRACKS",
        export_nla_strips=True,
        export_frame_range=True,
        export_frame_step=1,
        export_force_sampling=True,
        export_morph=True,
        export_morph_animation=True,
        export_skins=True,
        export_materials="EXPORT",
        export_normals=True,
        export_texcoords=True,
        export_tangents=False,
        export_apply=True,
        export_extras=True,
        export_lights=False,
        export_cameras=False,
        export_image_format="AUTO",
    )
    print("Created Blender umbrella:", BLEND_PATH)
    print("Created animated GLB:", GLB_PATH)


build_model()
