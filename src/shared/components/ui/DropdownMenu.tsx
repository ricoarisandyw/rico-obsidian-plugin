import { ComponentChildren, JSX } from "preact";

export interface DropdownMenuProps {
  children: ComponentChildren;
}

/** Reusable container for a list of MenuItem rows. */
export function DropdownMenu({ children }: DropdownMenuProps): JSX.Element {
  return (
    <div class="roc-dropdown-menu" role="menu">
      {children}
    </div>
  );
}
