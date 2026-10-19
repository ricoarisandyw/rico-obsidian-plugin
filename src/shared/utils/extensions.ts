/** Turn "html, .JS; *.ts" style user input into a clean, de-duplicated extension list. */
export function parseExtensions(text: string): string[] {
  const seen = new Set<string>();
  for (const token of (text ?? "").split(/[\s,;]+/)) {
    const ext = token.trim().replace(/^\*?\./, "").toLowerCase();
    if (ext && /^[a-z0-9_+-]+$/.test(ext)) seen.add(ext);
  }
  return [...seen];
}
