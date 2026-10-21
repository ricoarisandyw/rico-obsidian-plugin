import { describe, it, expect } from "vitest";
import { applyChange } from "../src/modules/quiz/stats";
import { readMistakes } from "../src/modules/quiz/parser";
import { QuizFrontmatter } from "../src/modules/quiz/types";

const NOW = new Date(2026, 9, 20); // 2026-10-20

describe("applyChange — answering", () => {
  it("increments correct and stamps the date, leaving wrong alone", () => {
    const fm: QuizFrontmatter = { quiz_correct: 4, quiz_wrong: 2 };
    applyChange(fm, { kind: "answer", correct: true }, NOW);
    expect(fm.quiz_correct).toBe(5);
    expect(fm.quiz_wrong).toBe(2);
    expect(fm.quiz_last_answered).toBe("2026-10-20");
  });

  it("records a wrong answer, which is also how a timeout lands", () => {
    const fm: QuizFrontmatter = {};
    applyChange(fm, { kind: "answer", correct: false }, NOW);
    expect(fm.quiz_wrong).toBe(1);
    expect(fm.quiz_correct).toBeUndefined();
  });

  it("starts missing counters at 0, never NaN", () => {
    const fm: QuizFrontmatter = { quiz_correct: "junk" };
    applyChange(fm, { kind: "answer", correct: true }, NOW);
    expect(fm.quiz_correct).toBe(1);
  });
});

describe("applyChange — votes", () => {
  it("bumps relevant", () => {
    const fm: QuizFrontmatter = { quiz_relevant: 2 };
    applyChange(fm, { kind: "relevant" }, NOW);
    expect(fm.quiz_relevant).toBe(3);
  });

  it("bumps bad from nothing", () => {
    const fm: QuizFrontmatter = {};
    applyChange(fm, { kind: "bad" }, NOW);
    expect(fm.quiz_bad).toBe(1);
  });
});

describe("applyChange — mistake reports", () => {
  it("appends without dropping earlier reports", () => {
    const fm: QuizFrontmatter = {
      quiz_mistakes: [{ date: "2026-10-18", reason: "ambiguous" }],
    };
    applyChange(fm, { kind: "mistake", reason: "citation is wrong" }, NOW);
    const mistakes = readMistakes(fm.quiz_mistakes);
    expect(mistakes).toHaveLength(2);
    expect(mistakes[1]).toEqual({ date: "2026-10-20", reason: "citation is wrong" });
  });

  it("creates the list when there is none", () => {
    const fm: QuizFrontmatter = {};
    applyChange(fm, { kind: "mistake", reason: "wrong answer index" }, NOW);
    expect(readMistakes(fm.quiz_mistakes)).toHaveLength(1);
  });

  it("ignores an empty reason", () => {
    const fm: QuizFrontmatter = {};
    applyChange(fm, { kind: "mistake", reason: "   " }, NOW);
    expect(fm.quiz_mistakes).toBeUndefined();
  });
});
