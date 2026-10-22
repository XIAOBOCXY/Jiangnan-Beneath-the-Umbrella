# 伞下江南

**Jiangnan Beneath the Umbrella** · 西湖绸伞数字共创 H5

《伞下江南》以杭州西湖绸伞为文化载体，让用户在数字绸面上自由绘画、选择纹样并生成可编辑的环形装饰。设计以“以指为笔，以绸为纸，一笔绘出万千江南”为核心体验。

## 运行

项目使用原生 HTML、CSS、JavaScript 模块、Canvas 2D 和按需加载的 Three.js。2D 编辑可离线运行；首次打开 3D 赏伞时，需要联网从 jsDelivr 加载 Three.js 0.186.0。在项目根目录执行：

powershell:
python -m http.server 8000 --bind 127.0.0.1

浏览器打开 http://localhost:8000/。可使用电脑鼠标、触屏或 Apple Pencil；iPad Safari 建议使用横屏浏览。
桌面和 iPad 横屏采用单屏编辑布局；手机屏幕较窄时，工具会排在画布下方。

## 操作

- **自由绘画**：在伞面拖动画连续笔迹；支持柔墨、纤维笔和清晰笔触、颜色、大小、浓淡、放射数量、镜像与压力感应。
- **纹样装饰**：选中纹样卡后，在伞面点击一次放置一个对象。拖动已有对象可移动；右侧出现缩放、旋转、区域、重复数量、半径和朝向控件。
- **环形重复**：选中纹样，调整数量和半径后点击“环形重复”。重复副本由一个数据对象实时生成，可继续统一调整。
- **构图辅助**：伞面保持俯视圆形，约占绘画画布直径的 68%。辅助线标出伞心（0–18%）、中部（22–58%）和外圈（68–82%），区域留白用于分隔主次；这些比例是数字编辑辅助，不代表传统工艺尺寸规范。辅助线不进入 PNG 和分享海报，区域吸附默认开启，可关闭。
- **示例 / 空白**：示例加载由可编辑纹样对象组成的“荷韵西湖”构图；空白清除笔迹和纹样。撤销、重做支持绘画、添加、移动、重复、编辑、删除和清空。
- **伞面与分享**：可切换素绸、轻纱、蓝印与伞面颜色。保存导出 PNG；分享保留原有动态展开海报预览和系统分享回退。
- **2D 绘制 / 3D 赏伞**：状态栏切换视图。3D 模式使用独立 WebGL 预览，保留编辑器中的作品数据；切回 2D 后继续编辑，之后再进入 3D 会刷新伞面贴图。3D 模式的“保存”会导出当前赏伞画面 PNG，分享海报仍沿用二维作品图。
- **旋转与缩放**：拖动伞体旋转；滚轮或触屏双指缩放，视角范围受限。3D 预览在显示时低速自动旋转，切回 2D 后停止渲染循环。
- **导入 Blender GLB**：3D 模式点击“导入 Blender GLB”选择单文件 `.glb`。伞面网格需有 UV，建议在 Blender 命名为 `canopy`、`cloth` 或 `fabric`；未命名时程序尝试把最大的水平 UV 网格作为贴图接收面。正确的 UV 展开仍由模型制作阶段负责。

## 文件结构

Interaction Design/
├── index.html
├── styles.css
├── README.md
├── assets/
│   ├── umbrella-cloth.png
│   └── motifs/
│       ├── lotus.png             透明 RGBA 纹样草稿
│       ├── west-lake.png
│       ├── koi.png
│       ├── bamboo.png
│       ├── cloud.png
│       ├── water.svg             简单线饰
│       ├── *.svg                 保留的矢量资源，不作主纹样
│       └── README.md             资源格式、检查与替换步骤
├── js/
│   ├── main.js
│   ├── app/App.js                交互模式、Pointer Events 与控件编排
│   ├── rendering/ThreeUmbrellaPreview.js  Three.js 伞面、UV、CanvasTexture 与 GLB 预览
│   ├── core/
│   │   ├── ArtworkDocument.js    独立作品数据、历史快照、撤销重做
│   │   ├── CompositionZones.js   交互构图分区、吸附和辅助线
│   │   ├── CanvasManager.js      高分屏图层、绸面材质、竹骨与导出合成
│   │   └── MandalaRenderer.js    平滑放射笔迹、纹样对象和环形副本
│   ├── drawing/
│   │   ├── MotifLibrary.js       纹样 ID、文件格式、角色与替换入口
│   │   └── PatternDrawer.js      透明 PNG/WebP/SVG 加载、比例保持与对象绘制
│   ├── features/
│   │   ├── ShareManager.js       海报动画预览、下载和系统分享
│   │   └── TemplateComposer.js   可编辑默认示例数据
│   └── ui/
│       ├── AnimationManager.js
│       └── ControlManager.js
└── creative-mandala/             原参考项目，保持不修改

## 作品数据与渲染

笔迹和纹样对象保存在 ArtworkDocument，Canvas 只作为渲染缓存。纹样对象包含 id、patternId、位置、比例、角度、重复数量、排列半径、朝向和所属区域。环形副本每次绘制时由该对象生成，不会永久压平到像素图层。

画布按 720 × 720 个逻辑单位工作，并按 devicePixelRatio 调整像素缓冲区（最高 2x），控制 iPad 多层 Canvas 的内存占用。自由绘画默认使用 8 重、8px、45% 浓淡，可在 6、8、12 重之间吸附切换；环形纹样在中部最多 12 个，外圈小纹样最多 16 个。作品导出只合成绸面、笔迹、纹样、光影和伞骨；不包含选择框与辅助环带。

绘画纹样作为独立透明图像加载，保留原始宽高比，以 Canvas 2D 实现移动、缩放、旋转与环形重复；不会再由程序给纹样叠加随机颗粒或模糊来伪造工笔细节。二维预览中的图案仍可与底色层混合，三维伞面则由统一的 Three.js 光照和丝绸材质响应。环形重复采用逐个淡入和轻微缩放。导出画布沿用静态图层合成，不包含鼠标光斑或选择框。

### 2D / 3D 混合渲染

- `ArtworkDocument` 继续保存笔迹和纹样对象，Three.js 不保存或改写作品数据。
- `CanvasManager.getUmbrellaTextureCanvas()` 从二维导出层合成 1024 × 1024 的伞面贴图，裁出绸面圆区域并省略二维竹骨层，避免与 3D 竹骨重叠。CanvasTexture 复用这张离屏 Canvas；编辑过程不会逐帧重建或上传纹理，进入 3D 视图时只在贴图版本变化后更新。
- 程序化伞体由弯曲的放射网格、细微褶皱、24 组竹骨、伞缘、伞心和伞柄构成。网格 UV 以伞心为中心，将圆形 CanvasTexture 对应到伞面。
- 伞面使用 CanvasTexture、程序生成的细织法线图和 MeshPhysicalMaterial；场景使用柔和环境光与方向光。纹理法线和绸缎高光是实时着色近似，并非实拍物理材质扫描。
- Three.js 只在第一次切换到 3D 时动态加载。版本通过 HTML import map 固定为 0.186.0，依赖 jsDelivr 网络可用性；如果 CDN 无法访问，2D 编辑仍可继续使用。
- 导入 GLB 时，纹理会应用到具备 UV 的命名伞面网格；模型要有合理的伞面 UV、独立绸面与支撑结构，以及 Blender/glTF 的 Y 轴向上约定。未提供正式模型时使用程序伞体原型。
- 3D 预览保存会把当前 WebGL 画面合成到柔和背景并导出 PNG。分享海报仍使用原有二维作品导出，以保留原来的动态海报预览和分享流程。

二维编辑视图以 Canvas 图层和纹理融合提供实时绘画反馈；三维赏伞视图是真正的 WebGL 网格与材质光照，不是 TouchDesigner 工程。当前法线纹理、伞面曲率与光泽为程序化近似，不含真实扫描材质、完整次表面散射或流体 Navier–Stokes 求解。

## 素材说明

当前绘画器优先使用 `assets/motifs/` 中已有的五张透明 PNG（1254 × 1254，RGBA）：荷花、西湖景、锦鲤、竹枝和云纹；`water.svg` 保留为简单水线装饰。SVG 文件没有删除，但不再冒充上述正式纹样。资源来源在仓库中没有记录，因此这些高细节 PNG 仍按本地素材草稿管理，公开发布前需要补充作者与授权信息。替换接口见 `js/drawing/MotifLibrary.js`，步骤见 [纹样素材说明](assets/motifs/README.md)。

二维编辑器里的织理、扇区光照、绸面凹影和伞骨是 Canvas 2D 绘制的工作视图；3D 赏伞使用独立的弯曲网格和实体竹骨结构。两种视图共用同一份作品数据。分区仅是数字编辑的构图辅助，不代表传统工艺尺寸规范。

## 文化参考

- [中国非物质文化遗产网：伞制作技艺（西湖绸伞）](https://www.ihchina.cn/project_details/14578/)
- [杭州网：中国伞博物馆展陈介绍](https://ori.hangzhou.com.cn/ornews/content/2023-01/14/content_8448591.htm)
