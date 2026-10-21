import { describe, it, expect } from "vitest";
import { NOTE_TEMPLATE, buildCreatePrompt, buildFixPrompt } from "../src/modules/quiz/prompts";
import { FlaggedQuestion } from "../src/modules/quiz/types";

describe("buildCreatePrompt", () => {
  const prompt = buildCreatePrompt("Notes/Java/DB Quiz", "JVM memory model", 12);

  it("names the target folder and the count", () => {
    expect(prompt).toContain("Notes/Java/DB Quiz");
    expect(prompt).toContain("12 multiple-choice quiz questions");
  });

  it("includes the topic and the frontmatter template", () => {
    expect(prompt).toContain("JVM memory model");
    expect(prompt).toContain(NOTE_TEMPLATE);
    expect(prompt).toContain("quiz: true");
  });

  it("tells the agent not to write the stat keys", () => {
    expect(prompt).toContain("quiz_mistakes");
    expect(prompt).toContain("the plugin writes those");
  });

  it("falls back to the surrounding notes when no topic is given", () => {
    const noTopic = buildCreatePrompt("DB Quiz", "  ", 5);
    expect(noTopic).toContain("Read the notes around that folder first");
    expect(noTopic).toContain("5 multiple-choice quiz questions.");
  });
});

describe("buildFixPrompt", () => {
  const flagged: FlaggedQuestion[] = [
    {
      path: "DB Quiz/a.md",
      title: "a",
      question: "Is this ambiguous?",
      reasons: ["1 mistake report(s) filed"],
      bad: 0,
      relevant: 2,
      mistakes: [{ date: "2026-10-18", reason: "two options are correct" }],
    },
    {
      path: "DB Quiz/b.md",
      title: "b",
      question: "Off topic?",
      reasons: ["marked irrelevant 3x vs relevant 0x"],
      bad: 3,
      relevant: 0,
      mistakes: [],
    },
  ];

  it("lists only the flagged notes, with their reasons", () => {
    const prompt = buildFixPrompt("DB Quiz", flagged);
    expect(prompt).toContain("DB Quiz/a.md");
    expect(prompt).toContain("DB Quiz/b.md");
    expect(prompt).toContain("two options are correct");
    expect(prompt).toContain("marked irrelevant 3x");
    expect(prompt).toContain("2 quiz questions");
  });

  it("tells the agent to clear the flags after fixing", () => {
    const prompt = buildFixPrompt("DB Quiz", flagged);
    expect(prompt).toContain("quiz_bad: 0");
    expect(prompt).toContain("remove the `quiz_mistakes` key");
  });

  it("returns empty when nothing is flagged, so the caller can say so", () => {
    expect(buildFixPrompt("DB Quiz", [])).toBe("");
  });

  it("uses the singular for one question", () => {
    const prompt = buildFixPrompt("DB Quiz", [flagged[0]]);
    expect(prompt).toContain("1 quiz question ");
    expect(prompt).toContain("has been flagged");
  });
});
