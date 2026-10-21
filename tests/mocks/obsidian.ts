/** Vault file stand-ins. Production code narrows with `instanceof TFile`,
 * so tests construct these rather than plain objects. */
export class TAbstractFile {
  path: string;
  name: string;

  constructor(path = "") {
    this.path = path;
    this.name = path.split("/").pop() ?? path;
  }
}

export class TFile extends TAbstractFile {
  extension: string;
  basename: string;

  constructor(path = "") {
    super(path);
    const dot = this.name.lastIndexOf(".");
    this.extension = dot > 0 ? this.name.slice(dot + 1) : "";
    this.basename = dot > 0 ? this.name.slice(0, dot) : this.name;
  }
}

export class TFolder extends TAbstractFile {
  children: TAbstractFile[] = [];
}

/** Minimal stand-in for Obsidian's Keymap scope, enough to assert priority. */
export class Scope {
  handlers: Array<{ mods: string[]; key: string; fn: () => boolean | void }> = [];

  register(mods: string[], key: string, fn: () => boolean | void): any {
    const h = { mods, key, fn };
    // Obsidian prepends, so the newest registration wins.
    this.handlers.unshift(h);
    return h;
  }

  unregister(handle: any): void {
    const i = this.handlers.indexOf(handle);
    if (i >= 0) this.handlers.splice(i, 1);
  }

  /** Dispatch like Obsidian does: first handler returning false consumes it. */
  dispatch(mods: string[], key: string): boolean {
    for (const h of this.handlers) {
      const sameMods =
        h.mods.length === mods.length && h.mods.every((m) => mods.includes(m));
      if (sameMods && h.key === key) {
        return h.fn() !== false;
      }
    }
    return true;
  }
}

export class App {
  workspace: any;
  vault: any;
  metadataCache: any;
  scope: Scope = new Scope();

  constructor() {
    this.workspace = {
      activeLeaf: null,
      getLeavesOfType: () => [],
      on: () => ({}),
      onLayoutReady: (cb: () => void) => cb?.(),
    };
    this.vault = {
      getAbstractFileByPath: () => null,
      getMarkdownFiles: () => [],
      // The model manager probes the vault on render; an empty adapter keeps it quiet.
      adapter: {
        exists: async () => false,
        list: async () => ({ files: [], folders: [] }),
        stat: async () => null,
        read: async () => "",
      },
    };
  }
}

export class Plugin {
  app: App;
  data: Record<string, any> = {};

  constructor(app?: App) {
    this.app = app ?? new App();
  }

  async loadData(): Promise<any> {
    return this.data;
  }

  async saveData(val: any): Promise<void> {
    this.data = val;
  }

  registerEvent(_ref: any): void {}
  registerInterval(_id: any): void {}
  addCommand(_cmd: any): void {}
  addRibbonIcon(_icon: string, _title: string, _cb: any): any {}
}

export class WorkspaceLeaf {
  id = "test-leaf-1";
  view: any;

  constructor(view?: any) {
    this.view = view ?? {
      containerEl: document.createElement("div"),
      canvas: null,
      file: { path: "test-canvas.canvas" },
    };
  }
}

export function setIcon(el: HTMLElement, iconId: string): void {
  el.setAttribute("data-icon", iconId);
  const svg = document.createElement("span");
  svg.className = "svg-icon";
  svg.setAttribute("data-icon", iconId);
  el.appendChild(svg);
}

export function setTooltip(el: HTMLElement, tooltip: string): void {
  el.setAttribute("data-tooltip", tooltip);
}

/** Enough of Modal for subclasses to build their DOM and be opened in tests. */
export class Modal {
  app: App;
  contentEl: HTMLElement;
  titleEl: HTMLElement;
  modalEl: HTMLElement;
  opened = false;

  constructor(app: App) {
    this.app = app;
    this.modalEl = document.createElement("div");
    this.titleEl = document.createElement("div");
    this.contentEl = document.createElement("div");
    this.modalEl.appendChild(this.titleEl);
    this.modalEl.appendChild(this.contentEl);
  }

  open(): void {
    this.opened = true;
    this.onOpen?.();
  }

  close(): void {
    this.opened = false;
    this.onClose?.();
  }

  onOpen(): void {}
  onClose(): void {}
}

export class Notice {
  message: string;
  constructor(message: string) {
    this.message = message;
  }
}

export const Platform = {
  isDesktop: true,
  isDesktopApp: true,
  isMobile: false,
  isMacOS: true,
  isWin: false,
  isLinux: false,
  isIosApp: false,
  isAndroidApp: false,
};

/** Minimal Setting/PluginSettingTab mocks that record what the settings page builds. */
export interface MockSettingRecord {
  name: string;
  desc: string;
  heading: boolean;
  toggles: Array<{ value: boolean; onChange?: (v: boolean) => any }>;
  texts: Array<{ value: string; onChange?: (v: string) => any; inputEl: HTMLInputElement }>;
  areas: Array<{ value: string; onChange?: (v: string) => any; inputEl: HTMLTextAreaElement }>;
  buttons: Array<{ onClick?: () => any }>;
  dropdowns: Array<{ value: string; options: Record<string, string>; onChange?: (v: string) => any }>;
  sliders: Array<{ value: number; onChange?: (v: number) => any }>;
}

export class Setting {
  static registry = new WeakMap<HTMLElement, MockSettingRecord[]>();
  record: MockSettingRecord = {
    name: "",
    desc: "",
    heading: false,
    toggles: [],
    texts: [],
    areas: [],
    buttons: [],
    dropdowns: [],
    sliders: [],
  };

  constructor(containerEl: HTMLElement) {
    const list = Setting.registry.get(containerEl) ?? [];
    list.push(this.record);
    Setting.registry.set(containerEl, list);
  }

  setName(n: string) { this.record.name = n; return this; }
  setDesc(d: string) { this.record.desc = d; return this; }
  setHeading() { this.record.heading = true; return this; }

  addToggle(cb: (c: any) => any) {
    const state: any = { value: false };
    const comp = {
      setValue: (v: boolean) => { state.value = v; return comp; },
      onChange: (fn: (v: boolean) => any) => { state.onChange = fn; return comp; },
    };
    cb(comp);
    this.record.toggles.push(state);
    return this;
  }

  addText(cb: (c: any) => any) {
    const state: any = { value: "", inputEl: document.createElement("input") };
    const comp: any = {
      inputEl: state.inputEl,
      setPlaceholder: () => comp,
      setValue: (v: string) => { state.value = v; return comp; },
      onChange: (fn: (v: string) => any) => { state.onChange = fn; return comp; },
    };
    cb(comp);
    this.record.texts.push(state);
    return this;
  }

  addTextArea(cb: (c: any) => any) {
    const state: any = { value: "", inputEl: document.createElement("textarea") };
    const comp: any = {
      inputEl: state.inputEl,
      setPlaceholder: () => comp,
      setValue: (v: string) => { state.value = v; return comp; },
      onChange: (fn: (v: string) => any) => { state.onChange = fn; return comp; },
    };
    cb(comp);
    this.record.areas.push(state);
    return this;
  }

  addDropdown(cb: (c: any) => any) {
    const state: any = { value: "", options: {} };
    const comp: any = {
      addOption: (k: string, v: string) => { state.options[k] = v; return comp; },
      addOptions: (opts: Record<string, string>) => { Object.assign(state.options, opts); return comp; },
      setValue: (v: string) => { state.value = v; return comp; },
      onChange: (fn: (v: string) => any) => { state.onChange = fn; return comp; },
    };
    cb(comp);
    this.record.dropdowns.push(state);
    return this;
  }

  addSlider(cb: (c: any) => any) {
    const state: any = { value: 0 };
    const comp: any = {
      setLimits: () => comp,
      setDynamicTooltip: () => comp,
      setValue: (v: number) => { state.value = v; return comp; },
      onChange: (fn: (v: number) => any) => { state.onChange = fn; return comp; },
    };
    cb(comp);
    this.record.sliders.push(state);
    return this;
  }

  addButton(cb: (c: any) => any) {
    const state: any = {};
    const comp: any = {
      setButtonText: () => comp,
      setCta: () => comp,
      setWarning: () => comp,
      setDisabled: () => comp,
      setIcon: () => comp,
      setTooltip: () => comp,
      onClick: (fn: () => any) => { state.onClick = fn; return comp; },
    };
    cb(comp);
    this.record.buttons.push(state);
    return this;
  }

  addExtraButton(cb: (c: any) => any) {
    const state: any = {};
    const comp: any = {
      setIcon: () => comp,
      setTooltip: () => comp,
      onClick: (fn: () => any) => { state.onClick = fn; return comp; },
    };
    cb(comp);
    this.record.buttons.push(state);
    return this;
  }
}

export class PluginSettingTab {
  app: App;
  plugin: any;
  containerEl: HTMLElement;

  constructor(app: App, plugin: any) {
    this.app = app;
    this.plugin = plugin;
    this.containerEl = document.createElement("div");
  }
}

/** Tracks listeners the way Component does, so tests can assert cleanup. */
export class Component {
  private listeners: Array<{ el: any; type: string; cb: any }> = [];

  registerDomEvent(el: any, type: string, cb: any): void {
    el.addEventListener(type, cb);
    this.listeners.push({ el, type, cb });
  }

  unload(): void {
    for (const { el, type, cb } of this.listeners) el.removeEventListener(type, cb);
    this.listeners = [];
  }
}

export class MarkdownRenderChild extends Component {
  containerEl: any;
  constructor(containerEl: any) {
    super();
    this.containerEl = containerEl;
  }
}

export class Menu {
  items: any[] = [];
  addItem(cb: (item: any) => void): this {
    const item: any = {
      setTitle: () => item,
      setIcon: () => item,
      onClick: (fn: any) => {
        item.click = fn;
        return item;
      },
    };
    cb(item);
    this.items.push(item);
    return this;
  }
  showAtMouseEvent(): void {}
}
