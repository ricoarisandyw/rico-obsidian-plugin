import { DATA_FOLDER } from "../semantic-search/store";
import { isExcluded, parseExcludeFilter } from "../semantic-search/search";
import type { RicoPluginSettings } from "../../types";

/**
 * Which notes the cluster map leaves out.
 *
 * The map covers the whole vault, so it has to skip the places this plugin
 * writes to or reserves for itself: generated canvases, quiz notes, the model
 * and index folders, and anything the user already excluded from semantic
 * search. Using the same exclude filter as search keeps the two features
 * agreeing about what "the vault" means.
 *
 * No Obsidian imports beyond types, so it can be tested without a vault.
 */

type ExcludeSettings = Pick<
  RicoPluginSettings,
  | "semanticSearchExcludeFilter"
  | "semanticClusterExclude"
  | "noteToCanvasFolder"
  | "quizFolderName"
  | "semanticSearchModelPath"
>;

/** Strip surrounding slashes and spaces, so ".models/" and "/.models" match alike. */
function cleanFolder(raw: string | undefined): string {
  return (raw ?? "").trim().replace(/^\/+|\/+$/g, "");
}

/** True when `path` is the folder itself or anywhere beneath it. */
export function isUnderFolder(path: string, folder: string): boolean {
  const clean = cleanFolder(folder);
  if (!clean) return false;
  return path === clean || path.startsWith(`${clean}/`);
}

/** True when a folder with this name sits anywhere in the path, at any depth. */
export function hasFolderNamed(path: string, name: string): boolean {
  const clean = cleanFolder(name);
  if (!clean) return false;
  // Padding with a slash on both sides means "DB Quiz" cannot match "My DB Quiz notes".
  return `/${path}`.includes(`/${clean}/`);
}

/** Folders anchored at the vault root: internal ones and this plugin's own. */
export function rootFolders(settings: ExcludeSettings): string[] {
  return [
    ".obsidian",
    ".trash",
    DATA_FOLDER,
    cleanFolder(settings.semanticSearchModelPath),
    cleanFolder(settings.noteToCanvasFolder),
  ].filter(Boolean);
}

/**
 * A predicate that says whether a note path is left out of the map.
 *
 * Built once per run rather than parsing the settings for every note.
 */
export function buildExcluder(settings: ExcludeSettings): (path: string) => boolean {
  const roots = rootFolders(settings);
  const quiz = cleanFolder(settings.quizFolderName);
  // Both user filters are plain path fragments, exactly like semantic search's.
  const fragments = [
    ...parseExcludeFilter(settings.semanticSearchExcludeFilter),
    ...parseExcludeFilter(settings.semanticClusterExclude),
  ];

  return (path) => {
    if (roots.some((folder) => isUnderFolder(path, folder))) return true;
    if (quiz && hasFolderNamed(path, quiz)) return true;
    return fragments.length > 0 && isExcluded(path, fragments);
  };
}

/** Body shorter than this, after the title and frontmatter, counts as an empty note. */
const EMPTY_BODY_CHARS = 20;

/**
 * True for a note that holds little beyond its title: a draft nobody filled in.
 *
 * `text` is the indexed snippet, which starts with the note's title. When the
 * index kept no snippet there is nothing to judge by, so the note is not called
 * empty.
 */
export function isEmptyNote(text: string | undefined): boolean {
  if (!text?.trim()) return false;
  const body = text
    .replace(/^[^\n]*\n?/, "")
    .replace(/^\s*---\r?\n[\s\S]*?\r?\n---\s*(\r?\n|$)/, "")
    .trim();
  return body.length < EMPTY_BODY_CHARS;
}
