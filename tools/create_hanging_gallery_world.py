"""Build the navigable hanging-gallery street as Blender meshes and export GLB.

The scene is built in metres with Blender Z up. The glTF exporter converts it
to Y up for Three.js. Materials are CC0 PBR maps listed in the gallery README.
"""
import math
import os
import random

import bpy
import bmesh
from mathutils import Vector

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MODEL_DIR = os.path.join(ROOT, 'assets', 'models')
MAP_DIR = os.path.join(ROOT, 'assets', 'gallery', 'materials')
BLEND_PATH = os.path.join(MODEL_DIR, 'hanging-gallery-street.blend')
GLB_PATH = os.path.join(MODEL_DIR, 'hanging-gallery-street.glb')
random.seed(1729)


def material(name, color, roughness=.85, texture=None, emission=0):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*color, 1)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    shader = next((node for node in nodes if node.type == 'BSDF_PRINCIPLED'), None)
    if shader is None:
        shader = nodes.new('ShaderNodeBsdfPrincipled')
    output = next((node for node in nodes if node.type == 'OUTPUT_MATERIAL'), None)
    if output is None:
        output = nodes.new('ShaderNodeOutputMaterial')
    if not any(link.from_node == shader and link.to_node == output for link in mat.node_tree.links):
        mat.node_tree.links.new(shader.outputs['BSDF'], output.inputs['Surface'])
    shader.inputs['Base Color'].default_value = (*color, 1)
    shader.inputs['Roughness'].default_value = roughness
    if emission:
        emission_color = shader.inputs.get('Emission Color') or shader.inputs.get('Emission')
        emission_color.default_value = (*color, 1)
        shader.inputs['Emission Strength'].default_value = emission
    if texture:
        image_node = mat.node_tree.nodes.new('ShaderNodeTexImage')
        image_node.image = bpy.data.images.load(os.path.join(MAP_DIR, texture + '-color.jpg'), check_existing=True)
        image_node.image.pack()
        mat.node_tree.links.new(image_node.outputs['Color'], shader.inputs['Base Color'])
        normal_path = os.path.join(MAP_DIR, texture + '-normal.jpg')
        if os.path.isfile(normal_path):
            normal_image = mat.node_tree.nodes.new('ShaderNodeTexImage')
            normal_image.image = bpy.data.images.load(normal_path, check_existing=True)
            normal_image.image.colorspace_settings.name = 'Non-Color'
            normal_image.image.pack()
            normal_map = mat.node_tree.nodes.new('ShaderNodeNormalMap')
            normal_map.inputs['Strength'].default_value = .34
            mat.node_tree.links.new(normal_image.outputs['Color'], normal_map.inputs['Color'])
            mat.node_tree.links.new(normal_map.outputs['Normal'], shader.inputs['Normal'])
    return mat


class Batch:
    def __init__(self, name, mat):
        self.name, self.mat = name, mat
        self.vertices, self.faces, self.face_uv, self.smooth = [], [], [], []

    def face(self, vertices, uvs=None, smooth=False):
        start = len(self.vertices)
        self.vertices.extend([tuple(v) for v in vertices])
        self.faces.append(tuple(range(start, start + len(vertices))))
        self.face_uv.append(uvs or [(0, 0), (1, 0), (1, 1), (0, 1)][:len(vertices)])
        self.smooth.append(smooth)

    def box(self, center, size, uvscale=1):
        x, y, z = center
        a, b, c = (value * .5 for value in size)
        p = [(x-a,y-b,z-c),(x+a,y-b,z-c),(x+a,y+b,z-c),(x-a,y+b,z-c),
             (x-a,y-b,z+c),(x+a,y-b,z+c),(x+a,y+b,z+c),(x-a,y+b,z+c)]
        for indices, dims in (((0,3,2,1),(size[0],size[1])), ((4,5,6,7),(size[0],size[1])),
                              ((0,1,5,4),(size[0],size[2])), ((1,2,6,5),(size[1],size[2])),
                              ((2,3,7,6),(size[0],size[2])), ((3,0,4,7),(size[1],size[2]))):
            u, v = max(.08,dims[0]*uvscale), max(.08,dims[1]*uvscale)
            self.face([p[i] for i in indices], [(0,0),(u,0),(u,v),(0,v)])

    def rod(self, start, end, radius, sides=10):
        start, end = Vector(start), Vector(end)
        axis = (end - start).normalized()
        reference = Vector((0, 0, 1)) if abs(axis.z) < .9 else Vector((0, 1, 0))
        first = axis.cross(reference).normalized()
        second = axis.cross(first).normalized()
        for i in range(sides):
            a, b = math.tau*i/sides, math.tau*(i+1)/sides
            r0 = (first*math.cos(a) + second*math.sin(a))*radius
            r1 = (first*math.cos(b) + second*math.sin(b))*radius
            self.face((start+r0,start+r1,end+r1,end+r0), smooth=True)

    def post(self, x, y, bottom, top, width, depth, bevel=.018):
        """A subtly chamfered square timber post, with a real eight-sided section."""
        a,b=width*.5,depth*.5
        c=min(bevel,a*.45,b*.45)
        ring=[(-a+c,-b),(a-c,-b),(a,-b+c),(a,b-c),(a-c,b),(-a+c,b),(-a,b-c),(-a,-b+c)]
        for i in range(8):
            p,q=ring[i],ring[(i+1)%8]
            self.face(((x+p[0],y+p[1],bottom),(x+q[0],y+q[1],bottom),
                       (x+q[0],y+q[1],top),(x+p[0],y+p[1],top)),
                      [(0,0),(1,0),(1,(top-bottom)*1.2),(0,(top-bottom)*1.2)])

    def ellipsoid(self, center, scale, segments=24, rings=12):
        cx,cy,cz = center
        sx,sy,sz = scale
        def p(a,b):
            return (cx+sx*math.sin(b)*math.cos(a), cy+sy*math.sin(b)*math.sin(a), cz+sz*math.cos(b))
        for j in range(rings):
            for i in range(segments):
                a0,a1 = math.tau*i/segments, math.tau*(i+1)/segments
                b0,b1 = math.pi*j/rings, math.pi*(j+1)/rings
                self.face((p(a1,b0),p(a0,b0),p(a0,b1),p(a1,b1)),
                          [((i+1)/segments,j/rings),(i/segments,j/rings),
                           (i/segments,(j+1)/rings),((i+1)/segments,(j+1)/rings)], True)

    def build(self, location=None):
        mesh = bpy.data.meshes.new(self.name + ' Mesh')
        mesh.from_pydata(self.vertices, [], self.faces)
        mesh.update()
        uv = mesh.uv_layers.new(name='UVMap')
        for polygon, values, smooth in zip(mesh.polygons, self.face_uv, self.smooth):
            polygon.use_smooth = smooth
            for loop, value in zip(polygon.loop_indices, values):
                uv.data[loop].uv = value
        if self.name in ('RoofTiles', 'LanternSilk', 'MountainNear', 'MountainFar'):
            bm = bmesh.new()
            bm.from_mesh(mesh)
            bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.00001)
            bm.to_mesh(mesh)
            bm.free()
            mesh.update()
        obj = bpy.data.objects.new(self.name, mesh)
        bpy.context.collection.objects.link(obj)
        obj.data.materials.append(self.mat)
        if location is not None: obj.location = location
        return obj


def hanging_shop_sign(batches, side, y, z=2.32, width=.27, height=.58):
    """A compact timber-framed paper plaque, not a plain strip of red cloth."""
    wood,dark,paper=(batches[k] for k in ('Timber','DarkTimber','CraftPaper'))
    wood.box((side*3.34,y,z),(.075,width+.10,height+.10),.85)
    paper.box((side*3.292,y,z),(.018,width,height),.8)
    for offset in (-width*.36,width*.36):
        dark.rod((side*3.34,y+offset,2.99),(side*3.34,y+offset,z+height*.5),.009,6)
    for edge in (-1,1):
        wood.box((side*3.275,y+edge*(width*.5+.01),z),(.025,.018,height),.8)
    wood.box((side*3.275,y,z+height*.5-.005),(.025,width+.035,.022),.8)
    wood.box((side*3.275,y,z-height*.5+.005),(.025,width+.035,.022),.8)


def shop_props(batches, side, index):
    """Distinct, restrained fixtures make neighbouring shops read as different trades."""
    y=2.0+index*4.7
    variation=(index*3+(1 if side>0 else 0))%7
    wood,dark,stone,red,paper,paint,leaves=(batches[k] for k in
        ('Timber','DarkTimber','StoneTrim','RedDetails','CraftPaper','Pigment','DecorLeaves'))
    x=side*3.34
    cy=y+(-1.05 if side<0 else .55)

    if variation==0:
        # Umbrella-maker: a low timber rack of restrained folded silk bolts.
        wood.box((x,cy,.09),(.60,1.08,.14),1.2)
        for dx in (-.25,.25):
            for dy in (-.48,.48): wood.rod((x+dx,cy+dy,.13),(x+dx,cy+dy,.95),.026,10)
        for z in (.30,.72,.91):
            for dx in (-.25,.25): wood.rod((x+dx,cy-.48,z),(x+dx,cy+.48,z),.020,8)
        cloths=(batches['FoldedSilkIndigo'],batches['FoldedSilkRose'])
        for n,offset in enumerate((-.32,0,.32)):
            cloth=cloths[(n+index)%2]
            cloth.box((side*3.34,cy+offset,.23),(.40,.24,.12),.9)
            cloth.box((side*3.34,cy+offset,.34),(.36,.22,.08),.9)
    elif variation==1:
        # Calligraphy workshop: loose paper, ink and a wooden brush rest.
        x=side*3.30; cy=y-.35
        wood.box((x,cy,.78),(.78,1.42,.11),1.1)
        for dx in (-.31,.31):
            for dy in (-.58,.58): wood.box((x+dx,cy+dy,.39),(.085,.085,.78),1)
        paper.box((x,cy-.20,.845),(.50,.60,.014))
        for n,dy in enumerate((.18,.49,.80)):
            paper.box((x-side*.11,cy+dy,.875),(.17,.19,.018),.8)
            paint.box((x-side*.11,cy+dy,.891),(.10,.12,.012),.8)
        cup_x=x-side*.22
        wood.rod((cup_x,cy-.42,.86),(cup_x,cy-.42,1.02),.075,12)
        for n,offset in enumerate((-.055,0,.055)):
            brush_x=cup_x+side*offset
            dark.rod((brush_x,cy-.42,.95),(brush_x+side*.035,cy-.42,1.33-(n%2)*.09),.014,7)
            paint.rod((brush_x+side*.035,cy-.42,1.25-(n%2)*.09),(brush_x+side*.035,cy-.42,1.33-(n%2)*.09),.018,6)
    elif variation==2:
        # Timber shop: visibly stacked slatted crates and rolled bamboo mats.
        for n,(offset,width,height) in enumerate(((-.50,.42,.34),(.02,.55,.50),(.54,.38,.27))):
            wood.box((side*3.35,y+offset,.12+height*.5),(width,.38,height),1.3)
            for z in (.16+height*.28,.16+height*.72):
                dark.rod((side*3.35,y+offset-.20,z),(side*3.35,y+offset+.20,z),.018,8)
        for n,offset in enumerate((-.35,.10,.55)):
            dark.rod((side*3.28,y+offset,.65),(side*3.28,y+offset,1.05),.022,8)
            batches['FoldedSilkIndigo' if n%2 else 'FoldedSilkRose'].rod(
                (side*3.28,y+offset,.70),(side*3.28,y+offset,1.00),.09,10)
    elif variation==3:
        # Cloth merchant: folded bolts arranged on an open timber counter.
        wood.box((side*3.32,y-.35,.64),(.54,1.48,.13),1.1)
        for dx in (-.23,.23): wood.box((side*3.32+dx,y-.35,.34),(.07,.08,.58),1)
        cloths=(batches['FoldedSilkIndigo'],batches['FoldedSilkRose'])
        for n,offset in enumerate((-.79,-.43,-.07,.29,.65)):
            cloth=cloths[(n+abs(index))%2]
            cloth.ellipsoid((side*3.32,y+offset,.77+(n%2)*.12),(.18,.22,.052),18,10)
            cloth.ellipsoid((side*3.32,y+offset,.83+(n%2)*.12),(.15,.19,.022),18,8)
    elif variation==4:
        # A domestic frontage: a long timber bench, stacked firewood and a plant.
        wood.box((side*3.42,y-.55,.35),(.42,1.18,.12),1.1)
        for offset in (-.98,-.12): wood.box((side*3.42,y+offset,.19),(.40,.09,.28),1.2)
        for n,offset in enumerate((.58,.76,.94,1.12)):
            wood.rod((side*3.30,y+offset,.10),(side*3.30,y+offset,.32),.045,10)
        wood.rod((side*3.30,y+1.66,.06),(side*3.30,y+1.66,.35),.17,16)
        for n in range(13):
            a=math.tau*n/13
            leaves.rod((side*3.30,y+1.66,.31),(side*3.30+.18*math.cos(a),y+1.66+.18*math.sin(a),.60+(n%3)*.05),.019,6)
    elif variation==5:
        # Tall open display shelves with folded cloth and paper packages.
        for dx in (-.22,.22): wood.rod((side*3.36+dx,y-.56,.13),(side*3.36+dx,y-.56,1.55),.038,8)
        for z in (.30,.76,1.22,1.52):
            wood.box((side*3.36,y-.56,z),(.52,1.24,.07),1.2)
        for n,offset in enumerate((-.88,-.48,-.08,.32)):
            fabric=batches['FoldedSilkRose' if n%2 else 'FoldedSilkIndigo']
            fabric.box((side*3.36,y+offset,1.38),(.18,.30,.24),.9)
        for n,offset in enumerate((-.80,-.25,.36)):
            paper.box((side*3.26,y+offset,.40),(.16,.18,.11),.8)
    else:
        # A quiet threshold with open bamboo baskets and a low stool, unlike
        # the shop counters. Open slats keep these from reading as ceramic jars.
        wood.box((side*3.43,y-.45,.22),(.38,.46,.40),1.4)
        for z in (.10,.23,.36): dark.box((side*3.22,y-.45,z),(.025,.48,.025),1.5)
        for offset,radius,height in ((.43,.18,.36),(.90,.14,.30)):
            cx,cy=side*3.32,y+offset
            sides=10
            for level in range(4):
                t=level/3
                z=.08+t*height
                ring_radius=radius*(.80+.20*t)
                for spoke in range(sides):
                    a0=math.tau*spoke/sides; a1=math.tau*(spoke+1)/sides
                    p0=(cx+ring_radius*math.cos(a0),cy+ring_radius*math.sin(a0),z)
                    p1=(cx+ring_radius*math.cos(a1),cy+ring_radius*math.sin(a1),z)
                    dark.rod(p0,p1,.010,6)
            for spoke in range(sides):
                angle=math.tau*spoke/sides
                r0,r1=radius*.80,radius
                wood.rod((cx+r0*math.cos(angle),cy+r0*math.sin(angle),.08),
                         (cx+r1*math.cos(angle),cy+r1*math.sin(angle),.08+height),.013,7)
            wood.rod((cx-radius,cy,.08+height),(cx+radius,cy,.08+height),.014,8)
        wood.box((side*3.43,y+1.52,.32),(.42,.82,.11),1.2)
        for offset in (.18,1.22): wood.box((side*3.43,y+offset,.17),(.08,.08,.32),1.1)

    # Some trades display a small framed plaque beneath the eaves.
    if variation in (0,2,5):
        sign_y=y+(1.65 if side<0 else -1.55)
        dark.rod((side*3.33,sign_y-.23,2.97),(side*3.33,sign_y+.23,2.97),.025,8)
        hanging_shop_sign(batches,side,sign_y,2.34,.24,.54)


def roof(batch, side, y, length, eave_height, ridge_height, variation, depth=3.3):
    # Curved, finely corrugated tile surface, not a flat roof-colored box.
    # Keep the close storefronts finely modeled; the far roofs dissolve into
    # perspective and do not need the same dense tessellation.
    across, along = (24, 100) if variation <= 8 else (16, 48)
    def point(i, j):
        t, u = i/across, j/along
        x = side * (3.22 + t * depth)
        yy = y - length*.52 + u * length*1.04
        z = eave_height + (ridge_height-eave_height)*math.sin(t*math.pi)**.9
        z += .035*math.cos(u*length*math.tau/.20) + .012*math.sin(t*math.tau*10)
        z += (.09+.035*(variation%3)) * (abs(2*u-1)**8)
        return (x, yy, z)
    for i in range(across):
        for j in range(along):
            batch.face((point(i,j),point(i+1,j),point(i+1,j+1),point(i,j+1)),
                       [(i/across*2,j/along*2),((i+1)/across*2,j/along*2),
                        ((i+1)/across*2,(j+1)/along*2),(i/across*2,(j+1)/along*2)], True)


def shop_awning(batch,side,y,length,height,detail=0):
    """A shallower tiled eave below the upper storey, with lifted corners."""
    across,along=(10,72) if detail <= 8 else (8,40)
    def point(i,j):
        t=i/across; u=j/along
        x=side*(3.20+t*.75)
        yy=y-length*.49+u*length*.98
        z=height+t*.30+.023*math.cos(u*length*math.tau/.19)+.055*abs(2*u-1)**8
        return (x,yy,z)
    for i in range(across):
        for j in range(along):
            batch.face((point(i,j),point(i+1,j),point(i+1,j+1),point(i,j+1)),
                       [(i/across,j/along*2),((i+1)/across,j/along*2),
                        ((i+1)/across,(j+1)/along*2),(i/across,(j+1)/along*2)],True)


def framed_window_joinery(batch,side,y,z,width,height):
    """Fine square-cut fretwork inside a recessed, paper-backed timber sash."""
    columns,rows=5,4
    cell_w,cell_h=width/columns,height/rows
    for col in range(columns):
        cy=y-width*.5+(col+.5)*cell_w
        for row in range(rows):
            cz=z-height*.5+(row+.5)*cell_h
            inset_w,inset_h=cell_w*.62,cell_h*.62
            for edge in (-1,1):
                batch.box((side*3.605,cy+edge*inset_w*.5,cz),(.025,.010,inset_h),1.4)
                batch.box((side*3.605,cy,cz+edge*inset_h*.5),(.025,inset_w,.010),1.4)


def open_shutter(batch,side,y,z,width,height,edge):
    """A lightly opened timber shutter projects away from the shopfront."""
    hinge_y=y+edge*(width*.5+.07)
    x0,x1=side*3.68,side*3.48
    y0,y1=hinge_y,hinge_y+edge*.27
    bottom,top=z-height*.48,z+height*.48
    corners=((x0,y0,bottom),(x1,y1,bottom),(x1,y1,top),(x0,y0,top))
    batch.face(corners,[(0,0),(.4,0),(.4,1.3),(0,1.3)])
    batch.face(tuple(reversed(corners)),[(0,0),(.4,0),(.4,1.3),(0,1.3)])
    for t in (.15,.33,.51,.69,.87):
        x=x0+(x1-x0)*t; yy=y0+(y1-y0)*t
        batch.rod((x,yy,bottom+.03),(x,yy,top-.03),.010,6)
    for zz in (bottom+.07,z,top-.07):
        batch.rod((x0,y0,zz),(x1,y1,zz),.014,6)


def projecting_bay(batches,side,y,z,width,height):
    """A projecting timber bay breaks the flat shopfront silhouette."""
    wood,dark,glass=(batches[k] for k in ('Timber','DarkTimber','WindowGlass'))
    front=side*3.38
    glass.box((side*3.43,y,z),(.045,width*.88,height*.86),1.2)
    for edge in (-1,1):
        wood.box((side*3.43,y+edge*(width*.5+.045),z),(.15,.075,height+.16),1.25)
        # Angled returns connect the projecting window to the original wall.
        dark.rod((side*3.68,y+edge*(width*.5-.04),z-height*.43),
                 (side*3.43,y+edge*(width*.5+.025),z-height*.43),.022,8)
    wood.box((front,y,z-height*.5-.05),(.21,width+.16,.085),1.3)
    wood.box((front,y,z+height*.5+.035),(.21,width+.19,.075),1.3)
    wood.box((front,y,z),(.07,.035,height*.9),1.4)
    wood.box((front,y,z),(.07,width*.87,.035),1.3)
    dark.rod((side*3.70,y-width*.52,z-height*.52),(front,y-width*.52,z-height*.52),.023,8)
    dark.rod((side*3.70,y+width*.52,z-height*.52),(front,y+width*.52,z-height*.52),.023,8)


def distant_storefront(batches,side,index):
    """Low-detail shop silhouettes carry both eaves to the distant shoreline."""
    y=2.0+index*4.7
    side_offset=1 if side>0 else 0
    profile=(index+3+side_offset*3)%7
    length=(3.9,4.9,3.7,5.0,4.2,4.8,3.8)[profile]
    eave=(3.45,4.05,4.72,5.05,3.85,4.92,3.62)[profile]
    depth=(2.15,4.25,1.75,3.45,4.55,2.35,3.05)[(index+side_offset)%7]
    front_x,back_x=3.96,3.96+depth
    wall=batches['AgedPlaster' if (index+side_offset)%4==2 else 'Plaster']
    wood,dark,glass,roof_tiles,stone=(batches[k] for k in
        ('Timber','DarkTimber','WindowGlass','RoofTiles','StoneTrim'))
    style=(index+side_offset*2)%4
    wall.box((side*back_x,y,eave*.5),(.14,length,eave),.45)
    for edge in (-1,1):
        wall.box((side*(front_x+depth*.5),y+edge*(length*.5-.06),eave*.5),
                 (depth,.12,eave),.45)
    wood.box((side*(front_x+depth*.5),y,.11),(depth,length,.15),.55)
    if style in (0,2):
        # Leave one broad opening to reveal a shaded interior and round timber posts.
        for edge in (-1,1):
            wall.box((side*front_x,y+edge*length*.39,eave*.48),(.13,length*.22,eave*.96),.45)
            wood.rod((side*(front_x-.08),y+edge*length*.36,.16),
                     (side*(front_x-.08),y+edge*length*.36,eave-.08),.07,10)
        dark.box((side*(front_x+depth*.72),y,1.38),(.07,length*.70,2.55),.55)
        wood.box((side*(front_x-.12),y,.82),(.28,length*.58,.13),.8)
        if style==2:
            wood.rod((side*(front_x-.10),y-length*.40,2.62),
                     (side*(front_x-.10),y+length*.40,2.62),.07,10)
    else:
        wall.box((side*front_x,y,eave*.49),(.13,length,eave*.98),.45)
        door_y=y+(-length*.22 if style==1 else length*.22)
        dark.box((side*(front_x-.08),door_y,1.24),(.07,.84,2.35),.7)
        for bay in (-length*.27,length*.27):
            if abs(bay-(door_y-y))<.9: continue
            dark.box((side*(front_x-.08),y+bay,1.96),(.06,.72,.92),.7)
            glass.box((side*(front_x-.12),y+bay,1.96),(.035,.56,.74))
            for edge in (-1,1):
                wood.rod((side*(front_x-.18),y+bay+edge*.35,1.48),
                         (side*(front_x-.18),y+bay+edge*.35,2.44),.025,8)
    for edge in (-1,1):
        wood.rod((side*(front_x-.11),y+edge*length*.48,.14),
                 (side*(front_x-.11),y+edge*length*.48,eave-.06),.045,10)
    for end in (-1,1):
        yy=y+end*(length*.5-.12)
        points=((side*front_x,yy,eave-.03),
                (side*(front_x+depth*.5),yy,eave+.78),
                (side*back_x,yy,eave-.03))
        wall.face(points if side*end>0 else tuple(reversed(points)),[(0,0),(.5,1),(1,0)])
    roof(roof_tiles,side,y,length,eave,eave+.82,18+profile,depth+.82)
    wood.rod((side*(3.22+(depth+.82)*.5),y-length*.53,eave+.84),
             (side*(3.22+(depth+.82)*.5),y+length*.53,eave+.84),.042,8)
    stone.box((side*(front_x-.07),y,.075),(.30,.9,.13),.55)


def storefront(batches, side, index):
    if index>=10:
        distant_storefront(batches,side,index)
        return
    y = 2.0 + index * 4.7
    side_offset=1 if side>0 else 0
    # Start the varied profiles close to the camera so the differences read
    # immediately instead of only appearing far down the street.
    # Opposing eaves share an elevation so cross-street umbrella lines stay
    # nearly level while each shop still varies in depth and facade style.
    profile=(index+3)%7
    # Strongly different footprints and rooflines create deep workshops,
    # shallow homes, and taller narrow shopfronts along the same street.
    length=(3.62,4.92,3.78,5.02,4.12,4.76,3.94)[profile]
    eave=(3.38,4.08,5.10,5.22,4.00,5.28,3.72)[profile]
    style=((1,0,3,2) if side<0 else (0,2,1,3))[(index*3+side_offset)%4]
    variation=(index*3+side_offset)%7
    depth_base=(4.65,1.48,3.92,1.86,4.88,1.62,2.92)[variation]
    depth_shift=(-.28,.18,.06,.32,-.12,.24,.02)[(index+side_offset)%7]
    front_x,depth=3.96,max(1.30,depth_base+depth_shift)
    back_x=front_x+depth
    center_x=(front_x+back_x)*.5
    wall, wood, dark, glass, roof_tiles, lamp, red, stone, paper = (batches[k] for k in
        ('Plaster','Timber','DarkTimber','WindowGlass','RoofTiles','LanternSilk','RedDetails','StoneTrim','CraftPaper'))
    if (side<0 and index%4==1) or (side>0 and index%4==3):
        wall=batches['AgedPlaster']
    # Real shallow interiors: rear and side masonry replace the former solid box.
    wall.box((side*back_x,y,eave*.5),(.16,length,eave),.48)
    for end in (-1,1):
        wall.box((side*center_x,y+end*(length*.5-.08),eave*.5),(depth,.16,eave),.48)
        # Each independent building ends in a plaster gable under its ridge.
        yy=y+end*(length*.5-.16)
        points=((side*front_x,yy,eave-.03),(side*(front_x+depth*.5),yy,eave+.88),(side*back_x,yy,eave-.03))
        wall.face(points if (side*end)>0 else tuple(reversed(points)),[(0,0),(.5,1),(1,0)])
    wood.box((side*center_x,y,.12),(depth,length,.17),.65)
    if style in (1,3):
        stone.box((side*(front_x+.05),y,.15),(.24,length,.30),.7)
    elif style==2:
        stone.box((side*(front_x-.02),y,.095),(.15,length,.19),.7)
    if style in (1,3):
        wall.box((side*3.96,y,1.62),(.13,length-.12,2.77), .48)
    elif style == 2:
        dark.box((side*5.90,y,1.62),(.13,length-.12,2.77), .7)
        wall.box((side*3.96,y+1.43,1.62),(.13,1.35,2.77),.48)
    else:
        dark.box((side*5.90,y,1.62),(.13,length-.12,2.77), .7)
        wall.box((side*3.96,y+1.50,1.62),(.13,1.12,2.77),.48)
    post_layout=((-length*.47,length*.47),(-length*.47,0,length*.47),
                 (-length*.47,-.10,length*.47),(-length*.42,-.14,.14,length*.42))[style]
    post_width=(.13,.16,.145,.105)[style]
    for offset in post_layout:
        wood.rod((side*3.86,y+offset,.17),(side*3.86,y+offset,3.34),post_width*.50,12)
    for z in (.35,2.96,3.18):
        wood.rod((side*3.85,y-length*.49,z),(side*3.85,y+length*.49,z),.052,12)
    # Four distinct facades: an open shop, plaster house, shuttered shop and
    # a narrow-window home. Their masonry, openings and fittings are meshes.
    windows = {
        0: [(-1.45,.80,1.72,1.70),(-.48,.80,1.72,1.70),(.52,.80,1.72,1.70)],
        1: [(-1.35,.82,1.05,1.83),(1.35,.82,1.05,1.83)],
        2: [(-1.30,.90,1.55,1.62),(.25,1.15,1.55,1.62)],
        3: [(-1.38,.70,1.15,1.77),(-.43,.70,1.15,1.77),(1.35,.70,1.15,1.77)]
    }[style]
    # Domestic buildings use one carefully framed window; open shops retain
    # broad displays. This changes the silhouette from one facade to the next.
    if profile in (1,5): windows=windows[-1:]
    for bay, width, height, center_z in windows:
        if (style==0 and bay<0) or (style==2 and bay<-.6):
            continue  # Open shop bay, with shelves and counter behind it.
        lattice=(style+index+(1 if side>0 else 0))%3
        if index%4==0: lattice=0
        dark.box((side*3.88,y+bay,center_z),(.16,width+.15,height+.16),1)
        (batches['WindowPaper'] if lattice==2 else glass).box((side*3.77,y+bay,center_z),(.045,width,height))
        # Layered jambs sit proud of the recessed paper/glass so the windows
        # read as fitted joinery rather than lines painted onto a flat wall.
        for edge in (-1,1):
            wood.box((side*3.79,y+bay+edge*(width*.5+.055),center_z),
                     (.12,.075,height+.20),1.1)
            wood.box((side*3.79,y+bay,center_z+edge*(height*.5+.06)),
                     (.12,width+.22,.085),1.1)
        wood.box((side*3.77,y+bay,center_z-height*.5-.13),(.12,width+.30,.075),1.2)
        wood.box((side*3.77,y+bay,center_z+height*.5+.12),(.12,width+.24,.06),1.1)
        # Fine inset beads catch the warm room light inside the heavier casing.
        for edge in ():
            frame_y=y+bay+edge*(width*.5+.025)
            wood.rod((side*3.55,frame_y,center_z-height*.5-.06),
                     (side*3.55,frame_y,center_z+height*.5+.06),.027,10)
            frame_z=center_z+edge*(height*.5+.035)
            wood.rod((side*3.55,y+bay-width*.5-.075,frame_z),
                     (side*3.55,y+bay+width*.5+.075,frame_z),.025,10)
        uprights=((-0.24,0.24),(-0.30,0,0.30),(0,))[lattice]
        crossbars=((-0.20,0.25),(0.12,),(-0.28,0.18))[lattice]
        for fraction in uprights:
            wood.rod((side*3.74,y+bay+width*fraction,center_z-height*.5),
                     (side*3.74,y+bay+width*fraction,center_z+height*.5),.013,8)
        for fraction in crossbars:
            z=center_z+height*fraction
            wood.rod((side*3.74,y+bay-width*.5,z),(side*3.74,y+bay+width*.5,z),.013,8)
        if False:
            framed_window_joinery(wood,side,y+bay,center_z,width-.06,height-.06)
            # Separate transom and bottom rail sit forward of the fine lattice.
            for fraction in (-.42,.36):
                wood.box((side*3.52,y+bay,center_z+height*fraction),(.055,width,.045),1.3)
        if False:
            open_shutter(wood,side,y+bay,center_z,width,height,1 if side<0 else -1)
    if False:
        bay,width,height,center_z=windows[-1]
        projecting_bay(batches,side,y+bay,center_z,width,height)
    door_offset = (1.47,0,1.50,.53)[style]
    if profile in (1,5): door_offset=-1.25 if profile==1 else 1.25
    if style==0:
        # Open workshop entry: a shaded recess and an inner door sit behind
        # the street-facing jamb, making the room depth visible.
        dark.box((side*(front_x+depth*.20),y+door_offset,1.36),(.06,.68,2.08),.8)
        wood.box((side*(front_x+depth*.25),y+door_offset,1.34),(.055,.48,1.98),1.1)
    else:
        panel_x=front_x+(.16 if style==1 else -.12 if style==3 else .04)
        wood.box((side*panel_x,y+door_offset,1.42),(.10,.88,2.22),1.3)
    for edge in (-1,1):
        dark.box((side*3.70,y+door_offset+edge*.43,1.42),(.07,.065,2.24),1.2)
    if style!=0:
        for offset in (-.31,-.10,.10,.31):
            dark.box((side*3.72,y+door_offset+offset,1.42),(.04,.020,2.13),1.4)
        for z in (.43,.90,1.92,2.47):
            wood.box((side*3.68,y+door_offset,z),(.065,.85,.045),1.2)
        dark.ellipsoid((side*3.69,y+door_offset+.25,1.22),(.025,.035,.035),10,6)
    if style in (0,2):
        wood.box((side*3.52,y-.65,.78),(.67,1.65,.12),1.4)
        for dy in (-.70,.70): wood.box((side*3.52,y-.65+dy,.38),(.09,.09,.72),1.5)
        shelf_x=front_x+depth*.72
        shelf_levels=(.95,1.43,1.91,2.34) if variation%2 else (1.02,1.62,2.22)
        for shelf in shelf_levels:
            wood.box((side*shelf_x,y-.85,shelf),(.48,1.45,.055),1.5)
            for slot_index,slot in enumerate((-.45,0,.45)):
                if (slot_index+round(shelf*100))%2:
                    fabric=batches['FoldedSilkIndigo' if slot_index%2 else 'FoldedSilkRose']
                    fabric_x=shelf_x-.10
                    fabric.ellipsoid((side*fabric_x,y-.85+slot,shelf+.075),(.15,.12,.045),16,8)
                    fabric.ellipsoid((side*fabric_x,y-.85+slot,shelf+.125),(.13,.105,.018),16,6)
                else:
                    paper.box((side*(shelf_x-.10),y-.85+slot,shelf+.065),(.14,.14,.07),.8)
    if profile in (0,4):
        # Two businesses open directly to the lane with a deep, readable
        # interior and a broad counter, unlike the closed residential fronts.
        opening_y=y+(.10 if profile==0 else -.18)
        dark.box((side*3.91,opening_y,1.56),(.075,2.20,2.42),.72)
        for edge in (-1,1):
            wood.rod((side*3.84,opening_y+edge*1.12,.15),(side*3.84,opening_y+edge*1.12,2.84),.07,12)
        wood.rod((side*3.84,opening_y-1.20,2.79),(side*3.84,opening_y+1.20,2.79),.075,12)
        wood.box((side*3.80,opening_y,.48),(.28,2.35,.12),1.2)
        counter_x=side*3.52
        wood.box((counter_x,opening_y,.91),(.42,1.76,.12),1.2)
        for n,offset in enumerate((-.58,0,.58)):
            fabric=batches['FoldedSilkRose' if n==1 else 'FoldedSilkIndigo']
            fabric.ellipsoid((side*3.50,opening_y+offset,1.18),(.10,.20,.052),18,10)
            fabric.ellipsoid((side*3.48,opening_y+offset,1.24),(.085,.17,.022),18,8)
        for offset in (-.37,.37):
            paper.box((side*3.49,opening_y+offset,1.13),(.14,.14,.018),.8)
        if profile==4:
            # One shop has its own shallow canopy and two slim support posts.
            roof_tiles.box((side*3.50,opening_y,2.98),(.68,2.55,.085),1.1)
        for offset in (-1.16,1.16):
            wood.rod((side*3.43,opening_y+offset,.10),(side*3.43,opening_y+offset,2.92),.038,10)
    if profile==6:
        # A covered residential threshold projects into the street, making a
        # small porch instead of another flush door-and-window rectangle.
        porch_y=y+door_offset
        roof_tiles.box((side*3.48,porch_y,2.86),(.62,1.48,.095),1.2)
        for offset in (-.65,.65):
            wood.rod((side*3.43,porch_y+offset,.12),(side*3.43,porch_y+offset,2.78),.045,10)
    # Taller bays have timber upper storeys with smaller individual windows.
    if eave > 4.5:
        wall.box((side*3.98,y,(3.2+eave)*.5),(.16,length-.12,eave-3.2),.48)
        wood.box((side*3.84,y,3.23),(.15,length,.13),1)
        for bay in (-1.45,-.48,.48,1.45):
            dark.box((side*3.83,y+bay,3.82),(.07,.73,.90),1)
            glass.box((side*3.77,y+bay,3.82),(.045,.60,.72))
            for dx in (-.28,0,.28): wood.box((side*3.71,y+bay+dx,3.82),(.06,.03,.75),1.3)
            wood.box((side*3.71,y+bay,3.82),(.06,.64,.035),1.3)
        shop_awning(roof_tiles,side,y,length,3.18,index)
        wood.rod((side*3.20,y-length*.5,3.15),(side*3.20,y+length*.5,3.15),.035,10)
        # Some upper floors have a shallow, independently framed balcony.
        if False:
            wood.box((side*3.48,y,3.28),(.62,length*.78,.085),1.2)
            for n in range(9):
                yy=y-length*.37+n*length*.74/8
                wood.rod((side*3.19,yy,3.30),(side*3.19,yy,3.78),.022,8)
            wood.rod((side*3.19,y-length*.40,3.80),(side*3.19,y+length*.40,3.80),.030,8)
    for dy in ((-1.55, 1.45) if (index + (side > 0)) % 3 != 2 else (1.15,)):
        x = side*3.55
        # Keep each lantern tucked immediately below its own eave; only a
        # short cord remains visible, rather than a long dangling line.
        bracket_z=eave-.045
        lamp_z=eave-.40
        wood.rod((side*3.24,y+dy,bracket_z),(x,y+dy,bracket_z),.025,8)
        dark.rod((x,y+dy,bracket_z-.025),(x,y+dy,lamp_z+.22),.010,6)
        lamp.ellipsoid((x,y+dy,lamp_z),(.13,.13,.20), 24, 12)
        wood.rod((x,y+dy,lamp_z-.22),(x,y+dy,lamp_z-.17),.075,12)
        wood.rod((x,y+dy,lamp_z+.18),(x,y+dy,lamp_z+.22),.075,12)
        red.rod((x,y+dy,lamp_z-.34),(x,y+dy,lamp_z-.22),.022,8)
        for n in range(8):
            a = math.tau*n/8
            points=[]
            for k in range(7):
                t=-math.pi/2+k*math.pi/6
                points.append((x+.131*math.cos(t)*math.cos(a),y+dy+.131*math.cos(t)*math.sin(a),lamp_z+.2*math.sin(t)))
            for p,q in zip(points,points[1:]): dark.rod(p,q,.004,5)
    roof(roof_tiles, side, y, length, eave, eave+.9,index+(1 if side>0 else 0),depth+.84)
    ridge_x=3.22+(depth+.84)*.5
    roof_tiles.rod((side*ridge_x,y-length*.53,eave+.91),(side*ridge_x,y+length*.53,eave+.91),.055,12)
    # The exposed ends of individual semi-cylindrical tiles give the eave a
    # lighter, layered edge instead of a single thick rectangular beam.
    tile_count=max(12,round(length/.20))
    for tile in range(tile_count):
        yy=y-length*.49+(tile+.5)*length*.98/tile_count
        lift=(.09+.035*((index+(1 if side>0 else 0))%3))*abs(2*(tile+.5)/tile_count-1)**8
        roof_tiles.rod((side*3.17,yy,eave+lift+.018),(side*3.33,yy,eave+lift+.045),.043,8)
    wood.rod((side*3.20,y-length*.53,eave-.04),(side*3.20,y+length*.53,eave-.04),.045,12)
    for offset in (-2.0,-1.0,0,1.0,2.0):
        wood.rod((side*3.25,y+offset,eave-.10),(side*4.15,y+offset,eave+.32),.043,8)
    # Stacked timber brackets, visible on the underside of the overhanging eaves.
    for offset in (-1.7,-.85,0,.85,1.7):
        wood.rod((side*3.27,y+offset,eave-.20),(side*3.63,y+offset,eave-.06),.044,10)
        dark.rod((side*3.39,y+offset,eave-.25),(side*3.55,y+offset,eave-.16),.035,8)
    # Each doorway has its own worn threshold: a two-step sill, a raised slab,
    # a narrow timber sill, or a shallow single stone step.
    threshold=(index+(1 if side>0 else 0))%4
    if threshold==0:
        stone.box((side*3.64,y+door_offset,.12),(.55,1.05,.16),.6)
        stone.box((side*3.45,y+door_offset,.055),(.44,1.12,.09),.6)
    elif threshold==1:
        stone.box((side*3.68,y+door_offset,.10),(.34,.98,.15),.6)
    elif threshold==2:
        stone.box((side*3.72,y+door_offset,.075),(.22,.90,.10),.6)
        wood.box((side*3.57,y+door_offset,.055),(.15,.86,.08),.8)
    else:
        stone.box((side*3.55,y+door_offset,.055),(.38,1.0,.09),.6)
    # A few small objects break the silhouette of otherwise similar storefronts.


def tree(location, index, mats):
    trunk = Batch('PlantBranches %d' % index, mats['Bark'])
    leaves = Batch('PlantLeaves %d' % index, mats['Leaves'])
    light_leaves = Batch('PlantLeavesLight %d' % index, mats['LeavesLight'])
    rng=random.Random(2600+index)
    trunk.rod((0,0,0),(0,0,2.4),.12,14)
    for i in range(38):
        a = math.tau*i/38
        start=Vector((0,0,1.1+rng.random()*1.5))
        end=Vector((math.cos(a)*rng.uniform(.8,1.5),math.sin(a)*rng.uniform(.7,1.3),rng.uniform(2.2,3.7)))
        trunk.rod(start,end,.026,7)
        for j in range(42):
            t=rng.uniform(.48,1.18)
            p=start.lerp(end,t)+Vector((rng.uniform(-.27,.27),rng.uniform(-.27,.27),rng.uniform(-.20,.20)))
            size=rng.uniform(.09,.17); angle=rng.uniform(0,math.tau)
            axis=Vector((math.cos(angle)*size,math.sin(angle)*size,rng.uniform(-.03,.03)))
            across=Vector((-math.sin(angle)*size*.34,math.cos(angle)*size*.34,rng.uniform(-.04,.04)))
            batch=light_leaves if rng.random()<.28 else leaves
            batch.face((p-axis,p+across,p+axis,p-across),smooth=True)
    parent=bpy.data.objects.new('WindPlant %d' % index,None)
    bpy.context.collection.objects.link(parent)
    parent.location=location
    trunk.build().parent=parent
    leaves.build().parent=parent
    light_leaves.build().parent=parent


def main():
    os.makedirs(MODEL_DIR,exist_ok=True)
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    mats={
      'Plaster':material('Plaster',(.72,.70,.65),.94,'plaster'),
      'AgedPlaster':material('AgedPlaster',(.70,.68,.62),.98,'aged-plaster'),
      'Timber':material('Timber',(.30,.20,.13),.86,'wood'),
      'DarkTimber':material('DarkTimber',(.12,.085,.06),.92,'wood'),
      'RoofTiles':material('RoofTiles',(.20,.23,.22),.91,'roof'),
      'Paving':material('Paving',(.36,.38,.36),.92,'stone'),
      'StoneTrim':material('StoneTrim',(.39,.38,.35),.92,'bridge'),
      'WindowGlass':material('WindowGlass',(.38,.26,.13),.76,emission=.02),
      'WindowPaper':material('WindowPaper',(.63,.59,.48),.94,emission=.01),
      'LanternSilk':material('LanternSilk',(.70,.20,.07),.75,emission=.03),
      'RedDetails':material('RedDetails',(.45,.06,.035),.86),
      'CraftPaper':material('CraftPaper',(.76,.69,.54),.95),
      'FoldedSilkIndigo':material('FoldedSilkIndigo',(.26,.34,.29),.9),
      'FoldedSilkRose':material('FoldedSilkRose',(.46,.38,.27),.9),
      'Pigment':material('Pigment',(.35,.09,.05),.9),
      'DecorLeaves':material('DecorLeaves',(.19,.30,.12),.98),
      'Moss':material('Moss',(.10,.19,.055),.99),
      'MossLight':material('MossLight',(.18,.27,.09),.99),
      'LakeWater':material('LakeWater',(.24,.39,.38),.32),
      'Bark':material('Bark',(.22,.18,.13),.98,'wood'),
      'Leaves':material('Leaves',(.14,.25,.105),.95),
      'LeavesLight':material('LeavesLight',(.25,.36,.15),.95),
    }
    batches={name:Batch(name,mat) for name,mat in mats.items() if name not in ('Bark','Leaves','LeavesLight')}
    # Carry the stone lane past the camera's horizon line so both rows of
    # houses taper together in perspective before the lakeshore appears.
    lane_start, paved_end, lane_end = -14.7, 84.5, 190.0
    lane_center, lane_length = (lane_start+paved_end)*.5, paved_end-lane_start
    batches['Paving'].box((0,lane_center,-.09),(8.2,lane_length,.16),.55)
    # Individually lifted, staggered cobbles give the old street a physical
    # stone surface instead of one perfectly flat textured slab.
    paving_rng=random.Random(82631)
    row=0; y=lane_start+.22
    while y < paved_end-.18:
        offset=(row%2)*.275
        for column in range(15):
            x=-3.85+column*.55+offset+paving_rng.uniform(-.035,.035)
            if abs(x)>3.58: continue
            block_width=.50+paving_rng.uniform(-.035,.025)
            block_length=.415+paving_rng.uniform(-.04,.02)
            height=.058+paving_rng.random()*.032
            block_y=y+paving_rng.uniform(-.018,.018)
            batches['Paving'].box((x,block_y,-.01+height*.5),(block_width,block_length,height),.55)
            if paving_rng.random()<.125:
                radius=.09+paving_rng.random()*.09
                moss_x=x+paving_rng.uniform(-block_width*.20,block_width*.20)
                moss_y=block_y+paving_rng.uniform(-block_length*.20,block_length*.20)
                moss_z=-.01+height+.005
                points=[]; moss_uvs=[]; sides=7
                for vertex in range(sides):
                    angle=math.tau*vertex/sides
                    scale=radius*paving_rng.uniform(.72,1.25)
                    points.append((moss_x+math.cos(angle)*scale,moss_y+math.sin(angle)*scale*.72,moss_z))
                    moss_uvs.append((.5+.5*math.cos(angle),.5+.5*math.sin(angle)))
                moss_batch=batches['MossLight'] if paving_rng.random()<.28 else batches['Moss']
                moss_batch.face(points,moss_uvs,smooth=True)
        row+=1; y=lane_start+.22+row*.48
    # The last stretch descends and converges to a narrow point in the haze,
    # rather than ending as a broad, perfectly flat cut across the view.
    road_steps, across_steps = 28, 8
    transition_length = lane_end-paved_end
    def far_road_point(t, across):
        half_width = max(.18,4.1*(1-t)**1.65)
        x = across*half_width + .16*math.sin(t*math.pi)
        y = paved_end + transition_length*t + .20*t*t*math.sin((across+1)*math.pi*3)
        # Taper down only slightly so the lane meets the distant lake at the
        # same height instead of dropping into a visible ditch at the horizon.
        z = -.01-.11*t + .032*(1-abs(across))*(1-.55*t)
        return x,y,z
    for segment in range(road_steps):
        t0, t1 = segment/road_steps, (segment+1)/road_steps
        for across_index in range(across_steps):
            a0, a1 = across_index/across_steps*2-1, (across_index+1)/across_steps*2-1
            points = (far_road_point(t0,a0),far_road_point(t0,a1),
                      far_road_point(t1,a1),far_road_point(t1,a0))
            uvs = [((point[0]+4.1)*.55,(point[1]-lane_start)*.55) for point in points]
            batches['Paving'].face(points,uvs)
    # Continue raised, irregular cobbles over the receding road mesh. The
    # taper is shared with the shop facades so the paving stays visible to
    # the vanishing point instead of changing into a flat slab.
    transition_row=0
    while True:
        y=paved_end+.24+transition_row*.54
        if y>=lane_end: break
        t=max(0,min(1,(y-paved_end)/transition_length))
        half_width=max(.18,4.1*(1-t)**1.65)
        pitch=min(.55,max(.12,half_width/7.5))
        count=max(1,int((2*half_width)/pitch))
        lane_center_x=.16*math.sin(t*math.pi)
        for column in range(count):
            across=((column+.5)/count)*2-1
            x=lane_center_x+across*half_width+paving_rng.uniform(-pitch*.055,pitch*.055)
            surface_z=-.01-.11*t+.032*(1-abs(across))*(1-.55*t)
            block_width=max(.085,min(.49,pitch*.88))+paving_rng.uniform(-.015,.012)
            block_length=min(.43,max(.11,.42*(.45+.55*(1-t))))+paving_rng.uniform(-.025,.018)
            height=.042+paving_rng.random()*.026
            block_y=y+paving_rng.uniform(-.016,.016)
            batches['Paving'].box((x,block_y,surface_z+height*.5),(block_width,block_length,height),.55)
            if paving_rng.random()<.075 and t<.82:
                radius=min(.10+paving_rng.random()*.05,block_width*.25)
                moss_z=surface_z+height+.004
                points=[]; moss_uvs=[]
                for vertex in range(7):
                    angle=math.tau*vertex/7
                    scale=radius*paving_rng.uniform(.72,1.2)
                    points.append((x+math.cos(angle)*scale,block_y+math.sin(angle)*scale*.72,moss_z))
                    moss_uvs.append((.5+.5*math.cos(angle),.5+.5*math.sin(angle)))
                (batches['MossLight'] if paving_rng.random()<.28 else batches['Moss']).face(points,moss_uvs,smooth=True)
        transition_row+=1
    for side in (-1,1):
        # A long sequence of individually dressed shopfronts keeps the camera's
        # sightline enclosed; the shoreline sits beyond the distant vanishing point.
        for index in range(-3,40):
            starts={name:len(batch.vertices) for name,batch in batches.items()}
            storefront(batches,side,index)
            if index<10: shop_props(batches,side,index)
            # Recess the buildings by different amounts instead of producing
            # two perfectly straight, mirrored walls.
            shift=side*((0,.34,-.20,.22,-.36,.42,-.15,.28)[index%8] + (.035 if side>0 else 0))
            for name,batch in batches.items():
                for n in range(starts[name],len(batch.vertices)):
                    x,y,z=batch.vertices[n]
                    # Keep both shop fronts and the road on one vanishing
                    # profile. Previously the road pinched to a point while
                    # the buildings stopped at 24% of their original width.
                    depth_progress=max(0,min(1,(y-paved_end)/(lane_end-paved_end)))
                    inward_scale=max(.18/4.1,(1-depth_progress)**1.65)
                    batch.vertices[n]=(x*inward_scale+shift*inward_scale,y,z)
        # A raised stone edge makes the transition between shops and street physical.
        batches['StoneTrim'].box((side*3.85,lane_center,.08),(.35,lane_length,.18),1.2)
        for segment in range(road_steps):
            t = (segment+.5)/road_steps
            half_width = max(.18,4.1*(1-t)**1.65)
            curb_width = min(.35*(1-.28*t),half_width*.35)
            y = paved_end + transition_length*t
            z = -.01-.11*t
            batches['StoneTrim'].box((side*(half_width-curb_width*.5),y,z+.08),
                                     (curb_width,transition_length/road_steps+.025,.18*(1-.25*t)),1.2)
    # Keep the lake below the tapered road so the shared shoreline cannot
    # z-fight and flash a flat green strip across the distant paving.
    lake_level = -.20
    lake_start, lake_end = lane_end + 22.0, lane_end + 42.0
    batches['LakeWater'].face(((-18,lake_start,lake_level),(18,lake_start,lake_level),
                               (18,lake_end,lake_level),(-18,lake_end,lake_level)),[(0,0),(6,0),(6,4),(0,4)])
    # A pair of shore trees and stone roots soften the change from shopfronts
    # to the distant landscape without closing the view down the lane.
    for batch in batches.values():
        if batch.vertices: batch.build()
    bpy.ops.wm.save_as_mainfile(filepath=BLEND_PATH)
    bpy.ops.export_scene.gltf(filepath=GLB_PATH,export_format='GLB',export_yup=True,export_apply=True,
                              export_animations=False,export_materials='EXPORT',export_image_format='AUTO',
                              export_lights=False,export_cameras=False,export_normals=True,export_texcoords=True)
    print('Built 3D hanging gallery', GLB_PATH, flush=True)


if __name__ == '__main__': main()
