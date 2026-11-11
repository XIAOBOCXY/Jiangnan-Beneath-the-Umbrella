# 画廊场景与角色素材

## 悬伞展廊

悬伞展廊以 `assets/models/hanging-gallery-street.blend` 为可编辑源文件，导出的 `hanging-gallery-street.glb` 包含连续纵深店铺立面、起伏瓦顶、山墙、木格窗、浅层室内、伞架、制作台、灯笼和石路。两侧建筑覆盖镜头滚轮行进范围，并与道路使用同一收窄曲线，在远处共同汇向中线；立面、进退位置和窗格各不相同，房屋不带招牌文字。构建脚本为 `tools/create_hanging_gallery_world.py`；展开、半开、收拢三种静态展示伞由 `tools/create_umbrella_display_poses.py` 从动画伞模导出。建筑与伞均为三维几何体；街道延伸到远山前，湖面退到远景之后，没有桥。湖山背景使用 `misty-west-lake-panorama.png`，叠加多层缓慢流动的山雾，并与距离雾和昼夜调色结合。湖面使用同一远景的水面纹理与动态水波着色器。

`js/site/HangingGallery3D.js` 将同一把绸伞 GLB 和不同作品纹理组合为可交互的三维悬伞；横绳固定到屋檐支点，并与挂绳及伞一起响应风力。滚轮沿街道前后移动相机，鼠标移动以小幅平滑转动视角。相机行程由两侧逐步向中线收拢的建筑连续覆盖，屋檐、立面与绳端锚点保持贴合。底部可选择作品，地面与门口同时陈列收拢、半开和展开的真实三维伞模型；点击悬挂展伞进入独立赏伞视图。晴天与带雾雨天自动切换，昼夜自动循环，共同调节环境光、太阳光、灯笼、雨滴、雾和湿地材质。湿地使用环境高光近似，未实现屏幕空间反射；雾为距离雾而非体积雾。

材质由 [Poly Haven](https://polyhaven.com/license) 的 CC0 纹理制作：

- [Fine Grained Wood](https://polyhaven.com/a/fine_grained_wood)、[White Plaster 02](https://polyhaven.com/a/white_plaster_02)、[Grey Roof 01](https://polyhaven.com/a/grey_roof_01)
- [Monastery Stone Floor](https://polyhaven.com/a/monastery_stone_floor)、[Stone Wall](https://polyhaven.com/a/stone_wall) 和 [Worn Mossy Plasterwall](https://polyhaven.com/a/worn_mossy_plasterwall)

湖山图使用内置图像生成工具制作，用于远景；不作为建筑模型。生成时使用的提示词：

> Create an exceptionally natural photographic distant landscape background plate for a 3D West Lake, Hangzhou, Jiangnan old town street scene. Landscape orientation, a wide quiet fresh-water lake across the lower third, believable delicate water ripples and soft reflections, layered low rounded forest-covered green-blue mountains with translucent wisps of mountain mist, pale warm grey overcast sky in the upper third. Camera at the edge of the lake at human eye height. Refined realistic cinematic environment texture, old southern China atmosphere, muted earthy olive and blue-grey colors, gentle depth and natural detail. Keep center open and peaceful, visually continuous from edge to edge. NO buildings, no bridge, no street, no foreground trees, no people, no boats, no text, no logo, no frame, no close foreground. Not a 3D render, not an illustration, not ink painting. This is a distant environment backdrop, not a poster.

画廊内的实物伞面样本来自项目收录的实物照片，见 `assets/patterns/heritage/` 的相关资料说明。原有悬伞背景图保留为历史素材，但当前三维模式不加载它。

## 分层场景

画廊占满浏览器视口；空白区域可拖动，以小幅视差浏览同一幅桥景。`js/site/GalleryScene.js` 按深度分别渲染：

1. `layers/rainy-mountains.png`：独立青绿水墨远山与天空图层，桥和人物均不烘焙在这张图中。
2. CSS 雾带：远雾和中景雾使用不同方向与周期缓慢漂移，并轻微改变透明度。
3. Three.js WebGL 湖面：位于山景之上、桥后层与人物之后；远处水面以宽幅渐隐与山间雾气相接，向前逐渐转为低饱和深青，避免桥下出现一条硬直的水平分界。水面叠加不同尺度的断续横波、短反光、水纹噪声、桥洞暗部和稀疏雨滴涟漪，纹理随时间轻缓变化。
4. `layers/walkers-sprite-v2.png`：透明 4×4 序列图；女性占第 1、2 行，男性占第 3、4 行，每行四帧。奇数行是行走步态，偶数行是站立/轻微转头姿态。场景最多展示八位纤细、小比例人物，角色可以复用伞面款式；脚底锚点沿桥拱采样，人物接近时会按身体宽度减速避让。`GalleryScene` 依据累计行走距离和驻足时钟选择图集帧，脚底不会随身体呼吸上下漂移。
5. `layers/ink-stone-bridge.png`：透明的单孔水墨侧立面石桥，替换了带密集栏杆立柱的旧桥。它被拆成后层和窄前缘；宽屏以接近素材原始比例显示，窄屏加宽桥图并降低高度，避免将拱桥拉成高墙。桥前缘只露出约 1.8% 图高的贴面遮挡带。人物脚点先从屏幕坐标换算到加宽场景，再换算为桥图自身坐标，沿素材上缘采样曲线定位；人物位于桥后层与前缘之间。桥面矩形从浏览器实时布局读取，以适配窄屏桥位。
6. `layers/foreground-lotus.png`：透明底部荷叶与荷花。显示时保留原图纵横比并裁去上方空透明区，不再将宽幅素材压扁拉伸；图层沿视口底部铺开，透明水面留出桥洞与中景空间。
7. 两层 CSS 雨丝与淡纸纹：改用有限长度的稀疏雨线纹理，远雨更短更淡，近雨稍长，避免原先横穿画面的连续斜线。

远山和前景素材保持空间锚点，远雾与中雾独立缓慢漂移；桥体保持稳定，人物沿拱形桥面行走、停顿和转向，接近时会避让。WebGL 湖面以不同尺度噪声扰动细波和断续反光，并叠加稀疏的雨滴涟漪；雨丝在 CSS 图层中分远近两层运动。图像层由项目根据用户提供的青绿雨景和人物参考图生成/整理，以便分别控制位置、遮挡与动画；不是从外部图库下载的素材。桥、荷花和人物均使用透明 PNG。人物为艺术化演绎，不代表历史人物复原；序列帧动画不是实时骨骼动画。

## 绸伞与作品

- 人物手中的伞面预览由 `ThreeUmbrellaPreview.captureGalleryParasolPreview()` 从对应作品的真实 3D 模型及纹理生成。女性和男性使用各自的手部锚点；透明人物序列已包含手部，因此不再叠加重复的手臂/手掌层。作品变化时只替换伞面纹样，竹骨结构保持一致。
- 预览以同一握柄锚点分层绘制：伞柄在人物手部后方，伞面前景副本按实际伞盖网格顶点投影裁切，只遮住伞盖覆盖到的人物头部与上身，不复制伞柄、手掌或袖口。
- 独立 3D 赏伞复用缩略图的模型姿态、比例、28° 视场角、正方形画幅、相机位置和模型边界目标点。作品纹理由同一个 UV 画布提供，避免进入赏伞视图时因画幅或目标点变化造成伞面图案的视觉缩放和偏移。
- 右侧“全部绸伞”面板列出系统作品和当前浏览器保存的作品；“在画廊展示”把作品 ID 分配给选中的人物，未选人物时分配给第一位。个人作品可二次确认后删除，正被展示的作品会回退到有效预设作品。分配关系保存在浏览器本地。
- 点击伞面热区后，以相同作品 ID 打开真实 3D 模型和纹理。关闭 3D 欣赏后，固定场景中的人物与背景继续运动。

## 旧资源与参考

旧合成全景背景 `rainy-west-lake-scene.png` 和旧人物 `rainy-west-lake-walkers.png` 已移除，不再加载。`vendor/upstream-nijimi/` 仅作为源码存档，当前画廊不加载它；qingming-riverside 和 Nijimi 是交互与画风研究参考，不是运行依赖。
