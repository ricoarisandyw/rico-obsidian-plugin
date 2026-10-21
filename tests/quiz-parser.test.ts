import { describe, it, expect } from "vitest";
import {
  fixReasons,
  flagQuestions,
  isBadQuestion,
  isQuizNote,
  parseQuestion,
  readCount,
  readMistakes,
  readStats,
  today,
} from "../src/modules/quiz/parser";
import { QuizFrontmatter, QuizQuestion } from "../src/modules/quiz/types";

const VALID: QuizFrontmatter = {
  quiz: true,
  question: "What does the SOLID 'L' stand for?",
  options: [
    "Liskov Substitution Principle",
    "Layered Separation Principle",
    "Loose Coupling Principle",
    "Lazy Initialization Principle",
  ],
  answer: 0,
  explanation: "Subtypes must be substitutable for their base types.",
  reference: "Martin, Agile Software Development (2002), ch. 10",
};

const parse = (fm: QuizFrontmatter) => parseQuestion("DB Quiz/a.md", "a", fm);

describe("readCount", () => {
  it("reads numbers, strings and junk", () => {
    expect(readCount(3)).toBe(3);
    expect(readCount("5")).toBe(5);
    expect(readCount(undefined)).toBe(0);
    expect(readCount("nonsense")).toBe(0);
    expect(readCount(-2)).toBe(0);
  });
});

describe("readMistakes", () => {
  it("accepts objects and bare strings, dropping empties", () => {
    const out = readMistakes([
      { date: "2026-10-18", reason: "Option C is also right" },
      "no citation",
      { reason: "   " },
      42,
    ]);
    expect(out).toEqual([
      { date: "2026-10-18", reason: "Option C is also right" },
      { date: "", reason: "no citation" },
    ]);
  });

  it("returns empty for a non-array", () => {
    expect(readMistakes(undefined)).toEqual([]);
    expect(readMistakes("oops")).toEqual([]);
  });
});

describe("readStats", () => {
  it("defaults every counter to 0, never NaN", () => {
    const stats = readStats({});
    expect(stats).toEqual({
      relevant: 0,
      bad: 0,
      correct: 0,
      wrong: 0,
      lastAnswered: null,
      mistakes: [],
    });
  });

  it("reads a Date for quiz_last_answered", () => {
    const stats = readStats({ quiz_last_answered: new Date("2026-10-20T00:00:00Z") });
    expect(stats.lastAnswered).toBe("2026-10-20");
  });
});

describe("isQuizNote", () => {
  it("accepts true, \"true\" and 1", () => {
    expect(isQuizNote({ quiz: true })).toBe(true);
    expect(isQuizNote({ quiz: "true" })).toBe(true);
    expect(isQuizNote({ quiz: 1 })).toBe(true);
  });

  it("rejects everything else", () => {
    expect(isQuizNote({})).toBe(false);
    expect(isQuizNote({ quiz: false })).toBe(false);
    expect(isQuizNote(null)).toBe(false);
  });
});

describe("parseQuestion", () => {
  it("parses a valid note", () => {
    const result = parse(VALID);
    expect("question" in result).toBe(true);
    if (!("question" in result)) return;
    expect(result.question.options).toHaveLength(4);
    expect(result.question.answer).toBe(0);
    expect(result.question.reference).toContain("Martin");
    expect(result.question.stats.correct).toBe(0);
  });

  it("rejects a note without quiz: true", () => {
    const result = parse({ ...VALID, quiz: undefined });
    expect(result).toEqual({ error: expect.stringContaining("not a quiz note") });
  });

  it("rejects a missing question", () => {
    const result = parse({ ...VALID, question: "   " });
    expect(result).toEqual({ error: "missing `question`" });
  });

  it("rejects the wrong number of options", () => {
    const result = parse({ ...VALID, options: ["a", "b", "c"] });
    expect("error" in result).toBe(true);
  });

  it("rejects an empty option", () => {
    const result = parse({ ...VALID, options: ["a", "", "c", "d"] });
    expect("error" in result).toBe(true);
  });

  it("rejects an out-of-range answer", () => {
    expect("error" in parse({ ...VALID, answer: 4 })).toBe(true);
    expect("error" in parse({ ...VALID, answer: -1 })).toBe(true);
    expect("error" in parse({ ...VALID, answer: "nope" })).toBe(true);
  });

  it("accepts a numeric string answer", () => {
    const result = parse({ ...VALID, answer: "2" });
    expect("question" in result && result.question.answer).toBe(2);
  });

  it("tolerates a missing explanation and reference", () => {
    const result = parse({ ...VALID, explanation: undefined, reference: undefined });
    expect("question" in result && result.question.explanation).toBe("");
  });
});

describe("isBadQuestion", () => {
  it("is bad only when downvotes beat upvotes", () => {
    expect(isBadQuestion(readStats({ quiz_bad: 3, quiz_relevant: 1 }))).toBe(true);
    expect(isBadQuestion(readStats({ quiz_bad: 1, quiz_relevant: 1 }))).toBe(false);
    expect(isBadQuestion(readStats({}))).toBe(false);
  });
});

const makeQuestion = (fm: QuizFrontmatter, path = "DB Quiz/x.md"): QuizQuestion => {
  const result = parseQuestion(path, "x", { ...VALID, ...fm });
  if (!("question" in result)) throw new Error("fixture should parse");
  return result.question;
};

describe("fixReasons / flagQuestions", () => {
  it("flags a question with a mistake report", () => {
    const q = makeQuestion({ quiz_mistakes: [{ date: "2026-10-18", reason: "ambiguous" }] });
    expect(fixReasons(q)).toHaveLength(1);
  });

  it("flags a question voted down more than up", () => {
    const q = makeQuestion({ quiz_bad: 4, quiz_relevant: 1 });
    expect(fixReasons(q)[0]).toContain("irrelevant");
  });

  it("leaves a healthy question alone", () => {
    expect(fixReasons(makeQuestion({ quiz_relevant: 5 }))).toEqual([]);
    expect(flagQuestions([makeQuestion({ quiz_relevant: 5 })])).toEqual([]);
  });

  it("carries the mistakes through to the flag", () => {
    const q = makeQuestion({ quiz_bad: 2, quiz_mistakes: ["wrong citation"] });
    const [flag] = flagQuestions([q]);
    expect(flag.reasons).toHaveLength(2);
    expect(flag.mistakes[0].reason).toBe("wrong citation");
  });
});

describe("today", () => {
  it("formats as YYYY-MM-DD", () => {
    expect(today(new Date(2026, 0, 5))).toBe("2026-01-05");
  });
});
