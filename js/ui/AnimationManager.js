// AnimationManager 封装 requestAnimationFrame，页面控制器只需启停它。
export class AnimationManager {
  constructor(onFrame) {
    this.onFrame = onFrame;
    this.frameId = null;
    this.boundTick = this.tick.bind(this);
  }

  start() {
    if (this.frameId !== null) return;
    this.frameId = requestAnimationFrame(this.boundTick);
  }

  tick() {
    this.frameId = null;
    this.onFrame();
    this.frameId = requestAnimationFrame(this.boundTick);
  }

  stop() {
    if (this.frameId === null) return;
    cancelAnimationFrame(this.frameId);
    this.frameId = null;
  }
}
