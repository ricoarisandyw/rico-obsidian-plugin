import { describe, it, expect } from "vitest";
import { registerRailButton, syncRail, removeAllRails, setRailButtonActive } from "../src/modules/canvas/tool-rail";

describe("Canvas Tool Rail", () => {
  it("renders every registered canvas button in order, once per rail", () => {
    removeAllRails();
    const w = document.createElement("div");
    w.className = "canvas-wrapper";
    document.body.appendChild(w);

    registerRailButton({ id: "layers", icon: "layers", label: "Canvas Layers", order: 10 });
    registerRailButton({ id: "drawing", icon: "palette", label: "Drawing Mode", order: 20 });
    registerRailButton({ id: "icon-drop", icon: "sparkles", label: "Drag to add icon", order: 30, draggable: true });
    registerRailButton({ id: "roadmap", icon: "map", label: "Drag to add roadmap node", order: 40, draggable: true });
    syncRail(w);

    const btns = Array.from(w.querySelectorAll(".rico-canvas-rail-btn"));
    const order = btns.map((b) => b.getAttribute("aria-label"));
    expect(order).toEqual([
      "Canvas Layers",
      "Drawing Mode",
      "Drag to add icon",
      "Drag to add roadmap node",
    ]);

    // Drag sources keep their draggable attribute.
    expect(w.querySelector(".rico-canvas-rail-btn-roadmap")?.getAttribute("draggable")).toBe("true");
    expect(w.querySelector(".rico-canvas-rail-btn-layers")?.getAttribute("draggable")).toBeNull();

    // Active state toggles.
    setRailButtonActive("drawing", true);
    expect(w.querySelector(".rico-canvas-rail-btn-drawing")?.classList.contains("is-active")).toBe(true);

    // One rail only, even after repeated syncs.
    syncRail(w);
    syncRail(w);
    expect(w.querySelectorAll(".rico-canvas-rail").length).toBe(1);
    expect(w.querySelectorAll(".rico-canvas-rail-btn").length).toBe(4);
  });

  it("does not mutate the DOM when re-synced with unchanged specs", async () => {
    // The canvas modules call these from a MutationObserver on document.body,
    // so a redundant DOM write here feeds back into the observer and hangs
    // Obsidian on load. A settled rail must produce zero mutations.
    removeAllRails();
    const w = document.createElement("div");
    w.className = "canvas-wrapper";
    document.body.appendChild(w);

    const spec = { id: "layers", icon: "layers", label: "Canvas Layers", order: 10 };
    registerRailButton(spec);
    syncRail(w);

    let mutations = 0;
    const obs = new MutationObserver((records) => {
      mutations += records.length;
    });
    obs.observe(w, { childList: true, subtree: true, attributes: true });

    // Exactly what the observer-driven sync loop does on every tick.
    for (let i = 0; i < 5; i++) {
      registerRailButton({ ...spec, onClick: () => {} });
      syncRail(w);
      setRailButtonActive("layers", false);
    }

    await new Promise((r) => setTimeout(r, 0));
    obs.disconnect();
    expect(mutations).toBe(0);
  });
});
