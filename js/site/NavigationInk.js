/** Keeps navigation state in the DOM; CSS paints the small brush marks. */
export class NavigationInk {
  constructor(nav) {
    if (!nav) throw new Error("Missing navigation");
    this.nav = nav;
    this.links = [...nav.querySelectorAll("a[data-route], button[data-ink-nav]")];
    this.burstTimers = new Map();
  }

  setActive(route) {
    this.links.forEach((link) => {
      link.classList.toggle("is-current", link.dataset.route === route);
    });
  }

  setVisible(visible) {
    if (!visible) this.links.forEach((link) => link.classList.remove("is-inking"));
  }

  burst(link) {
    if (!this.links.includes(link)) return Promise.resolve();
    clearTimeout(this.burstTimers.get(link));
    link.classList.add("is-inking");
    this.burstTimers.set(link, window.setTimeout(() => {
      link.classList.remove("is-inking");
      this.burstTimers.delete(link);
    }, 360));
    // The page transition can start immediately; it needn't wait for a second animation.
    return Promise.resolve();
  }

  destroy() {
    this.burstTimers.forEach((timer) => clearTimeout(timer));
    this.burstTimers.clear();
    this.links.forEach((link) => link.classList.remove("is-current", "is-inking"));
  }
}
