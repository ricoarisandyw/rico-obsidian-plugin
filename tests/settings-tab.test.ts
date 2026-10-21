import { describe, it, expect, beforeEach } from "vitest";
import { RicoSettingTab } from "../src/settings/settings-tab";
import { App, MockSettingRecord, Setting } from "./mocks/obsidian";
import { DEFAULT_SETTINGS, DEFAULT_VISIBILITY_RULES } from "../src/types";

function build() {
  let saves = 0;
  let applied = 0;
  const app = new App() as any;
  const plugin: any = {
    // The semantic-search model manager reads plugin.app.vault on render.
    app,
    settings: { ...DEFAULT_SETTINGS },
    savePluginSettings: async () => { saves++; },
    applyVisibilityRules: async () => { applied++; },
    hiddenFoldersManager: null,
    syncOverlays: () => {},
    getTocManager: () => null,
    enableTocManager: () => {},
    disableTocManager: () => {},
  };
  const tab = new RicoSettingTab(app, plugin);
  tab.display();
  const records: MockSettingRecord[] = Setting.registry.get(tab.containerEl) ?? [];
  return { plugin, tab, records, counts: () => ({ saves, applied }) };
}

describe("Rico settings tab", () => {
  let ctx: ReturnType<typeof build>;
  beforeEach(() => { ctx = build(); });

  it("groups settings under headings in order", () => {
    const headings = ctx.records.filter((r) => r.heading).map((r) => r.name);
    expect(headings.slice(0, 4)).toEqual([
      "Canvas",
      "Database",
      "Files & Explorer",
      "Tools & Extras",
    ]);
    expect(headings).toContain("Quiz");
  });

  it("has no FlexView setting", () => {
    expect(ctx.records.some((r) => /flex/i.test(r.name) || /flex/i.test(r.desc))).toBe(false);
  });

  it("puts each toggle under its feature group", () => {
    const names: string[] = [];
    let group = "";
    const byGroup: Record<string, string[]> = {};
    for (const r of ctx.records) {
      if (r.heading) { group = r.name; byGroup[group] = []; continue; }
      byGroup[group].push(r.name);
      names.push(r.name);
    }
    expect(byGroup["Canvas"].length).toBeGreaterThanOrEqual(6);
    expect(byGroup["Canvas"]).toContain("Canvas Outline");
    expect(byGroup["Database"]).toEqual(["Folder Base"]);
    expect(byGroup["Files & Explorer"]).toEqual(
      expect.arrayContaining(["File extensions", "Visibility rules"])
    );
    expect(byGroup["Tools & Extras"]).toEqual(
      expect.arrayContaining(["Run in Terminal", "Typing Game", "Floating Table of Contents"])
    );
    expect(byGroup["Quiz"]).toEqual(
      expect.arrayContaining([
        "Quiz builder",
        "Quiz folder name",
        "Seconds per question",
        "Skip questions marked irrelevant",
      ])
    );
  });

  it("saves the quiz folder name, falling back to the default when blanked", async () => {
    const folder = ctx.records.find((r) => r.name === "Quiz folder name")!;
    await folder.texts[0].onChange!("Questions");
    expect(ctx.plugin.settings.quizFolderName).toBe("Questions");
    await folder.texts[0].onChange!("   ");
    expect(ctx.plugin.settings.quizFolderName).toBe("DB Quiz");
  });

  it("keeps the question timer positive", async () => {
    const seconds = ctx.records.find((r) => r.name === "Seconds per question")!;
    await seconds.texts[0].onChange!("45");
    expect(ctx.plugin.settings.quizQuestionSeconds).toBe(45);
    await seconds.texts[0].onChange!("abc");
    expect(ctx.plugin.settings.quizQuestionSeconds).toBe(30);
    await seconds.texts[0].onChange!("0");
    expect(ctx.plugin.settings.quizQuestionSeconds).toBe(30);
  });

  it("saves a toggle change", async () => {
    const drawing = ctx.records.find((r) => r.name === "Freehand Drawing")!;
    await drawing.toggles[0].onChange!(false);
    expect(ctx.plugin.settings.enableCanvasDrawing).toBe(false);
    expect(ctx.counts().saves).toBe(1);
  });

  it("saves the extensions list and the visibility rules", async () => {
    const ext = ctx.records.find((r) => r.name === "File extensions")!;
    await ext.texts[0].onChange!("py, go");
    expect(ctx.plugin.settings.visibleExtensions).toBe("py, go");

    const rules = ctx.records.find((r) => r.name === "Visibility rules")!;
    await rules.areas[0].onChange!(".smart-env/");
    expect(ctx.plugin.settings.visibilityRules).toBe(".smart-env/");
  });

  it("re-applies rules on blur and on reset", async () => {
    const rules = ctx.records.find((r) => r.name === "Visibility rules")!;
    rules.areas[0].inputEl.dispatchEvent(new Event("blur"));
    expect(ctx.counts().applied).toBe(1);

    ctx.plugin.settings.visibilityRules = "custom";
    await rules.buttons[0].onClick!();
    expect(ctx.plugin.settings.visibilityRules).toBe(DEFAULT_VISIBILITY_RULES);
    expect(ctx.counts().applied).toBe(2);
  });
});
