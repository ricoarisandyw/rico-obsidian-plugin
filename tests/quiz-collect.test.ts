import { describe, it, expect } from "vitest";
import { App, TFile, TFolder } from "obsidian";
import {
  applySkipBad,
  collectQuestions,
  isInQuizFolder,
  isQuizFolder,
  isUnder,
  quizFolderFor,
  shuffle,
} from "../src/modules/quiz/collect";
import { parseQuestion } from "../src/modules/quiz/parser";
import { QuizFrontmatter, QuizQuestion } from "../src/modules/quiz/types";

const FOLDER = "DB Quiz";

const question = (overrides: QuizFrontmatter = {}): QuizFrontmatter => ({
  quiz: true,
  question: "Q?",
  options: ["a", "b", "c", "d"],
  answer: 1,
  explanation: "because",
  reference: "somewhere",
  ...overrides,
});

/** A vault of `path -> frontmatter`, wired into the two APIs collect uses. */
function fakeApp(notes: Record<string, QuizFrontmatter | null>): App {
  const files = Object.keys(notes).map((path) => new TFile(path));
  const app = new App() as any;
  app.vault.getMarkdownFiles = () => files;
  app.metadataCache = {
    getFileCache: (file: TFile) => {
      const fm = notes[file.path];
      return fm ? { frontmatter: fm } : {};
    },
  };
  return app as App;
}

const asQuestion = (fm: QuizFrontmatter, path = "DB Quiz/q.md"): QuizQuestion => {
  const parsed = parseQuestion(path, "q", fm);
  if (!("question" in parsed)) throw new Error("fixture should parse");
  return parsed.question;
};

describe("isInQuizFolder", () => {
  it("matches a quiz folder at any depth, case-insensitively", () => {
    expect(isInQuizFolder("Notes/DB Quiz/a.md", FOLDER)).toBe(true);
    expect(isInQuizFolder("db quiz/a.md", FOLDER)).toBe(true);
    expect(isInQuizFolder("Notes/DB Quiz/Deep/a.md", FOLDER)).toBe(true);
  });

  it("does not match a note merely named after it", () => {
    expect(isInQuizFolder("Notes/DB Quiz.md", FOLDER)).toBe(false);
    expect(isInQuizFolder("Notes/a.md", FOLDER)).toBe(false);
  });
});

describe("isUnder", () => {
  it("treats an empty root as the whole vault", () => {
    expect(isUnder("anything/a.md", "")).toBe(true);
  });

  it("matches only real descendants", () => {
    expect(isUnder("Notes/DB Quiz/a.md", "Notes/DB Quiz")).toBe(true);
    expect(isUnder("Notes/DB Quizzes/a.md", "Notes/DB Quiz")).toBe(false);
  });
});

describe("collectQuestions", () => {
  it("collects from one folder and skips non-quiz notes", () => {
    const app = fakeApp({
      "Notes/DB Quiz/a.md": question(),
      "Notes/DB Quiz/b.md": question({ question: "Second?" }),
      "Notes/DB Quiz/readme.md": null,
      "Notes/elsewhere.md": question(),
    });
    const result = collectQuestions(app, "Notes/DB Quiz", FOLDER);
    expect(result.questions).toHaveLength(2);
    expect(result.broken).toHaveLength(0);
  });

  it("finds every quiz folder in the vault on a global run", () => {
    const app = fakeApp({
      "A/DB Quiz/a.md": question(),
      "B/Deep/DB Quiz/b.md": question(),
      "C/notes.md": question(),
    });
    const result = collectQuestions(app, "", FOLDER);
    expect(result.questions.map((q) => q.path).sort()).toEqual([
      "A/DB Quiz/a.md",
      "B/Deep/DB Quiz/b.md",
    ]);
  });

  it("reports malformed quiz notes instead of dropping them silently", () => {
    const app = fakeApp({
      "DB Quiz/good.md": question(),
      "DB Quiz/bad.md": question({ options: ["only", "two"] }),
    });
    const result = collectQuestions(app, "DB Quiz", FOLDER);
    expect(result.questions).toHaveLength(1);
    expect(result.broken).toEqual([{ path: "DB Quiz/bad.md", error: expect.any(String) }]);
  });
});

describe("applySkipBad", () => {
  it("drops questions voted down more than up", () => {
    const keep = asQuestion(question({ quiz_relevant: 2, quiz_bad: 1 }), "DB Quiz/keep.md");
    const drop = asQuestion(question({ quiz_relevant: 0, quiz_bad: 3 }), "DB Quiz/drop.md");
    expect(applySkipBad([keep, drop], true).map((q) => q.path)).toEqual(["DB Quiz/keep.md"]);
  });

  it("keeps everything when the setting is off", () => {
    const drop = asQuestion(question({ quiz_bad: 3 }), "DB Quiz/drop.md");
    expect(applySkipBad([drop], false)).toHaveLength(1);
  });
});

describe("shuffle", () => {
  it("keeps the same set, just reordered", () => {
    const items = [1, 2, 3, 4, 5];
    const out = shuffle(items, () => 0.5);
    expect(out.slice().sort()).toEqual(items);
    expect(out).not.toBe(items);
    expect(items).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("quizFolderFor / isQuizFolder", () => {
  it("nests a quiz folder inside a normal folder", () => {
    const folder = new TFolder("Notes/Java") as any;
    folder.isRoot = () => false;
    expect(quizFolderFor(folder, FOLDER)).toBe("Notes/Java/DB Quiz");
  });

  it("returns the folder itself when it is already a quiz folder", () => {
    const folder = new TFolder("Notes/DB Quiz") as any;
    folder.isRoot = () => false;
    expect(quizFolderFor(folder, FOLDER)).toBe("Notes/DB Quiz");
    expect(isQuizFolder(folder, FOLDER)).toBe(true);
  });

  it("puts a quiz folder at the vault root", () => {
    const folder = new TFolder("") as any;
    folder.isRoot = () => true;
    expect(quizFolderFor(folder, FOLDER)).toBe("DB Quiz");
  });
});
