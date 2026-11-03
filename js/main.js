// 页面入口只负责等待 DOM，并创建主应用对象。
// Versioned import prevents an older cached controller from surviving a UI
// change where control IDs have changed.
import { App } from "./app/App.js?v=20261102-lake-silk-v23";
import { SiteExperience } from "./site/SiteExperience.js?v=20261030-hanging-gallery-v1";
import { HomeLakeScene } from "./site/HomeLakeScene.js?v=20261028-inkfield-v39";
import { InkTransition } from "./site/InkTransition.js?v=20261028-upstream-fluid-v45";
import { InkWashBackground } from "./ui/InkWashBackground.js?v=20261029-book-hover-ink-v46";

document.addEventListener("DOMContentLoaded", () => {
  let atmosphere = null;
  try {
    atmosphere = new HomeLakeScene(document.getElementById("homeLakeHost"));
  } catch (error) {
    console.warn("Three.js 环境水墨暂不可用：", error);
  }
  const app = new App(atmosphere);
  const culturalInk = new InkWashBackground({ studio: document.getElementById("inkWashCanvas"), heritage: document.getElementById("heritageInkHost") });
  let transition = null;
  try {
    transition = new InkTransition(document.getElementById("inkTransitionCanvas"));
  } catch (error) {
    console.warn("液态水墨转场暂不可用：", error);
  }
  new SiteExperience(app, culturalInk, atmosphere, transition);
});
