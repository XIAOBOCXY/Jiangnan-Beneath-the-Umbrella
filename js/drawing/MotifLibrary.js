// 素材目录是新增纹样的唯一注册入口：作品只保存稳定的 patternId。
// 文件放进 assets/motifs 后，在这里增加一条元数据即可接入卡片、2D 绘制和 3D 贴图。
export const MOTIF_FORMATS = Object.freeze([
  "image/png",
  "image/webp",
  "image/svg+xml"
]);

export const MOTIF_CATEGORIES = Object.freeze([
  Object.freeze({ id: "subject", name: "主体绘画" }),
  Object.freeze({ id: "flora", name: "花卉植物" }),
  Object.freeze({ id: "jiangnan", name: "江南元素" }),
  Object.freeze({ id: "ornament", name: "传统纹饰" }),
  Object.freeze({ id: "edge", name: "伞缘边饰" })
]);

const freezeAsset = (asset) => Object.freeze({
  ...asset,
  applicableZones: Object.freeze([...asset.applicableZones])
});

export const MOTIF_LIBRARY = Object.freeze([
  freezeAsset({
    id: "westLake",
    name: "雷峰湖山",
    categoryId: "subject",
    src: "../../assets/motifs/west-lake.png",
    format: "image/png",
    recommendedSize: 300,
    defaultRepeatCount: 1,
    defaultPlacement: "single",
    applicableZones: ["伞心"],
    role: "主体绘画",
    status: "existing-raster-draft",
    description: "适合作为伞心单幅主体；保留透明底与原始比例。"
  }),
  freezeAsset({
    id: "lotus",
    name: "西湖荷花",
    categoryId: "flora",
    src: "../../assets/motifs/lotus.png",
    format: "image/png",
    recommendedSize: 150,
    defaultRepeatCount: 8,
    defaultPlacement: "single",
    applicableZones: ["伞心", "中部"],
    role: "花卉植物",
    status: "existing-raster-draft",
    description: "可单幅放置，也可手动生成环形构图。"
  }),
  freezeAsset({
    id: "bamboo",
    name: "风竹",
    categoryId: "flora",
    src: "../../assets/motifs/bamboo.png",
    format: "image/png",
    recommendedSize: 112,
    defaultRepeatCount: 8,
    defaultPlacement: "single",
    applicableZones: ["中部", "外圈"],
    role: "花卉植物",
    status: "existing-raster-draft",
    description: "可单幅放置或沿装饰带重复。"
  }),
  freezeAsset({
    id: "koi",
    name: "锦鲤戏水",
    categoryId: "jiangnan",
    src: "../../assets/motifs/koi.png",
    format: "image/png",
    recommendedSize: 104,
    defaultRepeatCount: 8,
    defaultPlacement: "single",
    applicableZones: ["中部", "外圈"],
    role: "江南元素",
    status: "existing-raster-draft",
    description: "可作为独立小景，也可手动环形排列。"
  }),
  freezeAsset({
    id: "cloud",
    name: "如意云纹",
    categoryId: "ornament",
    src: "../../assets/motifs/cloud.png",
    format: "image/png",
    recommendedSize: 92,
    defaultRepeatCount: 12,
    defaultPlacement: "single",
    applicableZones: ["中部", "外圈"],
    role: "传统纹饰",
    status: "existing-raster-draft",
    description: "装饰纹饰，默认提供 12 重环形排列建议。"
  }),
  freezeAsset({
    id: "water",
    name: "西湖水纹",
    categoryId: "edge",
    src: "../../assets/motifs/water.svg",
    format: "image/svg+xml",
    recommendedSize: 48,
    defaultRepeatCount: 12,
    defaultPlacement: "single",
    applicableZones: ["外圈", "伞缘"],
    role: "伞缘边饰",
    status: "decorative-vector-study",
    description: "现有线饰示例；正式边饰可直接替换为透明 PNG/WebP。"
  })
]);

export const getMotifAsset = (id) => MOTIF_LIBRARY.find((asset) => asset.id === id) || null;
export const getMotifsInCategory = (categoryId) => MOTIF_LIBRARY.filter((asset) => asset.categoryId === categoryId);
export const getMotifAssetURL = (asset) => new URL(asset.src, import.meta.url).href;
