import { ArtworkGalleryStore } from "../features/ArtworkGalleryStore.js?v=20261111-gallery-color-v5";
import { HangingGallery3D } from "./HangingGallery3D.js?v=20261111-lantern-default-v1";
import { NavigationInk } from "./NavigationInk.js?v=20261106-ink-font-v1";

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
    this.imageCache = new Map();
    this.galleryPreviewCache = new Map();
    this.galleryPreparationToken = 0;
    this.galleryFocusRequestToken = 0;
    this.hangingGalleryMode = false;
    this.hangingPreparedWorks = [];
    this.hangingCards = new Map();
    this.hangingFocusId = null;
    this.lastHangingRailSelection = null;
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
          this.app.threePreview.controls.autoRotateSpeed = id === "homeUmbrellaHost" ? 0.2 : 0.65;
        }
      });
      host.addEventListener("pointerleave", () => {
        if (isCurrentShowcase() && this.app.threePreview?.controls) {
          this.app.threePreview.controls.autoRotateSpeed = id === "homeUmbrellaHost" ? 0.44 : 2;
        }
      });
    });
    window.addEventListener("gallery:updated", (event) => {
      const savedWork = event.detail;
      if (savedWork?.id) {
        this.store.select(savedWork.id);
        this.hangingFocusId = savedWork.id;
      }
      void (async () => {
        if (this.page !== "gallery") {
          await this.navigate("gallery");
          if (this.page !== "gallery") {
            history.pushState(null, "", "#gallery");
            this.showPage("gallery", false);
          }
        } else this.openHangingGallery();
        this.hangingFocusId = savedWork?.id || this.hangingFocusId;
        this.renderHangingGallery();
        requestAnimationFrame(() => this.hangingCards.get(this.hangingFocusId)?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" }));
      })();
    });
    this.app.ready.then(() => {
      this.featuredWork ||= this.store.createFeatured(this.app.canvasManager.getUmbrellaTextureCanvas());
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
            : this.navigationInk;
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
    this.hangingNavigationInk?.setActive(route);
    this.hangingNavigationInk?.setVisible(route === "gallery");
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
      if (route === "gallery") {
        this.openHangingGallery();
      }
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
    const selectedId = this.store.getSelectedWorkId();
    const selected = saved.find((work) => work.id === selectedId);
    if (selected) {
      this.homeWorkId = selected.id;
      return { ...selected, fabricMaterial: selected.fabricMaterial || this.app.controls.getSettings().fabricMaterial || "georgette" };
    }
    const fallbackMaterial = this.app.controls.getSettings().fabricMaterial || "georgette";
    const choices = saved.length
      ? saved.map((work) => ({ ...work, fabricMaterial: work.fabricMaterial || fallbackMaterial }))
      : [this.featuredWork];
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
      const preview = await this.app.presentShowcase(
        document.getElementById("homeUmbrellaHost"),
        canvas,
        `home-${work.id}`,
        null,
        work.fabricMaterial || this.app.controls.getSettings().fabricMaterial || "georgette"
      );
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
    const focus = document.getElementById("galleryFocus");
    const focusHost = document.getElementById("galleryFocusHost");
    let focusGesture = null;
    focus.addEventListener("pointerdown", (event) => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      focusGesture = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    }, true);
    focus.addEventListener("pointerup", (event) => {
      if (!focusGesture || event.pointerId !== focusGesture.pointerId) return;
      const gesture = focusGesture;
      focusGesture = null;
      if (Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > 8) return;
      const hitCanvas = focusHost.contains(event.target);
      const hitUmbrella = hitCanvas && this.app.threePreview?.hitTestClientPoint(event.clientX, event.clientY);
      if (!hitUmbrella) this.closeGalleryFocus();
    }, true);
    focus.addEventListener("pointercancel", () => { focusGesture = null; }, true);

    const hangingGallery = document.getElementById("hangingGallery");
    document.getElementById("hangingGalleryCreate").addEventListener("click", () => {
      void this.navigate("studio", document.querySelector('.hanging-gallery-nav [data-route="studio"]'));
    });
    document.getElementById("hangingGalleryPrev").addEventListener("click", () => this.scrollHangingGallery(-1));
    document.getElementById("hangingGalleryNext").addEventListener("click", () => this.scrollHangingGallery(1));
    document.getElementById("hangingGalleryTrack").addEventListener("keydown", (event) => {
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        this.scrollHangingGallery(event.key === "ArrowLeft" ? -1 : 1);
      }
    });
    hangingGallery.querySelectorAll("[data-hanging-weather]").forEach((button) => button.addEventListener("click", () => {
      this.hangingWorld?.setWeather(button.dataset.hangingWeather);
    }));
    hangingGallery.querySelectorAll("[data-hanging-time]").forEach((button) => button.addEventListener("click", () => {
      this.hangingWorld?.setTimeOfDay(button.dataset.hangingTime);
    }));
    document.addEventListener("visibilitychange", () => {
      this.hangingWorld?.setActive(this.hangingGalleryMode && !document.hidden);
    });
  }

  openHangingGallery() {
    if (this.page !== "gallery") return;
    this.hangingGalleryMode = true;
    document.getElementById("galleryPage").classList.add("is-hanging-gallery");
    if (!this.hangingWorld) {
      try {
        this.hangingWorld = new HangingGallery3D(
          document.getElementById("hangingGallery3D"),
          (work, origin) => {
            if (work?.id) {
              this.store.select(work.id);
              this.hangingFocusId = work.id;
              this.renderHangingGallery();
            }
            this.openGalleryFocus(work, origin);
          },
          {
            onWeatherChange: (name) => document.querySelectorAll("[data-hanging-weather]").forEach((button) => {
              button.setAttribute("aria-pressed", String(button.dataset.hangingWeather === name));
            }),
            onTimeChange: (name) => document.querySelectorAll("[data-hanging-time]").forEach((button) => {
              button.setAttribute("aria-pressed", String(button.dataset.hangingTime === name));
            })
          }
        );
        this.hangingWorld.ready.catch(() => {});
      } catch (error) {
        console.error("无法启动三维悬伞街景：", error);
        document.querySelector("#hangingGallery3D .hanging-gallery-loading").textContent = "三维街景启动失败，请检查浏览器的 WebGL 支持。";
      }
    }
    this.hangingWorld?.setActive(true);
    this.hangingNavigationInk?.setVisible(true);
    if (!this.app.isReady) return;
    this.refreshGallery();
  }

  closeHangingGallery() {
    if (!this.hangingGalleryMode && document.getElementById("hangingGallery")?.hidden !== false) return;
    this.hangingGalleryMode = false;
    this.hangingWorld?.setActive(false);
    const page = document.getElementById("galleryPage");
    page?.classList.remove("is-hanging-gallery");
    this.hangingNavigationInk?.setVisible(false);
  }

  scrollHangingGallery(direction) {
    const track = document.getElementById("hangingGalleryTrack");
    if (!track) return;
    const cards = [...track.querySelectorAll(".hanging-gallery-card")];
    if (!cards.length) return;
    const selectedIndex = cards.findIndex((card) => card.classList.contains("is-selected"));
    const startIndex = selectedIndex < 0 ? (direction < 0 ? cards.length : -1) : selectedIndex;
    const nextIndex = Math.max(0, Math.min(cards.length - 1, startIndex + Math.sign(direction)));
    if (nextIndex === selectedIndex) return;
    cards[nextIndex].querySelector(".hanging-gallery-thumb")?.click();
  }

  renderHangingGallery() {
    const available = this.hangingPreparedWorks.filter((work) => work?.id && work.category === "mine");
    const validIds = new Set(available.map((work) => work.id));
    if (!validIds.has(this.hangingFocusId)) {
      const storedSelection = this.store.getSelectedWorkId();
      this.hangingFocusId = validIds.has(storedSelection) ? storedSelection : null;
    }
    this.hangingWorld?.setFocusedWork(this.hangingFocusId);

    const track = document.getElementById("hangingGalleryTrack");
    const empty = document.getElementById("hangingGalleryEmpty");
    const isEmpty = available.length === 0;
    empty.hidden = !isEmpty;
    document.querySelector(".hanging-gallery-rail").hidden = isEmpty;
    document.querySelectorAll(".hanging-gallery-arrow").forEach((button) => { button.hidden = isEmpty; });
    const visibleIds = new Set();
    let cursor = track.firstElementChild;
    available.forEach((work) => {
      visibleIds.add(work.id);
      let card = this.hangingCards.get(work.id);
      let choose, image;
      if (!card) {
        card = document.createElement("article");
        card.dataset.workId = work.id;
        choose = document.createElement("button");
        choose.type = "button";
        choose.className = "hanging-gallery-thumb";
        choose.setAttribute("aria-label", "选中这把绸伞并在街景中高亮");
        image = document.createElement("img");
        image.alt = "自绘绸伞伞面预览";
        image.loading = "lazy";
        choose.append(image);
        choose.addEventListener("click", () => {
          this.store.select(work.id);
          this.hangingFocusId = work.id;
          this.renderHangingGallery();
          card.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
        });
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "hanging-gallery-remove";
        remove.innerHTML = '<svg class="trash-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path class="trash-lid" d="M4.5 7h15M9 7V4.8h6V7"/><path d="m7 7 .8 12h8.4L17 7M10 10.5v5.7m4-5.7v5.7"/></svg>';
        remove.setAttribute("aria-label", "删除这件自绘作品");
        remove.title = "删除自绘作品";
        remove.addEventListener("click", (event) => {
          event.stopPropagation();
          if (!window.confirm("确定删除这把自绘绸伞吗？删除后无法恢复。")) return;
          if (this.store.delete(work.id)) this.refreshGallery();
        });
        card.append(choose, remove);
        this.hangingCards.set(work.id, card);
      } else {
        choose = card.querySelector(".hanging-gallery-thumb");
        image = choose.querySelector("img");
      }
      const selected = work.id === this.hangingFocusId;
      card.className = `hanging-gallery-card${selected ? " is-selected" : ""}`;
      choose.setAttribute("aria-pressed", String(selected));
      const previewSource = work.galleryRailPreview?.src || work.parasolPreview?.src || work.imageDataUrl || work.motifUrl;
      if (previewSource && image.dataset.source !== previewSource) {
        image.dataset.source = previewSource;
        image.src = previewSource;
      }
      if (card !== cursor) track.insertBefore(card, cursor);
      cursor = card.nextElementSibling;
    });
    for (const [id, card] of this.hangingCards) {
      if (visibleIds.has(id)) continue;
      card.remove();
      this.hangingCards.delete(id);
    }
    if (!this.hangingFocusId) this.lastHangingRailSelection = null;
    if (this.hangingFocusId && this.lastHangingRailSelection !== this.hangingFocusId) {
      this.lastHangingRailSelection = this.hangingFocusId;
      const selectedCard = this.hangingCards.get(this.hangingFocusId);
      requestAnimationFrame(() => {
        if (selectedCard?.isConnected && this.hangingFocusId === selectedCard.dataset.workId) {
          selectedCard.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
        }
      });
    }
  }

  refreshGallery() {
    if (!this.app.isReady) return;
    this.imageCache.clear();
    this.galleryPreviewCache.clear();
    this.filterGallery();
  }

  filterGallery() {
    const fallbackMaterial = this.app.controls.getSettings().fabricMaterial || "georgette";
    const works = [...this.store.list()].reverse()
      .filter((work) => work.category === "mine")
      .map((work) => ({ ...work, fabricMaterial: work.fabricMaterial || fallbackMaterial }));
    this.galleryWorks = works;
    this.hangingPreparedWorks = works;
    if (!works.some((work) => work.id === this.hangingFocusId)) {
      const storedSelection = this.store.getSelectedWorkId();
      this.hangingFocusId = works.some((work) => work.id === storedSelection) ? storedSelection : null;
    }
    if (this.hangingGalleryMode) this.renderHangingGallery();
    if (this.hangingGalleryMode) void this.hangingWorld?.setWorks(works, (work) => this.getCanvas(work), this.hangingFocusId);
    const token = ++this.galleryPreparationToken;
    void this.prepareHangingWorks(works, token);
  }

  async prepareHangingWorks(works, token) {
    const prepared = await Promise.all(works.map(async (work) => {
      try {
        const canvas = await this.getCanvas(work);
        let preview = this.galleryPreviewCache.get(work.id);
        if (preview?.canvas !== canvas) {
          preview = { canvas, railThumbnail: this.createGalleryParasolFallback(canvas) };
          this.galleryPreviewCache.set(work.id, preview);
        }
        return { ...work, parasolPreview: preview.railThumbnail, galleryRailPreview: preview.railThumbnail };
      } catch (error) {
        console.warn(`作品 ${work.id} 的伞面预览生成失败：`, error);
        return work;
      }
    }));
    if (token !== this.galleryPreparationToken || this.page !== "gallery") return;
    const preparedById = new Map(prepared.map((work) => [work.id, work]));
    this.galleryWorks = this.galleryWorks.map((work) => preparedById.get(work.id) || work);
    this.hangingPreparedWorks = this.galleryWorks;
    if (this.hangingGalleryMode) this.renderHangingGallery();
  }

  createGalleryParasolFallback(artworkCanvas) {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 256;
    const context = canvas.getContext("2d");
    if (!context || !artworkCanvas) return null;
    const center = 128;
    const radius = 126;
    context.save();
    context.beginPath();
    context.arc(center, center, radius, 0, Math.PI * 2);
    context.clip();
    // Use the saved artwork's pixels and alpha without recoloring the dye or
    // applying the 3D fabric's transparency a second time.
    context.drawImage(artworkCanvas, center - radius, center - radius, radius * 2, radius * 2);
    context.restore();
    context.lineCap = "round";
    context.lineJoin = "round";
    const ribCount = 36;
    for (let index = 0; index < ribCount; index += 1) {
      const angle = index / ribCount * Math.PI * 2;
      const x = center + Math.cos(angle) * (radius - 2);
      const y = center + Math.sin(angle) * (radius - 2);
      context.strokeStyle = index % 2 ? "rgba(78,68,50,.23)" : "rgba(255,247,225,.48)";
      context.lineWidth = index % 2 ? 1.05 : 1.35;
      context.beginPath();
      context.moveTo(center, center);
      context.quadraticCurveTo(center + (x - center) * .53, center + (y - center) * .53 - 5, x, y);
      context.stroke();
    }
    context.strokeStyle = "rgba(86,68,45,.48)";
    context.lineWidth = 1.4;
    context.beginPath();
    context.arc(center, center, radius - 1, 0, Math.PI * 2);
    context.stroke();
    const hub = context.createRadialGradient(center - 1, center - 1, 0, center, center, 5);
    hub.addColorStop(0, "#f0e2c3");
    hub.addColorStop(1, "#756348");
    context.fillStyle = hub;
    context.beginPath();
    context.arc(center, center, 4.5, 0, Math.PI * 2);
    context.fill();
    return { src: canvas.toDataURL("image/png"), width: canvas.width, height: canvas.height, gripX: .5, gripY: .5, canopyBottom: .94 };
  }

  async openGalleryFocus(work, origin = null) {
    if (!work) return;
    if (work.category === "mine") {
      this.hangingFocusId = work.id;
      this.renderHangingGallery();
      this.hangingWorld?.setFocusedWork(work.id);
    }
    const requestToken = ++this.galleryFocusRequestToken;
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
    this.hangingWorld?.setActive(false);
    this.inkWashBackground?.setSceneMode("gallery");
    try {
      const canvas = await this.getCanvas(work);
      if (focus.hidden || requestToken !== this.galleryFocusRequestToken) return;
      await this.app.presentShowcase(host, canvas, `gallery-${work.id}`, work.galleryPose || null, work.fabricMaterial || this.app.controls.getSettings().fabricMaterial || "georgette");
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
      this.app.suspendShowcase();
      if (this.hangingGalleryMode && this.page === "gallery" && !document.hidden) this.hangingWorld?.setActive(true);
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


