// 模板使用与用户操作相同的纹样对象数据，示例中的每个环带均可重新编辑。
export class TemplateComposer {
  constructor(canvasManager, patternDrawer) {
    this.canvasManager = canvasManager;
    this.patternDrawer = patternDrawer;
  }

  async createDefault() {
    await this.patternDrawer.ready;
    const subject = this.patternDrawer.getAsset("westLake");
    const border = this.patternDrawer.getAsset("water");
    return {
      strokes: [],
      patterns: [
        {
          id: "example-west-lake", patternId: "westLake", x: 360, y: 360,
          scale: .7, rotation: 0, repeatCount: 1, repeatRadius: 0, repeatMode: "single",
          repeatAngle: 0, repeatOrientation: "original", opacity: .92, zone: "伞心", baseSize: subject.recommendedSize
        },
        {
          id: "example-water-ring", patternId: "water", x: 0, y: 0,
          scale: .4, rotation: 0, repeatCount: border.defaultRepeatCount, repeatRadius: 178, repeatMode: "radial",
          repeatAngle: Math.PI / 8, repeatOrientation: "tangent", opacity: .52, zone: "中部", baseSize: border.recommendedSize
        }
      ]
    };
  }

  async applyDefault(renderer) {
    renderer.setDocument(await this.createDefault());
  }
}
