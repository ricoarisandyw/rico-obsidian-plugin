/** Property shown first in every folder base. */
export const NAME_COLUMN = "file.name";

/** YAML words that would change type if written without quotes. */
const YAML_WORDS = /^(true|false|yes|no|on|off|null|y|n)$/i;
const PLAIN_KEY = /^[A-Za-z_][\w-]*$/;

/** Always-safe YAML string in single quotes. */
function singleQuoted(text: string): string {
  return `'${text.replace(/'/g, "''")}'`;
}

/** A property name as a YAML list item: plain when that is safe, double-quoted otherwise. */
function yamlKey(key: string): string {
  return PLAIN_KEY.test(key) && !YAML_WORDS.test(key) ? key : JSON.stringify(key);
}

/** Bases filter that keeps only the notes sitting directly in `folderPath`. */
export function folderFilter(folderPath: string): string {
  return `file.folder == ${JSON.stringify(folderPath)}`;
}

/** Prefix of every base this plugin creates, e.g. `_BASE-Books.base`. */
export const BASE_PREFIX = "_BASE-";

/** Name (without extension) of the base for a folder; `Root` stands for the whole vault. */
export function baseName(folderName: string | null): string {
  return `${BASE_PREFIX}${folderName ?? "Root"}`;
}

/** Bases filter that leaves the generated `_BASE-*` files out, so a base never lists itself (numbered copies included). */
export const EXCLUDE_BASE_FILTER = `!file.name.startsWith("${BASE_PREFIX}")`;

/**
 * Content of a native `.base` file for one folder.
 *   - `folderPath` null means the whole vault (no folder filter)
 *   - generated `_BASE-*` files are always left out
 *   - one table view, `file.name` first, then `columns` (no repeats)
 */
export function buildBaseYaml(folderPath: string | null, columns: string[]): string {
  const order = [NAME_COLUMN, ...columns.filter((c, i) => c !== NAME_COLUMN && columns.indexOf(c) === i)];
  const filters = [...(folderPath !== null ? [folderFilter(folderPath)] : []), EXCLUDE_BASE_FILTER];
  const lines: string[] = ["filters:", "  and:", ...filters.map((f) => `    - ${singleQuoted(f)}`)];
  lines.push("views:", "  - type: table", "    name: Table", "    order:");
  for (const key of order) lines.push(`      - ${key === NAME_COLUMN ? key : yamlKey(key)}`);
  return `${lines.join("\n")}\n`;
}

/** First free `<dir><name>.base`, then `<name> 1.base`, `<name> 2.base`, ... */
export function uniqueBasePath(exists: (path: string) => boolean, dir: string, name: string): string {
  let path = `${dir}${name}.base`;
  for (let n = 1; exists(path); n++) path = `${dir}${name} ${n}.base`;
  return path;
}
