/**
 * Where a note's generated canvas lives. Kept free of Obsidian imports so it can be
 * unit tested on its own.
 */

/** Collapse "a//b/" style paths the way Obsidian's normalizePath does. */
function tidy(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/{2,}/g, "/").replace(/^\/+|\/+$/g, "");
}

/** Target path for a note's canvas: beside the note, or in `outputFolder` when set. */
export function canvasPathFor(notePath: string, outputFolder: string): string {
  const base = notePath.replace(/\.md$/i, "");
  const name = base.includes("/") ? base.slice(base.lastIndexOf("/") + 1) : base;
  const folder = tidy(outputFolder);
  return folder ? `${folder}/${name}.canvas` : tidy(base) + ".canvas";
}
