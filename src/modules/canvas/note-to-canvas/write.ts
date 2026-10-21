/**
 * Where the canvas file goes, and the vault work to create or update it.
 */

import { App, Notice, TFile } from "obsidian";
import type { CanvasData } from "../../../shared/utils/canvas";

export { canvasPathFor } from "./paths";

/** Read an existing canvas file, or null when it is absent or unreadable. */
export async function readExistingCanvas(app: App, path: string): Promise<CanvasData | null> {
  const file = app.vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile)) return null;
  try {
    const raw = JSON.parse(await app.vault.read(file)) as Partial<CanvasData>;
    return {
      ...raw,
      nodes: Array.isArray(raw.nodes) ? raw.nodes : [],
      edges: Array.isArray(raw.edges) ? raw.edges : [],
    };
  } catch {
    return null;
  }
}

/** Create the canvas file or overwrite it, making any missing folders on the way. */
export async function writeCanvas(app: App, path: string, data: CanvasData): Promise<TFile | null> {
  const body = JSON.stringify(data, null, 2);
  const existing = app.vault.getAbstractFileByPath(path);

  try {
    if (existing instanceof TFile) {
      await app.vault.modify(existing, body);
      return existing;
    }
    const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
    if (dir && !(await app.vault.adapter.exists(dir))) await app.vault.createFolder(dir);
    return await app.vault.create(path, body);
  } catch (err) {
    new Notice(`Couldn't write the canvas: ${(err as Error).message}`, 8000);
    return null;
  }
}

/** Open the canvas in a new tab. */
export async function openCanvas(app: App, file: TFile): Promise<void> {
  try {
    await app.workspace.getLeaf("tab").openFile(file);
  } catch (err) {
    new Notice(`Created ${file.path}, but it could not be opened: ${(err as Error).message}`, 8000);
  }
}
