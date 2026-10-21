import {
  FlaggedQuestion,
  MistakeReport,
  QUIZ_OPTION_COUNT,
  QuizFrontmatter,
  QuizQuestion,
  QuizStats,
} from "./types";

/** A number that may be missing, a string, or junk. Junk counts as 0. */
export function readCount(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, Math.floor(value));
  if (typeof value === "string") {
    const n = Number.parseInt(value.trim(), 10);
    return Number.isFinite(n) ? Math.max(0, n) : 0;
  }
  return 0;
}

/** Mistake entries, tolerating a bare string instead of `{date, reason}`. */
export function readMistakes(value: unknown): MistakeReport[] {
  if (!Array.isArray(value)) return [];
  const out: MistakeReport[] = [];
  for (const raw of value) {
    if (typeof raw === "string") {
      const reason = raw.trim();
      if (reason) out.push({ date: "", reason });
      continue;
    }
    if (raw && typeof raw === "object") {
      const entry = raw as Record<string, unknown>;
      const reason = typeof entry.reason === "string" ? entry.reason.trim() : "";
      if (!reason) continue;
      const date =
        typeof entry.date === "string"
          ? entry.date.trim()
          : entry.date instanceof Date
            ? entry.date.toISOString().slice(0, 10)
            : "";
      out.push({ date, reason });
    }
  }
  return out;
}

export function readStats(fm: QuizFrontmatter | null | undefined): QuizStats {
  const source = fm ?? {};
  const last = source.quiz_last_answered;
  return {
    relevant: readCount(source.quiz_relevant),
    bad: readCount(source.quiz_bad),
    correct: readCount(source.quiz_correct),
    wrong: readCount(source.quiz_wrong),
    lastAnswered:
      typeof last === "string" && last.trim()
        ? last.trim()
        : last instanceof Date
          ? last.toISOString().slice(0, 10)
          : null,
    mistakes: readMistakes(source.quiz_mistakes),
  };
}

/** `quiz: true` marks a note as a question. Accepts the string "true" too. */
export function isQuizNote(fm: QuizFrontmatter | null | undefined): boolean {
  const flag = fm?.quiz;
  return flag === true || flag === "true" || flag === 1;
}

function readOptions(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const options = value.map((o) => (typeof o === "string" ? o.trim() : String(o ?? "").trim()));
  if (options.length !== QUIZ_OPTION_COUNT) return null;
  if (options.some((o) => !o)) return null;
  return options;
}

/**
 * Turn a note's frontmatter into a question the runner can show.
 * Returns an error string instead of throwing, so a bad note is reported, not fatal.
 */
export function parseQuestion(
  path: string,
  title: string,
  fm: QuizFrontmatter | null | undefined
): { question: QuizQuestion } | { error: string } {
  if (!isQuizNote(fm)) return { error: "not a quiz note (missing `quiz: true`)" };
  const source = fm as QuizFrontmatter;

  const question = typeof source.question === "string" ? source.question.trim() : "";
  if (!question) return { error: "missing `question`" };

  const options = readOptions(source.options);
  if (!options) return { error: `\`options\` must be ${QUIZ_OPTION_COUNT} non-empty entries` };

  const answer = typeof source.answer === "number" ? source.answer : Number.parseInt(String(source.answer ?? ""), 10);
  if (!Number.isInteger(answer) || answer < 0 || answer >= QUIZ_OPTION_COUNT) {
    return { error: `\`answer\` must be an index 0-${QUIZ_OPTION_COUNT - 1}` };
  }

  return {
    question: {
      path,
      title,
      question,
      options,
      answer,
      explanation: typeof source.explanation === "string" ? source.explanation.trim() : "",
      reference: typeof source.reference === "string" ? source.reference.trim() : "",
      stats: readStats(source),
    },
  };
}

/**
 * Questions you have voted down more than up are noise while practising.
 * A question with no votes either way is always kept.
 */
export function isBadQuestion(stats: QuizStats): boolean {
  return stats.bad > stats.relevant;
}

/** Reasons a question should go into the fix prompt; empty means it is fine. */
export function fixReasons(question: QuizQuestion): string[] {
  const reasons: string[] = [];
  if (question.stats.mistakes.length > 0) {
    reasons.push(`${question.stats.mistakes.length} mistake report(s) filed`);
  }
  if (isBadQuestion(question.stats)) {
    reasons.push(`marked irrelevant ${question.stats.bad}x vs relevant ${question.stats.relevant}x`);
  }
  return reasons;
}

/** Collect every question that needs rewriting, plus malformed notes passed in separately. */
export function flagQuestions(questions: QuizQuestion[]): FlaggedQuestion[] {
  const flagged: FlaggedQuestion[] = [];
  for (const q of questions) {
    const reasons = fixReasons(q);
    if (reasons.length === 0) continue;
    flagged.push({
      path: q.path,
      title: q.title,
      question: q.question,
      reasons,
      bad: q.stats.bad,
      relevant: q.stats.relevant,
      mistakes: q.stats.mistakes,
    });
  }
  return flagged;
}

/** Today as `YYYY-MM-DD`, the format Obsidian writes for date properties. */
export function today(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
