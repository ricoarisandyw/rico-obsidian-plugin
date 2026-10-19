import { App } from "obsidian";
import { render } from "preact";
import { h } from "preact";
import { HammerMenu } from "./HammerMenu";
import {
  Canvas,
  CanvasToolContext,
  getActiveCanvas,
  getSelectedNode,
} from "../../../shared/utils/canvas";

const BUTTON_CLASS = "roc-hammer-button";
const POPUP_CLASS = "roc-hammer-popup";

/** Tracks the currently open popup so we can clean it up. */
let activePopup: HTMLElement | null = null;
let outsideClickHandler: ((ev: MouseEvent) => void) | null = null;
let keydownHandler: ((ev: KeyboardEvent) => void) | null = null;

/** Close + unmount any open hammer popup. */
export function closeHammerPopup(): void {
  if (activePopup) {
    render(null, activePopup);
    activePopup.remove();
    activePopup = null;
  }
  if (outsideClickHandler) {
    document.removeEventListener("mousedown", outsideClickHandler, true);
    outsideClickHandler = null;
  }
  if (keydownHandler) {
    document.removeEventListener("keydown", keydownHandler, true);
    keydownHandler = null;
  }
}

function openHammerPopup(app: App, button: HTMLElement): void {
  // Toggle: clicking the button again closes the popup.
  if (activePopup) {
    closeHammerPopup();
    return;
  }

  const canvas = getActiveCanvas(app);
  if (!canvas) {
    console.warn("[Rich-o] No active canvas found for hammer menu");
    return;
  }

  const ctx: CanvasToolContext = {
    app,
    canvas,
    node: getSelectedNode(canvas),
  };

  const popup = document.createElement("div");
  popup.classList.add(POPUP_CLASS, "menu");
  document.body.appendChild(popup);
  activePopup = popup;

  // Position under the button.
  const rect = button.getBoundingClientRect();
  popup.style.position = "fixed";
  popup.style.top = `${rect.bottom + 4}px`;
  popup.style.left = `${rect.left}px`;
  popup.style.zIndex = "var(--layer-menu, 9999)";

  render(h(HammerMenu, { ctx, onClose: closeHammerPopup }), popup);

  // Keep the popup within the viewport horizontally.
  requestAnimationFrame(() => {
    if (!activePopup) return;
    const popupRect = popup.getBoundingClientRect();
    const overflowX = popupRect.right - window.innerWidth + 8;
    if (overflowX > 0) {
      popup.style.left = `${Math.max(8, rect.left - overflowX)}px`;
    }
  });

  // Dismiss on outside click.
  outsideClickHandler = (ev: MouseEvent) => {
    const target = ev.target as Node;
    if (popup.contains(target) || button.contains(target)) return;
    closeHammerPopup();
  };
  document.addEventListener("mousedown", outsideClickHandler, true);

  // Dismiss on Escape.
  keydownHandler = (ev: KeyboardEvent) => {
    if (ev.key === "Escape") closeHammerPopup();
  };
  document.addEventListener("keydown", keydownHandler, true);
}

/**
 * Inject the 🔨 button into a specific canvas popup menu element.
 * Guards against duplicate injection.
 */
export function injectHammerButtonIntoMenu(app: App, menuEl: HTMLElement): boolean {
  if (!menuEl) return false;
  if (menuEl.querySelector(`.${BUTTON_CLASS}`)) return false; // already injected

  const button = document.createElement("button");
  button.classList.add(BUTTON_CLASS, "clickable-icon");
  button.setAttribute("aria-label", "Canvas tools");
  button.textContent = "🔨";

  button.addEventListener("click", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    openHammerPopup(app, button);
  });

  menuEl.appendChild(button);
  return true;
}

/**
 * Inject into a canvas's popup menu (used by the `canvas:popup-menu` event path).
 */
export function injectHammerButton(app: App, canvas: Canvas): boolean {
  const menuEl = canvas?.menu?.menuEl;
  if (!menuEl) return false;
  return injectHammerButtonIntoMenu(app, menuEl);
}

/** Remove every injected hammer button from the DOM. */
export function removeAllHammerButtons(): void {
  document.querySelectorAll(`.${BUTTON_CLASS}`).forEach((el) => el.remove());
}
