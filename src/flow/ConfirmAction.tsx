import { useRef, useState } from "react";
import type { ReactNode } from "react";

import { useOutsideDismiss } from "./useOutsideDismiss";

interface ConfirmActionProps {
  /** What's being asked, plain language, same tone the rest of this app's
   * banners/hints already use. */
  message: string;
  /** The confirm step's own button label -- usually shorter than the
   * question ("Discard draft", not "Yes, discard this draft"). */
  confirmLabel: string;
  /** Styles the confirm button `button--danger` instead of the default
   * `button--primary`, for the destructive ones (Discard, Retire). */
  danger?: boolean;
  onConfirm: () => void;
  /** The trigger, exactly as the caller would otherwise have rendered it
   * (a plain button, or `Cta`'s two-line title+description one) -- this
   * component doesn't style or replace it, it just hands back `open`
   * instead of letting the caller wire the action straight to `onClick`. */
  children: (open: () => void) => ReactNode;
}

/**
 * A trigger plus an inline "are you sure?" step, replacing `window.confirm`
 * everywhere this app asks before a destructive or hard-to-undo action
 * (discard a draft, retire a question, activate an old version, publish).
 *
 * Native `confirm()` blocks the whole tab and looks like the browser
 * asking, not this app -- this is the same floating-panel technique
 * `EditorDropdown` already uses (`.editor-panel`, `useOutsideDismiss`),
 * so it dismisses the same way every other popup here does: clicking
 * outside it, Escape, or explicitly cancelling.
 */
export function ConfirmAction({
  message,
  confirmLabel,
  danger = false,
  onConfirm,
  children,
}: ConfirmActionProps) {
  const [confirming, setConfirming] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useOutsideDismiss(ref, confirming, () => setConfirming(false));

  return (
    <div className="confirm-trigger" ref={ref}>
      {children(() => setConfirming(true))}

      {confirming && (
        <div className="editor-panel" role="alertdialog" aria-label={confirmLabel}>
          <p className="panel__hint">{message}</p>
          <div className="editor__actions">
            <button
              className={`button ${danger ? "button--danger" : "button--primary"}`}
              type="button"
              onClick={() => {
                setConfirming(false);
                onConfirm();
              }}
            >
              {confirmLabel}
            </button>
            <button
              className="button button--quiet"
              type="button"
              onClick={() => setConfirming(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
