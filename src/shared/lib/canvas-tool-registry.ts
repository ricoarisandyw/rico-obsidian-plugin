import { CanvasToolContext } from "../utils/canvas";

/**
 * A self-describing canvas tool. Tools register themselves (side-effect import)
 * and the hammer menu renders whatever is registered and currently available.
 */
export interface CanvasTool {
  /** Stable unique id, e.g. "open-in-new-tab". */
  id: string;
  /** Logical grouping, e.g. "canvas". */
  group: string;
  /** Emoji shown as the row icon. */
  emoji: string;
  /** Human-readable label. */
  label: string;
  /** Whether the tool should appear for the given context. */
  isAvailable: (ctx: CanvasToolContext) => boolean;
  /** Perform the tool action. */
  run: (ctx: CanvasToolContext) => void | Promise<void>;
}

const registry = new Map<string, CanvasTool>();

/** Register a canvas tool. Re-registering the same id overwrites the previous one. */
export function registerCanvasTool(tool: CanvasTool): void {
  registry.set(tool.id, tool);
}

/** List all registered tools (insertion order). */
export function getCanvasTools(): CanvasTool[] {
  return Array.from(registry.values());
}

/** List tools available for a given context. */
export function getAvailableCanvasTools(ctx: CanvasToolContext): CanvasTool[] {
  return getCanvasTools().filter((tool) => {
    try {
      return tool.isAvailable(ctx);
    } catch {
      return false;
    }
  });
}
