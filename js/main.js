// 页面入口只负责等待 DOM，并创建主应用对象。
// Versioned import prevents an older cached controller from surviving a UI
// change where control IDs have changed.
import { App } from "./app/App.js?v=20261023-ink-fluid-v3";

document.addEventListener("DOMContentLoaded", () => {
  new App();
});
