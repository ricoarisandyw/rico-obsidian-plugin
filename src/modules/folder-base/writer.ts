import { App, TFile } from "obsidian";

const SELF_WRITE_WINDOW_MS = 2000;

export class FrontmatterWriter {
  private selfWrites = new Map<string, number>();

  constructor(private app: App) {}

  /** Returns true (and consumes the marker) if this path was just written by us. */
  consumeSelfWrite(path: string): boolean {
    const at = this.selfWrites.get(path);
    if (at === undefined) return false;
    this.selfWrites.delete(path);
    return Date.now() - at < SELF_WRITE_WINDOW_MS;
  }

  async writeCell(file: TFile, key: string, value: unknown): Promise<void> {
    this.selfWrites.set(file.path, Date.now());
    await this.app.fileManager.processFrontMatter(file, (fm) => {
      if (value === undefined) delete fm[key];
      else fm[key] = value;
    });
  }
}
