// 页面入口只负责等待 DOM，并创建主应用对象。
// Versioned import prevents an older cached controller from surviving a UI
// change where control IDs have changed.
import { App } from "./app/App.js?v=20261026-ui-v4";
import { InkWashBackground } from "./ui/InkWashBackground.js?v=20261026-ink-wash-v11";

document.addEventListener("DOMContentLoaded", () => {
  const inkWashBackground = new InkWashBackground(document.getElementById("inkWashBackground"));
  new App(inkWashBackground);
});
