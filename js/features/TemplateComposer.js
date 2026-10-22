// 模板使用与用户操作相同的纹样对象数据，示例中的每个环带均可重新编辑。
export class TemplateComposer {
  constructor(canvasManager, patternDrawer) {
    this.canvasManager = canvasManager;
    this.patternDrawer = patternDrawer;
  }

  async createDefault() {
    await this.patternDrawer.ready;
    return {
      strokes: [],
      patterns: [
        {
          id: "example-west-lake", patternId: "westLake", x: 360, y: 360,
          scale: .44, rotation: 0, repeatCount: 1, repeatRadius: 0, repeatMode: "single",
          repeatAngle: 0, repeatOrientation: "original", opacity: .88, zone: "伞心", baseSize: 136
        },
        {
          id: "example-lotus-heart", patternId: "lotus", x: 360, y: 360,
          scale: .54, rotation: 0, repeatCount: 1, repeatRadius: 0, repeatMode: "single",
          repeatAngle: 0, repeatOrientation: "original", opacity: .94, zone: "伞心", baseSize: 68
        },
        {
          id: "example-water-ring", patternId: "water", x: 0, y: 0,
          scale: .66, rotation: 0, repeatCount: 8, repeatRadius: 98, repeatMode: "radial",
          repeatAngle: 0, repeatOrientation: "tangent", opacity: .78, zone: "中部", baseSize: 40
        },
        {
          id: "example-cloud-rim", patternId: "cloud", x: 0, y: 0,
          scale: .86, rotation: 0, repeatCount: 12, repeatRadius: 178, repeatMode: "radial",
          repeatAngle: Math.PI / 12, repeatOrientation: "tangent", opacity: .68, zone: "外圈", baseSize: 24
        }
      ]
    };
  }

  async applyDefault(renderer) {
    renderer.setDocument(await this.createDefault());
  }
}
