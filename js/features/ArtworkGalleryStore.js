const STORAGE_KEY = "jiangnan-umbrella-gallery-v1";
const MAX_ARTWORKS = 12;
const ASSIGNMENTS_KEY = "jiangnan-umbrella-gallery-assignments-v1";
const SELECTION_KEY = "jiangnan-umbrella-gallery-selected-v1";

/** Stores private visitor artworks in this browser; no upload or account is used. */
export class ArtworkGalleryStore {
  getSelectedWorkId() {
    try { return localStorage.getItem(SELECTION_KEY) || null; }
    catch { return null; }
  }

  select(workId) {
    const validId = this.list().some((work) => work.id === workId) ? workId : null;
    try {
      if (validId) localStorage.setItem(SELECTION_KEY, validId);
      else localStorage.removeItem(SELECTION_KEY);
    } catch { /* A remembered selection is optional when storage is unavailable. */ }
    return validId;
  }

  list() {
    try {
      const items = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      return Array.isArray(items) ? items.filter((item) => item?.id && item?.imageDataUrl) : [];
    } catch {
      return [];
    }
  }

  getAssignments() {
    try {
      const value = JSON.parse(localStorage.getItem(ASSIGNMENTS_KEY) || "{}");
      return value && typeof value === "object" && !Array.isArray(value) ? value : {};
    } catch { return {}; }
  }

  assign(slot, workId) {
    const assignments = this.getAssignments();
    assignments[String(slot)] = workId;
    localStorage.setItem(ASSIGNMENTS_KEY, JSON.stringify(assignments));
  }

  delete(workId) {
    const existing = this.list();
    const target = existing.find((item) => item.id === workId);
    if (!target || target.category !== "mine") return false;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(existing.filter((item) => item.id !== workId)));
    const assignments = this.getAssignments();
    Object.keys(assignments).forEach((slot) => { if (assignments[slot] === workId) delete assignments[slot]; });
    localStorage.setItem(ASSIGNMENTS_KEY, JSON.stringify(assignments));
    if (this.getSelectedWorkId() === workId) this.select(null);
    return true;
  }

  saveCanvas(sourceCanvas, documentData = null, fabricMaterial = "georgette", settings = null) {
    const size = 640;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext("2d");
    context.clearRect(0, 0, size, size);
    context.drawImage(sourceCanvas, 0, 0, size, size);
    const material = ["georgette", "plainSilk", "denseSilk"].includes(fabricMaterial) ? fabricMaterial : "georgette";
    const fabricColor = /^#[0-9a-f]{6}$/i.test(settings?.fabricColor || "") ? settings.fabricColor.toLowerCase() : null;
    const savedSettings = settings ? { ...JSON.parse(JSON.stringify(settings)), fabricMaterial: material, fabricColor } : null;
    const savedDocument = documentData ? JSON.parse(JSON.stringify(documentData)) : null;
    if (savedDocument && savedSettings) savedDocument.settings = savedSettings;
    const artwork = {
      id: `work-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: new Date().toISOString(),
      category: "mine",
      imageDataUrl: canvas.toDataURL("image/webp", 0.88),
      document: savedDocument,
      fabricMaterial: material,
      fabricColor,
      settings: savedSettings
    };
    const next = [...this.list().filter((item) => item.id !== artwork.id), artwork].slice(-MAX_ARTWORKS);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return artwork;
    } catch (error) {
      // Keep older local works when storage is nearly full; try a smaller image once.
      canvas.width = 384;
      canvas.height = 384;
      canvas.getContext("2d").drawImage(sourceCanvas, 0, 0, 384, 384);
      artwork.imageDataUrl = canvas.toDataURL("image/webp", 0.72);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify([...this.list().slice(-5), artwork]));
        return artwork;
      } catch {
        throw new Error(error?.name === "QuotaExceededError" ? "本地画廊空间已满，请清理浏览器站点数据后再保存。" : "无法写入浏览器本地画廊。请检查隐私模式或存储设置。");
      }
    }
  }

  createFeatured(canvas) {
    return {
      id: "featured-lotus-lake",
      createdAt: "1932-01-01T00:00:00.000Z",
      category: "traditional",
      fabricMaterial: "georgette",
      imageDataUrl: canvas.toDataURL("image/webp", 0.9)
    };
  }

  createCuratedExhibitionWorks(_patternDrawer) {
    const root = new URL("../../assets/patterns/painted-collection/", import.meta.url);
    const designs = [
      ["painted-lake", "lake.webp", "南湖晚照", "#d9d1b8", "#748d83", "scene"],
      ["white-flowers", "white-flowers.webp", "玉兰清影", "#e9e3d2", "#889783", "floral"],
      ["butterfly", "butterfly.webp", "蝶恋春枝", "#e2d2b4", "#6f8c86", "butterfly"],
      ["blossoms", "blossoms.webp", "海棠春色", "#e8d5d3", "#8b756f", "floral"],
      ["green-opera", "green-opera.webp", "翠面戏彩", "#c1c6a7", "#556a58", "opera"],
      ["gold-opera", "gold-opera.webp", "金彩戏韵", "#dfc58b", "#886b42", "opera"],
      ["red-spray", "red-spray.webp", "朱梅映雪", "#e3d8c7", "#986453", "floral"],
      ["blue-lake", "blue-lake.webp", "月照三潭", "#c7d7d9", "#668897", "scene"],
      ["clouds", "clouds.webp", "云纹绕边", "#e4d9c1", "#a18151", "border"],
      ["green-bird", "green-bird.webp", "青鸟衔春", "#ced8bf", "#587d78", "bird"],
      ["pink-peony", "pink-peony.webp", "粉黛牡丹", "#ead6d3", "#a67578", "floral"],
      ["lotus", "lotus.webp", "荷塘月色", "#d6ded1", "#6f9187", "floral"],
      ["blue-blossoms", "blue-blossoms.webp", "蓝紫花枝", "#d5dee1", "#728997", "floral"],
      ["white-butterfly", "white-butterfly.webp", "素蝶", "#e4ddca", "#9b8766", "butterfly"],
      ["plum", "plum.webp", "红梅疏影", "#dfd2c6", "#915c4c", "floral"],
      ["yellow-flower", "yellow-flower.webp", "金蕊淡香", "#e5dec5", "#9d8b5f", "floral"],
      ["blue-opera", "blue-opera.webp", "蓝彩戏韵", "#c7d2dc", "#526d8b", "opera"],
      ["red-opera", "red-opera.webp", "丹面戏彩", "#e2c9c0", "#a35045", "opera"],
      ["willow-boat", "willow-boat.webp", "柳岸归舟", "#d5ddd2", "#738e87", "scene"],
      ["pavilion", "pavilion.webp", "湖山亭影", "#d8ddce", "#70877b", "scene"],
      ["floral-border", "floral-border.webp", "锦边花带", "#e8ded0", "#9c7e69", "border"]
    ];
    return designs.map(([id, file, title, silk, shade, layout]) => ({
      id: "painted-" + id,
      title,
      createdAt: "1932-01-01T00:00:00.000Z",
      category: "traditional",
      motifUrl: new URL(file, root).href,
      motifLayout: layout,
      silkPalette: { silk, shade }
    }));
  }
  async createCuratedCanopyCanvas(artwork) {
    const image = new Image();
    image.decoding = "async";
    try {
      if (image.decode) {
        image.src = artwork.motifUrl;
        await image.decode();
      } else {
        await new Promise((resolve, reject) => {
          image.onload = resolve;
          image.onerror = () => reject(new Error("彩绘纹样素材无法读取。"));
          image.src = artwork.motifUrl;
        });
      }
    } catch {
      throw new Error("彩绘纹样素材无法读取，请检查本地素材文件。");
    }
    if (!image.naturalWidth || !image.naturalHeight) throw new Error("彩绘纹样素材尺寸无效。");

    const size = 768;
    const center = size / 2;
    const radius = size * .478;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("浏览器无法创建彩绘纹样画布。");

    const silk = artwork.silkPalette?.silk || "#e7dfcc";
    const shade = artwork.silkPalette?.shade || "#879388";
    const fabric = context.createRadialGradient(center * .66, center * .62, 12, center, center, radius);
    fabric.addColorStop(0, silk);
    fabric.addColorStop(.83, silk);
    fabric.addColorStop(1, shade);
    context.fillStyle = fabric;
    context.fillRect(0, 0, size, size);

    context.save();
    context.beginPath();
    context.arc(center, center, radius, 0, Math.PI * 2);
    context.clip();
    const sheen = context.createRadialGradient(center * .72, center * .66, 5, center, center, radius);
    sheen.addColorStop(0, "rgba(255,252,237,.2)");
    sheen.addColorStop(.72, "rgba(255,252,237,.03)");
    sheen.addColorStop(1, "rgba(74,61,43,.08)");
    context.fillStyle = sheen;
    context.fillRect(0, 0, size, size);

    const drawMotif = (x, y, maxWidth, maxHeight, rotation = 0, opacity = .96) => {
      const aspect = image.naturalWidth / image.naturalHeight;
      let width = maxWidth;
      let height = width / aspect;
      if (height > maxHeight) { height = maxHeight; width = height * aspect; }
      context.save();
      context.translate(x, y);
      context.rotate(rotation);
      context.globalAlpha = opacity;
      context.drawImage(image, -width / 2, -height / 2, width, height);
      context.restore();
    };

    if (artwork.motifLayout === "scene") {
      drawMotif(center, center + 35, size * .88, size * .58, 0, .96);
    } else if (artwork.motifLayout === "opera") {
      for (let index = 0; index < 4; index += 1) {
        const angle = -Math.PI / 2 + index * Math.PI / 2;
        drawMotif(center + Math.cos(angle) * radius * .59, center + Math.sin(angle) * radius * .59,
          size * .26, size * .31, angle + Math.PI / 2, .94);
      }
    } else if (artwork.motifLayout === "butterfly") {
      for (let index = 0; index < 6; index += 1) {
        const angle = -Math.PI / 2 + index * Math.PI / 3;
        drawMotif(center + Math.cos(angle) * radius * .55, center + Math.sin(angle) * radius * .55,
          size * .23, size * .2, angle + Math.PI / 2, .94);
      }
    } else if (artwork.motifLayout === "border") {
      for (let index = 0; index < 7; index += 1) {
        const angle = -Math.PI / 2 + index * Math.PI * 2 / 7;
        drawMotif(center + Math.cos(angle) * radius * .76, center + Math.sin(angle) * radius * .76,
          size * .26, size * .23, angle + Math.PI / 2, .9);
      }
    } else if (artwork.motifLayout === "bird") {
      for (const [x, y, angle] of [[.32, .34, -.5], [.67, .42, .45], [.42, .68, .3]]) {
        drawMotif(size * x, size * y, size * .34, size * .3, angle, .95);
      }
    } else {
      drawMotif(center, center + 26, size * .78, size * .68, -.12, .98);
      drawMotif(center + radius * .48, center - radius * .28, size * .25, size * .23, .42, .62);
    }

    context.restore();
    context.strokeStyle = "rgba(91,72,49,.28)";
    context.lineWidth = 1.7;
    context.beginPath();
    context.arc(center, center, radius - .5, 0, Math.PI * 2);
    context.stroke();
    return canvas;
  }

  async toCanvas(artwork) {
    if (artwork?.motifUrl) return this.createCuratedCanopyCanvas(artwork);
    if (!artwork?.imageDataUrl || typeof artwork.imageDataUrl !== "string") {
      throw new Error("作品没有可用的伞面图像，请重新保存这把伞。");
    }
    const image = new Image();
    image.decoding = "async";
    const loaded = new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error("伞面图像无法解码，作品数据可能已损坏。"));
      image.src = artwork.imageDataUrl;
    });
    try {
      if (image.decode) await image.decode();
      else await loaded;
    } catch {
      // `decode()` rejects for corrupt local data URLs; keep the public error
      // actionable rather than allowing the renderer to fail later silently.
      throw new Error("伞面图像无法解码，作品数据可能已损坏。");
    }
    if (!image.naturalWidth || !image.naturalHeight) {
      throw new Error("伞面图像尺寸为空，请重新保存这把伞。");
    }
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("浏览器无法创建伞面纹理画布，请检查图形加速设置。");
    try { context.drawImage(image, 0, 0); }
    catch { throw new Error("伞面纹理绘制失败，请重新保存这把伞。"); }
    return canvas;
  }
}
