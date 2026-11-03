import { ArtworkGalleryStore } from "../features/ArtworkGalleryStore.js?v=20261101-silk-craft-v3";
import { GalleryScene } from "./GalleryScene.js?v=20261030-hanging-gallery-v1";
import { NavigationInk } from "./NavigationInk.js?v=20261030-hanging-gallery-v1";

const ROUTES = new Set(["home", "heritage", "studio", "gallery"]);

/** Coordinates page navigation and reuses the editor's Three.js renderer. */
export class SiteExperience {
  constructor(app, inkWashBackground, homeLakeScene = null, inkTransition = null) {
    this.app = app;
    this.inkWashBackground = inkWashBackground;
    this.homeLakeScene = homeLakeScene;
    this.store = app.galleryStore || new ArtworkGalleryStore();
    this.page = "";
    this.transitioning = false;
    this.scrollX = 0;
    this.galleryWorks = [];
    this.curatedWorks = [];
    this.imageCache = new Map();
    this.galleryPreviewCache = new Map();
    this.galleryPreparationToken = 0;
    this.galleryFocusRequestToken = 0;
    this.hangingGalleryMode = false;
    this.hangingGalleryDefaultsChosen = false;
    this.hangingDayNightInterval = 0;
    this.hangingRopeAnimationFrame = 0;
    this.hangingRopePhase = 0;
    this.hangingRopeWind = 0;
    this.hangingRopeWindTarget = 0;
    this.hangingRopeLastTime = 0;
    this.hangingSelectedIds = new Set();
    this.hangingDismissedIds = new Set();
    this.hangingPreparedWorks = [];
    this.featuredWork = null;
    this.homeWorkId = null;
    this.homeIntroPlayed = false;
    this.transition = inkTransition;
    this.bindHomeInteractions();
    this.bindHeritageBook();
    this.bindNavigation();
    this.bindGallery();
    ["homeUmbrellaHost", "galleryFocusHost"].forEach((id) => {
      const host = document.getElementById(id);
      const isCurrentShowcase = () => id === "homeUmbrellaHost"
        ? this.page === "home"
        : this.page === "gallery" && !document.getElementById("galleryFocus").hidden;
      host.addEventListener("pointerenter", () => {
        if (isCurrentShowcase() && this.app.threePreview?.controls) {
          this.app.threePreview.controls.autoRotateSpeed = id === "homeUmbrellaHost" ? 0.16 : 0.65;
        }
      });
      host.addEventListener("pointerleave", () => {
        if (isCurrentShowcase() && this.app.threePreview?.controls) {
          this.app.threePreview.controls.autoRotateSpeed = id === "homeUmbrellaHost" ? 0.42 : 2;
        }
      });
    });
    window.addEventListener("gallery:updated", () => this.refreshGallery());
    this.app.ready.then(() => {
      this.featuredWork ||= this.store.createFeatured(this.app.canvasManager.getUmbrellaTextureCanvas());
      this.curatedWorks = this.store.createCuratedExhibitionWorks(this.app.patternDrawer);
      if (this.page === "gallery") this.refreshGallery();
    }).catch((error) => console.warn("作品工坊初始化失败：", error));
    window.addEventListener("popstate", () => this.showPage(this.routeFromHash(), false));
    window.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !document.getElementById("galleryFocus").hidden) this.closeGalleryFocus();
    });
    this.showPage(this.routeFromHash(), false);
  }

  bindHomeInteractions() {
    this.homePage = document.getElementById("homePage");
    const host = document.getElementById("homeUmbrellaHost");

    const reset = () => {
      this.homePage.style.setProperty("--home-stage-x", "0px");
      this.homePage.style.setProperty("--home-stage-y", "0px");
      this.homeLakeScene?.setParallax(0, 0);
    };
    this.homePage.addEventListener("pointermove", (event) => {
      if (this.page !== "home" || event.pointerType === "touch") return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest("#homeUmbrellaHost, .site-masthead, .home-actions, button, a") || this.homePage.classList.contains("is-umbrella-dragging")) {
        reset();
        return;
      }
      const x = Math.max(-1, Math.min(1, (event.clientX / Math.max(window.innerWidth, 1) - 0.5) * 2));
      const y = Math.max(-1, Math.min(1, (event.clientY / Math.max(window.innerHeight, 1) - 0.5) * 2));
      this.homePage.style.setProperty("--home-stage-x", `${x * 5}px`);
      this.homePage.style.setProperty("--home-stage-y", `${y * 3}px`);
      this.homeLakeScene?.setParallax(x, y);
    }, { passive: true });
    this.homePage.addEventListener("pointerleave", reset, { passive: true });
    host.addEventListener("pointerdown", () => {
      this.homePage.classList.add("is-umbrella-dragging");
      reset();
    });
    window.addEventListener("pointerup", () => this.homePage.classList.remove("is-umbrella-dragging"));
    window.addEventListener("pointercancel", () => this.homePage.classList.remove("is-umbrella-dragging"));
  }

  routeFromHash() {
    const route = location.hash.replace(/^#/, "");
    return ROUTES.has(route) ? route : "home";
  }

  bindNavigation() {
    const heritageNav = document.querySelector(".heritage-page-nav:not(.studio-floating-nav)");
    const studioNav = document.querySelector(".studio-floating-nav");
    const galleryNav = document.querySelector(".gallery-floating-nav");
    const hangingNav = document.querySelector(".hanging-gallery-nav");
    try {
      this.navigationInk = new NavigationInk(heritageNav);
    } catch (error) {
      console.warn("Three.js 导航水墨暂不可用：", error);
      this.navigationInk = null;
    }
    try {
      this.studioNavigationInk = new NavigationInk(studioNav);
    } catch (error) {
      console.warn("绘制工坊导航水墨暂不可用：", error);
      this.studioNavigationInk = null;
    }
    try {
      this.galleryNavigationInk = new NavigationInk(galleryNav);
    } catch (error) {
      console.warn("画廊导航水墨暂不可用：", error);
      this.galleryNavigationInk = null;
    }
    try {
      this.hangingNavigationInk = new NavigationInk(hangingNav);
    } catch (error) {
      console.warn("悬伞展廊导航水墨暂不可用：", error);
      this.hangingNavigationInk = null;
    }
    document.querySelectorAll("[data-route]").forEach((link) => link.addEventListener("click", (event) => {
      event.preventDefault();
      this.navigate(link.dataset.route, link.closest(".heritage-page-nav") ? link : null);
    }));
  }

  async navigate(route, sourceLink = null) {
    if (!ROUTES.has(route) || route === this.page || this.transitioning) return;
    this.transitioning = true;
    const changePage = () => {
      history.pushState(null, "", `#${route}`);
      this.showPage(route, false);
    };
    try {
      if (sourceLink) {
        const navigationInk = sourceLink.closest(".studio-floating-nav")
          ? this.studioNavigationInk
          : sourceLink.closest(".hanging-gallery-nav") ? this.hangingNavigationInk
            : sourceLink.closest(".gallery-floating-nav") ? this.galleryNavigationInk : this.navigationInk;
        await navigationInk?.burst(sourceLink);
      }
      if (!this.transition) {
        changePage();
        return;
      }
      await this.transition.play(changePage);
    } catch (error) {
      console.warn("水墨页面转场失败：", error);
      changePage();
    } finally {
      this.transitioning = false;
    }
  }

  showPage(route, _animate = false) {
    if (!ROUTES.has(route)) route = "home";
    const previous = this.page;
    this.page = route;
    document.documentElement.dataset.sitePage = route;
    this.homeLakeScene?.setActive(route === "home");
    this.homeLakeScene?.setSceneMode(route === "home" ? "home" : "off");
    this.galleryScene?.setActive(route === "gallery" && !this.hangingGalleryMode);
    if (route !== "gallery") this.closeGalleryWorksPanel?.();
    const pageByRoute = {
      home: "homePage",
      heritage: "heritagePage",
      studio: "studioPage",
      gallery: "galleryPage"
    };
    Object.entries(pageByRoute).forEach(([key, id]) => {
      document.getElementById(id).hidden = key !== route;
    });
    this.navigationInk?.setActive(route);
    this.navigationInk?.setVisible(route === "heritage");
    this.studioNavigationInk?.setActive(route);
    this.studioNavigationInk?.setVisible(route === "studio");
    this.galleryNavigationInk?.setActive(route);
    this.galleryNavigationInk?.setVisible(route === "gallery");
    this.hangingNavigationInk?.setVisible(route === "gallery" && this.hangingGalleryMode);
    if (route !== "gallery") this.closeHangingGallery();
    if (route !== "studio") this.app.suspendShowcase();
    if (route === "home") {
      this.inkWashBackground?.setSceneMode("home");
      if (!this.homeIntroPlayed) {
        this.homePage.classList.add("is-entering");
        this.homeIntroPlayed = true;
        window.setTimeout(() => {
          this.homePage.classList.remove("is-entering");
        }, 1700);
      }
      this.presentHomeUmbrella();
    } else if (route === "studio") {
      this.inkWashBackground?.setSceneMode("studio");
      requestAnimationFrame(() => this.app.resumeStudioPresentation());
    } else {
      this.inkWashBackground?.setSceneMode(route);
      if (route === "gallery") this.refreshGallery();
    }
    if (previous === "gallery" && route !== "gallery") this.closeGalleryFocus(false, true);
  }

  bindHeritageBook() {
    this.heritageBook = document.getElementById("heritageBook");
    this.heritageSpreads = [...this.heritageBook.querySelectorAll(".heritage-spread")];
    this.heritageSpreads.forEach((spread) => {
      if (spread.classList.contains("is-image-left") && spread.children.length > 1) {
        spread.insertBefore(spread.children[1], spread.children[0]);
      }
    });
    this.heritageBook.querySelectorAll("img").forEach((image) => {
      image.loading = "eager";
      image.decode?.().catch(() => {});
    });
    this.heritageIndex = 0;
    this.heritageFlipBusy = false;
    this.heritageBookLayout = this.heritageBook.closest(".heritage-book-layout");
    this.heritageFlipSheet = document.getElementById("heritageFlipSheet");
    this.heritageFlipFront = document.getElementById("heritageFlipFront");
    this.heritageFlipBack = document.getElementById("heritageFlipBack");
    const previous = document.getElementById("heritagePrevious");
    const next = document.getElementById("heritageNext");
    const rightTabs = [...document.querySelectorAll(".heritage-tabs-right [data-heritage-spread]")];
    const leftTabs = [...document.querySelectorAll(".heritage-tabs-left [data-heritage-spread]")];
    const allTabs = [...rightTabs, ...leftTabs];
    const inkTargets = [...document.querySelectorAll(".heritage-tabs button")];
    inkTargets.forEach((target) => {
      let inkTimer = 0;
      const bloom = (event = null) => {
        if (event && Number.isFinite(event.clientX) && Number.isFinite(event.clientY)) {
          const bounds = target.getBoundingClientRect();
          const x = Math.min(100, Math.max(0, ((event.clientX - bounds.left) / Math.max(bounds.width, 1)) * 100));
          const y = Math.min(100, Math.max(0, ((event.clientY - bounds.top) / Math.max(bounds.height, 1)) * 100));
          target.style.setProperty("--ink-origin-x", `${x}%`);
          target.style.setProperty("--ink-origin-y", `${y}%`);
        }
        target.classList.remove("is-inking");
        // Restart the CSS ink bloom on repeated taps without using a bitmap.
        void target.offsetWidth;
        target.classList.add("is-inking");
        window.clearTimeout(inkTimer);
        inkTimer = window.setTimeout(() => target.classList.remove("is-inking"), 720);
      };
      target.addEventListener("pointerdown", bloom, { passive: true });
      target.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") bloom();
      });
    });
    const renderTabs = (index, clearFlight = false) => {
      const activeTab = rightTabs.find((tab) => Number(tab.dataset.heritageSpread) === index);
      rightTabs.forEach((tab) => {
        if (clearFlight) tab.classList.remove("is-in-flight", "is-turn-target");
        const passed = Number(tab.dataset.heritageSpread) < index;
        const active = tab === activeTab;
        tab.classList.toggle("is-passed", passed);
        tab.classList.toggle("is-active", active);
        tab.disabled = passed;
        if (passed) tab.setAttribute("aria-hidden", "true");
        else tab.removeAttribute("aria-hidden");
        if (active) tab.setAttribute("aria-current", "page");
        else tab.removeAttribute("aria-current");
      });
      leftTabs.forEach((tab) => {
        if (clearFlight) tab.classList.remove("is-in-flight", "is-turn-target");
        const passed = Number(tab.dataset.heritageSpread) < index;
        tab.classList.toggle("is-off-left", !passed);
        tab.classList.remove("is-active");
        tab.disabled = !passed;
        if (passed) tab.removeAttribute("aria-hidden");
        else tab.setAttribute("aria-hidden", "true");
        tab.removeAttribute("aria-current");
      });
    };
    const renderSpread = () => {
      this.heritageSpreads.forEach((spread, index) => {
        spread.classList.remove("is-flipping-current-next", "is-flipping-current-previous", "is-flipping-target");
        spread.hidden = index !== this.heritageIndex;
        spread.classList.toggle("is-active", index === this.heritageIndex);
      });
      previous.disabled = this.heritageIndex === 0;
      next.disabled = this.heritageIndex === this.heritageSpreads.length - 1;
      renderTabs(this.heritageIndex, true);
      this.heritageBookLayout.classList.remove("is-turning");
      this.heritageBook.removeAttribute("aria-busy");
    };
    this.turnHeritagePage = async (direction, destinationIndex = null) => {
      const targetIndex = destinationIndex ?? this.heritageIndex + direction;
      if (this.heritageFlipBusy || targetIndex < 0 || targetIndex >= this.heritageSpreads.length) return;
      const fromIndex = this.heritageIndex;
      const current = this.heritageSpreads[this.heritageIndex];
      const target = this.heritageSpreads[targetIndex];
      const isNext = direction > 0;
      const turningPage = current.children[isNext ? 1 : 0].cloneNode(true);
      const reversePage = target.children[isNext ? 0 : 1].cloneNode(true);
      const movingIndex = isNext ? fromIndex : targetIndex;
      const movingTab = (isNext ? rightTabs : leftTabs).find((tab) => Number(tab.dataset.heritageSpread) === movingIndex);
      const landingTab = (isNext ? leftTabs : rightTabs).find((tab) => Number(tab.dataset.heritageSpread) === movingIndex);
      turningPage.querySelectorAll(".heritage-page-tab").forEach((tab) => tab.remove());
      reversePage.querySelectorAll(".heritage-page-tab").forEach((tab) => tab.remove());
      this.heritageFlipBusy = true;
      this.heritageBook.setAttribute("aria-busy", "true");
      this.heritageBookLayout.classList.add("is-turning");
      previous.disabled = true;
      next.disabled = true;
      this.heritageFlipFront.replaceChildren(turningPage);
      this.heritageFlipBack.replaceChildren(reversePage);
      const clonedImages = [...this.heritageFlipSheet.querySelectorAll("img")];
      clonedImages.forEach((image) => { image.loading = "eager"; image.decoding = "async"; });
      await Promise.allSettled([
        document.fonts?.ready || Promise.resolve(),
        ...clonedImages.map((image) => image.decode?.() || Promise.resolve())
      ]);
      if (this.page !== "heritage") {
        this.heritageFlipFront.replaceChildren();
        this.heritageFlipBack.replaceChildren();
        this.heritageFlipSheet.style.left = "";
        this.heritageFlipSheet.style.right = "";
        this.heritageFlipSheet.style.transform = "";
        this.heritageFlipSheet.style.transformOrigin = "";
        delete this.heritageFlipSheet.dataset.direction;
        this.heritageFlipBusy = false;
        this.heritageBook.removeAttribute("aria-busy");
        this.heritageBookLayout.classList.remove("is-turning");
        renderSpread();
        return;
      }
      target.hidden = false;
      current.classList.add(isNext ? "is-flipping-current-next" : "is-flipping-current-previous");
      target.classList.add("is-flipping-target");
      movingTab?.classList.add("is-in-flight");
      this.heritageBook.classList.add("is-turning");
      const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      let finished = false;
      let destinationRevealed = false;
      let fallbackTimer = 0;
      let revealTimer = 0;
      const revealTargetSpread = () => {
        if (destinationRevealed || finished || this.page !== "heritage") return;
        destinationRevealed = true;
        this.heritageIndex = targetIndex;
        current.hidden = true;
        current.classList.remove("is-flipping-current-next", "is-flipping-current-previous");
        target.hidden = false;
        target.classList.remove("is-flipping-target");
        this.heritageSpreads.forEach((spread, index) => spread.classList.toggle("is-active", index === targetIndex));
        previous.disabled = targetIndex === 0;
        next.disabled = targetIndex === this.heritageSpreads.length - 1;
        renderTabs(targetIndex);
        if (movingTab && landingTab) landingTab.classList.add("is-in-flight");
      };
      const finish = () => {
        if (finished) return;
        finished = true;
        window.clearTimeout(fallbackTimer);
        window.clearTimeout(revealTimer);
        this.heritageFlipAnimation?.cancel();
        this.heritageFlipAnimation = null;
        this.heritageIndex = targetIndex;
        renderSpread();
        this.heritageBook.classList.remove("is-turning");
        this.heritageFlipSheet.style.left = "";
        this.heritageFlipSheet.style.right = "";
        this.heritageFlipSheet.style.transform = "";
        this.heritageFlipSheet.style.transformOrigin = "";
        delete this.heritageFlipSheet.dataset.direction;
        this.heritageFlipFront.replaceChildren();
        this.heritageFlipBack.replaceChildren();
        this.heritageFlipBusy = false;
        this.heritageBook.removeAttribute("aria-busy");
      };
      if (reduced) {
        finish();
        return;
      }
      const sheet = this.heritageFlipSheet;
      sheet.dataset.direction = isNext ? "next" : "previous";
      sheet.style.left = isNext ? "50%" : "0";
      sheet.style.right = isNext ? "0" : "50%";
      sheet.style.transformOrigin = isNext ? "left center" : "right center";
      sheet.style.transform = "rotateY(0deg)";
      const to = isNext ? -180 : 180;
      this.heritageFlipAnimation = sheet.animate([
        { transform: "rotateY(0deg)", boxShadow: "0 0 0 rgba(56,48,36,0)" },
        { offset: 0.48, transform: `rotateY(${to * 0.52}deg)`, boxShadow: "0 0 1.15rem rgba(56,48,36,.18)" },
        { transform: `rotateY(${to}deg)`, boxShadow: "0 0 .22rem rgba(56,48,36,.06)" }
      ], { duration: 720, easing: "cubic-bezier(.42,.04,.18,1)", fill: "both" });
      this.heritageFlipAnimation.finished.then(finish).catch(() => {});
      revealTimer = window.setTimeout(revealTargetSpread, 390);
      fallbackTimer = window.setTimeout(finish, 900);
    };
    previous.addEventListener("click", () => this.turnHeritagePage(-1));
    next.addEventListener("click", () => this.turnHeritagePage(1));
    allTabs.forEach((tab) => tab.addEventListener("click", () => {
      if (this.heritageFlipBusy) return;
      const targetIndex = Number(tab.dataset.heritageSpread);
      if (!Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex >= this.heritageSpreads.length) return;
      if (targetIndex === this.heritageIndex) return;
      this.turnHeritagePage(Math.sign(targetIndex - this.heritageIndex), targetIndex);
    }));
    let pageGesture = null;
    let suppressPageClickUntil = 0;
    this.heritageBook.addEventListener("pointerdown", (event) => {
      if (event.target instanceof Element && event.target.closest("a, button, input, textarea, select")) return;
      if (event.pointerType === "mouse" && event.button !== 0) return;
      if (!event.isPrimary || this.heritageFlipBusy) return;
      pageGesture = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, lastX: event.clientX, lastY: event.clientY, moved: false };
      this.heritageBook.setPointerCapture?.(event.pointerId);
    });
    this.heritageBook.addEventListener("pointermove", (event) => {
      if (!pageGesture || event.pointerId !== pageGesture.pointerId) return;
      const dx = event.clientX - pageGesture.x;
      const dy = event.clientY - pageGesture.y;
      pageGesture.lastX = event.clientX;
      pageGesture.lastY = event.clientY;
      if (Math.abs(dx) > 9 && Math.abs(dx) > Math.abs(dy) * 1.15) pageGesture.moved = true;
      if (pageGesture.moved) event.preventDefault();
    });
    this.heritageBook.addEventListener("pointerup", (event) => {
      if (!pageGesture || event.pointerId !== pageGesture.pointerId) return;
      const dx = event.clientX - pageGesture.x;
      const dy = event.clientY - pageGesture.y;
      if (Math.abs(dx) >= 52 && Math.abs(dx) > Math.abs(dy) * 1.2) {
        this.turnHeritagePage(dx < 0 ? 1 : -1);
        suppressPageClickUntil = performance.now() + 320;
      }
      pageGesture = null;
    });
    this.heritageBook.addEventListener("pointercancel", () => { pageGesture = null; });
    this.heritageBook.addEventListener("click", (event) => {
      if (event.target.closest("a, button")) return;
      if (performance.now() < suppressPageClickUntil) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      const bounds = this.heritageBook.getBoundingClientRect();
      if (event.clientX > bounds.left + bounds.width * 0.76) this.turnHeritagePage(1);
      else if (event.clientX < bounds.left + bounds.width * 0.24) this.turnHeritagePage(-1);
    });
    window.addEventListener("keydown", (event) => {
      if (this.page !== "heritage" || event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      if (event.key === "ArrowRight" || event.key === "PageDown") this.turnHeritagePage(1);
      if (event.key === "ArrowLeft" || event.key === "PageUp") this.turnHeritagePage(-1);
    });
    renderSpread();
  }

  async getFeaturedWork() {
    await this.app.ready;
    this.featuredWork ||= this.store.createFeatured(this.app.canvasManager.getUmbrellaTextureCanvas());
    const saved = this.store.list();
    const choices = [this.featuredWork, ...saved];
    if (!this.homeWorkId || !choices.some((work) => work.id === this.homeWorkId)) {
      const choice = choices[Math.floor(Math.random() * choices.length)];
      this.homeWorkId = choice.id;
    }
    return choices.find((work) => work.id === this.homeWorkId) || choices[0];
  }

  async presentHomeUmbrella() {
    try {
      const work = await this.getFeaturedWork();
      const canvas = await this.getCanvas(work);
      if (this.page !== "home") return;
      const preview = await this.app.presentShowcase(document.getElementById("homeUmbrellaHost"), canvas, `home-${work.id}`);
      if (preview) {
        const hitTest = (clientX, clientY) => preview.hitTestClientPoint(clientX, clientY);
        preview.setBackgroundPointerHandler((event) => this.homeLakeScene?.handlePointerDown(event));
        this.homeLakeScene?.setUmbrellaHitTest(hitTest);
      }
    } catch (error) {
      console.warn("首页绸伞展示暂不可用：", error);
    }
  }

  async getCanvas(work) {
    if (!work?.id) throw new Error("作品缺少有效编号，无法读取伞面纹理。");
    if (!this.imageCache.has(work.id)) {
      const request = this.store.toCanvas(work).catch((error) => {
        this.imageCache.delete(work.id);
        throw error;
      });
      this.imageCache.set(work.id, request);
    }
    const canvas = await this.imageCache.get(work.id);
    if (!(canvas instanceof HTMLCanvasElement) || !canvas.width || !canvas.height) {
      this.imageCache.delete(work.id);
      throw new Error("伞面纹理为空或尺寸无效，请重新保存这把伞。");
    }
    return canvas;
  }

  bindGallery() {
    this.galleryScene = new GalleryScene(document.getElementById("gallerySceneHost"), (work, origin) => this.openGalleryFocus(work, origin));
    const panel = document.getElementById("galleryWorksPanel");
    const toggle = document.getElementById("galleryWorksToggle");
    const close = () => {
      panel.hidden = true;
      toggle.setAttribute("aria-expanded", "false");
      document.getElementById("galleryPage").classList.remove("has-works-panel");
    };
    this.closeGalleryWorksPanel = close;
    toggle.addEventListener("click", () => {
      if (!document.getElementById("galleryFocus").hidden) return;
      const opening = panel.hidden;
      panel.hidden = !opening;
      toggle.setAttribute("aria-expanded", String(opening));
      document.getElementById("galleryPage").classList.toggle("has-works-panel", opening);
      if (opening) this.renderGalleryWorksPanel();
    });
    document.getElementById("galleryWorksClose").addEventListener("click", close);
    toggle.addEventListener("click", () => { void this.galleryNavigationInk?.burst(toggle); });
    document.querySelectorAll("[data-gallery-filter]").forEach((button) => button.addEventListener("click", () => {
      document.querySelectorAll("[data-gallery-filter]").forEach((item) => item.classList.toggle("is-active", item === button));
      this.renderGalleryWorksPanel();
    }));
    document.getElementById("galleryFocusClose").addEventListener("click", () => this.closeGalleryFocus());

    const hangingGallery = document.getElementById("hangingGallery");
    const hangingStage = document.getElementById("hangingGalleryStage");
    const openHanging = document.getElementById("galleryHangingOpen");
    openHanging.addEventListener("click", async () => {
      await this.galleryNavigationInk?.burst(openHanging);
      this.openHangingGallery();
    });
    hangingGallery.querySelector('[data-gallery-mode="classic"]').addEventListener("click", async (event) => {
      await this.hangingNavigationInk?.burst(event.currentTarget);
      this.closeHangingGallery();
    });
    document.getElementById("hangingGalleryPrev").addEventListener("click", () => this.scrollHangingGallery(-1));
    document.getElementById("hangingGalleryNext").addEventListener("click", () => this.scrollHangingGallery(1));
    document.getElementById("hangingGalleryTrack").addEventListener("keydown", (event) => {
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        this.scrollHangingGallery(event.key === "ArrowLeft" ? -1 : 1);
      }
    });
    this.hangingWindPointer = null;
    this.hangingWindResetTimer = 0;
    this.renderHangingWalkers();
    window.addEventListener("resize", () => {
      if (this.hangingGalleryMode) this.positionHangingGalleryParasols();
    }, { passive: true });
    hangingStage.addEventListener("pointermove", (event) => this.applyHangingWind(event), { passive: true });
    hangingStage.addEventListener("pointerleave", () => this.releaseHangingWind(), { passive: true });
    document.addEventListener("visibilitychange", () => {
      if (this.hangingGalleryMode && !document.hidden) this.startHangingRopeMotion();
    });
    window.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && this.hangingGalleryMode && document.getElementById("galleryFocus").hidden) this.closeHangingGallery();
    });
  }

  openHangingGallery() {
    if (this.page !== "gallery") return;
    this.closeGalleryWorksPanel?.();
    this.hangingGalleryMode = true;
    document.getElementById("galleryClassicView").hidden = true;
    document.getElementById("hangingGallery").hidden = false;
    document.getElementById("galleryPage").classList.add("is-hanging-gallery");
    this.startHangingDayNightCycle();
    this.startHangingRopeMotion();
    this.galleryScene?.setActive(false);
    this.galleryNavigationInk?.setVisible(false);
    this.hangingNavigationInk?.setVisible(true);
    if (!this.hangingPreparedWorks.length) this.refreshGallery();
    else this.renderHangingGallery();
  }

  closeHangingGallery() {
    if (!this.hangingGalleryMode && document.getElementById("hangingGallery")?.hidden !== false) return;
    this.hangingGalleryMode = false;
    this.stopHangingDayNightCycle();
    this.stopHangingRopeMotion();
    this.releaseHangingWind();
    const page = document.getElementById("galleryPage");
    page?.classList.remove("is-hanging-gallery");
    const hanging = document.getElementById("hangingGallery");
    const classic = document.getElementById("galleryClassicView");
    if (hanging) hanging.hidden = true;
    if (classic) classic.hidden = false;
    this.galleryScene?.setActive(this.page === "gallery");
    this.hangingNavigationInk?.setVisible(false);
    this.galleryNavigationInk?.setVisible(this.page === "gallery");
  }

  scrollHangingGallery(direction) {
    const track = document.getElementById("hangingGalleryTrack");
    if (!track) return;
    track.scrollBy({ left: direction * Math.max(track.clientWidth * .72, 260), behavior: "smooth" });
  }

  startHangingDayNightCycle() {
    this.stopHangingDayNightCycle();
    const gallery = document.getElementById("hangingGallery");
    if (!gallery) return;
    gallery.dataset.time = "day";
    this.hangingDayNightInterval = window.setInterval(() => {
      if (!this.hangingGalleryMode || gallery.hidden) return;
      gallery.dataset.time = gallery.dataset.time === "night" ? "day" : "night";
    }, 30000);
  }

  stopHangingDayNightCycle() {
    window.clearInterval(this.hangingDayNightInterval);
    this.hangingDayNightInterval = 0;
    const gallery = document.getElementById("hangingGallery");
    if (gallery) gallery.dataset.time = "day";
  }

  startHangingRopeMotion() {
    this.stopHangingRopeMotion();
    if (!this.hangingGalleryMode) return;
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reducedMotion) {
      this.positionHangingGalleryParasols(34);
      return;
    }
    const tick = (now) => {
      if (!this.hangingGalleryMode || document.hidden) {
        this.hangingRopeAnimationFrame = 0;
        this.hangingRopeLastTime = 0;
        return;
      }
      const delta = this.hangingRopeLastTime ? Math.min(48, now - this.hangingRopeLastTime) : 16;
      this.hangingRopeLastTime = now;
      this.hangingRopePhase += delta * .00042;
      const easing = 1 - Math.exp(-delta / 430);
      this.hangingRopeWind += (this.hangingRopeWindTarget - this.hangingRopeWind) * easing;
      this.hangingRopeWindTarget *= Math.exp(-delta / 760);
      const centerSag = 34 + Math.sin(this.hangingRopePhase) * 1.15 + this.hangingRopeWind * .72;
      this.positionHangingGalleryParasols(centerSag);
      this.hangingRopeAnimationFrame = requestAnimationFrame(tick);
    };
    this.hangingRopeAnimationFrame = requestAnimationFrame(tick);
  }

  stopHangingRopeMotion() {
    cancelAnimationFrame(this.hangingRopeAnimationFrame);
    this.hangingRopeAnimationFrame = 0;
    this.hangingRopeLastTime = 0;
    this.hangingRopeWind = 0;
    this.hangingRopeWindTarget = 0;
  }

  renderHangingWalkers() {
    const host = document.getElementById("hangingGalleryWalkers");
    if (!host || host.childElementCount) return;
    const walkers = [
      { type: "woman", row: "0%", direction: "right", duration: "58s", delay: "-17s", width: "clamp(6.1rem, 6.8vw, 8rem)", opacity: ".84", start: "19.25%", middle: "26.05%", end: "18.325%", scaleStart: ".84", scaleMiddle: ".68", scaleEnd: ".82", depth: 3, step: "1.22s" },
      { type: "man", row: "100%", direction: "left", duration: "67s", delay: "-39s", width: "clamp(5.7rem, 6.3vw, 7.5rem)", opacity: ".8", start: "20.225%", middle: "24.35%", end: "18.325%", scaleStart: ".77", scaleMiddle: ".62", scaleEnd: ".76", depth: 2, step: "1.38s" },
      { type: "woman", row: "0%", direction: "left", duration: "63s", delay: "-23s", width: "clamp(5rem, 5.5vw, 6.5rem)", opacity: ".72", start: "20.45%", middle: "26.9%", end: "19.9%", scaleStart: ".67", scaleMiddle: ".54", scaleEnd: ".65", depth: 1, step: "1.56s" },
      { type: "man", row: "100%", direction: "right", duration: "74s", delay: "-51s", width: "clamp(5.3rem, 5.9vw, 7rem)", opacity: ".76", start: "18.325%", middle: "25.3%", end: "20.225%", scaleStart: ".74", scaleMiddle: ".59", scaleEnd: ".72", depth: 2, step: "1.46s" }
    ];
    walkers.forEach((config, index) => {
      const walker = document.createElement("span");
      walker.className = `hanging-gallery-walker is-${config.direction}`;
      walker.style.setProperty("--walker-duration", config.duration);
      walker.style.setProperty("--walker-delay", config.delay);
      walker.style.setProperty("--walker-width", config.width);
      walker.style.setProperty("--walker-opacity", config.opacity);
      walker.style.setProperty("--walker-bottom-start", config.start);
      walker.style.setProperty("--walker-bottom-middle", config.middle);
      walker.style.setProperty("--walker-bottom-end", config.end);
      walker.style.setProperty("--walker-scale-start", config.scaleStart);
      walker.style.setProperty("--walker-scale-middle", config.scaleMiddle);
      walker.style.setProperty("--walker-scale-end", config.scaleEnd);
      // Keep walking figures only slightly in front of the room plate. A large
      // z gap made the sprite look like a separate cutout layer.
      walker.style.setProperty("--walker-z", `${-10 + (config.depth - 1) * 8}px`);
      walker.style.setProperty("--walker-shadow-strength", config.scaleStart);
      walker.style.zIndex = String(config.depth);
      walker.setAttribute("data-figure", config.type);
      const sprite = document.createElement("span");
      sprite.className = "hanging-gallery-walker-sprite";
      sprite.style.setProperty("--sprite-row", config.row);
      sprite.style.setProperty("--step-duration", config.step);
      walker.append(sprite);
      host.append(walker);
    });
  }

  positionHangingGalleryParasols(centerSag = 34) {
    const suspension = document.getElementById("hangingGallerySuspension");
    const rope = suspension?.querySelector(".hanging-gallery-rope");
    if (!suspension || !rope || !suspension.getClientRects().length) return;
    const suspensionBounds = suspension.getBoundingClientRect();
    const ropeBounds = rope.getBoundingClientRect();
    const hangers = [...suspension.querySelectorAll(".hanging-parasol-hanger")];
    hangers.forEach((hanger, index) => {
      const t = Number(hanger.dataset.ropeT) || (index + 1) / (hangers.length + 1);
      const mirroredT = t <= .5 ? t : 1 - t;
      const targetX = 1 + 98 * mirroredT;
      let low = 0;
      let high = 1;
      for (let iteration = 0; iteration < 24; iteration += 1) {
        const u = (low + high) / 2;
        const inverse = 1 - u;
        const x = inverse ** 3 + 3 * inverse ** 2 * u * 27 + 3 * inverse * u ** 2 * 37 + u ** 3 * 50;
        if (x < targetX) low = u;
        else high = u;
      }
      const u = (low + high) / 2;
      const inverse = 1 - u;
      const cubicY = (controlY) => inverse ** 3 * 2 + 3 * inverse ** 2 * u * 2 + 3 * inverse * u ** 2 * controlY + u ** 3 * controlY;
      const baseSag = Math.max(0, (cubicY(centerSag) - 2) / 40 * ropeBounds.height);
      hanger.style.left = `${ropeBounds.left - suspensionBounds.left + ropeBounds.width * t}px`;
      hanger.style.setProperty("--rope-sag", `${baseSag.toFixed(2)}px`);
    });
    const ropePaths = rope.querySelectorAll("path");
    const curve = (start, control) => `M1 ${start} C27 ${start} 37 ${control} 50 ${control} C63 ${control} 73 ${start} 99 ${start}`;
    ropePaths[0]?.setAttribute("d", curve(4, centerSag + 2));
    ropePaths[1]?.setAttribute("d", curve(2, centerSag));
    ropePaths[2]?.setAttribute("d", curve(1, centerSag - 1));
  }

  applyHangingWind(event) {
    if (!this.hangingGalleryMode || event.pointerType === "touch") return;
    const now = performance.now();
    const previous = this.hangingWindPointer;
    this.hangingWindPointer = { x: event.clientX, y: event.clientY, time: now };
    if (!previous) return;
    const elapsed = Math.max(8, now - previous.time);
    const velocityX = (event.clientX - previous.x) / elapsed;
    const velocityY = (event.clientY - previous.y) / elapsed;
    this.hangingRopeWindTarget = Math.max(-1.8, Math.min(1.8, velocityX * 2.5 + velocityY * .55));
    const root = document.getElementById("hangingGalleryStage");
    root.querySelectorAll(".hanging-parasol-hanger").forEach((hanger) => {
      const factor = Number(hanger.dataset.gustFactor) || .7;
      const sway = Math.max(-5.2, Math.min(5.2, velocityX * 88 * factor + velocityY * 18 * factor));
      hanger.style.setProperty("--gust-angle", `${sway.toFixed(2)}deg`);
    });
    window.clearTimeout(this.hangingWindResetTimer);
    this.hangingWindResetTimer = window.setTimeout(() => this.releaseHangingWind(), 180);
  }

  releaseHangingWind() {
    window.clearTimeout(this.hangingWindResetTimer);
    this.hangingWindResetTimer = 0;
    this.hangingWindPointer = null;
    this.hangingRopeWindTarget = 0;
    const root = document.getElementById("hangingGalleryStage");
    if (!root) return;
    root.querySelectorAll(".hanging-parasol-hanger").forEach((hanger) => hanger.style.setProperty("--gust-angle", "0deg"));
  }

  renderHangingGallery() {
    if (!this.hangingPreparedWorks.length) return;
    const seenIds = new Set();
    const seenArtworks = new Set();
    const available = this.hangingPreparedWorks.filter((work) => {
      if (!work?.id || this.hangingDismissedIds.has(work.id) || seenIds.has(work.id)) return false;
      seenIds.add(work.id);
      const signature = String(work.imageDataUrl || "").trim();
      if (signature && seenArtworks.has(signature)) return false;
      if (signature) seenArtworks.add(signature);
      return true;
    });
    const validIds = new Set(available.map((work) => work.id));
    this.hangingSelectedIds = new Set([...this.hangingSelectedIds].filter((id) => validIds.has(id)));
    if (!this.hangingGalleryDefaultsChosen) {
      const shuffled = [...available];
      for (let index = shuffled.length - 1; index > 0; index -= 1) {
        const swap = Math.floor(Math.random() * (index + 1));
        [shuffled[index], shuffled[swap]] = [shuffled[swap], shuffled[index]];
      }
      shuffled.slice(0, Math.min(4, shuffled.length)).forEach((work) => this.hangingSelectedIds.add(work.id));
      this.hangingGalleryDefaultsChosen = true;
    }
    const workById = new Map(available.map((work) => [work.id, work]));
    const selected = [...this.hangingSelectedIds].map((id) => workById.get(id)).filter(Boolean).slice(0, 5);
    this.hangingSelectedIds = new Set(selected.map((work) => work.id));
    const parasols = document.getElementById("hangingGalleryParasols");
    parasols.replaceChildren();
    selected.forEach((work, index) => {
      const hanger = document.createElement("article");
      hanger.className = "hanging-parasol-hanger";
      hanger.dataset.ropeT = `${(index + 1) / (selected.length + 1)}`;
      let motionSeed = 0;
      const motionKey = String(work.id);
      for (let charIndex = 0; charIndex < motionKey.length; charIndex += 1) motionSeed = (motionSeed * 31 + motionKey.charCodeAt(charIndex)) >>> 0;
      const swayAmplitude = .78 + (motionSeed % 13) / 10;
      const swayPeriod = 6.8 + (motionSeed % 41) / 10;
      const depthScale = .96 + (motionSeed % 9) / 100;
      hanger.style.setProperty("--sway-duration", `${swayPeriod.toFixed(1)}s`);
      hanger.style.setProperty("--sway-delay", `${-((motionSeed % 100) / 100 * swayPeriod).toFixed(2)}s`);
      hanger.style.setProperty("--sway-left", `${-swayAmplitude.toFixed(2)}deg`);
      hanger.style.setProperty("--sway-right", `${swayAmplitude.toFixed(2)}deg`);
      hanger.style.setProperty("--hanger-scale", depthScale.toFixed(2));
      // Tiny depth/scale variation keeps the display dimensional without
      // separating the umbrellas from the room as floating foreground props.
      hanger.style.setProperty("--hanger-z", `${(-4 + ((depthScale - .96) / .08) * 12).toFixed(1)}px`);
      hanger.style.setProperty("--hanger-depth", String(Math.round(depthScale * 10)));
      hanger.dataset.gustFactor = `${.42 + (motionSeed % 48) / 100}`;
      const cord = document.createElement("span");
      cord.className = "hanging-parasol-cord";
      cord.setAttribute("aria-hidden", "true");
      const button = document.createElement("button");
      button.type = "button";
      button.className = "hanging-parasol";
      button.setAttribute("aria-label", "点击欣赏这把绸伞的三维模型");
      const body = document.createElement("span");
      body.className = "hanging-parasol-body";
      const image = document.createElement("img");
      image.src = work.parasolPreview?.src || work.imageDataUrl;
      image.alt = "悬挂展示的绸伞";
      image.draggable = false;
      body.append(image);
      button.append(body);
      button.addEventListener("click", () => {
        const bounds = button.getBoundingClientRect();
        void this.openGalleryFocus(work, { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 });
      });
      hanger.append(cord, button);
      parasols.append(hanger);
    });
    requestAnimationFrame(() => this.positionHangingGalleryParasols());

    const track = document.getElementById("hangingGalleryTrack");
    track.replaceChildren();
    available.forEach((work) => {
      const card = document.createElement("article");
      card.className = `hanging-gallery-card${this.hangingSelectedIds.has(work.id) ? " is-selected" : ""}`;
      const choose = document.createElement("button");
      choose.type = "button";
      choose.className = "hanging-gallery-thumb";
      choose.setAttribute("aria-pressed", String(this.hangingSelectedIds.has(work.id)));
      choose.setAttribute("aria-label", this.hangingSelectedIds.has(work.id) ? "从上方展陈中取下这把伞" : "将这把伞挂到上方展陈");
      const image = document.createElement("img");
      image.src = work.parasolPreview?.src || work.imageDataUrl;
      image.alt = "绸伞作品预览";
      image.loading = "lazy";
      choose.append(image);
      choose.addEventListener("click", () => {
        if (this.hangingSelectedIds.has(work.id)) this.hangingSelectedIds.delete(work.id);
        else {
          if (this.hangingSelectedIds.size >= 5) this.hangingSelectedIds.delete(this.hangingSelectedIds.values().next().value);
          this.hangingSelectedIds.add(work.id);
        }
        this.renderHangingGallery();
      });
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "hanging-gallery-remove";
      remove.textContent = "×";
      remove.setAttribute("aria-label", work.category === "mine" ? "删除这件自绘作品" : "从悬伞展廊移除这把预设伞");
      remove.title = work.category === "mine" ? "删除自绘作品" : "从本次展陈移除";
      remove.addEventListener("click", (event) => {
        event.stopPropagation();
        if (work.category === "mine") {
          if (!window.confirm("确定删除这把自绘绸伞吗？删除后无法恢复。")) return;
          if (this.store.delete(work.id)) this.refreshGallery();
        } else {
          this.hangingDismissedIds.add(work.id);
          this.hangingSelectedIds.delete(work.id);
          this.renderHangingGallery();
        }
      });
      card.append(choose, remove);
      track.append(card);
    });
  }

  refreshGallery() {
    if (!this.app.isReady) return;
    this.featuredWork ||= this.store.createFeatured(this.app.canvasManager.getUmbrellaTextureCanvas());
    this.imageCache.clear();
    this.galleryPreviewCache.clear();
    this.filterGallery();
    this.renderGalleryWorksPanel();
  }

  filterGallery() {
    const saved = this.store.list();
    const recentSaved = [...saved].reverse();
    const featured = this.featuredWork;
    const traditional = this.curatedWorks.filter((work) => work.category === "traditional");
    const creative = this.curatedWorks.filter((work) => work.category === "creative");
    const works = [...recentSaved, featured, ...traditional, ...creative].filter((work, index, all) => work && all.findIndex((item) => item?.id === work.id) === index);
    this.galleryWorks = works;
    const assignments = this.store.getAssignments();
    const defaultWorks = works;
    const sceneWorks = Array.from({ length: 8 }, (_, slot) =>
      works.find((work) => work.id === assignments[String(slot)]) || defaultWorks[slot % Math.max(defaultWorks.length, 1)]
    ).filter(Boolean);
    const token = ++this.galleryPreparationToken;
    this.galleryScene?.host.classList.add("is-preparing");
    if (this.galleryScene) void this.prepareGalleryWorks(sceneWorks, token, works);
    document.getElementById("galleryEmpty").hidden = works.length > 0;
  }

  renderGalleryWorksPanel() {
    const grid = document.getElementById("galleryWorksGrid");
    const filter = document.querySelector("[data-gallery-filter].is-active")?.dataset.galleryFilter || "all";
    const works = (this.galleryWorks || []).filter((work) => filter !== "mine" || work.category === "mine");
    grid.replaceChildren();
    if (!works.length) {
      const empty = document.createElement("div");
      empty.className = "gallery-works-empty";
      empty.innerHTML = '<p>还没有保存的绸伞</p><a href="#studio" data-route="studio">前往绘制工坊</a>';
      empty.querySelector("a").addEventListener("click", (event) => { event.preventDefault(); this.closeGalleryWorksPanel(); this.navigate("studio"); });
      grid.append(empty);
      return;
    }
    works.forEach((work) => {
      const card = document.createElement("article");
      card.className = "gallery-work-card";
      const image = document.createElement("img");
      image.src = work.imageDataUrl;
      image.alt = "绸伞伞面纹样";
      image.loading = "lazy";
      const actions = document.createElement("div");
      actions.className = "gallery-work-actions";
      const show = document.createElement("button");
      show.type = "button";
      show.className = "gallery-work-action-show";
      show.textContent = "展示";
      show.addEventListener("click", () => {
        const slot = Number.isInteger(this.galleryScene?.selectedWalkerIndex) ? this.galleryScene.selectedWalkerIndex : 0;
        this.store.assign(slot, work.id);
        this.filterGallery();
        this.closeGalleryWorksPanel();
      });
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "gallery-work-action-delete";
      remove.textContent = "删除";
      if (work.category === "mine") {
        remove.setAttribute("aria-label", "删除这件我的作品");
        remove.addEventListener("click", () => {
          if (!window.confirm("确定删除这把绸伞吗？删除后无法恢复。")) return;
          if (this.store.delete(work.id)) this.refreshGallery();
        });
      } else {
        remove.disabled = true;
        remove.title = "预设作品不可删除";
        remove.setAttribute("aria-label", "预设作品不可删除");
      }
      actions.append(show, remove);
      card.append(image, actions);
      grid.append(card);
    });
  }

  async prepareGalleryWorks(sceneWorks, token, allWorks = this.galleryWorks) {
    let preview = null;
    try {
      preview = await this.app.ensureBundledUmbrella();
    } catch (error) {
      // Keep the walk scene visible even if WebGL is unavailable. The actual
      // 3D focus will still report its own actionable error when selected.
      console.warn("画廊 3D 伞模不可用，将使用本地伞面预览：", error);
    }
    const prepared = [];
    const uniqueWorks = [...new Map([...allWorks, ...sceneWorks].filter(Boolean).map((work) => [work.id, work])).values()];
    for (let index = 0; index < uniqueWorks.length; index += 1) {
      const work = uniqueWorks[index];
      const pose = GalleryScene.poseForIndex(index);
      let canvas = null;
      let thumbnail = null;
      try {
        canvas = await this.getCanvas(work);
        const previewKey = `${work.id}:${pose.character}`;
        const cached = this.galleryPreviewCache.get(previewKey);
        if (cached?.canvas === canvas) thumbnail = cached.thumbnail;
        else if (preview?.captureGalleryParasolPreview) {
          thumbnail = preview.captureGalleryParasolPreview(canvas, `gallery-thumbnail-${work.id}-${token}`, pose);
          this.galleryPreviewCache.set(previewKey, { canvas, thumbnail });
        }
      } catch (error) {
        console.warn(`作品 ${work.id} 的 3D 伞面预览生成失败：`, error);
      }
      if (!thumbnail && canvas) thumbnail = this.createGalleryParasolFallback(canvas);
      if (thumbnail) {
        prepared.push({ ...work, galleryPose: { yaw: pose.yaw, roll: pose.roll }, parasolPreview: thumbnail });
      }
    }
    if (token !== this.galleryPreparationToken || this.page !== "gallery") return;
    const preparedById = new Map(prepared.map((work) => [work.id, work]));
    this.galleryScene?.setWorks(sceneWorks.map((work) => preparedById.get(work.id)).filter(Boolean));
    this.hangingPreparedWorks = allWorks.map((work) => preparedById.get(work.id)).filter(Boolean);
    if (this.hangingGalleryMode) this.renderHangingGallery();
    this.galleryScene?.host.classList.remove("is-preparing");
  }

  createGalleryParasolFallback(artworkCanvas) {
    const canvas = document.createElement("canvas");
    canvas.width = 384;
    canvas.height = 256;
    const context = canvas.getContext("2d");
    if (!context || !artworkCanvas) return null;
    const centerX = 192;
    const crownY = 30;
    const radiusX = 154;
    const radiusY = 68;
    context.save();
    context.beginPath();
    context.moveTo(centerX - radiusX, crownY + radiusY * .58);
    context.quadraticCurveTo(centerX, crownY - radiusY * 1.1, centerX + radiusX, crownY + radiusY * .58);
    context.quadraticCurveTo(centerX, crownY + radiusY * 1.42, centerX - radiusX, crownY + radiusY * .58);
    context.closePath();
    context.clip();
    context.fillStyle = "#e9e2d1";
    context.fillRect(centerX - radiusX, crownY - radiusY, radiusX * 2, radiusY * 2.4);
    context.globalAlpha = .88;
    context.drawImage(artworkCanvas, centerX - radiusX, crownY - radiusY * .4, radiusX * 2, radiusY * 1.8);
    context.restore();
    context.lineCap = "round";
    context.lineJoin = "round";
    const ribCount = 16;
    for (let index = 0; index < ribCount; index += 1) {
      const t = index / (ribCount - 1) * 2 - 1;
      const x = centerX + radiusX * t;
      const y = crownY + radiusY * .58 * (1 - t * t);
      context.strokeStyle = index % 2 ? "rgba(106,91,65,.48)" : "rgba(224,211,178,.9)";
      context.lineWidth = index % 2 ? 1.35 : 2.2;
      context.beginPath();
      context.moveTo(centerX, crownY + 2);
      context.quadraticCurveTo(centerX + (x - centerX) * .52, crownY + radiusY * .42, x, y);
      context.stroke();
    }
    context.strokeStyle = "rgba(100,77,48,.88)";
    context.lineWidth = 3;
    context.beginPath();
    context.moveTo(centerX, crownY + 4);
    context.lineTo(centerX, 225);
    context.stroke();
    context.strokeStyle = "rgba(232,218,185,.76)";
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(centerX - 1, crownY + 8);
    context.lineTo(centerX - 1, 224);
    context.stroke();
    return { src: canvas.toDataURL("image/png"), width: canvas.width, height: canvas.height, gripX: .5, gripY: .77, canopyBottom: .48 };
  }

  async openGalleryFocus(work, origin = null) {
    if (!work) return;
    const requestToken = ++this.galleryFocusRequestToken;
    this.closeGalleryWorksPanel?.();
    const page = document.getElementById("galleryPage");
    const focus = document.getElementById("galleryFocus");
    window.clearTimeout(this.focusCloseTimer);
    focus.classList.remove("is-closing");
    focus.hidden = false;
    const host = focus.querySelector(".gallery-focus-host");
    const hostBounds = host.getBoundingClientRect();
    const originX = origin ? ((origin.x - hostBounds.left) / Math.max(hostBounds.width, 1)) * 100 : 50;
    const originY = origin ? ((origin.y - hostBounds.top) / Math.max(hostBounds.height, 1)) * 100 : 50;
    host.style.setProperty("--focus-origin-x", `${originX}%`);
    host.style.setProperty("--focus-origin-y", `${originY}%`);
    page.classList.add("is-focused");
    this.galleryScene?.setFocused(true);
    this.inkWashBackground?.setSceneMode("gallery");
    try {
      const canvas = await this.getCanvas(work);
      if (focus.hidden || requestToken !== this.galleryFocusRequestToken) return;
      await this.app.presentShowcase(host, canvas, `gallery-${work.id}`, work.galleryPose || null);
    } catch (error) {
      console.warn("画廊绸伞预览暂不可用：", error);
      if (focus.hidden || requestToken !== this.galleryFocusRequestToken) return;
      this.closeGalleryFocus(false, true);
      const detail = String(error?.message || "发生未知错误").replace(/\s+/g, " ").slice(0, 96);
      this.app.showMessage(`3D赏伞失败：${detail}；场景已恢复，可重试`);
    }
  }

  closeGalleryFocus(restorePage = true, immediate = false) {
    const focus = document.getElementById("galleryFocus");
    this.galleryFocusRequestToken += 1;
    if (focus.hidden || (focus.classList.contains("is-closing") && !immediate)) return;
    const finish = () => {
      focus.hidden = true;
      focus.classList.remove("is-closing");
      document.getElementById("galleryPage").classList.remove("is-focused");
      this.galleryScene?.setFocused(false);
      this.app.suspendShowcase();
    };
    if (immediate) {
      window.clearTimeout(this.focusCloseTimer);
      finish();
    }
    else {
      focus.classList.add("is-closing");
      const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      this.focusCloseTimer = window.setTimeout(finish, reduced ? 0 : 360);
    }
    if (restorePage && this.page === "studio") this.app.resumeStudioPresentation();
  }
}


