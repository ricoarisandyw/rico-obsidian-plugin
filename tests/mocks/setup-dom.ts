/**
 * Polyfills Obsidian's DOM extensions on HTMLElement and mocks browser APIs
 * (ResizeObserver, CanvasRenderingContext2D, DOMMatrix) for testing outside Obsidian.
 */

export function setupDOMEnvironment(): void {
  if (typeof window === "undefined") {
    return;
  }

  // Obsidian HTMLElement extensions
  const proto = (window.HTMLElement || Object).prototype as any;

  if (!proto.createEl) {
    proto.createEl = function (tag: string, o?: any) {
      const el = document.createElement(tag);
      if (o) {
        if (o.cls) {
          if (Array.isArray(o.cls)) el.classList.add(...o.cls);
          else el.className = o.cls;
        }
        if (o.text !== undefined) el.textContent = o.text;
        if (o.title !== undefined) el.title = o.title;
        if (o.attr) {
          for (const [k, v] of Object.entries(o.attr)) {
            el.setAttribute(k, String(v));
          }
        }
      }
      this.appendChild(el);
      return el;
    };
  }

  if (!proto.createDiv) {
    proto.createDiv = function (o?: any) {
      return this.createEl("div", o);
    };
  }

  if (!proto.createSpan) {
    proto.createSpan = function (o?: any) {
      return this.createEl("span", o);
    };
  }

  if (!proto.addClass) {
    proto.addClass = function (...cls: string[]) {
      this.classList.add(...cls);
    };
  }

  if (!proto.removeClass) {
    proto.removeClass = function (...cls: string[]) {
      this.classList.remove(...cls);
    };
  }

  if (!proto.toggleClass) {
    proto.toggleClass = function (cls: string, val: boolean) {
      this.classList.toggle(cls, val);
    };
  }

  if (!proto.empty) {
    proto.empty = function () {
      while (this.firstChild) {
        this.removeChild(this.firstChild);
      }
    };
  }

  // Mock CanvasRenderingContext2D
  if (window.HTMLCanvasElement && !window.HTMLCanvasElement.prototype.getContext) {
    window.HTMLCanvasElement.prototype.getContext = function () {
      return createMockCanvasContext();
    } as any;
  } else if (window.HTMLCanvasElement) {
    const origGetContext = window.HTMLCanvasElement.prototype.getContext;
    window.HTMLCanvasElement.prototype.getContext = function (type: string, ...args: any[]) {
      if (type === "2d") {
        return createMockCanvasContext();
      }
      return origGetContext ? origGetContext.call(this, type, ...args) : null;
    } as any;
  }

  // Mock ResizeObserver
  if (!window.ResizeObserver) {
    (window as any).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }

  // Mock DOMMatrix
  if (!window.DOMMatrix) {
    (window as any).DOMMatrix = class {
      a = 1;
      b = 0;
      c = 0;
      d = 1;
      e = 0;
      f = 0;
      constructor(transform?: string) {
        if (transform && transform.includes("matrix")) {
          const match = transform.match(/matrix\(([^)]+)\)/);
          if (match) {
            const parts = match[1].split(",").map((n) => parseFloat(n.trim()));
            this.a = parts[0] ?? 1;
            this.b = parts[1] ?? 0;
            this.c = parts[2] ?? 0;
            this.d = parts[3] ?? 1;
            this.e = parts[4] ?? 0;
            this.f = parts[5] ?? 0;
          }
        }
      }
    };
  }
}

export function createMockCanvasContext(): any {
  const ctx: any = {
    save: () => {},
    restore: () => {},
    scale: () => {},
    translate: () => {},
    transform: () => {},
    resetTransform: () => {},
    clearRect: () => {},
    fillRect: () => {},
    strokeRect: () => {},
    beginPath: () => {},
    closePath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    rect: () => {},
    roundRect: () => {},
    clip: () => {},
    quadraticCurveTo: () => {},
    bezierCurveTo: () => {},
    ellipse: () => {},
    stroke: () => {},
    fill: () => {},
    arc: () => {},
    arcTo: () => {},
    fillText: () => {},
    strokeText: () => {},
    drawImage: () => {},
    measureText: () => ({ width: 100 }),
    setLineDash: () => {},
    getLineDash: () => [],
    strokeStyle: "#000",
    fillStyle: "#000",
    lineWidth: 1,
    lineCap: "round",
    lineJoin: "round",
    font: "10px sans-serif",
    textAlign: "left",
    textBaseline: "top",
  };

  return new Proxy(ctx, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (typeof prop === "string") {
        target[prop] = () => {};
        return target[prop];
      }
      return undefined;
    },
  });
}
