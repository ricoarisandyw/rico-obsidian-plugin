import { JSX } from "preact";
import { DropdownMenu } from "../../../shared/components/ui/DropdownMenu";
import { MenuItem } from "../../../shared/components/ui/MenuItem";
import { getAvailableCanvasTools } from "../../../shared/lib/canvas-tool-registry";
import { CanvasToolContext } from "../../../shared/utils/canvas";

export interface HammerMenuProps {
  ctx: CanvasToolContext;
  onClose: () => void;
}

/**
 * The dropdown rendered when the 🔨 button is clicked. Lists every registered
 * canvas tool that is available for the current selection.
 */
export function HammerMenu({ ctx, onClose }: HammerMenuProps): JSX.Element {
  const tools = getAvailableCanvasTools(ctx);

  return (
    <DropdownMenu>
      {tools.length === 0 ? (
        <div class="roc-menu-empty">No tools available</div>
      ) : (
        tools.map((tool) => (
          <MenuItem
            key={tool.id}
            emoji={tool.emoji}
            label={tool.label}
            onClick={async () => {
              try {
                await tool.run(ctx);
              } finally {
                onClose();
              }
            }}
          />
        ))
      )}
    </DropdownMenu>
  );
}
