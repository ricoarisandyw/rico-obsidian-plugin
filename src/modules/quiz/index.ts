import type { FileMenuRegistry } from "../../shared/lib/menu-registry";
import type { MenuEntry } from "../../shared/lib/menu-group";
import { Notice, Plugin, TFolder, normalizePath } from "obsidian";
import {
  applySkipBad,
  collectQuestions,
  isQuizFolder,
  quizFolderFor,
  shuffle,
} from "./collect";
import { CreateQuizModal } from "./modal";
import { flagQuestions } from "./parser";
import { buildCreatePrompt, buildFixPrompt } from "./prompts";
import { QuizQuestion, VIEW_TYPE_QUIZ_RUNNER } from "./types";
import { QuizRunnerView } from "./view";

type QuizPlugin = Plugin & {
  settings: {
    enableQuiz: boolean;
    quizFolderName: string;
    quizQuestionSeconds: number;
    quizSkipBadQuestions: boolean;
    quizDefaultCount: number;
  };
};

function folderName(plugin: QuizPlugin): string {
  return plugin.settings.quizFolderName.trim() || "DB Quiz";
}

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Open (or reuse) the runner tab and hand it the questions. */
async function runQuiz(plugin: QuizPlugin, root: string, title: string): Promise<void> {
  const { questions, broken } = collectQuestions(plugin.app, root, folderName(plugin));
  const playable = shuffle(applySkipBad(questions, plugin.settings.quizSkipBadQuestions));

  if (broken.length > 0) {
    const first = broken[0];
    new Notice(
      `${broken.length} quiz note${broken.length === 1 ? "" : "s"} could not be read — e.g. ${first.path}: ${first.error}`,
      8000
    );
  }
  if (playable.length === 0) {
    new Notice(
      questions.length > 0
        ? "Every question here is marked irrelevant. Turn off \"skip irrelevant\" in settings, or fix them."
        : `No quiz questions found${root ? ` in ${root}` : ""}.`,
      7000
    );
    return;
  }

  const { workspace } = plugin.app;
  let leaf = workspace.getLeavesOfType(VIEW_TYPE_QUIZ_RUNNER)[0];
  if (!leaf) {
    leaf = workspace.getLeaf("tab");
    await leaf.setViewState({ type: VIEW_TYPE_QUIZ_RUNNER, active: true });
  }
  workspace.revealLeaf(leaf);

  const view = leaf.view;
  if (view instanceof QuizRunnerView) {
    view.start(playable, { title, seconds: plugin.settings.quizQuestionSeconds });
  }
}

/** Ask for a topic, then copy a "write these questions" prompt. */
function promptCreateGroup(plugin: QuizPlugin, folder: TFolder): void {
  const target = normalizePath(quizFolderFor(folder, folderName(plugin)));
  new CreateQuizModal(plugin.app, target, plugin.settings.quizDefaultCount, (topic, count) => {
    const prompt = buildCreatePrompt(target, topic, count);
    void copy(prompt).then((ok) => {
      new Notice(
        ok
          ? `Prompt for ${count} questions copied — paste it into your agent.`
          : "Could not reach the clipboard. Check Obsidian's permissions.",
        6000
      );
    });
  }).open();
}

/** Collect flagged questions in a folder and copy a rewrite prompt. */
function scanAndFix(plugin: QuizPlugin, folder: TFolder): void {
  const name = folderName(plugin);
  const root = quizFolderFor(folder, name);
  const { questions, broken } = collectQuestions(plugin.app, root, name);
  const flagged = flagQuestions(questions);

  for (const bad of broken) {
    flagged.push({
      path: bad.path,
      title: bad.path,
      question: "(could not be parsed)",
      reasons: [`malformed frontmatter: ${bad.error}`],
      bad: 0,
      relevant: 0,
      mistakes: [],
    });
  }

  if (flagged.length === 0) {
    new Notice(
      questions.length === 0
        ? `No quiz questions found in ${root}.`
        : `All ${questions.length} questions in ${root} look fine — nothing flagged.`,
      6000
    );
    return;
  }

  void copy(buildFixPrompt(root, flagged)).then((ok) => {
    new Notice(
      ok
        ? `${flagged.length} question${flagged.length === 1 ? "" : "s"} flagged — fix prompt copied.`
        : "Could not reach the clipboard. Check Obsidian's permissions.",
      7000
    );
  });
}

export function registerQuiz(
  plugin: QuizPlugin,
  menuRegistry?: FileMenuRegistry,
): void {
  plugin.registerView(VIEW_TYPE_QUIZ_RUNNER, (leaf) => new QuizRunnerView(leaf));

  plugin.addCommand({
    id: "run-global-quiz",
    name: "Run global quiz",
    callback: () => void runQuiz(plugin, "", "Global quiz"),
  });

  plugin.addRibbonIcon("help-circle", "Run global quiz", () =>
    void runQuiz(plugin, "", "Global quiz")
  );

  menuRegistry?.add((file) => {
    if (!plugin.settings.enableQuiz) return [];
    if (!(file instanceof TFolder)) return [];

    const entries: MenuEntry[] = [
      {
        title: "Create quiz group",
        icon: "list-plus",
        onClick: () => promptCreateGroup(plugin, file),
      },
    ];

    // Running and fixing only make sense inside the quiz folder.
    if (isQuizFolder(file, folderName(plugin))) {
      entries.push({
        title: "Run this quiz",
        icon: "help-circle",
        onClick: () => void runQuiz(plugin, file.path, file.parent?.name || file.name),
      });
      entries.push({
        title: "Scan & fix quiz",
        icon: "wrench",
        onClick: () => scanAndFix(plugin, file),
      });
    }
    return entries;
  });
}

/** Pulled out for tests: what a session would play, given a collect result. */
export function playableFrom(questions: QuizQuestion[], skipBad: boolean): QuizQuestion[] {
  return applySkipBad(questions, skipBad);
}
