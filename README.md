# 西湖绸伞非遗数字展馆

**Jiangnan Beneath the Umbrella** · 沉浸式非遗体验网站

以西湖绸伞为主题的浏览器交互项目，包含首页、非遗文化书册、绘制工坊和三维悬伞画廊。用户可以选择伞面颜色与织物、添加纹样、自由绘画，再以同一份作品查看三维绸伞并存入本地画廊。

项目采用原生 HTML、CSS、JavaScript 模块、Canvas 2D、Three.js 和 Web Audio。无需构建或安装 npm 依赖；当前没有后端、账号系统或云端作品库。

## 本地运行

在项目根目录启动静态服务器：

```powershell
python -m http.server 8000 --bind 127.0.0.1
```

浏览器打开 [首页](http://localhost:8000/#home) 或 [绘制工坊](http://localhost:8000/#studio)。页面使用 ES 模块、模型和同源 iframe，请通过 HTTP 服务访问，不要直接双击 `index.html`。

Three.js 0.186.0 及所用插件随项目存放在 `vendor/three/`，import map 指向本地文件；字体、模型、文化书页图片和纹样也由项目静态资源加载。三维场景和水墨需要浏览器支持 WebGL，建议开启硬件加速。鼠标、触屏和笔输入使用 Pointer Events；桌面显示右侧卷轴面板，手机面板固定在屏幕底部并向上展开，面板内容可独立滚动。

桌面默认界面按用户确认的本地 150% 浏览器缩放截图校准：在 1920 × 911 视区中，右侧卷轴约 473 像素宽，2D/3D 切换约 231 像素宽；文字和按钮随窗口协调缩放，伞面仍按可用视区取景。浏览器使用 100% 即可获得这套尺寸，本地与线上地址应使用相同的浏览器缩放比例，避免在放大的默认界面上再次叠加 150%。根字号限制在浏览器默认值的 100%–225%，较窄桌面的底部控件分行。宽度不超过 980 CSS 像素时使用窄屏布局，回到桌面布局时清除整页滚动偏移。设备像素比只影响画布清晰度，不作为界面尺寸的基准。

这套尺寸覆盖四个页面：首页文案、文化书册文字及章节索引、各页导航、工坊卷轴与底部按钮、画廊天气昼夜控件及作品条。桌面顶部导航和文化书册文字统一使用 rem 跟随全站字号；书册外框、伞面及三维街景按视区取景。

部署时使用静态托管即可，保留 `js/`、`assets/` 和 `vendor/` 的相对路径。Python 服务只负责提供文件，不负责接收或保存作品。

## 线上部署与访问

当前服务器通过 HTTP 提供两个项目：

| 地址 | 用途 |
| --- | --- |
| [http://47.114.72.51/](http://47.114.72.51/) | 自动跳转到绸伞项目的 `/umbrella/` 首页。 |
| [http://47.114.72.51/umbrella/](http://47.114.72.51/umbrella/) | 绸伞项目的实际入口；可继续使用 `#home`、`#heritage`、`#studio` 和 `#gallery`。 |
| [http://47.114.72.51/stayscape/](http://47.114.72.51/stayscape/) | 跳转到原“余宿成景”项目的 `/visitor` 首页。 |
| [http://47.114.72.51/visitor](http://47.114.72.51/visitor) | 原“余宿成景”项目的直接入口；其登录页、接口和静态资源仍由原项目提供。 |

绸伞静态文件位于服务器 `/opt/JiangnanUmbrella`，由 `jiangnan-umbrella-web` 容器提供；外层 `stayscape-nginx-1` 将 `/umbrella/` 代理到该容器，并将根地址重定向到 `/umbrella/`。原“余宿成景”代码、容器、数据库与 `/api/`、`/ws/`、`/generated-media/` 路径保留。外层配置位于 `/opt/StayScape/nginx/nginx.conf`；修改后需先验证 Nginx 配置，再平滑重载并检查两个项目。

根地址使用 302 跳转并保留查询参数，实际页面仍加载在 `/umbrella/`，方便后续调整默认入口。原路径的 `#studio` 等页内路由可继续使用。根地址跳转后仍在相同协议、主机和端口下运行，因此同一浏览器原来在 `/umbrella/` 保存的画廊作品仍可使用；这不改变作品仅保存在当前浏览器中的行为。

## 页面与导航

| 路由 | 当前功能 |
| --- | --- |
| `#home` | 水墨湖面、指针水波、可拖动旋转和缩放的三维绸伞，以及三个页面入口。优先展示本地已选作品；没有作品时使用初始伞面。 |
| `#heritage` | 12 组文化书册，提供翻页与创制、材料、装饰、贴青、纹样、养护六个章节索引；手机逐面显示，章节索引始终位于右侧。iOS 使用静态水墨纸面背景，避免透明图层影响文字。 |
| `#studio` | 伞面选色、三种织物、纹样编辑、自由绘画、灵感组合、撤销重做，以及 2D/3D 切换。 |
| `#gallery` | 三维江南街巷与悬挂作品，支持沿街浏览、选中作品、打开赏伞、删除作品和切换天气、昼夜。 |

页面切换采用 WebGL 水墨转场，先完整遮住旧页，再切换和揭幕；系统开启“减少动态效果”时会缩短或跳过部分动画。首页湖面、文化页墨流、工坊背景和伞面绘画各自管理状态，离开相应页面或切到后台时暂停相关动画。

当前画廊直接进入 `HangingGallery3D.js` 的三维街景。旧雨桥、人物行走画廊的 `GalleryScene.js` 和相关图像仍留在目录中作为历史实现，当前页面入口不使用它们。

## 绘制工坊

新进入页面时是一把空白的新作，初始底色为湖绿色 `#8aa79b`，面料为乔其纱；不会自动铺入示例纹样。

### 伞面与视图

- **伞面选择**：使用预设色块或颜色选择器改变基布颜色；织物可选乔其纱、电力纺和密织真丝。
- **2D 绘制**：在俯视伞面上编辑，空白处拖动旋转视图，滚轮以指针为中心缩放。
- **3D 赏伞**：使用 Blender 绸伞模型显示同一份 UV 作品，可拖动旋转、缩放，并通过滑杆或“收拢／展开”查看开合。
- **收卷／展卷**：收起或展开工具面板；三维画面的取景随面板状态调整。
- **声光响应**：点击后播放 Web Audio 实时合成的氛围音乐，并以音频能量驱动伞面微光与轻微动态；不读取系统声音，也不需要麦克风。

底部的 2D/3D 切换、收拢／展开、声光响应和存入画廊统一使用寒蝉活楷体及相同的按钮字号、字重。右侧卷轴工具面板使用刀隶体；字体文件由 `assets/fonts/` 同源加载。

### 纹样装饰

当前注册表提供 **28 个可选条目**，分为湖山景致、花卉植物、飞鸟蝶影、戏曲人物、传统纹饰和伞缘边饰六类。新作品的选择列表不再重复显示同一图像；旧素材 ID 仍然保留，以兼容已有作品。

选择纹样后点击纸面放置。选中对象可直接在画布上移动，拖动四角缩放、顶部手柄旋转，点击删除手柄移除；下方的加减手柄控制环绕数量。对象可以跨出伞缘，落在伞面内时会参考构图区吸附。辅助线和操作框只用于编辑，不进入作品纹理。

点击纹样卡片会显示题材与摆放说明，较长内容自动缓慢滚动。纹样资源、分类、尺寸、重复数和来源说明统一登记在 `js/drawing/MotifLibrary.js`，新增素材应从该注册表接入。

### 自由绘画与灵感

| 笔刷 | 当前表现 |
| --- | --- |
| 柔墨 | 较宽的柔和笔迹，保留轻微湿边。 |
| 纤维笔 | 以干笔颗粒表现纤维纹理，水量为零。 |
| 清晰 | 使用 Canvas 平滑路径绘制清晰线条，不走 GPU 湿墨晕染。 |
| 水墨生成 | 使用 GPU 颜料与湿度场表现明显的水墨扩散。 |

大小和浓淡各有 1–10 档；放射重复为 1–14 重，绘制的笔迹数量与重数一致。镜像在重复数大于 1 时让相邻笔迹交替翻转，不增加笔迹数量；旧笔迹保留原有重现方式。笔输入会读取压力。GPU 笔迹在松笔后短暂扩散，再清理速度和湿度，保留已落下的颜料。

**纹样和所有笔刷统一按创作顺序叠加：后添加的内容在上方，以原有透明度与下方内容融合。** 例如先画线再放纹样，纹样在上；先放纹样再画线，线条在上。移动、缩放、旋转、替换或调整已有纹样的重复数量，会保留它最初的层级。撤销、重做、2D、3D 和存入画廊均使用同一顺序。

每个对象的 `order` 随逻辑作品保存。活动水墨笔迹在 GPU 中保留晕染；添加下一笔或纹样、切换三维、保存或恢复历史时，先处理尚未提交的墨段，再将当前笔迹冻结到它对应的位置。离屏像素缓存最多保留 32 层，缺失时按记录的源墨段重建，不将像素缓存复制到历史快照。旧数据没有记录交错顺序，会按旧版的清晰笔迹、纹样、水墨顺序迁移；旧存档中的作品图像保持原样。

“灵感”会重新组合底色、面料、一至两枚同类纹样及五组连贯水墨笔迹，随机调整大小、位置和方向。整次生成是一条可撤销操作，完成后取消纹样操作框。批量生成只做最终合成与三维刷新，并复用面料贴图缓存。“清空”移除当前笔迹和纹样，保留已选基布与面料。

撤销／重做支持按钮及 `Ctrl+Z`、`Ctrl+Shift+Z`、`Ctrl+Y`；选中纹样时可用 Delete／Backspace 删除。历史最多 40 步，并有约 16 MiB 的序列化快照预算。

## 作品保存在哪里

**作品保存在当前浏览器、当前网站地址的 `localStorage` 中，不会上传服务器，也不会写入项目文件夹。**

点击“存入画廊”时，程序先冻结当前水墨笔迹，再按创作顺序和当前工坊参数合成底色、笔迹及纹样；三维和画廊使用同一份合成纹理。保存的是伞面创作纹理，不是三维视口截图。保存后进入画廊并选中新作品。

每件存档包含作品 ID、创建时间、伞面图像、可编辑笔迹与纹样数据、面料、底色和创作参数。图像通常编码为 640 × 640 的 WebP；空间不足时会尝试 384 × 384 的版本，并缩减保留的历史作品数量。正常最多保留最近 12 件，继续保存会移出较早的作品。

| 存储键 | 用途 |
| --- | --- |
| `jiangnan-umbrella-gallery-v1` | 作品图像、对象数据、面料与颜色等存档。 |
| `jiangnan-umbrella-gallery-selected-v1` | 当前选择的作品，供首页和画廊展示使用。 |
| `jiangnan-umbrella-gallery-assignments-v1` | 旧版画廊作品分配的兼容数据。 |

本地存储按协议、主机和端口隔离。因此 `http://localhost:8000`、`http://127.0.0.1:8000`、不同端口或正式部署的域名，各自拥有独立作品库；URL 中的 `#studio` 与 `#gallery` 不会划分作品库。

换电脑、换浏览器或换浏览器用户配置时，不会自动看到原来的作品。复制项目文件也不会带走这些存档；清除网站数据、使用临时浏览模式或删除作品可能使其丢失。当前没有作品导出／导入、跨设备同步或重新打开存档继续编辑的界面；刷新页面后工坊仍从新作开始，已保存作品可在画廊查看。

## 三维悬伞画廊

街景加载本地 `hanging-gallery-street.glb`，用远山图片、湖面与多层雾构成远景。街景、远山和当前作品准备完毕后一起显示，加载失败时显示提示。手机手势提示显示 30 秒后淡出。横绳固定在屋檐支点，悬伞和绳索随风摆动。当前悬挂作品来自本地保存的个人作品；没有作品时显示“去绘制一把”的入口。

- 滚轮沿街巷前后浏览，鼠标移动平滑调整观看方向。
- 手机端单指上下滑动可前进或后退、左右滑动可转向；双指滑动调整视角。独立赏伞按手机屏幕宽度取景，点击伞外空白处返回。
- 底部作品条提供选择与左右浏览，选中时相机会向对应悬伞取景；点击悬挂伞打开独立三维赏伞，Escape 关闭。
- 作品条上的删除按钮会二次确认；删除同时清理相关本地选择与旧分配关系。
- 右上角可选择晴天、雨天、白天或黑夜。天气和昼夜也会随场景时间自动变化，影响雾、雨、风、环境光、窗户和灯笼。
- 夜景包含窗灯、灯笼、伞面局部暖光和湿地反光。地面反光是着色器近似，不是屏幕空间反射或完整镜面反射。

独立赏伞、首页和工坊复用同一 Three.js 预览器；街景悬伞使用共享伞面材质。作品条缩略图直接使用保存的图像，不额外套颜色转换或再次叠加面料透明度。

## 伞面材质与渲染

`ArtworkDocument` 保存逻辑笔迹和纹样对象，Canvas 图层是渲染缓存。2D 使用 720 × 720 的逻辑工作区，按屏幕像素比调整缓冲区，最高 2 倍；3D 伞面使用 1024 × 1024 的 UV 纹理。纹理只在需要时重建和上传，源画布与 CanvasTexture 会复用。

当前三种织物是实时视觉近似：乔其纱轻薄透光，电力纺较平滑，密织真丝更紧密、丝光稍明显。三维基础不透明度分别为 0.78、0.90、0.96，并以细密纤维和透光间隙表现纱感；远处的细纹会淡出以减少闪烁。材质只改变织理、轻微形变及光照响应，不替换用户图案。

二维底色直接使用所选染色，布面照片转为缓存的灰度细节；三维采用中性柔光和克制的反光，避免默认黄调改变绿色。街景灯笼光只在传入真实灯光参数后参与着色，工坊默认关闭这些暖灯。由于半透明布面会透出背景，2D/3D 的视角、曲面与动态背景仍会影响视觉明暗。

模型 `west-lake-umbrella.glb` 包含径向 UV、36 组长短竹骨、伞巢、直竹柄和 `Umbrella Fold` 动画。支持浏览器解压流时优先读取同目录的无损压缩版本 `west-lake-umbrella.glb.gzbin`，否则回退到原始 GLB；更新模型后应同步重新生成压缩文件。Three.js 用 AnimationMixer 驱动内置模型的开合；程序伞作为模型加载失败时的回退。折叠和透光均为 H5 近似，没有真实布料碰撞、物理丝绸扫描或完整颜料化学模拟。

## 代码与资源目录

```text
Interaction Design/
├── index.html                         四个页面及原生控件
├── styles.css                         页面布局、字体、卷轴与响应式样式
├── js/
│   ├── main.js                        应用入口
│   ├── app/App.js                     绘画输入、视图切换、灵感与保存编排
│   ├── core/
│   │   ├── ArtworkDocument.js          逻辑作品、撤销和重做
│   │   ├── InkArtworkLayers.js         按笔迹缓存、冻结与重建 GPU 水墨
│   │   ├── CanvasManager.js            2D 图层、染色与 UV 合成
│   │   ├── MandalaRenderer.js          笔迹、纹样对象和画布手柄
│   │   ├── RadialSymmetry.js           放射重复与镜像变换
│   │   └── CompositionZones.js         构图区与吸附
│   ├── drawing/
│   │   ├── MotifLibrary.js             纹样注册表
│   │   └── PatternDrawer.js            图像加载及纹样绘制
│   ├── features/
│   │   ├── ArtworkGalleryStore.js      浏览器本地作品库
│   │   ├── TemplateComposer.js         空白新作初始化
│   │   └── AmbientMusic.js             Web Audio 氛围音乐
│   ├── rendering/
│   │   ├── ThreeUmbrellaPreview.js     工坊、首页和详情三维赏伞
│   │   ├── UmbrellaCanopyMaterial.js   共享织物、纱网与灯光着色
│   │   └── InkFluidSystem.js           伞面 GPU 水墨
│   ├── site/
│   │   ├── SiteExperience.js           路由、文化翻页及画廊交互
│   │   ├── HangingGallery3D.js         三维街景、天气、昼夜与悬伞
│   │   ├── HomeLakeScene.js            首页湖面和指针水波
│   │   ├── InkTransition.js            全屏水墨转场
│   │   ├── NavigationInk.js            导航墨迹
│   │   └── GalleryScene.js             旧雨桥画廊，当前入口不加载
│   └── ui/
│       ├── ControlManager.js           工具状态、纹样分类及说明
│       └── InkWashBackground.js        环境墨流 iframe 与启停
├── assets/
│   ├── fonts/                         本地刀隶体、活楷体及许可文本
│   ├── heritage/papers/               文化页图片、原始资料及来源说明
│   ├── patterns/                      彩绘、修复与研究纹样
│   ├── motifs/                        旧纹样与兼容素材
│   ├── models/                        Blender 工程、GLB 和模型说明
│   ├── gallery/                       湖山背景、街景材质及旧版图层
│   └── ui/                            宣纸、卷轴和墨迹资源
├── vendor/
│   ├── three/                         Three.js 核心、插件及许可证
│   ├── integrations/                  工坊与文化页的水墨背景适配
│   ├── upstream-shuimo-liuyun/         工坊流体背景上游源码
│   ├── upstream-ink-water/             文化页流体背景上游源码
│   └── upstream-nijimi/               历史参考存档，当前不运行
├── tools/                             Blender 建模和纹样处理脚本
├── tmp/                               开发截图、检查脚本及临时资源
└── creative-mandala/                   保留的原参考项目
```

## 开发与维护

默认不需要 Blender；页面直接读取已导出的 GLB。重建模型时，在项目根目录依次运行：

```powershell
blender --background --python tools/create_blender_umbrella.py
blender --background --python tools/create_umbrella_display_poses.py
blender --background --python tools/create_hanging_gallery_world.py
```

分别生成动画伞模、静态展示伞和街景。脚本使用已有本地材质文件；没有将 Blender 加入 PATH 时改用其可执行文件的完整路径。细节见 [模型说明](assets/models/README.md) 与 [画廊素材说明](assets/gallery/README.md)。

重建动画伞模后，重新生成首页优先加载的无损压缩版本：

```powershell
python -c "import gzip; from pathlib import Path; p=Path('assets/models/west-lake-umbrella.glb'); Path(str(p)+'.gzbin').write_bytes(gzip.compress(p.read_bytes(), compresslevel=7, mtime=0))"
```

新增纹样时，把带透明通道的 PNG、WebP 或 SVG 放入资源目录，并在 `MotifLibrary.js` 填写稳定 ID、分类、尺寸、重复配置、适用区域与来源。保留旧 ID，以免已有存档无法找到素材。当前大部分可选条目为 PNG/WebP；生成彩绘资源的参考与范围见 [彩绘纹样说明](assets/patterns/painted-collection/README.md)。

修改 JS 或 CSS 后，更新对应的版本查询参数，避免浏览器继续使用旧模块。使用 `?inspect=1#studio` 可在开发控制台读取 `window.__inspectStudio` 和 `window.__inspectSite`，核对当前底色、贴图版本、材质、灯光与保存链路；这是开发检查入口，不是用户工具面板。

创作顺序回归检查位于 `tools/verify-artwork-order.mjs`：Node 可直接运行模型测试；浏览器开发检查页可导入并执行 `runArtworkOrderChecks(window.__inspectStudio)`，检查实际 Canvas、GPU 水墨、保存纹理和历史恢复。

`tmp/` 中的回归脚本与截图用于本机开发，部分脚本引用本机 Node、Canvas 或浏览器路径，不属于通用安装命令。日常修改应按影响范围检查：

- 选色后切换 2D/3D，检查纱感、色相、纹样位置和开合。
- 绘画、灵感、撤销／重做后保存，重新打开画廊作品，核对底色与笔迹。
- 检查画廊的选择、详情关闭、昼夜和雨天地面反光。
- 检查桌面和窄屏的卷轴展开、底部操作栏、文化翻页和页面转场。

当前界面没有 GLB 文件导入、GPU 调试面板、作品分享、云同步或批量导出入口；底层保留的历史方法不代表这些功能已对用户开放。

## 素材来源与第三方代码

- **Three.js**：本地分发 [mrdoob/three.js](https://github.com/mrdoob/three.js)，版本见 `vendor/three/VERSION.txt`，许可见 `vendor/three/LICENSE`。
- **工坊环境流体**：实际集成 [airbate/shuimo-liuyun](https://github.com/airbate/shuimo-liuyun)，原始源码与 MIT 许可保留在 `vendor/upstream-shuimo-liuyun/`，适配页为 `vendor/integrations/shuimo-liuyun-studio.html`。背景自动演墨，当前工坊指针不向环境背景写入颜料或速度。
- **文化页墨流**：实际集成 [YijiaDuan/ink-water](https://github.com/YijiaDuan/ink-water)，源码与 MIT 许可见 `vendor/upstream-ink-water/`，适配页为 `vendor/integrations/ink-water-heritage.html`。
- **伞面水墨与书页运动参考**：[PavelDoGreat/WebGL-Fluid-Simulation](https://github.com/PavelDoGreat/WebGL-Fluid-Simulation)、[StPageFlip](https://github.com/Nodlik/StPageFlip)。伞面输入、作品数据及翻页控制由本项目模块实现。
- **历史视觉与交互参考**：[Nijimi](https://github.com/mosaddiqdev/nijimi)、[qingming-riverside](https://github.com/xianxie6/qingming-riverside)、[Uiverse](https://uiverse.io/) 和 [Web Awesome](https://webawesome.com/docs/components)。当前页面不加载这些参考站点的运行脚本。
- **字体**：刀隶体与寒蝉活楷从 `assets/fonts/` 加载，相关许可文本同目录保留；活楷来源为 [ChillMovableType](https://github.com/Warren2060/ChillMovableType)。
- **街景纹理、背景及图像**：来源、许可和生成说明见 [画廊素材说明](assets/gallery/README.md)。纹样中的生成绘制稿、实物提取修复稿和旧兼容素材应按各自元数据区分。
- **文化资料**：[中国非物质文化遗产网项目档案](https://www.ihchina.cn/project_details/14578/)、[湖北美术学院非遗研究中心工艺调查](https://fyzx.hifa.edu.cn/info/1028/1166.htm)。本地文献图版与来源见 [资料来源表](assets/heritage/papers/SOURCES.md)；这些资料与开源代码的许可分别记录，不将文化图版默认视为项目自有作品。
