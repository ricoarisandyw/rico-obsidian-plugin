import { App, ItemView, Modal, Notice, Plugin, requestUrl } from "obsidian";

export const OG_NODE_TYPE = "og-link";
export const OG_NODE_SIZE = { width: 360, height: 220 };

export interface OgData {
  url: string;
  title: string;
  description: string;
  image: string | null;
  hostname: string;
}

export async function fetchOgData(url: string): Promise<OgData> {
  let html = "";
  try {
    const res = await Promise.race([
      requestUrl({ url, method: "GET" }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), 10000)
      ),
    ]);
    if (res.status < 200 || res.status >= 400) throw new Error(`HTTP ${res.status}`);
    html = res.text || "";
  } catch (err) {
    throw err;
  }

  const getMeta = (property: string, type = "property") => {
    const r1 = new RegExp(
      `<meta[^>]+${type}=["']${property}["'][^>]+content=["']([^"']+)["']`,
      "i"
    );
    const r2 = new RegExp(
      `<meta[^>]+content=["']([^"']+)["'][^>]+${type}=["']${property}["']`,
      "i"
    );
    return (html.match(r1) || html.match(r2) || [])[1] || null;
  };

  const title =
    getMeta("og:title") ||
    getMeta("twitter:title", "name") ||
    (html.match(/<title[^>]*>([^<]{1,200})<\/title>/i) || [])[1] ||
    url;

  const description =
    getMeta("og:description") ||
    getMeta("twitter:description", "name") ||
    getMeta("description", "name") ||
    "";

  const image =
    getMeta("og:image") ||
    getMeta("twitter:image", "name") ||
    getMeta("twitter:image:src", "name") ||
    null;

  let hostname = url;
  try {
    hostname = new URL(url).hostname;
  } catch {
    /* fallback */
  }

  return {
    url,
    title: title.trim(),
    description: description.trim(),
    image: image ? image.trim() : null,
    hostname,
  };
}

export class UrlInputModal extends Modal {
  private onSubmit: (url: string) => void;
  private inputEl!: HTMLInputElement;
  private errorEl!: HTMLElement;

  constructor(app: App, onSubmit: (url: string) => void) {
    super(app);
    this.onSubmit = onSubmit;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass("og-url-modal");

    contentEl.createEl("h3", {
      text: "Add OG Link Card",
      attr: { style: "margin: 0 0 14px;" },
    });

    contentEl.createEl("span", {
      cls: "og-modal-label",
      text: "Paste a URL to fetch its Open Graph preview:",
    });

    this.inputEl = contentEl.createEl("input", { cls: "og-modal-input" });
    this.inputEl.type = "url";
    this.inputEl.placeholder = "https://";

    this.errorEl = contentEl.createEl("div", { cls: "og-modal-error" });

    const submitBtn = contentEl.createEl("button", {
      cls: "og-modal-submit",
      text: "Fetch & Create Card",
    });
    submitBtn.addEventListener("click", () => this.submit());
    this.inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter") this.submit();
    });

    navigator.clipboard
      .readText()
      .then((text) => {
        if (/^https?:\/\//i.test(text.trim())) this.inputEl.value = text.trim();
      })
      .catch(() => {});

    setTimeout(() => {
      this.inputEl.focus();
      this.inputEl.select();
    }, 60);
  }

  submit(): void {
    const url = this.inputEl.value.trim();
    if (!url) {
      this.errorEl.textContent = "Please enter a URL.";
      return;
    }
    if (!/^https?:\/\//i.test(url)) {
      this.errorEl.textContent = "URL must start with http:// or https://";
      return;
    }
    this.close();
    this.onSubmit(url);
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

export function renderOgCard(node: any): void {
  const nodeEl = node.nodeEl as HTMLElement | undefined;
  if (!nodeEl) return;

  const contentEl = nodeEl.querySelector<HTMLElement>(".canvas-node-content");
  if (!contentEl) return;

  if (contentEl.querySelector(".og-link-card")) return;

  const data = node.getData?.();
  const ogData: OgData | undefined = data?.ogData;
  if (!ogData) return;

  contentEl.innerHTML = "";

  const card = contentEl.createEl("div", { cls: "og-link-card" });

  const imgWrap = card.createEl("div", { cls: "og-link-image-wrap" });
  if (ogData.image) {
    const img = imgWrap.createEl("img", { cls: "og-link-image" });
    img.alt = ogData.title || "";
    img.src = ogData.image;
    img.onerror = () => imgWrap.addClass("og-no-image");
  } else {
    imgWrap.addClass("og-no-image");
  }

  const body = card.createEl("div", { cls: "og-link-body" });
  if (ogData.hostname) {
    body.createEl("div", { cls: "og-link-hostname", text: ogData.hostname });
  }
  body.createEl("div", { cls: "og-link-title", text: ogData.title || ogData.url });
  if (ogData.description) {
    body.createEl("div", { cls: "og-link-description", text: ogData.description });
  }

  const footer = card.createEl("div", { cls: "og-link-footer" });

  const openBtn = footer.createEl("button", {
    cls: "og-link-open-btn",
    text: "Open ↗",
  });
  openBtn.addEventListener("mousedown", (e) => e.stopPropagation());
  openBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    e.preventDefault();
    window.open(ogData.url, "_blank");
  });

  const refreshBtn = footer.createEl("button", {
    cls: "og-link-refresh-btn",
    text: "↺ Refresh",
  });
  refreshBtn.title = "Re-fetch OG metadata";
  refreshBtn.addEventListener("mousedown", (e) => e.stopPropagation());
  refreshBtn.addEventListener("click", async (e) => {
    e.stopPropagation();
    e.preventDefault();
    refreshBtn.textContent = "…";
    refreshBtn.setAttribute("disabled", "true");
    try {
      const fresh = await fetchOgData(ogData.url);
      node.setData({ ...node.getData(), ogData: fresh });
      node.canvas?.requestSave?.();
      contentEl.innerHTML = "";
      renderOgCard(node);
    } catch (err: any) {
      new Notice("Refresh failed: " + err.message);
      refreshBtn.textContent = "↺ Refresh";
      refreshBtn.removeAttribute("disabled");
    }
  });

  contentEl.addEventListener("dblclick", (e) => e.stopPropagation(), { capture: true });

  const customNodeEl = nodeEl as HTMLElement & { _ogObserver?: MutationObserver };
  if (!customNodeEl._ogObserver) {
    customNodeEl._ogObserver = new MutationObserver(() => {
      if (!contentEl.querySelector(".og-link-card")) {
        renderOgCard(node);
      }
    });
    customNodeEl._ogObserver.observe(contentEl, { childList: true });
  }
}

export async function createOgLinkNode(canvas: any, ogData: OgData): Promise<any> {
  let pos = { x: 0, y: 0 };
  try {
    const bbox = canvas.getViewportBBox();
    pos = {
      x: Math.round((bbox.minX + bbox.maxX) / 2 - OG_NODE_SIZE.width / 2),
      y: Math.round((bbox.minY + bbox.maxY) / 2 - OG_NODE_SIZE.height / 2),
    };
  } catch {
    /* fallback */
  }

  const node = canvas.createTextNode({
    pos,
    size: OG_NODE_SIZE,
    text: "",
    focus: false,
  });

  node.setData({
    ...node.getData(),
    customNodeType: OG_NODE_TYPE,
    ogData,
  });

  canvas.requestSave?.();
  requestAnimationFrame(() => renderOgCard(node));
  return node;
}

export class OgLinkCanvasManager {
  private plugin: Plugin;

  constructor(plugin: Plugin) {
    this.plugin = plugin;
  }

  init(): void {
    const { plugin } = this;

    plugin.addCommand({
      id: "add-og-link-card",
      name: "Add OG Link card",
      checkCallback: (checking) => {
        const canvas = this.getActiveCanvas();
        if (!canvas) return false;
        if (!checking) this.showUrlModal(canvas);
        return true;
      },
    });

    plugin.addRibbonIcon("link", "Add OG Link card to canvas", () => {
      const canvas = this.getActiveCanvas();
      if (!canvas) {
        new Notice("Open a canvas file first, then click this button.");
        return;
      }
      this.showUrlModal(canvas);
    });

    plugin.registerEvent(
      plugin.app.workspace.on("canvas:node-menu" as any, (menu: any, node: any) => {
        const data = node.getData?.();
        if (data?.customNodeType === OG_NODE_TYPE) {
          menu.addItem((item: any) =>
            item
              .setTitle("Refresh OG Link card")
              .setIcon("refresh-cw")
              .onClick(() => this.refreshNode(node))
          );
          return;
        }
        menu.addItem((item: any) =>
          item
            .setTitle("Make OG Link card")
            .setIcon("link")
            .onClick(() => {
              const canvas = node.canvas ?? this.getActiveCanvas();
              if (!canvas) return;
              this.showUrlModal(canvas, node);
            })
        );
      })
    );

    plugin.registerEvent(
      plugin.app.workspace.on(
        "advanced-canvas:node-added" as any,
        (_canvas: any, node: any) => {
          if (node.getData?.()?.customNodeType === OG_NODE_TYPE) {
            requestAnimationFrame(() => renderOgCard(node));
          }
        }
      )
    );

    plugin.registerEvent(
      plugin.app.workspace.on(
        "advanced-canvas:node-editing-state-changed" as any,
        (_canvas: any, node: any, editing: boolean) => {
          if (!editing && node.getData?.()?.customNodeType === OG_NODE_TYPE) {
            requestAnimationFrame(() => {
              const contentEl = node.nodeEl?.querySelector(".canvas-node-content");
              if (contentEl) contentEl.innerHTML = "";
              renderOgCard(node);
            });
          }
        }
      )
    );

    plugin.app.workspace.onLayoutReady(() => {
      plugin.app.workspace.getLeavesOfType("canvas").forEach((leaf) => {
        const canvas = (leaf.view as any)?.canvas;
        this.scanCanvasForOgNodes(canvas);
      });
    });

    plugin.registerEvent(
      plugin.app.workspace.on("layout-change", () => {
        plugin.app.workspace.getLeavesOfType("canvas").forEach((leaf) => {
          const canvas = (leaf.view as any)?.canvas;
          if (!canvas || canvas._ogHooked) return;
          canvas._ogHooked = true;
          this.scanCanvasForOgNodes(canvas);
          this.observeCanvasForOgNodes(canvas);
        });
      })
    );
  }

  getActiveCanvas(): any {
    const view = this.plugin.app.workspace.getActiveViewOfType(ItemView);
    if (!view || view.getViewType() !== "canvas") return null;
    return (view as any).canvas ?? null;
  }

  showUrlModal(canvas: any, existingNode: any = null): void {
    new UrlInputModal(this.plugin.app, async (url: string) => {
      const notice = new Notice("Fetching OG metadata…", 0);
      let ogData: OgData;
      try {
        ogData = await fetchOgData(url);
      } catch (err: any) {
        new Notice(
          `Could not fetch OG data (${err.message}). Creating card with URL only.`
        );
        let hostname = url;
        try {
          hostname = new URL(url).hostname;
        } catch {
          /* fallback */
        }
        ogData = { url, title: url, description: "", image: null, hostname };
      } finally {
        notice.hide();
      }

      if (existingNode) {
        existingNode.setData({
          ...existingNode.getData(),
          customNodeType: OG_NODE_TYPE,
          ogData,
        });
        canvas.requestSave?.();
        const contentEl = existingNode.nodeEl?.querySelector(".canvas-node-content");
        if (contentEl) contentEl.innerHTML = "";
        requestAnimationFrame(() => renderOgCard(existingNode));
      } else {
        await createOgLinkNode(canvas, ogData);
      }
    }).open();
  }

  async refreshNode(node: any): Promise<void> {
    const data = node.getData?.();
    if (!data?.ogData?.url) return;
    const notice = new Notice("Refreshing OG metadata…", 0);
    try {
      const fresh = await fetchOgData(data.ogData.url);
      node.setData({ ...data, ogData: fresh });
      node.canvas?.requestSave?.();
      const contentEl = node.nodeEl?.querySelector(".canvas-node-content");
      if (contentEl) contentEl.innerHTML = "";
      renderOgCard(node);
    } catch (err: any) {
      new Notice("Refresh failed: " + err.message);
    } finally {
      notice.hide();
    }
  }

  scanCanvasForOgNodes(canvas: any): void {
    if (!canvas?.nodes) return;
    canvas.nodes.forEach((node: any) => {
      if (node.getData?.()?.customNodeType === OG_NODE_TYPE) {
        requestAnimationFrame(() => renderOgCard(node));
      }
    });
  }

  observeCanvasForOgNodes(canvas: any): void {
    const canvasEl = canvas.canvasEl ?? canvas.wrapperEl;
    if (!canvasEl) return;

    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const added of Array.from(m.addedNodes) as HTMLElement[]) {
          if (added.nodeType !== 1) continue;
          const candidates = added.classList?.contains("canvas-node")
            ? [added]
            : Array.from(added.querySelectorAll?.(".canvas-node") ?? []);

          for (const el of candidates) {
            if (!canvas.nodes) continue;
            canvas.nodes.forEach((node: any) => {
              if (
                node.nodeEl === el &&
                node.getData?.()?.customNodeType === OG_NODE_TYPE
              ) {
                requestAnimationFrame(() => renderOgCard(node));
              }
            });
          }
        }
      }
    });

    observer.observe(canvasEl, { childList: true, subtree: true });
    this.plugin.register(() => observer.disconnect());
  }
}
