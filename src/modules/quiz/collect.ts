import { App, TFile, TFolder } from "obsidian";
import { isBadQuestion, parseQuestion } from "./parser";
import { QuizFrontmatter, QuizQuestion } from "./types";

/** Everything a collect pass found, valid and broken alike. */
export interface CollectResult {
  questions: QuizQuestion[];
  /** Notes that look like quizzes but could not be parsed. */
  broken: { path: string; error: string }[];
}

/** Does `path` sit inside a folder called `folderName`? */
export function isInQuizFolder(path: string, folderName: string): boolean {
  const needle = `/${folderName.toLowerCase()}/`;
  return `/${path.toLowerCase()}`.includes(needle);
}

/** Is `path` inside `root` (or is `root` itself)? Root "" means the whole vault. */
export function isUnder(path: string, root: string): boolean {
  if (!root) return true;
  return path === root || path.startsWith(`${root}/`);
}

/**
 * Fisher-Yates on a copy. `random` is injectable so tests can pin the order.
 */
export function shuffle<T>(items: T[], random: () => number = Math.random): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Drop the questions you have voted down more than up. */
export function applySkipBad(questions: QuizQuestion[], skipBad: boolean): QuizQuestion[] {
  if (!skipBad) return questions;
  return questions.filter((q) => !isBadQuestion(q.stats));
}

/**
 * Walk the vault for quiz notes. `root` limits it to one folder; "" scans everywhere,
 * in which case only notes inside a `folderName` folder count.
 */
export function collectQuestions(app: App, root: string, folderName: string): CollectResult {
  const questions: QuizQuestion[] = [];
  const broken: { path: string; error: string }[] = [];

  for (const file of app.vault.getMarkdownFiles()) {
    if (!isUnder(file.path, root)) continue;
    // A global run only trusts notes that live in a quiz folder; a scoped run
    // takes whatever is under the folder you picked.
    if (!root && !isInQuizFolder(file.path, folderName)) continue;

    const cache = app.metadataCache.getFileCache(file);
    const fm = cache?.frontmatter as QuizFrontmatter | undefined;
    if (!fm || fm.quiz === undefined) continue;

    const parsed = parseQuestion(file.path, file.basename, fm);
    if ("error" in parsed) {
      broken.push({ path: file.path, error: parsed.error });
      continue;
    }
    questions.push(parsed.question);
  }

  return { questions, broken };
}

/** The folder a "Run this quiz" / "Create quiz group" click should act on. */
export function quizFolderFor(folder: TFolder, folderName: string): string {
  const name = folder.name.toLowerCase();
  if (name === folderName.toLowerCase()) return folder.path;
  return folder.isRoot() ? folderName : `${folder.path}/${folderName}`;
}

/** True when the right-clicked folder is itself a quiz folder. */
export function isQuizFolder(folder: TFolder, folderName: string): boolean {
  return folder.name.toLowerCase() === folderName.toLowerCase();
}

/** Resolve a note path back to its file, for writing stats. */
export function fileForPath(app: App, path: string): TFile | null {
  const file = app.vault.getAbstractFileByPath(path);
  return file instanceof TFile ? file : null;
}
