export class App {
  workspace: any;
  vault: any;

  constructor() {
    this.workspace = {
      activeLeaf: null,
      getLeavesOfType: () => [],
      on: () => ({}),
      onLayoutReady: (cb: () => void) => cb?.(),
    };
    this.vault = {
      getAbstractFileByPath: () => null,
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
