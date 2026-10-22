import { getMotifAssetURL, MOTIF_LIBRARY } from "./MotifLibrary.js";

export class PatternDrawer {
  constructor(onAssetsReady = () => {}) {
    this.images = new Map();
    this.assets = new Map(MOTIF_LIBRARY.map((asset) => [asset.id, asset]));
    this.assetStates = new Map();
    this.ready = Promise.all(MOTIF_LIBRARY.map((asset) => new Promise((resolve) => {
      const image = new Image();
      image.onload = () => {
        this.assetStates.set(asset.id, "ready");
        resolve();
      };
      image.onerror = () => {
        this.assetStates.set(asset.id, "missing");
        resolve();
      };
      image.src = getMotifAssetURL(asset);
      this.images.set(asset.id, image);
    }))).then(() => {
      onAssetsReady(); return this;
    });
  }

  getImage(name) {
    const image = this.images.get(name);
    return image && image.complete && image.naturalWidth ? image : null;
  }

  getAsset(name) { return this.assets.get(name) || null; }
  getAssetState(name) { return this.assetStates.get(name) || "loading"; }

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
    // 使用素材原始透明图像和自然宽高比；不添加合成纤维、模糊或描边假装工笔细节。
    ctx.globalAlpha = opacity;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(image, -width / 2, -height / 2, width, height);
    ctx.restore();
  }
}
