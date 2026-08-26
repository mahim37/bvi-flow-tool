import { useRef, useState } from "react";
import type { ReactNode } from "react";

import { useOutsideDismiss } from "./useOutsideDismiss";

interface EditorDropdownProps {
  /** The pill button that opens the panel -- plain text or a short node,
   * styled by `.editor-dropdown > summary` in app.css. */
  trigger: ReactNode;
  /** Blocks opening without hiding the trigger, matching every other
   * disabled control in this app (a greyed-out button, not a missing
   * one) -- `<summary>` has no native `disabled`, so this is done by
   * hand via `aria-disabled` plus swallowing the click that would
   * otherwise toggle it open. */
  disabled?: boolean;
  /** Either the panel's contents, or a function receiving `close` to
   * dismiss itself on a successful submit (`DraftBar`'s forms,
   * `AddQuestion`) -- `SectionEditor` ignores it and stays open instead,
   * since adding one section and immediately wanting to add another is
   * the point of that one. */
  children: ReactNode | ((close: () => void) => ReactNode);
}

/**
 * The one place this app's floating "click a button, a form pops up"
 * popup is built -- Add a question, Edit sections, Submit for review, and
 * anything added after them all get the same behaviour for free instead
 * of each hand-rolling its own `<details>`/open-state/dismiss logic:
 * closed by clicking the trigger again, by Escape, or by clicking
 * anywhere outside the panel.
 *
 * Still a native `<details>` underneath (`.editor-dropdown`/`.editor-panel`
 * in app.css), just with the click-outside/Escape wiring `<details>` does
 * not provide on its own.
 */
export function EditorDropdown({ trigger, disabled, children }: EditorDropdownProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDetailsElement>(null);
  useOutsideDismiss(ref, open, () => setOpen(false));

  return (
    <details
      ref={ref}
      className="editor-dropdown"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary
        aria-disabled={disabled}
        onClick={(event) => {
          if (disabled) event.preventDefault();
        }}
      >
        {trigger}
      </summary>

      <div className="editor-panel">
        {typeof children === "function" ? children(() => setOpen(false)) : children}
      </div>
    </details>
  );
}
