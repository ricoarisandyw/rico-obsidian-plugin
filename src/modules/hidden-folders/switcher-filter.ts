import type { App } from "obsidian";

type Suggestion = { file?: { path?: string } | null };
type SwitcherProto = { getSuggestions?: (query: string) => unknown };

function hasHiddenSegment(path: string): boolean {
  return path.split("/").some((seg) => seg.startsWith("."));
}

/** The core Quick Switcher modal class, or null when the core plugin is off/unavailable. */
function getSwitcherProto(app: App): SwitcherProto | null {
  const internal = (app as unknown as {
    internalPlugins?: {
      getPluginById?: (id: string) => { instance?: { QuickSwitcherModal?: { prototype?: SwitcherProto } } };
    };
  }).internalPlugins;
  return internal?.getPluginById?.("switcher")?.instance?.QuickSwitcherModal?.prototype ?? null;
}

/**
 * Keep hidden (dot-prefixed) paths such as `.obsidian/` and `.trash/` out of the
 * Quick Switcher results. They stay visible in the File Explorer.
 * Returns an unpatch function, or null when the switcher could not be patched.
 */
export function installSwitcherFilter(
  app: App,
  isEnabled: () => boolean
): (() => void) | null {
  const proto = getSwitcherProto(app);
  if (!proto || typeof proto.getSuggestions !== "function") return null;

  const hadOwn = Object.prototype.hasOwnProperty.call(proto, "getSuggestions");
  const original = proto.getSuggestions;

  const keep = (item: Suggestion): boolean => {
    const path = item?.file?.path;
    return !path || !hasHiddenSegment(path);
  };

  proto.getSuggestions = function (this: unknown, query: string) {
    const result = original.call(this, query);
    if (!isEnabled()) return result;
    if (Array.isArray(result)) return result.filter(keep);
    if (result && typeof (result as Promise<unknown>).then === "function") {
      return (result as Promise<unknown>).then((r) => (Array.isArray(r) ? r.filter(keep) : r));
    }
    return result;
  };

  return () => {
    if (hadOwn) proto.getSuggestions = original;
    else delete proto.getSuggestions;
  };
}
