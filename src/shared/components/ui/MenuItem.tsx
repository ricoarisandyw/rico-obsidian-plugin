import { JSX } from "preact";

export interface MenuItemProps {
  emoji: string;
  label: string;
  disabled?: boolean;
  onClick?: () => void;
}

/** A single emoji-icon + label row inside a dropdown menu. */
export function MenuItem({ emoji, label, disabled, onClick }: MenuItemProps): JSX.Element {
  return (
    <button
      type="button"
      class={`roc-menu-item${disabled ? " is-disabled" : ""}`}
      disabled={disabled}
      onClick={() => {
        if (!disabled) onClick?.();
      }}
    >
      <span class="roc-menu-item-emoji" aria-hidden="true">
        {emoji}
      </span>
      <span class="roc-menu-item-label">{label}</span>
    </button>
  );
}
