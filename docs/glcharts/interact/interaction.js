// glcharts/interact/interaction.js — pointer/wheel/pinch + click-vs-drag discrimination.
// Modes (owner sets via getMode()):
//   "navigate" — pan/zoom; short click → handlers.click; drag → pan (unless pointerDown
//                returns true to capture the gesture, e.g. drawing-handle drag)
//   "draw"     — clicks place drawing points (no pan); Escape cancels via handlers.cancel
//
// handlers: {
//   pan(dx), zoom(factor, xCss), cross(x,y|null), fit(), changed(),
//   click(x,y, mods),
//   pointerDown(x,y, mods) → boolean (true = capture, suppress pan),
//   pointerMove(x,y),
//   pointerUp(x,y),
//   cancel(), key(key, e), getMode(): "navigate"|"draw",
// }

const CLICK_SLOP = 5;

export function attachInteraction(el, handlers) {
  const pointers = new Map();
  let dragging = false;
  let didDrag = false;
  let captured = false;
  let downPos = null;
  let lastX = 0;
  let pinchDist = 0;
  let vx = 0;
  let lastMoveT = 0;
  let inertiaRaf = 0;
  let lastTapT = 0;

  const pos = (e) => {
    const r = el.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const mode = () => handlers.getMode?.() || "navigate";

  const stopInertia = () => {
    if (inertiaRaf) cancelAnimationFrame(inertiaRaf);
    inertiaRaf = 0;
  };

  const startInertia = () => {
    if (Math.abs(vx) < 0.05) return;
    let v = vx;
    let prev = performance.now();
    const step = (now) => {
      const dt = now - prev;
      prev = now;
      v *= Math.pow(0.94, dt / 16);
      if (Math.abs(v) < 0.02) { inertiaRaf = 0; return; }
      handlers.pan(v * dt / 16);
      handlers.changed();
      inertiaRaf = requestAnimationFrame(step);
    };
    inertiaRaf = requestAnimationFrame(step);
  };

  const onPointerDown = (e) => {
    stopInertia();
    el.setPointerCapture?.(e.pointerId);
    el.focus?.({ preventScroll: true });
    const p = pos(e);
    pointers.set(e.pointerId, p);
    if (pointers.size === 1) {
      dragging = true;
      didDrag = false;
      captured = !!handlers.pointerDown?.(p.x, p.y, {
        shift: e.shiftKey, alt: e.altKey, meta: e.metaKey || e.ctrlKey, button: e.button,
      });
      downPos = p;
      lastX = p.x;
      vx = 0;
      lastMoveT = performance.now();
      const now = Date.now();
      if (e.pointerType === "touch" && mode() === "navigate" && !captured && now - lastTapT < 300) {
        handlers.fit();
        handlers.changed();
      }
      lastTapT = now;
    } else if (pointers.size === 2) {
      dragging = false;
      captured = false;
      const [a, b] = [...pointers.values()];
      pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
    }
  };

  const onPointerMove = (e) => {
    const p = pos(e);
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, p);
    handlers.pointerMove?.(p.x, p.y);
    handlers.cross(p.x, p.y);

    if (pointers.size === 2 && mode() === "navigate") {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinchDist > 0 && d > 0) {
        handlers.zoom(d / pinchDist, (a.x + b.x) / 2);
        handlers.changed();
      }
      pinchDist = d;
      return;
    }

    if (dragging && pointers.size === 1) {
      if (downPos && Math.hypot(p.x - downPos.x, p.y - downPos.y) > CLICK_SLOP) {
        didDrag = true;
      }
      if (mode() === "navigate" && didDrag && !captured) {
        const dx = p.x - lastX;
        const now = performance.now();
        const dt = Math.max(1, now - lastMoveT);
        vx = 0.8 * vx + 0.2 * (dx / dt) * 16;
        lastMoveT = now;
        lastX = p.x;
        handlers.pan(dx);
      }
      handlers.changed();
      return;
    }

    handlers.changed();
  };

  const endPointer = (e) => {
    const p = pos(e);
    el.releasePointerCapture?.(e.pointerId);
    pointers.delete(e.pointerId);
    handlers.pointerUp?.(p.x, p.y);
    if (pointers.size === 0 && dragging) {
      dragging = false;
      if (!didDrag && downPos) {
        handlers.click?.(p.x, p.y, {
          shift: e.shiftKey, alt: e.altKey, meta: e.metaKey || e.ctrlKey, button: e.button,
        });
        handlers.changed();
      } else if (mode() === "navigate" && didDrag && !captured) {
        startInertia();
      }
      downPos = null;
      didDrag = false;
      captured = false;
    }
    if (pointers.size < 2) pinchDist = 0;
  };

  const onWheel = (e) => {
    e.preventDefault();
    stopInertia();
    const p = pos(e);
    if (e.ctrlKey || Math.abs(e.deltaY) >= Math.abs(e.deltaX)) {
      handlers.zoom(Math.pow(1.0016, -e.deltaY), p.x);
    } else {
      handlers.pan(-e.deltaX);
    }
    handlers.changed();
  };

  const onLeave = () => {
    handlers.cross(null, null);
    handlers.pointerMove?.(null, null);
    handlers.changed();
  };

  const onDblClick = () => {
    if (mode() !== "navigate") return;
    stopInertia();
    handlers.fit();
    handlers.changed();
  };

  const onKeyDown = (e) => {
    if (e.key === "Escape") {
      handlers.cancel?.();
      handlers.changed();
      return;
    }
    handlers.key?.(e.key, e);
  };

  if (!el.hasAttribute("tabindex")) el.setAttribute("tabindex", "0");
  el.addEventListener("pointerdown", onPointerDown);
  el.addEventListener("pointermove", onPointerMove);
  el.addEventListener("pointerup", endPointer);
  el.addEventListener("pointercancel", endPointer);
  el.addEventListener("pointerleave", onLeave);
  el.addEventListener("wheel", onWheel, { passive: false });
  el.addEventListener("dblclick", onDblClick);
  el.addEventListener("keydown", onKeyDown);
  el.style.touchAction = "none";
  el.style.outline = "none";

  return () => {
    stopInertia();
    el.removeEventListener("pointerdown", onPointerDown);
    el.removeEventListener("pointermove", onPointerMove);
    el.removeEventListener("pointerup", endPointer);
    el.removeEventListener("pointercancel", endPointer);
    el.removeEventListener("pointerleave", onLeave);
    el.removeEventListener("wheel", onWheel);
    el.removeEventListener("dblclick", onDblClick);
    el.removeEventListener("keydown", onKeyDown);
  };
}
