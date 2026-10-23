# 纹样资源库

纹样资源从 `js/drawing/MotifLibrary.js` 注册。Canvas 2D 读取独立图像并保留透明通道、原始宽高比；Three.js 继续使用作品合成后的 CanvasTexture。新增素材不需要改绘画器或 3D 渲染代码。

## 分类与现有素材

| 分类 | 素材 | 文件格式 | 推荐用途 |
| --- | --- | --- | --- |
| 主体绘画 | 雷峰湖山 | PNG | 伞心单幅主体 |
| 花卉植物 | 西湖荷花、风竹 | PNG | 主体或中部/外圈装饰 |
| 江南元素 | 锦鲤戏水 | PNG | 中部/外圈点景 |
| 传统纹饰 | 如意云纹 | PNG | 装饰纹样，可重复排列 |
| 伞缘边饰 | 西湖水纹 | SVG | 当前线饰研究稿；后续可替换为透明 PNG/WebP |

现有五张 PNG 为 1254 × 1254、RGBA 透明图像；素材文件夹里已有的其他 SVG 也全部保留，只是不自动作为主素材注册。现有图像按项目中的草稿素材管理，来源与授权信息尚未记录，不应标注为正式工笔成稿或非遗原作。

## 元数据字段

每个条目需要包含：

- `id`：稳定 ID，作品数据依赖它；替换文件时不要改已有 ID。
- `name`、`categoryId`：显示名称与分类 ID。
- `src`、`format`：相对 `MotifLibrary.js` 的文件路径与 MIME 格式。支持 `image/png`、`image/webp`、`image/svg+xml`。
- `recommendedSize`：Canvas 逻辑单位中的建议尺寸。
- `defaultRepeatCount`：主体绘画填 `1`；装饰纹样填建议环形数量。纹样放置时始终先作为单个对象，用户点击“环形重复”后才按此数量预填。
- `defaultPlacement`：目前为 `single`。
- `applicableZones`：允许放置或自动吸附的区域，使用 `伞心`、`中部`、`外圈`、`伞缘`。
- `role`、`status`、`description`：用途、资源成熟度与备注。

## 添加 Procreate 素材

1. 导出透明背景 PNG 或支持 alpha 的 WebP，并把文件复制到 `assets/motifs/`。保留主体周围合理的透明留白。
2. 在 `MotifLibrary.js` 中为它分配新的稳定 `id`，填写名称、分类、格式、推荐尺寸、默认重复数和适用区域。
3. 若是新分类，在 `MOTIF_CATEGORIES` 增加 `{ id, name }`；纹样分类页签和卡片会自动生成。
4. 刷新页面。文件成功加载后卡片可用；路径失效或配置错误时卡片会标出不可用状态。

资源路径示例：

```js
{
  id: "new-lotus-study",
  name: "并蒂莲",
  categoryId: "flora",
  src: "../../assets/motifs/twin-lotus.webp",
  format: "image/webp",
  recommendedSize: 156,
  defaultRepeatCount: 8,
  defaultPlacement: "single",
  applicableZones: ["伞心", "中部"],
  role: "花卉植物",
  status: "procreate-final",
  description: "透明 WebP 工笔成稿。"
}
```

渲染尺寸根据图像原始宽高比计算，不会强制拉伸成正方形。高分辨率成稿可直接替换同一 ID 对应的 `src`，既有作品对象仍然能找到该素材。
