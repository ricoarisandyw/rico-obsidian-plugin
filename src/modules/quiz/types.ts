/** Frontmatter shape of a quiz note. Everything the runner needs lives here. */
export interface QuizFrontmatter {
  quiz?: unknown;
  question?: unknown;
  options?: unknown;
  answer?: unknown;
  explanation?: unknown;
  reference?: unknown;
  quiz_relevant?: unknown;
  quiz_bad?: unknown;
  quiz_correct?: unknown;
  quiz_wrong?: unknown;
  quiz_last_answered?: unknown;
  quiz_mistakes?: unknown;
  [key: string]: unknown;
}

/** A reason you logged when a question turned out to be wrong. */
export interface MistakeReport {
  date: string;
  reason: string;
}

/** Counters kept per question. Missing keys read as 0 / empty. */
export interface QuizStats {
  relevant: number;
  bad: number;
  correct: number;
  wrong: number;
  lastAnswered: string | null;
  mistakes: MistakeReport[];
}

/** A question the runner can actually show. */
export interface QuizQuestion {
  /** Vault path of the note it came from. */
  path: string;
  /** Note basename, shown as the source. */
  title: string;
  question: string;
  /** Exactly four choices. */
  options: string[];
  /** Index into `options`, 0-3. */
  answer: number;
  explanation: string;
  reference: string;
  stats: QuizStats;
}

/** Why a question was flagged for the fix prompt. */
export interface FlaggedQuestion {
  path: string;
  title: string;
  question: string;
  reasons: string[];
  bad: number;
  relevant: number;
  mistakes: MistakeReport[];
}

export const QUIZ_OPTION_COUNT = 4;

/** Letters shown next to each option. */
export const OPTION_LABELS = ["A", "B", "C", "D"];

export const VIEW_TYPE_QUIZ_RUNNER = "rico-quiz-runner";
