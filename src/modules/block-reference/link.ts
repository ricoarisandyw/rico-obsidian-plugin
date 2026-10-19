import { App, Notice, TFile } from "obsidian";

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** `[[Note#^id]]` in the user's link style, as it would be pasted into another note. */
export function blockLink(app: App, file: TFile | null, id: string): string {
  return file ? app.fileManager.generateMarkdownLink(file, "", `#^${id}`) : `[[#^${id}]]`;
}

export async function copyBlockLink(app: App, file: TFile | null, id: string): Promise<void> {
  const link = blockLink(app, file, id);
  new Notice((await copyToClipboard(link)) ? `Link copied: ${link}` : link);
}
