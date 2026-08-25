import { useEffect } from "react";
import type { RefObject } from "react";

/**
 * Dismiss on a click anywhere outside `ref`'s element, or on Escape.
 *
 * The one place this behaviour is wired, shared by every dismissible popup
 * in this app (`EditorDropdown`'s panel, `ConfirmAction`'s confirm step) --
 * native `<details>` gives neither for free, and a plain button-triggered
 * popup gives neither either.
 */
export function useOutsideDismiss(
  ref: RefObject<HTMLElement | null>,
  active: boolean,
  onDismiss: () => void,
) {
  useEffect(() => {
    if (!active) return;

    function onOutsidePointerDown(event: PointerEvent) {
      if (ref.current !== null && !ref.current.contains(event.target as Node)) {
        onDismiss();
      }
    }
    function onEscape(event: KeyboardEvent) {
      if (event.key === "Escape") onDismiss();
    }

    document.addEventListener("pointerdown", onOutsidePointerDown);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("pointerdown", onOutsidePointerDown);
      document.removeEventListener("keydown", onEscape);
    };
  }, [active, ref, onDismiss]);
}
