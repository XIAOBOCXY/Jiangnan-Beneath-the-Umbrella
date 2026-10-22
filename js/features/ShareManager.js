// ShareManager 生成作品海报，并处理保存与系统分享的兼容回退。
export class ShareManager {
  constructor(canvasOrProvider, onMessage) {
    this.canvasSource = canvasOrProvider;
    this.onMessage = onMessage;
    this.overlay = document.getElementById("shareOverlay");
    this.preview = document.getElementById("posterPreview");
    this.designName = document.getElementById("designName");
    this.posterCanvas = null;
  }

  getCanvas() {
    return typeof this.canvasSource === "function" ? this.canvasSource() : this.canvasSource;
  }

  open() {
    this.posterCanvas = this.createPoster();
    this.preview.classList.remove("is-animating");
    this.preview.onload = () => this.playPreviewAnimation();
    this.preview.src = this.posterCanvas.toDataURL("image/png");
    this.overlay.hidden = false;
    this.overlay.classList.remove("is-open");
    requestAnimationFrame(() => {
      this.overlay.classList.add("is-open");
    });
    if (this.preview.complete) this.playPreviewAnimation();
  }

  playPreviewAnimation() {
    this.preview.classList.remove("is-animating");
    requestAnimationFrame(() => this.preview.classList.add("is-animating"));
  }

  close() {
    this.overlay.classList.remove("is-open");
    this.overlay.hidden = true;
  }

  createPoster() {
    const poster = document.createElement("canvas");
    poster.width = 1080;
    poster.height = 1350;
    const ctx = poster.getContext("2d");
    ctx.fillStyle = "#f4efe5";
    ctx.fillRect(0, 0, poster.width, poster.height);

    const wash = ctx.createRadialGradient(540, 575, 60, 540, 575, 500);
    wash.addColorStop(0, "#e2e9da");
    wash.addColorStop(1, "#f4efe5");
    ctx.fillStyle = wash;
    ctx.fillRect(55, 120, 970, 920);

    ctx.strokeStyle = "rgba(67, 94, 74, .24)";
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(540, 570, 420, 0, Math.PI * 2); ctx.stroke();
    ctx.save();
    ctx.beginPath(); ctx.arc(540, 570, 390, 0, Math.PI * 2); ctx.clip();
    ctx.drawImage(this.getCanvas(), 180, 210, 720, 720);
    ctx.restore();

    ctx.fillStyle = "#315c53";
    ctx.textAlign = "center";
    ctx.font = "500 38px 'STSong', 'Songti SC', serif";
    ctx.fillText("伞下江南", 540, 78);
    ctx.fillStyle = "#7c8376";
    ctx.font = "15px 'Courier New', monospace";
    ctx.letterSpacing = "4px";
    ctx.fillText("JIANGNAN BENEATH THE UMBRELLA", 540, 109);
    ctx.fillStyle = "#294b43";
    ctx.font = "500 31px 'STSong', 'Songti SC', serif";
    ctx.letterSpacing = "1px";
    ctx.fillText(this.getTitle(), 540, 1120);
    ctx.fillStyle = "#8b8a7f";
    ctx.font = "16px 'STSong', 'Songti SC', serif";
    ctx.fillText("以指为笔，以绸为纸，一笔绘出万千江南", 540, 1160);
    ctx.strokeStyle = "rgba(165,140,88,.55)";
    ctx.beginPath(); ctx.moveTo(440, 1192); ctx.lineTo(640, 1192); ctx.stroke();
    ctx.fillStyle = "#a58c58";
    ctx.font = "13px 'Courier New', monospace";
    ctx.letterSpacing = "2px";
    ctx.fillText("WEST LAKE SILK UMBRELLA · DIGITAL CO-CREATION", 540, 1240);
    return poster;
  }

  getTitle() {
    return this.designName.value.trim() || "我的江南伞";
  }

  async saveCanvas() {
    await this.download(this.getCanvas(), "jiangnan-umbrella.png");
    this.onMessage("伞面 PNG 已保存");
  }

  async savePoster() {
    if (!this.posterCanvas) this.posterCanvas = this.createPoster();
    await this.download(this.posterCanvas, "jiangnan-umbrella-poster.png");
    this.onMessage("作品海报已保存");
  }

  async sharePoster() {
    if (!this.posterCanvas) this.posterCanvas = this.createPoster();
    const blob = await this.toBlob(this.posterCanvas);
    if (!blob) {
      this.onMessage("海报生成失败，请再试一次");
      return;
    }
    const file = new File([blob], "jiangnan-umbrella-poster.png", { type: "image/png" });
    if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ title: "伞下江南 · " + this.getTitle(), files: [file] });
        return;
      } catch (error) {
        if (error && error.name === "AbortError") return;
      }
    }
    await this.savePoster();
  }

  download(canvas, filename) {
    return this.toBlob(canvas).then((blob) => {
      if (!blob) {
        this.onMessage("图片生成失败，请再试一次");
        return;
      }
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1500);
    });
  }

  toBlob(canvas) {
    return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  }
}
