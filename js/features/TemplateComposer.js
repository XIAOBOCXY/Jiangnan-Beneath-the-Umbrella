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
      patterns: []
    };
  }

  async applyDefault(renderer) {
    renderer.setDocument(await this.createDefault());
  }
}
