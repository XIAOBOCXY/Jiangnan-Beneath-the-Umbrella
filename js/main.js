// 页面入口只负责等待 DOM，并创建主应用对象。
import { App } from "./app/App.js";

document.addEventListener("DOMContentLoaded", () => {
  new App();
});
