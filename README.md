# 伞下江南

**Jiangnan Beneath the Umbrella** · 西湖绸伞数字共创 H5

《伞下江南》以杭州西湖绸伞为文化载体，让用户在数字绸面上自由绘画、选择纹样并生成可编辑的环形装饰。设计以“以指为笔，以绸为纸，一笔绘出万千江南”为核心体验。

## 运行

项目使用原生 HTML、CSS、JavaScript 模块、Canvas 2D 和按需加载的 Three.js。Three.js 0.186.0 核心模块及项目使用的插件已随项目存放在 `vendor/three/`，GPU 水墨和 3D 赏伞不再依赖 jsDelivr。除分享等浏览器系统能力外，页面资源从当前站点同源加载。在项目根目录执行：

```powershell
python -m http.server 8000 --bind 127.0.0.1
```

浏览器打开 http://localhost:8000/。可使用电脑鼠标、触屏或 Apple Pencil；iPad Safari 建议使用横屏浏览。
桌面和 iPad 横屏采用单屏编辑布局；手机屏幕较窄时，工具会排在画布下方。

## UI 与互动水墨背景

页面采用暖纸色、黛青和湖青为主的轻量新中式编辑界面，改为无外框的满幅工作台：顶部品牌与操作栏、中央伞面画布、右侧工具列直接置于整页水墨背景之上，控件组通过细分隔线组织，不再堆叠大面积卡片。控件参考 [BeUI](https://beui.dev/) 的内嵌范围滑块与标签切换，以及 [Rare UI](https://www.rareui.com/) 的轻量按压反馈和微交互；项目仍使用原生 HTML/CSS/JavaScript 实现，没有引入 React、Tailwind 构建步骤或远程组件依赖。

页面底层以“烟雨西湖 · 游墨生花”为方向。独立的全屏 SVG 山水层使用平滑贝塞尔曲线表现远山与近岸，柔化的雾带和水面曲线波纹分层缓慢漂移；`InkWashBackground` WebGL Shader 单独负责纸面柔墨与指针扰动。鼠标或触控笔经过时，根据移动方向形成带渐细尾迹的墨韵；小范围、低浓度的 CSS 柔光只作辅助，避免盖成一整颗大水滴。笔迹按约 8px 间距插值，改善快速移动时的断续感，停下后仍缓慢渗开并在约 2.2 秒内淡去。2D 绘制时减弱远山、雾气、水波和背景动画，切换到 3D 赏伞时柔和增强。色彩采用宣纸白 `#F5F1E8`、烟墨灰 `#777A75`、浓墨黑 `#343936` 与黛青 `#80948D`。WebGL 渲染限制为低分辨率、最高 30 FPS；背景不接收或阻断画布 Pointer Events，也不写入作品纹理。它与伞面上可编辑、可保存的 GPU 湿墨绘画分开，是轻量程序化墨韵，不是完整的 Navier–Stokes 流体模拟。浏览器不支持 WebGL 时会回退到 Canvas 柔墨背景，并遵循减少动态效果的系统偏好。

间距基于 `styles.css` 中的全局 `--spacing` 与 `--space-*` 刻度；界面颜色集中在 Tailwind v4 风格的 `@theme` 和 `:root` 设计令牌中，组件只引用统一的语义变量。背景 Shader 从同一组全局色值读取墨色与湖青。

## 操作

- **自由绘画**：普通笔触由 Canvas 连续绘制，支持柔墨、纤维笔和清晰笔触、颜色、大小、浓淡、1–14 重放射重复、镜像与压力感应。“水墨生成”是直接画在伞面上的 GPU 湿墨：Canvas 不会再叠画一条线，颜料会持续累积、松笔后继续流动并逐渐稳定；源笔迹和 GPU 注入点分别保存在作品数据中，撤销/重做时重建湿墨层。
- **纹样装饰**：纹样库按主体绘画、花卉植物、江南元素、传统纹饰和伞缘边饰分类。选中素材后，在伞面点击一次放置一个对象。主体画默认单幅放置；装饰纹样可按各自元数据预填重复数，再由用户决定是否环形排列。
- **环形重复**：选中纹样，调整数量和半径后点击“环形重复”。重复副本由一个数据对象实时生成，可继续统一调整。
- **构图辅助**：伞面保持俯视圆形，约占绘画画布直径的 68%。辅助线标出伞心（0–18%）、中部（22–58%）和外圈（68–82%），区域留白用于分隔主次；这些比例是数字编辑辅助，不代表传统工艺尺寸规范。辅助线不进入 PNG 和分享海报，区域吸附默认开启，可关闭。
- **示例 / 空白**：示例加载由可编辑纹样对象组成的“荷韵西湖”构图；空白清除笔迹和纹样。撤销、重做支持绘画、添加、移动、重复、编辑、删除和清空。
- **伞面与分享**：可切换素绸、轻纱、蓝印与伞面颜色。保存导出 PNG；分享保留原有动态展开海报预览和系统分享回退。
- **2D 绘制 / 3D 赏伞**：状态栏切换视图。3D 模式使用独立 WebGL 预览，保留编辑器中的作品数据；切回 2D 后继续编辑，之后再进入 3D 会刷新伞面贴图。3D 模式的“保存”会导出当前赏伞画面 PNG，分享海报仍沿用二维作品图。
- **收伞 / 开伞**：3D 视图可拖动“开合”滑杆控制开合度，也可按按钮播放约 1.25 秒的动画并中途反向。项目默认加载 Blender 制作的绸伞 GLB：绸面 Shape Key、独立竹骨、短骨、伞巢和连续竹柄带有统一的 `Umbrella Fold` 动画，由 AnimationMixer 按进度驱动。模型仍是可替换的视觉原型，没有布料碰撞模拟；正式工艺模型可替换 GLB。
- **GPU 湿墨与调试**：`InkFluidSystem.js` 与 Three.js 共用 WebGLRenderer，以双缓冲速度场、颜料场和湿度场做输入注入、速度/颜料输运、局部扩散及干燥。右侧可切换绸面颜料、速度场、颜料密度和湿度场；“测试注入”用于无需绘画验证 GPU 输出。湿墨直接留在 2D/3D 伞面上，不会在松笔后转换成 Canvas 线；当前湿墨模式为单笔，放射生成暂由普通 Canvas 模式负责。该实现是适合 H5 的低分辨率近似输运，不包含完整 Navier–Stokes 压力求解。
- **旋转与缩放**：2D 画布空白处拖动旋转，滚轮以指针为中心缩放；缩放范围为 60%–1000%，伞面可越过原始正方形编辑框显示，画布坐标仍按视图变换反算，放大后绘制位置不会错位。窄屏下画布会为放大后的可视范围留出页面空间，避免与下方工具重叠。3D 模型拖动旋转、滚轮或触屏双指缩放，视角范围受限；3D 预览在显示时低速自动旋转，切回 2D 后停止渲染循环。
- **导入 Blender GLB**：3D 模式点击“导入 Blender GLB”选择单文件 `.glb`。建议伞面网格命名为 `canopy`、`cloth` 或 `fabric` 并提供有效 UV；没有 UV 时程序用水平投影临时映射，并在界面提示需要在 Blender 制作正式 UV。

## 文件结构

```text
Interaction Design/
├── index.html
├── styles.css
├── README.md
├── assets/
│   ├── umbrella-cloth.png
│   ├── models/
│   │   ├── west-lake-umbrella.blend
│   │   ├── west-lake-umbrella.blend1
│   │   ├── west-lake-umbrella.glb
│   │   └── README.md
│   └── motifs/
│       ├── bamboo.png
│       ├── bamboo.svg
│       ├── cloud.png
│       ├── cloud.svg
│       ├── koi.png
│       ├── koi.svg
│       ├── lotus.png
│       ├── lotus.svg
│       ├── west-lake.png
│       ├── west-lake.svg
│       ├── water.svg
│       └── README.md
├── js/
│   ├── main.js
│   ├── app/App.js
│   ├── core/
│   │   ├── ArtworkDocument.js
│   │   ├── CanvasManager.js
│   │   ├── CompositionZones.js
│   │   └── MandalaRenderer.js
│   ├── drawing/
│   │   ├── MotifLibrary.js
│   │   └── PatternDrawer.js
│   ├── features/
│   │   ├── AmbientMusic.js
│   │   ├── ShareManager.js
│   │   └── TemplateComposer.js
│   ├── rendering/
│   │   ├── InkFluidSystem.js
│   │   └── ThreeUmbrellaPreview.js
│   └── ui/
│       ├── ControlManager.js
│       └── InkWashBackground.js
├── vendor/three/
│   ├── LICENSE
│   ├── VERSION.txt
│   ├── build/
│   │   ├── three.core.js
│   │   └── three.module.js
│   └── examples/jsm/
│       ├── controls/OrbitControls.js
│       ├── loaders/GLTFLoader.js
│       └── utils/
│           ├── BufferGeometryUtils.js
│           └── SkeletonUtils.js
├── tools/create_blender_umbrella.py
└── creative-mandala/  原参考项目，保留不改
```

树形目录放在 `text` 代码围栏中，以保持等宽字体、缩进和换行；不会再被 Markdown 当作普通文字合并成一段。

## 作品数据与渲染

笔迹和纹样对象保存在 ArtworkDocument，Canvas 只作为渲染缓存。纹样对象包含 id、patternId、位置、比例、角度、重复数量、排列半径、朝向和所属区域。环形副本每次绘制时由该对象生成，不会永久压平到像素图层。

画布按 720 × 720 个逻辑单位工作，并按 devicePixelRatio 调整像素缓冲区（最高 2x），控制 iPad 多层 Canvas 的内存占用。自由绘画默认使用 8 重、8px、45% 浓淡；放射重复范围为 1–14，滑块保留连续整数选择并提供 1、8、14 三个快捷刻度。环形纹样在中部最多 12 个，外圈小纹样最多 16 个。作品导出只合成绸面、笔迹、纹样、光影和伞骨；不包含选择框与辅助环带。

绘画纹样作为独立透明图像加载，保留原始宽高比，以 Canvas 2D 实现移动、缩放、旋转与环形重复；不会再由程序给纹样叠加随机颗粒或模糊来伪造工笔细节。二维预览中的图案仍可与底色层混合，三维伞面则由统一的 Three.js 光照和丝绸材质响应。环形重复采用逐个淡入和轻微缩放。导出画布沿用静态图层合成，不包含鼠标光斑或选择框。

### 2D / 3D 混合渲染

- `ArtworkDocument` 继续保存笔迹和纹样对象，Three.js 不保存或改写作品数据。
- `CanvasManager.getUmbrellaTextureCanvas()` 从二维导出层合成 1024 × 1024 的伞面贴图，裁出绸面圆区域并省略二维竹骨层，避免与 3D 竹骨重叠。CanvasTexture 复用这张离屏 Canvas；编辑过程不会逐帧重建或上传纹理，进入 3D 视图时只在贴图版本变化后更新。
- 默认 3D 伞由 `assets/models/west-lake-umbrella.glb` 加载。绸面网格有径向 UV，并使用 CanvasTexture；模型含 32 组长短竹骨、伞巢、伞心、直竹柄和绸面收拢动画。二维伞骨数量与默认 Blender 模型一致。`tools/create_blender_umbrella.py` 可以在 Blender 中重建 `.blend` 与 `.glb`。程序伞仍作为导入失败时的回退。
- 程序伞的开合采用简化连杆约束而非整伞缩放：伞巢位置确定短骨长度约束，解算主骨角度；伞面顶点与伞缘沿伞骨方向收束，保留 32 道细褶。它呈现西湖绸伞竹骨套合的结构关系，但仍是程序化近似，没有执行布料碰撞或真实竹材关节的有限元模拟。
- GPU 湿墨系统用 128 × 128 速度场、512 × 512 颜料场和 256 × 256 湿度场双缓冲；输入通过同一 UV 空间注入。实现速度回溯、颜料输运、局部扩散、涡旋扰动和湿度衰减。3D 视图把 GPU 颜料纹理映射到与伞面共用几何和 UV 的 PBR 湿墨层，随伞面曲率与开合变形。系统不读回像素，不复制 PavelDoGreat 的源代码；它参考该项目的 GPU 双缓冲与输运思路，属于轻量近似，不含完整压力迭代、Divergence/Gradient 投影或真实颜料物理。选择“水墨生成”时预热 Three.js 与 WebGL，减少第一笔等待；降低笔迹采样密度并限制每帧模拟批次以改善触屏延迟。
- 声光响应使用项目内置的原创 Web Audio 江南氛围乐，不访问系统声音、不要求上传音频，也不需要额外音频文件。用户点击“声光响应”后，古琴感五声音阶拨弦、低音铺底与轻雨质感循环播放；同一音频分析器提取低频能量，驱动伞面微光、绸面粗糙度与背景雾层变化。再次点击暂停音乐和响应。音频由浏览器实时合成，首次播放需用户主动点击；扫描光只在进入 3D 后短暂播放一次。效果属于 Web Audio/WebGL 的轻量近似，不是 TouchDesigner 工程。
- 伞面使用 CanvasTexture、程序生成的细织法线图和 MeshPhysicalMaterial；场景使用柔和环境光与方向光。纹理法线和绸缎高光是实时着色近似，并非实拍物理材质扫描。
- Three.js 在第一次选择 GPU 水墨或切换到 3D 时动态加载。HTML import map 指向项目内 `vendor/three/` 的 0.186.0 核心模块和插件，因此三维功能不依赖访问 jsDelivr。`vendor/three/LICENSE` 保留该 npm 包的许可证文本；升级版本时同步替换核心模块、插件及其依赖文件。
- 导入 GLB 时，纹理会应用到命名伞面网格；若缺少有效 UV，会从水平伞面投影补出临时平面 UV（不是径向展开），界面会提示用户制作正式 UV。材质匹配优先看伞面网格名，避免把 silk-rib-seam 等竹骨缝线误认为绸面；导入动画按 GLB 作者数据原样播放，不改写关键帧。默认 Blender 模型的竹骨沿绸面曲率铺设，并使用独立直柄、伞巢和开合动画。
- 3D 预览保存会把当前 WebGL 画面合成到柔和背景并导出 PNG。分享海报仍使用原有二维作品导出，以保留原来的动态海报预览和分享流程。

二维编辑视图以 Canvas 图层提供普通笔迹反馈；水墨生成模式使用与画布输入坐标一致的 GPU 伞面层，颜料持续留存，撤销/重做会从记录的注入点重建。GPU 速度场会消费每帧批次中的全部输入点，以免染料轨迹与速度方向脱节。作品历史最多保留 40 步，并另受约 16 MiB 的序列化快照预算约束；超限时优先丢弃较早的撤销/重做检查点。三维赏伞视图是 WebGL 网格与材质光照，不是 TouchDesigner 工程。模型为 Blender 程序化建模的可编辑原型，不含真实布料碰撞、完整次表面散射或 Navier–Stokes 压力求解。湿墨模式暂不参与放射复制，放射笔迹继续使用普通 Canvas 模式。

## 素材说明

`MotifLibrary.js` 是纹样配置注册表。每条素材元数据包含稳定 ID、分类、PNG/WebP/SVG 格式、推荐尺寸、默认重复数、默认单幅放置方式、适用伞面区域与资源状态。分类和卡片由该配置动态生成；新增 PNG/WebP 只需放入素材目录并在注册表新增一项，不需要改绘制算法。PNG/WebP 保留 alpha 和源图宽高比；Canvas 合成结果仍实时提供给 Three.js 的 CanvasTexture。

现有五张透明 PNG（1254 × 1254，RGBA）全部保留，分别归入主体绘画、花卉植物和江南元素等分类；`water.svg` 作为边饰线稿注册。其余原有 SVG 资源仍保留在目录中，没有被删除或自动填充为卡片。当前素材的来源及授权未记录，仍作为已有草稿管理；正式发布前应补充作者与授权信息。添加流程见 [纹样素材说明](assets/motifs/README.md)。

二维编辑器里的织理、扇区光照、绸面凹影和伞骨是 Canvas 2D 绘制的工作视图；3D 赏伞使用独立的弯曲网格和实体竹骨结构。两种视图共用同一份作品数据。分区仅是数字编辑的构图辅助，不代表传统工艺尺寸规范。

## 文化参考

- [中国非物质文化遗产网：伞制作技艺（西湖绸伞）](https://www.ihchina.cn/project_details/14578/)
- [杭州网：中国伞博物馆展陈介绍](https://ori.hangzhou.com.cn/ornews/content/2023-01/14/content_8448591.htm)
