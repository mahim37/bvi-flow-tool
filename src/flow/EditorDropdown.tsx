import { useState } from "react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

interface EditorDropdownProps {
  /** The control that opens the panel. A string is wrapped in a real
   * Button. A node is the caller's own trigger (also a Button). */
  trigger: ReactNode;
  disabled?: boolean;
  children: ReactNode | ((close: () => void) => ReactNode);
}

/**
 * Click a button, a form (or a short list of actions) pops up.
 *
 * A real `<button>` inside `<summary>` is invalid HTML, so this is a
 * shadcn Popover rather than native `<details>`. Dismisses on outside
 * click, Escape, or a successful submit calling `close`.
 */
export function EditorDropdown({ trigger, disabled, children }: EditorDropdownProps) {
  const [open, setOpen] = useState(false);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (disabled) return;
        setOpen(next);
      }}
    >
      <PopoverTrigger asChild>
        {typeof trigger === "string" ? (
          <Button {...(disabled ? { disabled: true } : {})}>{trigger}</Button>
        ) : (
          trigger
        )}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64">
        {typeof children === "function" ? children(() => setOpen(false)) : children}
      </PopoverContent>
    </Popover>
  );
}
