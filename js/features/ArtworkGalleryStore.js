const STORAGE_KEY = "jiangnan-umbrella-gallery-v1";
const MAX_ARTWORKS = 12;
const ASSIGNMENTS_KEY = "jiangnan-umbrella-gallery-assignments-v1";

/** Stores private visitor artworks in this browser; no upload or account is used. */
export class ArtworkGalleryStore {
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
    return true;
  }

  saveCanvas(sourceCanvas) {
    const size = 640;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext("2d");
    context.clearRect(0, 0, size, size);
    context.drawImage(sourceCanvas, 0, 0, size, size);
    const artwork = {
      id: `work-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: new Date().toISOString(),
      category: "mine",
      imageDataUrl: canvas.toDataURL("image/webp", 0.88)
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
      imageDataUrl: canvas.toDataURL("image/webp", 0.9)
    };
  }

  createCuratedExhibitionWorks(_patternDrawer) {
    const size = 768;
    const center = size / 2;
    const drawings = [
      {
        id: "exhibit-lotus",
        paint(context) {
          const distant = context.createLinearGradient(0, 210, 0, 490);
          distant.addColorStop(0, "rgba(164,187,166,.16)"); distant.addColorStop(1, "rgba(110,147,127,.28)");
          context.fillStyle = distant;
          context.beginPath(); context.moveTo(92, 409); context.bezierCurveTo(162, 347, 207, 387, 262, 323);
          context.bezierCurveTo(322, 273, 365, 369, 423, 309); context.bezierCurveTo(476, 260, 529, 352, 602, 304);
          context.bezierCurveTo(647, 286, 668, 340, 683, 333); context.lineTo(683, 485); context.lineTo(92, 485); context.closePath(); context.fill();
          context.strokeStyle = "rgba(53,92,79,.52)"; context.lineWidth = 3.2; context.lineCap = "round";
          context.beginPath(); context.moveTo(101, 411); context.bezierCurveTo(162, 361, 211, 391, 267, 331);
          context.bezierCurveTo(329, 278, 370, 373, 425, 317); context.bezierCurveTo(481, 266, 535, 357, 603, 311); context.stroke();
          context.strokeStyle = "rgba(73,112,101,.38)"; context.lineWidth = 1.5;
          for (let index = 0; index < 8; index += 1) {
            const y = 465 + index * 20;
            context.beginPath(); context.moveTo(131 + (index % 2) * 21, y);
            context.bezierCurveTo(267, y - 9, 450, y + 7, 636 - (index % 3) * 18, y - 2); context.stroke();
          }
          context.strokeStyle = "rgba(61,82,70,.55)"; context.lineWidth = 2.6;
          context.beginPath(); context.moveTo(353, 449); context.quadraticCurveTo(384, 418, 416, 449); context.stroke();
          context.beginPath(); context.moveTo(360, 447); context.lineTo(360, 431); context.lineTo(368, 437); context.lineTo(368, 447);
          context.moveTo(402, 447); context.lineTo(402, 431); context.lineTo(410, 437); context.lineTo(410, 447); context.stroke();
        }
      },
      {
        id: "exhibit-bamboo",
        paint(context) {
          context.strokeStyle = "rgba(69,91,69,.68)"; context.lineWidth = 5.2; context.lineCap = "round";
          context.beginPath(); context.moveTo(192, 604); context.bezierCurveTo(274, 511, 301, 420, 421, 324); context.bezierCurveTo(467, 286, 520, 250, 587, 228); context.stroke();
          const leaf = (x, y, angle, scale) => {
            context.save(); context.translate(x, y); context.rotate(angle); context.scale(scale, scale);
            context.fillStyle = "rgba(74,112,79,.58)"; context.strokeStyle = "rgba(48,84,62,.52)"; context.lineWidth = 1.55;
            context.beginPath(); context.moveTo(0, 0); context.bezierCurveTo(13, -28, 46, -31, 56, -13); context.bezierCurveTo(41, 10, 14, 14, 0, 0); context.fill(); context.stroke();
            context.strokeStyle = "rgba(237,230,205,.52)"; context.lineWidth = 1.1; context.beginPath(); context.moveTo(3, 0); context.quadraticCurveTo(29, -10, 50, -15); context.stroke(); context.restore();
          };
          leaf(268, 518, -2.63, 1.04); leaf(306, 469, .42, .86); leaf(377, 375, -2.55, .9); leaf(422, 336, .26, .82); leaf(508, 267, -2.35, .72);
          const flower = (x, y, scale, fill) => {
            context.save(); context.translate(x, y); context.scale(scale, scale);
            const colors = [fill, "rgba(250,234,211,.88)", "rgba(222,177,153,.78)", "rgba(255,244,220,.9)", fill, "rgba(239,205,182,.84)"];
            [[-1.48,31,9.5],[-.62,28,10.5],[.18,25,10],[.98,29,9],[1.86,25,9.5],[2.66,28,9]].forEach(([angle,length,width], index) => {
              context.save(); context.rotate(angle);
              const wash = context.createLinearGradient(0, -length, 0, 2);
              wash.addColorStop(0, "rgba(255,248,230,.92)"); wash.addColorStop(.3, colors[index]); wash.addColorStop(1, "rgba(196,139,119,.62)");
              context.fillStyle = wash; context.strokeStyle = "rgba(143,101,79,.38)"; context.lineWidth = 1.05;
              context.beginPath(); context.moveTo(0, 1);
              context.bezierCurveTo(width * .82, -length * .2, width, -length * .72, 1.2, -length);
              context.bezierCurveTo(-width * .9, -length * .72, -width * .78, -length * .22, 0, 1);
              context.fill(); context.stroke();
              context.strokeStyle = "rgba(255,248,230,.56)"; context.lineWidth = .9;
              context.beginPath(); context.moveTo(0, 0); context.quadraticCurveTo(width * .12, -length * .42, .6, -length * .84); context.stroke();
              context.restore();
            });
            context.strokeStyle = "rgba(181,139,76,.76)"; context.lineWidth = 1.15; context.lineCap = "round";
            for (let index = 0; index < 7; index += 1) {
              const angle = -Math.PI / 2 + index * (Math.PI * 2 / 7); const endX = Math.cos(angle) * (8 + index % 3); const endY = Math.sin(angle) * (8 + index % 3);
              context.beginPath(); context.moveTo(0, 1); context.quadraticCurveTo(endX * .42, endY * .45, endX, endY); context.stroke();
              context.beginPath(); context.moveTo(endX - 1.3, endY - 1.2); context.lineTo(endX + 1.2, endY + .7); context.stroke();
            }
            context.restore();
          };
          flower(536, 254, 1.08, "rgba(224,184,158,.82)"); flower(410, 342, .83, "rgba(240,224,197,.86)"); flower(306, 460, .64, "rgba(216,170,146,.8)");
          context.strokeStyle = "rgba(52,74,67,.58)"; context.lineWidth = 2.4;
          context.beginPath(); context.moveTo(566, 299); context.quadraticCurveTo(591, 282, 609, 297); context.quadraticCurveTo(591, 310, 566, 299);
          context.moveTo(568, 300); context.quadraticCurveTo(590, 304, 603, 315); context.moveTo(592, 288); context.lineTo(604, 277); context.stroke();
        }
      },
      {
        id: "exhibit-koi",
        paint(context) {
          context.strokeStyle = "rgba(127,96,59,.62)"; context.lineWidth = 2.6; context.lineCap = "round";
          context.beginPath(); context.moveTo(176, 599); context.bezierCurveTo(248, 542, 205, 431, 296, 366);
          context.bezierCurveTo(365, 316, 435, 393, 489, 325); context.bezierCurveTo(526, 279, 566, 249, 616, 237); context.stroke();
          context.strokeStyle = "rgba(178,145,96,.55)"; context.lineWidth = 1.8;
          for (let index = 0; index < 40; index += 1) {
            const t = index / 40; const x = 180 + t * 420; const y = 591 - t * 331 + Math.sin(t * 9) * 39;
            context.save(); context.translate(x, y); context.rotate(-.72 + Math.sin(t * 11) * .48);
            context.beginPath(); context.moveTo(-4.2, 0); context.lineTo(4.2, -1.2); context.stroke(); context.restore();
          }
          const embroideredLeaf = (x, y, angle, scale) => {
            context.save(); context.translate(x, y); context.rotate(angle); context.scale(scale, scale);
            context.fillStyle = "rgba(93,120,88,.48)"; context.strokeStyle = "rgba(91,91,61,.52)"; context.lineWidth = 1.3;
            context.beginPath(); context.moveTo(0, 0); context.bezierCurveTo(12, -24, 40, -26, 48, -12); context.bezierCurveTo(36, 10, 12, 12, 0, 0); context.fill(); context.stroke();
            context.setLineDash([3, 3]); context.beginPath(); context.moveTo(3, -1); context.lineTo(43, -12); context.stroke(); context.setLineDash([]); context.restore();
          };
          embroideredLeaf(242, 526, -1.08, 1.04); embroideredLeaf(321, 414, .28, .9); embroideredLeaf(463, 356, -1.12, .84); embroideredLeaf(539, 280, .18, .7);
          context.strokeStyle = "rgba(154,111,70,.62)"; context.lineWidth = 1.7;
          [[291,390],[374,332],[490,306],[551,258]].forEach(([x,y], index) => {
            context.beginPath(); context.moveTo(x - 8, y); context.quadraticCurveTo(x, y - (index % 2 ? 11 : 8), x + 8, y + 1); context.stroke();
          });
        }
      }
    ];

    const fabric = document.createElement("canvas"); fabric.width = size; fabric.height = size;
    const fabricContext = fabric.getContext("2d");
    const base = fabricContext.createLinearGradient(74, 116, 690, 654);
    base.addColorStop(0, "#f4efdf"); base.addColorStop(.46, "#eee8d8"); base.addColorStop(1, "#e6e1d1");
    fabricContext.fillStyle = base; fabricContext.fillRect(0, 0, size, size);
    // Barely visible warp/weft gives the illustrations a shared silk ground.
    fabricContext.strokeStyle = "rgba(116,105,79,.035)"; fabricContext.lineWidth = 1;
    for (let offset = 0; offset < size; offset += 8) {
      fabricContext.beginPath(); fabricContext.moveTo(offset, 0); fabricContext.lineTo(offset, size); fabricContext.stroke();
      fabricContext.beginPath(); fabricContext.moveTo(0, offset); fabricContext.lineTo(size, offset); fabricContext.stroke();
    }

    return drawings.map((drawing) => {
      const canvas = document.createElement("canvas"); canvas.width = size; canvas.height = size;
      const context = canvas.getContext("2d"); context.drawImage(fabric, 0, 0);
      context.save(); context.beginPath(); context.arc(center, center, size * .478, 0, Math.PI * 2); context.clip();
      drawing.paint(context);
      context.restore();
      return {
        id: drawing.id,
        createdAt: "1932-01-01T00:00:00.000Z",
        category: "traditional",
        imageDataUrl: canvas.toDataURL("image/webp", .94)
      };
    });
  }

  async toCanvas(artwork) {
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
