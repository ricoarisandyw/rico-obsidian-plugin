import { FlaggedQuestion } from "./types";

/** The note format both prompts teach the agent. Kept in one place so they never drift. */
export const NOTE_TEMPLATE = `---
quiz: true
question: "The question text, ending with a question mark?"
options:
  - "First choice"
  - "Second choice"
  - "Third choice"
  - "Fourth choice"
answer: 0
explanation: "Why the correct option is correct, in two or three sentences."
reference: "Where this comes from — book, chapter, RFC, URL, or doc section."
tags: [quiz]
---

# The question text, ending with a question mark?

Any extra notes, links, or worked examples go here. Free-form.`;

const RULES = [
  "One question per note. Never put two questions in one file.",
  "`options` must hold exactly 4 entries, all plausible — no filler like \"none of the above\".",
  "`answer` is the 0-based index of the correct entry in `options`.",
  "`explanation` says why the right answer is right, not just what it is.",
  "`reference` must be a real, checkable source. If you are not sure of one, say so in the explanation rather than inventing a citation.",
  "Name each file after the question, kebab-cased and trimmed to about 60 characters, e.g. `what-does-solid-l-stand-for.md`.",
  "Do not add the `quiz_relevant`, `quiz_bad`, `quiz_correct`, `quiz_wrong`, `quiz_last_answered` or `quiz_mistakes` keys — the plugin writes those.",
];

function numbered(lines: string[]): string {
  return lines.map((line, i) => `${i + 1}. ${line}`).join("\n");
}

/** Prompt that asks an agent to fill a `DB Quiz` folder with fresh questions. */
export function buildCreatePrompt(folderPath: string, topic: string, count: number): string {
  const subject = topic.trim();
  return [
    `Write ${count} multiple-choice quiz questions${subject ? ` about: ${subject}` : ""}.`,
    "",
    `Create one markdown note per question inside this vault folder (make the folder if it does not exist):`,
    "",
    `    ${folderPath}`,
    "",
    subject
      ? `Base the questions on what is already in the vault about "${subject}" where you can find it — read the surrounding notes first. Where the vault is thin, use your own knowledge and cite a real source.`
      : "Read the notes around that folder first and base the questions on them.",
    "",
    "Each note must look exactly like this:",
    "",
    NOTE_TEMPLATE,
    "",
    "Rules:",
    "",
    numbered(RULES),
    "",
    `Vary the difficulty: roughly a third easy recall, a third applied, a third genuinely hard. Do not repeat a question that already exists in ${folderPath}.`,
  ].join("\n");
}

function describeFlagged(flagged: FlaggedQuestion): string {
  const lines = [`### ${flagged.path}`, `Question: ${flagged.question}`, `Flagged because: ${flagged.reasons.join("; ")}`];
  if (flagged.mistakes.length > 0) {
    lines.push("Mistake reports:");
    for (const m of flagged.mistakes) {
      lines.push(`  - ${m.date ? `${m.date}: ` : ""}${m.reason}`);
    }
  }
  return lines.join("\n");
}

/**
 * Prompt that asks an agent to rewrite the questions you flagged.
 * Returns an empty string when nothing is flagged, so the caller can say "nothing to fix".
 */
export function buildFixPrompt(folderPath: string, flagged: FlaggedQuestion[]): string {
  if (flagged.length === 0) return "";
  return [
    `${flagged.length} quiz question${flagged.length === 1 ? "" : "s"} in \`${folderPath}\` ${flagged.length === 1 ? "has" : "have"} been flagged as wrong or irrelevant while practising. Fix ${flagged.length === 1 ? "it" : "them"} in place.`,
    "",
    flagged.map(describeFlagged).join("\n\n"),
    "",
    "For each note above:",
    "",
    numbered([
      "Read the note and the mistake reports, then decide: is the question factually wrong, ambiguous, or simply off-topic for this folder?",
      "Wrong or ambiguous → rewrite the question, options, explanation and reference so it is correct and has exactly one defensible answer.",
      "Off-topic → replace it with a question that fits the rest of the folder, keeping the same file.",
      "Beyond saving → delete the note and write a replacement question in the same folder.",
      "After fixing a note, reset `quiz_bad: 0` and remove the `quiz_mistakes` key. Leave `quiz_relevant`, `quiz_correct` and `quiz_wrong` as they are.",
      "Keep the frontmatter format identical to the rest of the folder.",
    ]),
    "",
    "The note format, for reference:",
    "",
    NOTE_TEMPLATE,
  ].join("\n");
}
