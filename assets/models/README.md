# Blender 绸伞模型

`west-lake-umbrella.blend` 是可编辑的 Blender 工程，`west-lake-umbrella.glb` 是 H5 默认加载的模型。GLB 包含 Blender 制作的弧形绸面、径向 UV、32 组长竹骨与短骨、伞巢、伞心、直竹柄，以及名为 `Umbrella Fold` 的开合动画。

模型参考西湖绸伞“淡竹劈骨、长短骨配合、收拢后如圆竹”的结构特点：展开时，长骨沿伞面放射，短骨支撑长骨；收伞时，同一组长骨、短骨和绸面通过 Shape Key 一起收束。短骨在闭合姿态中沿圆周均匀嵌入长骨之间，共同构成连续竹束，不另生成一段独立竹筒。竹骨使用轻微纵向竹纹，伞轴贯穿伞巢、竹束与直柄。当前网格是便于 H5 交互的简化结构示意，并非按传承人实测尺寸复刻。资料提到长骨常见 32 或 36 根，当前模型采用 32 根。参见[中国非物质文化遗产网](https://www.ihchina.cn/project_details/14578/)及[湖北美术学院非遗研究中心的西湖绸伞工艺调查](https://fyzx.hifa.edu.cn/info/1028/1166.htm)。

## 重新生成

在项目根目录运行：

```powershell
blender --background --python tools/create_blender_umbrella.py
```

如果 Windows 上没有配置 `blender` 命令，请把命令替换为 Blender 可执行文件的完整路径。

## H5 接入约定

- 将 GLB 放在 `assets/models/`，默认文件名为 `west-lake-umbrella.glb`。
- 伞面网格对象命名为包含 `canopy`、`cloth` 或 `fabric` 的名字，并优先提供有效 UV；缺少 UV 时 H5 会从水平投影生成临时平面 UV，这只是保底映射，并非正式径向展开，界面会提示用户补做 UV。伞骨、缝线和伞缘不要命名成 canopy。
- 伞面 UV 以圆心为 `(0.5, 0.5)`，完整绸面映射到单位正方形中的圆形区域。当前模型的 UV 方向与 2D 圆形伞面纹理保持一致。
- 开合片段需命名包含 `fold`、`open` 或 `close`，并在 GLB 导出时包含 Shape Key 和骨架/对象动画。导入时运行时按作者数据播放，不改写动画关键帧。
- 保留独立的竹骨和伞巢网格。运行时会把 CanvasTexture 和 GPU 颜料场绑定至伞面 UV，并通过 Three.js 的 AnimationMixer 按 0–1 进度播放开合动画。

## 当前模型边界

此模型由项目 Blender 脚本构建，目的是实际验证 UV 贴图、三维结构与可反向开合动画。折叠形态由 Shape Key 配合骨架对象动画近似，不是布料碰撞模拟；正式工笔纹样、实物扫描法线贴图和传承人提供的结构尺寸仍可替换进来。

流体模拟参考 [PavelDoGreat/WebGL-Fluid-Simulation](https://github.com/PavelDoGreat/WebGL-Fluid-Simulation) 的 GPU 双缓冲与输运结构；本项目保留自己的输入、材质和界面代码，没有复制该项目的演示资源。
