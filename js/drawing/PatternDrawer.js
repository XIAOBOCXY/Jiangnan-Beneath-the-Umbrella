import { getMotifAssetURL, MOTIF_CATEGORIES, MOTIF_FORMATS, MOTIF_LIBRARY } from "./MotifLibrary.js";

const VALID_ZONES = new Set(["伞心", "中部", "外圈", "伞缘"]);

const validateAsset = (asset) => {
  if (!asset?.id || !asset?.src || !asset?.name) return "素材缺少 id、名称或文件路径";
  if (!MOTIF_FORMATS.includes(asset.format)) return `不支持的素材格式：${asset.format}`;
  if (!MOTIF_CATEGORIES.some((category) => category.id === asset.categoryId)) return "素材分类未注册";
  if (!Number.isFinite(asset.recommendedSize) || asset.recommendedSize <= 0) return "推荐尺寸必须是正数";
  if (!Number.isInteger(asset.defaultRepeatCount) || asset.defaultRepeatCount < 1) return "默认重复数必须是正整数";
  if (!Array.isArray(asset.applicableZones) || asset.applicableZones.length === 0 || asset.applicableZones.some((zone) => !VALID_ZONES.has(zone))) return "素材适用区域配置无效";
  if (asset.defaultPlacement !== "single") return "当前素材放置方式仅支持 single";
  return null;
};

/**
 * 加载独立透明图像资源。绘制器保留原始宽高比和 alpha 通道，
 * 只负责把图片合成到 2D 作品层；Three.js 继续消费相同的合成 CanvasTexture。
 */
export class PatternDrawer {
  constructor(onAssetsReady = () => {}, assets = MOTIF_LIBRARY) {
    this.images = new Map();
    this.assets = new Map(assets.map((asset) => [asset.id, asset]));
    this.assetStates = new Map();
    this.assetErrors = new Map();

    this.ready = Promise.all(assets.map((asset) => this.loadAsset(asset))).then(() => {
      onAssetsReady(this);
      return this;
    });
  }

  loadAsset(asset) {
    const validationError = validateAsset(asset);
    if (validationError) {
      this.assetStates.set(asset?.id, "invalid");
      this.assetErrors.set(asset?.id, validationError);
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      const image = new Image();
      image.decoding = "async";
      image.onload = () => {
        this.assetStates.set(asset.id, "ready");
        this.images.set(asset.id, image);
        resolve();
      };
      image.onerror = () => {
        this.assetStates.set(asset.id, "missing");
        this.assetErrors.set(asset.id, `无法加载素材：${asset.src}`);
        resolve();
      };
      image.src = getMotifAssetURL(asset);
      // Image.decode 能更早准备解码结果；load/error 仍作为兼容回退。
      if (typeof image.decode === "function") {
        image.decode().then(() => {
          if (image.naturalWidth > 0) {
            this.assetStates.set(asset.id, "ready");
            this.images.set(asset.id, image);
          }
        }).catch(() => {});
      }
    });
  }

  getImage(id) {
    const image = this.images.get(id);
    return image && image.complete && image.naturalWidth ? image : null;
  }

  getAsset(id) { return this.assets.get(id) || null; }
  getAssets(categoryId = null) {
    return [...this.assets.values()].filter((asset) => !categoryId || asset.categoryId === categoryId);
  }
  getAssetState(id) { return this.assetStates.get(id) || "loading"; }
  getAssetError(id) { return this.assetErrors.get(id) || ""; }

  drawObject(ctx, object, instance) {
    const image = this.getImage(object.patternId);
    if (!image) return;
    const size = object.baseSize * object.scale * (instance.scale ?? 1);
    const ratio = image.naturalWidth / image.naturalHeight;
    const width = ratio >= 1 ? size : size * ratio;
    const height = ratio >= 1 ? size / ratio : size;
    ctx.save();
    ctx.translate(instance.x, instance.y);
    ctx.rotate(instance.rotation || 0);
    const opacity = Math.max(0, Math.min(1, (object.opacity ?? .94) * (instance.opacity ?? 1)));
    ctx.globalAlpha = opacity;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    // drawImage 会保留透明通道；尺寸按原始长宽比计算，不会拉伸成方形贴图。
    ctx.drawImage(image, -width / 2, -height / 2, width, height);
    ctx.restore();
  }
}
