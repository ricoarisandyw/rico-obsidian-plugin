import { App, TFile } from "obsidian";
import { readCount, readMistakes, today } from "./parser";
import { MistakeReport, QuizFrontmatter } from "./types";

/** What a feedback button or an answer does to the counters. */
export type StatChange =
  | { kind: "answer"; correct: boolean }
  | { kind: "relevant" }
  | { kind: "bad" }
  | { kind: "mistake"; reason: string };

/**
 * Apply a change to a frontmatter object in place. Pure enough to unit-test:
 * the Obsidian call just hands us the object to mutate.
 */
export function applyChange(fm: QuizFrontmatter, change: StatChange, now: Date = new Date()): void {
  switch (change.kind) {
    case "answer": {
      const key = change.correct ? "quiz_correct" : "quiz_wrong";
      fm[key] = readCount(fm[key]) + 1;
      fm.quiz_last_answered = today(now);
      break;
    }
    case "relevant":
      fm.quiz_relevant = readCount(fm.quiz_relevant) + 1;
      break;
    case "bad":
      fm.quiz_bad = readCount(fm.quiz_bad) + 1;
      break;
    case "mistake": {
      const reason = change.reason.trim();
      if (!reason) return;
      const existing: MistakeReport[] = readMistakes(fm.quiz_mistakes);
      existing.push({ date: today(now), reason });
      fm.quiz_mistakes = existing;
      break;
    }
  }
}

/**
 * Write a change into the note's frontmatter. `processFrontMatter` is atomic and
 * leaves the body alone, so a running quiz never clobbers an open editor.
 */
export async function recordChange(app: App, file: TFile, change: StatChange): Promise<void> {
  await app.fileManager.processFrontMatter(file, (fm: QuizFrontmatter) => {
    applyChange(fm, change);
  });
}
