const FRAME_URLS = {
  studio: new URL("../../vendor/integrations/shuimo-liuyun-studio.html?v=20261110-paper-only-v3", import.meta.url).href,
  heritage: new URL("../../vendor/integrations/ink-water-heritage.html?v=20261029-book-hover-ink", import.meta.url).href
};

/** Owns the two upstream GPU fluid backgrounds and pauses the inactive route. */
export class InkWashBackground {
  constructor(hosts) {
    const hostMap = hosts instanceof HTMLElement ? { studio: hosts, heritage: hosts } : hosts;
    if (!hostMap?.studio || !hostMap?.heritage) return;
    this.hosts = hostMap;
    this.mode = "off";
    // iOS WebKit can composite a transparent WebGL iframe as a white veil.
    // Keep the book readable and use its static paper/ink background there.
    this.staticHeritage = /iPad|iPhone|iPod/i.test(navigator.userAgent)
      || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    document.documentElement.classList.toggle("heritage-static-background", this.staticHeritage);
    this.frames = new Map();
    this.pointer = null;
    this.transitionPaused = false;
    this.reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    this.onPointerMove = (event) => this.relayPointer("move", event);
    this.onPointerDown = (event) => this.relayPointer("down", event);
    this.onPointerUp = (event) => this.relayPointer(event.type === "pointercancel" ? "cancel" : "up", event);
    this.onPointerLeave = (event) => {
      if (event.relatedTarget instanceof Node) return;
      this.clearPointer();
    };
    this.onVisibilityChange = () => this.syncFrames();
    this.onTransitionPhase = (event) => { this.transitionPaused = Boolean(event.detail?.active); this.syncFrames(); };
    window.addEventListener("pointermove", this.onPointerMove, { passive: true });
    window.addEventListener("pointerdown", this.onPointerDown, { passive: true });
    window.addEventListener("pointerup", this.onPointerUp, { passive: true });
    window.addEventListener("pointercancel", this.onPointerUp, { passive: true });
    window.addEventListener("pointerout", this.onPointerLeave, { passive: true });
    document.addEventListener("visibilitychange", this.onVisibilityChange);
    window.addEventListener("site:ink-transition", this.onTransitionPhase);
    Object.entries(FRAME_URLS).forEach(([route, src]) => this.createFrame(route, src, hostMap[route]));
    this.setSceneMode("off");
  }

  createFrame(route, src, host) {
    const frame = document.createElement("iframe");
    frame.className = `ink-wash-frame ink-wash-frame--${route}`;
    frame.title = route === "studio" ? "水墨流韵动态背景" : "静默水墨流体背景";
    frame.setAttribute("aria-hidden", "true");
    frame.setAttribute("tabindex", "-1");
    frame.setAttribute("sandbox", "allow-scripts allow-same-origin");
    frame.loading = "eager";
    frame.src = src;
    frame.addEventListener("load", () => {
      this.send(route, { type: "background-enabled", enabled: this.mode === route && !document.hidden && !this.transitionPaused });
    });
    this.frames.set(route, frame);
    host.append(frame);
  }

  send(route, message) {
    this.frames.get(route)?.contentWindow?.postMessage(message, location.origin);
  }

  syncFrames() {
    for (const [route, frame] of this.frames) {
      const visible = route === this.mode && !document.hidden;
      frame.classList.toggle("is-active", visible);
      this.send(route, { type: "background-enabled", enabled: visible && !this.transitionPaused });
    }
  }

  setSceneMode(mode) {
    this.mode = mode === "studio" || mode === "heritage" ? mode : "off";
    if (this.mode === "heritage" && this.staticHeritage) this.mode = "off";
    this.clearPointer();
    this.syncFrames();
  }

  clearPointer() {
    this.pointer = null;
    this.send("studio", { type: "studio-leave" });
    this.send("heritage", { type: "heritage-pointer-leave" });
  }

  relayPointer(phase, event) {
    // The studio background is autonomous: pointer input belongs to the tools
    // and canvas only, never to the decorative ink simulation.
    if (this.mode === "studio") return;
    if ((this.mode !== "studio" && this.mode !== "heritage") || document.hidden) return;
    const target = event.target instanceof Element ? event.target : null;
    const interactive = target?.closest("button,a,input,select,textarea,[contenteditable='true'],.app-header,.app-sidebar,.site-masthead,.page-nav,.studio-page-nav");
    const drawingSurface = this.mode === "studio" && target?.closest(".canvas-container,#umbrellaCanvas,.canvas-stage,.canvas-artwork-viewport");
    if (!target || interactive || drawingSurface) {
      if (this.pointer) this.clearPointer();
      return;
    }
    if (event.pointerType === "touch" && phase === "move" && !event.buttons) return;
    const x = Math.max(0, Math.min(1, event.clientX / Math.max(window.innerWidth, 1)));
    const y = Math.max(0, Math.min(1, 1 - event.clientY / Math.max(window.innerHeight, 1)));
    if (phase === "down") this.pointer = { x, y, down: true, pointerId: event.pointerId };
    const previous = this.pointer;
    const dx = previous && previous.pointerId === event.pointerId ? x - previous.x : 0;
    const dy = previous && previous.pointerId === event.pointerId ? y - previous.y : 0;
    const pointer = {
      x, y, dx, dy,
      down: phase === "down" || (phase === "move" && previous?.down && previous.pointerId === event.pointerId),
      phase,
      surface: this.mode === "heritage" && target.closest(".heritage-book") ? "book" : "background"
    };
    this.pointer = { ...pointer, pointerId: event.pointerId };
    if (this.mode === "studio") {
      this.send("studio", { ...pointer, type: phase === "down" ? "studio-pointer-start" : phase === "up" || phase === "cancel" ? "studio-pointer-end" : "studio-hover" });
    } else {
      this.send("heritage", { ...pointer, type: phase === "down" ? "heritage-pointer-start" : phase === "up" ? "heritage-pointer-end" : phase === "cancel" ? "heritage-pointer-cancel" : "heritage-pointer-move" });
    }
    if (phase === "up" || phase === "cancel") this.pointer = null;
  }

  destroy() {
    window.removeEventListener("pointermove", this.onPointerMove);
    window.removeEventListener("pointerdown", this.onPointerDown);
    window.removeEventListener("pointerup", this.onPointerUp);
    window.removeEventListener("pointercancel", this.onPointerUp);
    window.removeEventListener("pointerout", this.onPointerLeave);
    document.removeEventListener("visibilitychange", this.onVisibilityChange);
    window.removeEventListener("site:ink-transition", this.onTransitionPhase);
    this.mode = "off";
    this.syncFrames();
    for (const frame of this.frames.values()) frame.remove();
    this.frames.clear();
  }
}
