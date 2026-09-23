/* Hover tooltips that stay inside their view.
 *
 * The views used SVG <title> elements, which the BROWSER draws as a native tooltip: it
 * cannot be styled, it cannot be positioned, and on a mark near the right edge it ran
 * out of the view - over the neighbouring one, or cut off at the window edge. A
 * tooltip is details on demand; if it hides the next view or loses its own text, it
 * fails at the one thing it is for.
 *
 * This draws one tooltip per view, as a child of the view's card, and places it beside
 * the pointer on whichever side has room, so it can never leave the card.
 */

"use strict";

const Tooltip = (() => {
  const GAP = 12;       // distance from the pointer
  const INSET = 4;      // minimum distance from the card's edge
  const DELAY_MS = 500; // rest time before showing - close to the browsers' native delay

  /** Escape text that comes from the data before it is written as HTML. */
  function esc(value) {
    return String(value ?? "").replace(/[&<>"]/g, (c) => (
      { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }

  function tipFor(viewId) {
    const view = document.getElementById(viewId);
    let tip = view.querySelector(":scope > .tooltip");
    if (!tip) {
      tip = document.createElement("div");
      tip.className = "tooltip";
      tip.hidden = true;
      view.appendChild(tip);
    }
    return { view, tip };
  }

  /** Place the tooltip right-below the pointer, flipping left or up when that side
   * has no room, then clamp it into the card as a last resort. */
  function place(view, tip, event) {
    const box = view.getBoundingClientRect();
    const x = event.clientX - box.left;
    const y = event.clientY - box.top;
    const w = tip.offsetWidth;
    const h = tip.offsetHeight;

    let left = x + GAP;
    if (left + w > box.width - INSET) left = x - GAP - w;
    let top = y + GAP;
    if (top + h > box.height - INSET) top = y - GAP - h;

    left = Math.max(INSET, Math.min(box.width - w - INSET, left));
    top = Math.max(INSET, Math.min(box.height - h - INSET, top));
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
  }

  /**
   * Give every element of a d3 selection a tooltip.
   *
   * @param selection  d3 selection of marks
   * @param viewId     id of the view card the tooltip must stay inside
   * @param html       datum -> HTML string (escape data values with Tooltip.esc)
   */
  function attach(selection, viewId, html) {
    const { view, tip } = tipFor(viewId);

    // Shown only once the pointer has RESTED on a mark, as the browser's native tooltip
    // did. Appearing instantly, it flickered over every country and point the cursor
    // merely crossed on its way somewhere else - on a map of 168 countries and a plot
    // of 3,414 points, that is most of the time. Every movement restarts the wait;
    // once shown, the tooltip stays put, like the native one.
    const arm = (event, d) => {
      clearTimeout(tip.timer);
      // Not while a button is held: that is a lasso or a pan, not a pause to read.
      if (event.buttons) return;
      const { clientX, clientY } = event;
      tip.timer = setTimeout(() => {
        tip.innerHTML = html(d);
        tip.hidden = false;
        place(view, tip, { clientX, clientY });
      }, DELAY_MS);
    };

    selection
      .on("mouseenter.tooltip", arm)
      .on("mousemove.tooltip", (event, d) => { if (tip.hidden) arm(event, d); })
      .on("mouseleave.tooltip", () => { clearTimeout(tip.timer); tip.hidden = true; });
  }

  function hide(viewId) {
    const tip = document.querySelector(`#${viewId} > .tooltip`);
    if (!tip) return;
    clearTimeout(tip.timer);        // a pending show must not fire after a lasso starts
    tip.hidden = true;
  }

  return { attach, hide, esc };
})();
