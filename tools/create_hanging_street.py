"""Build and pre-render the three lightweight layers used by the 2.5D street.

Run:
  blender --background --factory-startup --python tools/create_hanging_street.py

The runtime does not render this geometry. The far street and the two near
shopfront layers are rendered once and moved at different speeds by CSS/JS.
"""
import math
import os
import random

import bpy
from mathutils import Vector


ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, "assets", "gallery", "street")
RESOLUTION = (1920, 1080)


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for datablocks in (bpy.data.materials, bpy.data.meshes, bpy.data.cameras, bpy.data.lights):
        for block in list(datablocks):
            if block.users == 0:
                datablocks.remove(block)


def collection(name):
    result = bpy.data.collections.get(name)
    if result is None:
        result = bpy.data.collections.new(name)
        bpy.context.scene.collection.children.link(result)
    return result


def move_to_collection(obj, target):
    for source in list(obj.users_collection):
        source.objects.unlink(obj)
    target.objects.link(obj)
    return obj


def material(name, color, roughness=.8, metallic=0.0, emission=0.0):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*color, 1)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    nodes.clear()
    output = nodes.new("ShaderNodeOutputMaterial")
    shader = nodes.new("ShaderNodeBsdfPrincipled")
    shader.inputs["Base Color"].default_value = (*color, 1)
    shader.inputs["Roughness"].default_value = roughness
    shader.inputs["Metallic"].default_value = metallic
    if emission > 0:
        if "Emission Color" in shader.inputs:
            shader.inputs["Emission Color"].default_value = (*color, 1)
            shader.inputs["Emission Strength"].default_value = emission
        else:
            shader.inputs["Emission"].default_value = (*color, 1)
            shader.inputs["Emission Strength"].default_value = emission
    mat.node_tree.links.new(shader.outputs["BSDF"], output.inputs["Surface"])
    return mat


def add_material(obj, mat):
    obj.data.materials.append(mat)


def box(name, location, dimensions, mat, target, rotation=(0, 0, 0), bevel=.02):
    bpy.ops.mesh.primitive_cube_add(size=1, location=location, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = dimensions
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel > 0:
        modifier = obj.modifiers.new("Soft carved edges", "BEVEL")
        modifier.width = bevel
        modifier.segments = 2
    add_material(obj, mat)
    move_to_collection(obj, target)
    return obj


def cylinder(name, location, radius, depth, mat, target, rotation=(0, 0, 0), vertices=24):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=location, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    add_material(obj, mat)
    move_to_collection(obj, target)
    return obj


def sphere(name, location, scale, mat, target, segments=20):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=max(8, segments // 2), location=location)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    add_material(obj, mat)
    move_to_collection(obj, target)
    return obj


def display_umbrella(name, location, radius, mat, target):
    bpy.ops.mesh.primitive_cone_add(
        vertices=32, radius1=radius, radius2=.018, depth=.045,
        location=location, rotation=(0, math.pi / 2, 0)
    )
    canopy = bpy.context.object
    canopy.name = name
    canopy.data.materials.append(mat)
    move_to_collection(canopy, target)
    shaft = cylinder(
        name + "-shaft", (location[0] - .24, location[1], location[2] - .22),
        .012, .9, canopy.data.materials[0], target,
        rotation=(0, math.pi / 2, 0), vertices=12
    )
    return canopy, shaft


def stone_material():
    mat = material("Cobblestone", (.20, .22, .23), roughness=.93)
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    principled = nodes.get("Principled BSDF")
    tex = nodes.new("ShaderNodeTexCoord")
    mapping = nodes.new("ShaderNodeMapping")
    mapping.inputs["Scale"].default_value = (4.8, 12.0, 4.0)
    brick = nodes.new("ShaderNodeTexBrick")
    brick.inputs["Color1"].default_value = (.24, .25, .25, 1)
    brick.inputs["Color2"].default_value = (.15, .17, .18, 1)
    brick.inputs["Mortar"].default_value = (.12, .13, .13, 1)
    brick.inputs["Scale"].default_value = 2.4
    brick.inputs["Mortar Size"].default_value = .018
    brick.inputs["Bias"].default_value = 0.0
    noise = nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = 42
    noise.inputs["Detail"].default_value = 4
    noise.inputs["Roughness"].default_value = .72
    bump = nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = .11
    links.new(tex.outputs["Object"], mapping.inputs["Vector"])
    links.new(mapping.outputs["Vector"], brick.inputs["Vector"])
    links.new(mapping.outputs["Vector"], noise.inputs["Vector"])
    links.new(brick.outputs["Color"], principled.inputs["Base Color"])
    links.new(noise.outputs["Fac"], bump.inputs["Height"])
    links.new(bump.outputs["Normal"], principled.inputs["Normal"])
    return mat


def sky_material():
    mat = bpy.data.materials.new("Painted dawn sky")
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    nodes.clear()
    output = nodes.new("ShaderNodeOutputMaterial")
    emission = nodes.new("ShaderNodeEmission")
    tex = nodes.new("ShaderNodeTexCoord")
    separate = nodes.new("ShaderNodeSeparateXYZ")
    ramp = nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].position = .08
    ramp.color_ramp.elements[0].color = (.46, .66, .72, 1)
    ramp.color_ramp.elements[1].position = .92
    ramp.color_ramp.elements[1].color = (.91, .83, .66, 1)
    links.new(tex.outputs["Generated"], separate.inputs["Vector"])
    links.new(separate.outputs["Z"], ramp.inputs["Fac"])
    links.new(ramp.outputs["Color"], emission.inputs["Color"])
    emission.inputs["Strength"].default_value = 1.0
    links.new(emission.outputs["Emission"], output.inputs["Surface"])
    return mat


def add_storefront(target, side, y_center, depth_index, mats):
    inward = -side
    wall_x = side * (4.65 + depth_index * .06)
    facade_x = wall_x + inward * .42
    store_length = 4.2
    height = 3.15 + (depth_index % 2) * .26
    box(
        f"{side:+.0f}-store-shell-{depth_index}",
        (wall_x, y_center, height * .5),
        (1.1, store_length, height),
        mats["wall"], target, bevel=.055
    )
    box(
        f"{side:+.0f}-wood-front-{depth_index}",
        (facade_x, y_center, 1.52),
        (.11, store_length - .22, 2.55),
        mats["wood"], target, bevel=.025
    )
    box(
        f"{side:+.0f}-window-{depth_index}",
        (facade_x + inward * .07, y_center + .62, 1.48),
        (.055, 2.1, 1.42),
        mats["window"], target, bevel=.015
    )
    box(
        f"{side:+.0f}-window-recess-{depth_index}",
        (facade_x + inward * .12, y_center + .62, 1.48),
        (.035, 1.72, 1.08),
        mats["shop_interior"], target, bevel=.008
    )
    for lattice_index, local_y in enumerate((-.12, .43, 1.14)):
        box(
            f"{side:+.0f}-window-mullion-{depth_index}-{lattice_index}",
            (facade_x + inward * .15, y_center + local_y, 1.48),
            (.045, .045, 1.16),
            mats["beam"], target, bevel=.006
        )
    box(
        f"{side:+.0f}-door-{depth_index}",
        (facade_x + inward * .08, y_center - 1.28, 1.15),
        (.06, .82, 2.05),
        mats["door"], target, bevel=.018
    )
    for beam_index, local_y in enumerate((-1.95, -.7, .7, 1.95)):
        box(
            f"{side:+.0f}-post-{depth_index}-{beam_index}",
            (facade_x + inward * .1, y_center + local_y, 1.55),
            (.09, .11, 2.65),
            mats["beam"], target, bevel=.014
        )
    for level in (.38, 2.7):
        box(
            f"{side:+.0f}-rail-{depth_index}-{level}",
            (facade_x + inward * .1, y_center, level),
            (.09, store_length - .2, .12),
            mats["beam"], target, bevel=.014
        )
    box(
        f"{side:+.0f}-sign-{depth_index}",
        (facade_x + inward * .16, y_center + .1, 2.36),
        (.08, 1.35, .56),
        mats["paper"], target, bevel=.025
    )
    box(
        f"{side:+.0f}-sign-frame-{depth_index}",
        (facade_x + inward * .12, y_center + .1, 2.36),
        (.055, 1.52, .68),
        mats["beam"], target, bevel=.02
    )
    box(
        f"{side:+.0f}-counter-{depth_index}",
        (facade_x + inward * .44, y_center - .7, .48),
        (.72, 1.45, .13),
        mats["wood"], target, bevel=.025
    )
    for leg_index, local_y in enumerate((-.58, .58)):
        box(
            f"{side:+.0f}-counter-leg-{depth_index}-{leg_index}",
            (facade_x + inward * .44, y_center - .7 + local_y, .23),
            (.08, .08, .44),
            mats["beam"], target, bevel=.01
        )
    display_colors = (mats["umbrella_red"], mats["umbrella_blue"], mats["umbrella_green"])
    for display_index, local_y in enumerate((.2, .75, 1.3)):
        display_umbrella(
            f"{side:+.0f}-window-umbrella-{depth_index}-{display_index}",
            (facade_x + inward * .23, y_center + local_y, 1.72 + (display_index % 2) * .14),
            .31, display_colors[(depth_index + display_index) % len(display_colors)], target
        )
    box(
        f"{side:+.0f}-roof-{depth_index}",
        (wall_x + inward * .08, y_center, height + .16),
        (1.75, store_length + .55, .21),
        mats["roof"], target, rotation=(0, inward * .115, 0), bevel=.04
    )
    box(
        f"{side:+.0f}-eave-{depth_index}",
        (facade_x + inward * .45, y_center, height + .02),
        (.66, store_length + .72, .14),
        mats["roof_edge"], target, rotation=(0, inward * .08, 0), bevel=.025
    )
    lantern_x = facade_x + inward * .5
    for lantern_index, local_y in enumerate((-.95, .95)):
        z = 2.22 - lantern_index * .12
        cylinder(
            f"{side:+.0f}-lantern-cap-{depth_index}-{lantern_index}",
            (lantern_x, y_center + local_y, z + .28),
            .055, .045, mats["dark_wood"], target
        )
        sphere(
            f"{side:+.0f}-lantern-{depth_index}-{lantern_index}",
            (lantern_x, y_center + local_y, z),
            (.115, .115, .2), mats["lantern"], target, segments=16
        )
        cylinder(
            f"{side:+.0f}-lantern-cord-{depth_index}-{lantern_index}",
            (lantern_x, y_center + local_y, z + .49),
            .006, .32, mats["dark_wood"], target
        )
        cylinder(
            f"{side:+.0f}-lantern-tail-{depth_index}-{lantern_index}",
            (lantern_x, y_center + local_y, z - .29),
            .024, .09, mats["red"], target
        )


def add_building_silhouette(target, x, y, width, height, mat):
    box(f"far-building-{x}-{y}", (x, y, height * .5), (width, 2.5, height), mat, target, bevel=.03)
    box(f"far-roof-{x}-{y}", (x, y, height + .1), (width + .7, 2.9, .16), mat, target, rotation=(0, 0, 0), bevel=.02)


def add_mountain(target, y, z_base, width, height, mat, seed):
    random.seed(seed)
    points = []
    for index in range(7):
        x = -width * .5 + width * index / 6
        z = z_base + height * (.15 + .7 * random.random()) * math.sin(math.pi * index / 6)
        points.append((x, y, z))
    points += [(width * .5, y, z_base), (-width * .5, y, z_base)]
    mesh = bpy.data.meshes.new("Mountain silhouette")
    mesh.from_pydata(points[:-2], [], [tuple(range(len(points)))])
    mesh.update()
    obj = bpy.data.objects.new("Mountain silhouette", mesh)
    target.objects.link(obj)
    add_material(obj, mat)
    return obj


def add_bridge(target, mats):
    center_y = -24.8
    outer, inner = 2.82, 2.02
    segments = 30
    vertices = []
    for radius in (outer, inner):
        for index in range(segments + 1):
            angle = math.pi * index / segments
            vertices.append((math.cos(angle) * radius, center_y, math.sin(angle) * radius))
    faces = []
    for index in range(segments):
        outer0 = index
        outer1 = index + 1
        inner0 = segments + 1 + index
        inner1 = segments + 2 + index
        faces.append((outer0, outer1, inner1, inner0))
    mesh = bpy.data.meshes.new("Distant stone arch")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    arch = bpy.data.objects.new("Distant stone arch", mesh)
    target.objects.link(arch)
    add_material(arch, mats["bridge"])
    solid = arch.modifiers.new("Bridge thickness", "SOLIDIFY")
    solid.thickness = .48
    box("bridge-deck", (0, center_y - .08, .56), (9.6, .72, .24), mats["bridge"], target, bevel=.03)
    for rail_z in (.96, 1.23):
        box("bridge-rail", (0, center_y + .28, rail_z), (10.2, .11, .09), mats["bridge"], target, bevel=.02)
    for x in (-4.8, 4.8):
        box("bridge-bank", (x, center_y, 1.0), (1.0, 1.4, 2.0), mats["bridge"], target, bevel=.04)


def add_far_pavilion(target, mats):
    box("lake-pavilion-platform", (0, -28.5, .18), (4.2, 2.8, .28), mats["bridge"], target, bevel=.04)
    box("lake-pavilion-body", (0, -28.5, 1.18), (2.5, 1.7, 1.9), mats["wall"], target, bevel=.035)
    for x in (-1.05, 1.05):
        for y in (-29.15, -27.85):
            cylinder("lake-pavilion-column", (x, y, 1.35), .07, 2.4, mats["beam"], target)
    box("lake-pavilion-roof", (0, -28.5, 2.34), (3.85, 2.65, .18), mats["roof"], target, rotation=(.06, 0, 0), bevel=.045)
    box("lake-pavilion-eave", (0, -28.5, 2.22), (4.35, 3.0, .11), mats["roof_edge"], target, bevel=.025)
    for x in (-1.5, 1.5):
        sphere("lake-pavilion-lantern", (x, -27.72, 1.58), (.08, .08, .13), mats["lantern"], target, segments=14)


def look_at(camera, target):
    direction = Vector(target) - camera.location
    camera.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


def render_layer(name, target_collection, all_collections, transparent=True):
    scene = bpy.context.scene
    for coll in all_collections:
        visible = coll == target_collection
        for obj in coll.objects:
            obj.hide_render = not visible
    scene.render.film_transparent = transparent
    scene.render.filepath = os.path.join(OUT_DIR, name)
    bpy.ops.render.render(write_still=True)


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    print("STREET: clear", flush=True)
    clear_scene()
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x, scene.render.resolution_y = RESOLUTION
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.image_settings.color_depth = "8"
    scene.render.film_transparent = True
    scene.render.use_file_extension = True
    scene.render.fps = 30
    scene.render.engine = "BLENDER_EEVEE"
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "Medium High Contrast"
    scene.view_settings.exposure = 0.15
    scene.world.use_nodes = True
    world_nodes = scene.world.node_tree.nodes
    world_nodes["Background"].inputs["Color"].default_value = (.48, .58, .58, 1)
    world_nodes["Background"].inputs["Strength"].default_value = .62
    print("STREET: scene", flush=True)

    far = collection("Street_Far")
    left = collection("Street_Left")
    right = collection("Street_Right")
    stage = collection("Street_Stage")
    collections = (far, left, right)

    mats = {
        "sky": sky_material(),
        "stone": stone_material(),
        "wall": material("Lime plaster", (.44, .42, .36), .94),
        "wood": material("Old cedar", (.22, .12, .075), .9),
        "beam": material("Dark timber", (.10, .055, .035), .86),
        "dark_wood": material("Lantern suspension wood", (.075, .04, .025), .9),
        "roof": material("Blue grey roof tiles", (.075, .10, .10), .82),
        "roof_edge": material("Roof edge timber", (.17, .09, .055), .88),
        "window": material("Warm paper window", (.83, .63, .34), .78, emission=.24),
        "door": material("Recessed door", (.14, .075, .04), .92),
        "paper": material("Shop sign paper", (.72, .61, .44), .88),
        "lantern": material("Warm lantern silk", (.86, .29, .08), .7, emission=.28),
        "red": material("Vermilion tassel", (.56, .05, .035), .82),
        "foliage": material("Street greenery", (.10, .23, .12), .94),
        "water": material("West Lake distant water", (.20, .38, .40), .2, metallic=.1),
        "bridge": material("Distant bridge stone", (.33, .35, .33), .94),
        "mountain_far": material("Distant mountain haze", (.30, .42, .40), 1.0),
        "mountain_near": material("Near mountain haze", (.23, .35, .32), 1.0),
        "banner": material("Red festival banner", (.56, .07, .045), .82),
        "shop_interior": material("Deep shop interior", (.045, .035, .026), .96),
        "umbrella_red": material("Display umbrella coral", (.56, .10, .08), .76),
        "umbrella_blue": material("Display umbrella indigo", (.065, .16, .33), .72),
        "umbrella_green": material("Display umbrella jade", (.08, .30, .22), .72),
    }
    print("STREET: materials", flush=True)

    box("sky-backdrop", (0, -42, 11), (70, .2, 28), mats["sky"], far, bevel=0)
    print("STREET: sky", flush=True)
    add_mountain(far, -38, .0, 55, 12, mats["mountain_far"], 11)
    print("STREET: mountain far", flush=True)
    add_mountain(far, -31, .1, 42, 8, mats["mountain_near"], 19)
    print("STREET: mountain near", flush=True)
    box("lake", (0, -27, .03), (35, 27, .05), mats["water"], far, bevel=0)
    box("street-floor", (0, -8.5, -.05), (8.2, 34, .10), mats["stone"], far, bevel=0)
    box("street-centre-stones", (0, -8.5, .006), (5.0, 34, .025), mats["stone"], far, bevel=0)
    print("STREET: ground", flush=True)

    add_bridge(far, mats)
    add_far_pavilion(far, mats)
    print("STREET: far", flush=True)

    # Near shop rows are rendered separately with alpha for differential motion.
    for side, target in ((-1, left), (1, right)):
        for index, y in enumerate((4.2, -.2, -4.6, -9.0)):
            add_storefront(target, side, y, index, mats)
        # A few clustered leafy branches soften the hard roof line.
        for index, y in enumerate((2.8, -2.0, -7.0)):
            x = side * (3.45 + index * .11)
            for leaf in range(5):
                sphere(
                    f"{side:+.0f}-leaf-{index}-{leaf}",
                    (x + side * .04 * (leaf % 2), y + (leaf - 2) * .27, 3.25 + .13 * (leaf % 3)),
                    (.22, .16, .12), mats["foliage"], target, segments=12
                )
        print(f"STREET: side {side}", flush=True)

    # Vertical banners give the near storefronts readable scale cues.
    for side, target in ((-1, left), (1, right)):
        for index, y in enumerate((4.5, -.1, -5.0)):
            x = side * 3.62
            box(
                f"{side:+.0f}-banner-cloth-{index}",
                (x, y, 2.2),
                (.055, .32, 1.35),
                mats["banner"], target, bevel=.01
            )
            box(
                f"{side:+.0f}-banner-rod-{index}",
                (x, y, 2.88),
                (.12, .62, .07),
                mats["dark_wood"] if "dark_wood" in mats else mats["beam"], target, bevel=.01
            )

    bpy.ops.object.camera_add(location=(0, 9.0, 1.72))
    camera = bpy.context.object
    camera.name = "Street perspective camera"
    camera.data.lens = 32
    camera.data.sensor_width = 36
    look_at(camera, (0, -25, 1.45))
    scene.camera = camera
    move_to_collection(camera, stage)

    bpy.ops.object.light_add(type="AREA", location=(-5, 2, 7))
    key = bpy.context.object
    key.name = "Soft eave light"
    key.data.energy = 1250
    key.data.shape = "DISK"
    key.data.size = 7
    look_at(key, (0, -7, 0))
    move_to_collection(key, stage)

    bpy.ops.object.light_add(type="AREA", location=(6, -1, 4))
    fill = bpy.context.object
    fill.name = "Warm shop bounce"
    fill.data.energy = 780
    fill.data.color = (1.0, .66, .39)
    fill.data.size = 5
    look_at(fill, (0, -8, 1.3))
    move_to_collection(fill, stage)
    print("STREET: render start", flush=True)

    render_layer("street-far.png", far, collections, transparent=False)
    print("STREET: far rendered", flush=True)
    render_layer("street-left.png", left, collections, transparent=True)
    print("STREET: left rendered", flush=True)
    render_layer("street-right.png", right, collections, transparent=True)
    print(f"Rendered hanging street layers to {OUT_DIR}")


if __name__ == "__main__":
    main()
