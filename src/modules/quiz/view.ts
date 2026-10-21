import { ItemView, Notice, WorkspaceLeaf } from "obsidian";
import { fileForPath } from "./collect";
import { ReasonModal } from "./modal";
import { recordChange } from "./stats";
import { OPTION_LABELS, QuizQuestion, VIEW_TYPE_QUIZ_RUNNER } from "./types";

interface SessionOptions {
  title: string;
  seconds: number;
}

/** What happened on one question, kept for the summary screen. */
interface Attempt {
  question: QuizQuestion;
  chosen: number | null;
  correct: boolean;
}

export class QuizRunnerView extends ItemView {
  private questions: QuizQuestion[] = [];
  private attempts: Attempt[] = [];
  private index = 0;
  private sessionTitle = "Quiz";
  private seconds = 30;
  private remaining = 0;
  private timer: number | null = null;
  private answered = false;

  private root!: HTMLElement;
  private timerEl: HTMLElement | null = null;
  private timerFill: HTMLElement | null = null;

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE_QUIZ_RUNNER;
  }
  getDisplayText(): string {
    return this.sessionTitle;
  }
  getIcon(): string {
    return "help-circle";
  }

  async onOpen(): Promise<void> {}

  async onClose(): Promise<void> {
    this.stopTimer();
  }

  /** Begin a run. `questions` is already shuffled and filtered by the caller. */
  start(questions: QuizQuestion[], opts: SessionOptions): void {
    this.stopTimer();
    this.questions = questions;
    this.attempts = [];
    this.index = 0;
    this.sessionTitle = opts.title;
    this.seconds = Math.max(5, opts.seconds);
    this.root = this.containerEl.children[1] as HTMLElement;
    this.root.addClass("rico-quiz-root");

    if (questions.length === 0) {
      this.renderEmpty();
      return;
    }
    this.renderQuestion();
  }

  // ---- Screens ----

  private renderEmpty(): void {
    this.root.empty();
    const wrap = this.root.createDiv({ cls: "rico-quiz-wrap" });
    wrap.createEl("h2", { text: "No questions to practise" });
    wrap.createEl("p", {
      cls: "rico-quiz-muted",
      text: "Right-click a folder and choose \"Create quiz group\" to generate some, or check that your quiz notes have `quiz: true` in their frontmatter.",
    });
  }

  private renderQuestion(): void {
    this.answered = false;
    const current = this.questions[this.index];
    this.root.empty();
    const wrap = this.root.createDiv({ cls: "rico-quiz-wrap" });

    this.renderHeader(wrap, current);
    wrap.createEl("h2", { cls: "rico-quiz-question", text: current.question });

    const list = wrap.createDiv({ cls: "rico-quiz-options" });
    current.options.forEach((option, i) => {
      const button = list.createEl("button", { cls: "rico-quiz-option" });
      button.createSpan({ cls: "rico-quiz-option-label", text: OPTION_LABELS[i] });
      button.createSpan({ cls: "rico-quiz-option-text", text: option });
      button.addEventListener("click", () => void this.choose(i));
    });

    wrap.createDiv({ cls: "rico-quiz-reveal" });
    this.startTimer();
  }

  private renderHeader(wrap: HTMLElement, current: QuizQuestion): void {
    const header = wrap.createDiv({ cls: "rico-quiz-header" });
    header.createSpan({
      cls: "rico-quiz-progress",
      text: `${this.index + 1} / ${this.questions.length}`,
    });
    header.createSpan({ cls: "rico-quiz-source", text: current.title });
    this.timerEl = header.createSpan({ cls: "rico-quiz-timer", text: `${this.seconds}s` });

    const bar = wrap.createDiv({ cls: "rico-quiz-timer-bar" });
    this.timerFill = bar.createDiv({ cls: "rico-quiz-timer-fill" });
  }

  private renderSummary(): void {
    this.stopTimer();
    this.root.empty();
    const wrap = this.root.createDiv({ cls: "rico-quiz-wrap" });
    const right = this.attempts.filter((a) => a.correct).length;
    const total = this.attempts.length;
    const pct = total ? Math.round((right / total) * 100) : 0;

    wrap.createEl("h2", { text: "Session finished" });
    const score = wrap.createDiv({ cls: "rico-quiz-score" });
    score.createDiv({ cls: "rico-quiz-score-big", text: `${right} / ${total}` });
    score.createDiv({ cls: "rico-quiz-muted", text: `${pct}% correct` });

    const missed = this.attempts.filter((a) => !a.correct);
    if (missed.length > 0) {
      wrap.createEl("h3", { text: "Worth revisiting" });
      const list = wrap.createEl("ul", { cls: "rico-quiz-missed" });
      for (const attempt of missed) {
        const item = list.createEl("li");
        const link = item.createEl("a", { text: attempt.question.question, href: "#" });
        link.addEventListener("click", (event) => {
          event.preventDefault();
          void this.app.workspace.openLinkText(attempt.question.path, "", true);
        });
      }
    }

    const again = wrap.createEl("button", { cls: "mod-cta rico-quiz-next", text: "↺ Run again" });
    again.addEventListener("click", () =>
      this.start(this.questions, { title: this.sessionTitle, seconds: this.seconds })
    );
  }

  // ---- Answering ----

  private async choose(chosen: number | null): Promise<void> {
    if (this.answered) return;
    this.answered = true;
    this.stopTimer();

    const current = this.questions[this.index];
    const correct = chosen === current.answer;
    this.attempts.push({ question: current, chosen, correct });

    this.paintOptions(current, chosen);
    this.renderReveal(current, chosen, correct);

    const file = fileForPath(this.app, current.path);
    if (file) {
      try {
        await recordChange(this.app, file, { kind: "answer", correct });
      } catch (err) {
        new Notice(`Could not record the result: ${(err as Error).message}`, 6000);
      }
    }
  }

  private paintOptions(current: QuizQuestion, chosen: number | null): void {
    const buttons = Array.from(this.root.querySelectorAll<HTMLElement>(".rico-quiz-option"));
    buttons.forEach((button, i) => {
      button.toggleAttribute("disabled", true);
      button.addClass("is-locked");
      if (i === current.answer) button.addClass("is-correct");
      if (chosen !== null && i === chosen && i !== current.answer) button.addClass("is-wrong");
    });
  }

  private renderReveal(current: QuizQuestion, chosen: number | null, correct: boolean): void {
    const reveal = this.root.querySelector<HTMLElement>(".rico-quiz-reveal");
    if (!reveal) return;
    reveal.empty();
    reveal.addClass("is-open");

    const verdict = correct ? "✅ Correct" : chosen === null ? "⏱ Time's up" : "❌ Not quite";
    reveal.createDiv({ cls: `rico-quiz-verdict ${correct ? "is-correct" : "is-wrong"}`, text: verdict });

    if (current.explanation) {
      reveal.createEl("p", { cls: "rico-quiz-explanation", text: current.explanation });
    }
    if (current.reference) {
      reveal.createDiv({ cls: "rico-quiz-reference", text: `📚 ${current.reference}` });
    }

    this.renderFeedback(reveal, current);

    const footer = reveal.createDiv({ cls: "rico-quiz-footer" });
    const open = footer.createEl("button", { cls: "rico-quiz-link", text: "Open note" });
    open.addEventListener("click", () => void this.app.workspace.openLinkText(current.path, "", true));

    const last = this.index === this.questions.length - 1;
    const next = footer.createEl("button", {
      cls: "mod-cta rico-quiz-next",
      text: last ? "See results" : "Next question →",
    });
    next.addEventListener("click", () => this.advance());
    next.focus();
  }

  private renderFeedback(reveal: HTMLElement, current: QuizQuestion): void {
    const bar = reveal.createDiv({ cls: "rico-quiz-feedback" });
    bar.createSpan({ cls: "rico-quiz-muted", text: "This question:" });

    const vote = (text: string, title: string, run: () => Promise<void>) => {
      const button = bar.createEl("button", { cls: "rico-quiz-vote", text });
      button.setAttribute("aria-label", title);
      button.title = title;
      button.addEventListener("click", async () => {
        button.toggleAttribute("disabled", true);
        button.addClass("is-voted");
        await run();
      });
      return button;
    };

    vote("👍 Useful", "Mark this question relevant", () => this.record(current, { kind: "relevant" }));
    vote("👎 Irrelevant", "Mark this question irrelevant", () => this.record(current, { kind: "bad" }));
    vote("🐞 Report mistake", "This question is wrong — say why", async () => {
      new ReasonModal(
        this.app,
        "Report a mistake",
        `${current.title} — your reason is saved into the note's frontmatter.`,
        (reason) => void this.record(current, { kind: "mistake", reason })
      ).open();
    });
  }

  private async record(
    current: QuizQuestion,
    change: Parameters<typeof recordChange>[2]
  ): Promise<void> {
    const file = fileForPath(this.app, current.path);
    if (!file) {
      new Notice(`Could not find ${current.path}`);
      return;
    }
    try {
      await recordChange(this.app, file, change);
      new Notice("Saved to the note.");
    } catch (err) {
      new Notice(`Could not save: ${(err as Error).message}`, 6000);
    }
  }

  private advance(): void {
    if (this.index >= this.questions.length - 1) {
      this.renderSummary();
      return;
    }
    this.index += 1;
    this.renderQuestion();
  }

  // ---- Timer ----

  private startTimer(): void {
    this.stopTimer();
    this.remaining = this.seconds;
    this.paintTimer();
    this.timer = window.setInterval(() => {
      this.remaining -= 1;
      this.paintTimer();
      if (this.remaining <= 0) {
        this.stopTimer();
        void this.choose(null);
      }
    }, 1000);
    this.registerInterval(this.timer);
  }

  private paintTimer(): void {
    if (this.timerEl) {
      this.timerEl.setText(`${Math.max(0, this.remaining)}s`);
      this.timerEl.toggleClass("is-urgent", this.remaining <= 5);
    }
    if (this.timerFill) {
      const pct = Math.max(0, this.remaining) / this.seconds;
      this.timerFill.style.width = `${pct * 100}%`;
      this.timerFill.toggleClass("is-urgent", this.remaining <= 5);
    }
  }

  private stopTimer(): void {
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
  }
}
