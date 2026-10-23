// 交互构图分区用于辅助创作，不代表西湖绸伞传统工艺尺寸规范。
const ZONES = [
  // 分区只限制单个纹样的最大绘制尺寸，不要求纹样完全留在分区环带内。
  { name: "伞心", min: 0, max: .18, maxMotif: 420 },
  { name: "中部", min: .22, max: .58, maxMotif: 210 },
  { name: "外圈", min: .68, max: .82, maxMotif: 92 },
  { name: "伞缘", min: .82, max: 1, maxMotif: 48 }
];

export class CompositionZones {
  constructor(center, radius) {
    this.center = center;
    this.radius = radius;
  }

  getZone(point) {
    const ratio = Math.hypot(point.x - this.center.x, point.y - this.center.y) / this.radius;
    const containingZone = ZONES.find((zone) => ratio >= zone.min && ratio <= zone.max);
    if (containingZone) return containingZone;
    // 留白带仍可放置纹样，吸附时归入最近的装饰区。
    return ZONES.reduce((closest, zone) => {
      const distance = ratio < zone.min ? zone.min - ratio : ratio > zone.max ? ratio - zone.max : 0;
      const closestDistance = ratio < closest.min ? closest.min - ratio : ratio > closest.max ? ratio - closest.max : 0;
      return distance < closestDistance ? zone : closest;
    }, ZONES[0]);
  }

  snap(point, zone = this.getZone(point)) {
    if (zone.name === "伞心") return { ...this.center };
    const dx = point.x - this.center.x;
    const dy = point.y - this.center.y;
    const distance = Math.hypot(dx, dy);
    const middle = (zone.min + zone.max) / 2 * this.radius;
    if (distance < 1) return { x: this.center.x, y: this.center.y };
    return {
      x: this.center.x + dx / distance * middle,
      y: this.center.y + dy / distance * middle
    };
  }

  limitScale(scale, zone, baseSize) {
    return Math.min(scale, zone.maxMotif / Math.max(1, baseSize));
  }

  getByName(name) { return ZONES.find((zone) => zone.name === name) || ZONES[1]; }

  clampOrbit(radius, zoneName) {
    const zone = this.getByName(zoneName);
    const inset = Math.min(9, (zone.max - zone.min) * this.radius * .2);
    return Math.max(zone.min * this.radius + inset, Math.min(zone.max * this.radius - inset, radius));
  }

  drawGuides(ctx) {
    ctx.save();
    ctx.setLineDash([3, 7]);
    ctx.lineWidth = .8;
    const boundaries = [.18, .22, .58, .68, .82];
    boundaries.forEach((boundary, index) => {
      ctx.beginPath();
      ctx.arc(this.center.x, this.center.y, boundary * this.radius, 0, Math.PI * 2);
      ctx.strokeStyle = index === 2 ? "rgba(191,163,122,.42)" : "rgba(83,124,126,.24)";
      ctx.stroke();
    });
    ctx.setLineDash([]);
    ctx.restore();
  }
}
