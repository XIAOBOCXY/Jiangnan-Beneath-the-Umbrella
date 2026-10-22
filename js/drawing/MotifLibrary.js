// 纹样资源清单：绘画素材优先使用透明 PNG/WebP，SVG 留给线饰等适合矢量表现的图形。
// 替换 Procreate 成稿时，更新对应 src 和 format 即可，作品数据仍使用稳定的 id。
export const MOTIF_FORMATS = Object.freeze(["image/png", "image/webp", "image/svg+xml"]);

export const MOTIF_LIBRARY = Object.freeze([
  {
    id: "lotus", name: "西湖荷花", src: "../../assets/motifs/lotus.png",
    format: "image/png", role: "traditional-motif", status: "existing-raster-draft"
  },
  {
    id: "westLake", name: "雷峰湖山", src: "../../assets/motifs/west-lake.png",
    format: "image/png", role: "traditional-motif", status: "existing-raster-draft"
  },
  {
    id: "koi", name: "锦鲤戏水", src: "../../assets/motifs/koi.png",
    format: "image/png", role: "traditional-motif", status: "existing-raster-draft"
  },
  {
    id: "bamboo", name: "风竹", src: "../../assets/motifs/bamboo.png",
    format: "image/png", role: "traditional-motif", status: "existing-raster-draft"
  },
  {
    id: "cloud", name: "如意云纹", src: "../../assets/motifs/cloud.png",
    format: "image/png", role: "traditional-motif", status: "existing-raster-draft"
  },
  {
    id: "water", name: "西湖水纹", src: "../../assets/motifs/water.svg",
    format: "image/svg+xml", role: "vector-decoration", status: "decorative-vector-study"
  }
]);

export const getMotifAssetURL = (asset) => new URL(asset.src, import.meta.url).href;
