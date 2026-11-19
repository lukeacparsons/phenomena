/**
 * Cinema curtain theme switch.
 * Every animation step displays one complete, separately drawn PNG frame.
 * No frame interpolation, rigging, morphing, or animated transforms are used.
 */

const FRAME_URLS = /*__FRAME_URLS_START__*/Array.from(
  { length: 16 },
  (_, index) => new URL(
    `./frames/frame-${String(index + 1).padStart(2, "0")}.png`,
    import.meta.url,
  ).href,
)/*__FRAME_URLS_END__*/;

const FRAME_DELAY = 50;
const LAST_FRAME = FRAME_URLS.length - 1;
let sharedFrames;

function preloadFrames() {
  if (!sharedFrames) {
    sharedFrames = Promise.all(FRAME_URLS.map((url) => new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("A cinema curtain animation frame could not be loaded."));
      image.src = url;
    })));
  }
  return sharedFrames;
}

export class CinemaThemeToggle extends HTMLElement {
  static get observedAttributes() {
    return ["checked", "size", "disabled", "label"];
  }

  constructor() {
    super();
    this._target = this.hasAttribute("checked");
    this._frame = this._target ? LAST_FRAME : 0;
    this._progress = this._target ? 1 : 0;
    this._timer = null;
    this._lastTick = null;
    this._images = null;
    this._connected = false;
    this._reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
    this._onMotionPreference = () => {
      if (this._reducedMotion.matches) this._jumpToTarget();
    };

    const shadow = this.attachShadow({ mode: "open", delegatesFocus: true });
    shadow.innerHTML = `
      <style>
        :host {
          display: inline-flex;
          vertical-align: middle;
          --cinema-toggle-size: 56px;
        }
        button {
          appearance: none;
          box-sizing: border-box;
          display: grid;
          place-items: center;
          width: max(44px, var(--cinema-toggle-size));
          height: max(44px, var(--cinema-toggle-size));
          min-width: 44px;
          min-height: 44px;
          margin: 0;
          padding: 0;
          border: 0;
          border-radius: 8px;
          background: transparent;
          color: inherit;
          cursor: pointer;
          touch-action: manipulation;
          -webkit-tap-highlight-color: transparent;
        }
        button:focus-visible {
          outline: 2px solid var(--cinema-toggle-focus, #c68e39);
          outline-offset: 4px;
        }
        button:disabled { cursor: default; }
        canvas {
          display: block;
          width: var(--cinema-toggle-size);
          height: var(--cinema-toggle-size);
          pointer-events: none;
        }
      </style>
      <button type="button" role="switch" aria-label="Light mode"
        aria-checked="false" aria-busy="true" disabled>
        <canvas width="256" height="256" aria-hidden="true"></canvas>
      </button>
    `;
    this._button = shadow.querySelector("button");
    this._canvas = shadow.querySelector("canvas");
    this._context = this._canvas.getContext("2d");
    this._button.addEventListener("click", () => {
      this.checked = !this.checked;
    });
    this._syncAccessibility();

    this.ready = preloadFrames().then((images) => {
      this._images = images;
      this._canvas.width = images[0].naturalWidth;
      this._canvas.height = images[0].naturalHeight;
      this._render();
      this._button.removeAttribute("aria-busy");
      this._syncDisabled();
      return this;
    });
    // Notify consumers while keeping an unused ready promise from causing an
    // unhandled rejection. The original ready promise still rejects for awaiters.
    this.ready.catch((error) => {
      this._button.removeAttribute("aria-busy");
      this.dispatchEvent(new CustomEvent("asset-error", {
        detail: { error }, bubbles: true, composed: true,
      }));
    });
  }

  connectedCallback() {
    this._connected = true;
    this._syncSize();
    this._syncAccessibility();
    this._reducedMotion.addEventListener("change", this._onMotionPreference);
    if (this._images) this._animateToTarget();
  }

  disconnectedCallback() {
    this._connected = false;
    this._stop();
    this._reducedMotion.removeEventListener("change", this._onMotionPreference);
  }

  attributeChangedCallback(name, oldValue, newValue) {
    if (oldValue === newValue) return;
    if (name === "label") {
      this._syncAccessibility();
      return;
    }
    if (name === "size") {
      this._syncSize();
      return;
    }
    if (name === "disabled") {
      this._syncDisabled();
      return;
    }
    const nextTarget = this.hasAttribute("checked");
    if (nextTarget === this._target) return;
    // Account for elapsed time in the old direction before reversing it.
    if (this._timer !== null) this._advance(performance.now());
    this._target = nextTarget;
    this._syncAccessibility();
    if (!this._images || !this._connected) {
      this._jumpToTarget();
    } else {
      this._animateToTarget();
    }
    this.dispatchEvent(new CustomEvent("theme-change", {
      detail: { theme: this.theme }, bubbles: true, composed: true,
    }));
  }

  get checked() { return this.hasAttribute("checked"); }
  set checked(value) { this.toggleAttribute("checked", Boolean(value)); }

  get theme() { return this.checked ? "light" : "dark"; }
  set theme(value) {
    if (value !== "light" && value !== "dark") {
      throw new TypeError('theme must be "light" or "dark".');
    }
    this.checked = value === "light";
  }

  get disabled() { return this.hasAttribute("disabled"); }
  set disabled(value) { this.toggleAttribute("disabled", Boolean(value)); }

  get frameIndex() { return this._frame; }
  get progress() {
    if (this._timer !== null) this._advance(performance.now());
    return this._progress;
  }

  _syncSize() {
    const raw = this.getAttribute("size") || "56";
    const value = /^\d+(?:\.\d+)?(?:px)?$/.test(raw) ? parseFloat(raw) : 56;
    const pixels = Math.max(16, Math.min(512, value));
    this.style.setProperty("--cinema-toggle-size", `${pixels}px`);
  }

  _syncAccessibility() {
    this._button.setAttribute("aria-label", this.getAttribute("label") || "Light mode");
    this._button.setAttribute("aria-checked", String(this._target));
  }

  _syncDisabled() {
    this._button.disabled = !this._images || this.disabled;
  }

  _stop() {
    if (this._timer !== null) cancelAnimationFrame(this._timer);
    this._timer = null;
    this._lastTick = null;
  }

  _jumpToTarget() {
    this._stop();
    this._progress = this._target ? 1 : 0;
    this._frame = this._target ? LAST_FRAME : 0;
    this._render();
  }

  _animateToTarget() {
    if (this._reducedMotion.matches) {
      this._jumpToTarget();
      return;
    }
    const destination = this._target ? 1 : 0;
    if (this._progress === destination) {
      this._stop();
      return;
    }
    // A continuous clock reverses immediately; artwork still uses only the
    // original drawings, without generating or interpolating any new frames.
    if (this._timer !== null) return;
    this._lastTick ??= performance.now();
    this._timer = requestAnimationFrame(time => this._step(time));
  }

  _advance(time) {
    const destination = this._target ? 1 : 0;
    const elapsed = Math.max(0, time - this._lastTick) / (LAST_FRAME * FRAME_DELAY);
    this._lastTick = time;
    this._progress += Math.sign(destination - this._progress) * Math.min(elapsed, Math.abs(destination - this._progress));
    const frame = Math.round(this._progress * LAST_FRAME);
    if (frame !== this._frame) {
      this._frame = frame;
      this._render();
    }
  }

  _step(time) {
    this._timer = null;
    if (!this._connected) return;
    this._advance(time);
    this._animateToTarget();
  }

  _render() {
    if (!this._images) return;
    this._context.clearRect(0, 0, this._canvas.width, this._canvas.height);
    this._context.drawImage(this._images[this._frame], 0, 0);
  }
}

if (!customElements.get("cinema-theme-toggle")) {
  customElements.define("cinema-theme-toggle", CinemaThemeToggle);
}
