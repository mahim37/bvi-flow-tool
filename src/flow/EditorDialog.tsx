import { useState } from "react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

interface EditorDialogProps {
  /** The control that opens the overlay. A string is wrapped in a Button. */
  trigger: ReactNode;
  title: string;
  description?: string;
  disabled?: boolean;
  /** Extra classes on the overlay panel (scroll for long forms). */
  className?: string;
  children: ReactNode | ((close: () => void) => ReactNode);
}

/**
 * Click a button, a form covers the page.
 *
 * Create-draft and create-product need the whole viewport dimmed, not a
 * popover hanging off the trigger -- those popovers were easy to miss and
 * easy to dismiss mid-fill. Dismisses on overlay click, Escape, or a
 * successful submit calling `close`.
 */
export function EditorDialog({
  trigger,
  title,
  description,
  disabled,
  className,
  children,
}: EditorDialogProps) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (disabled) return;
        setOpen(next);
      }}
    >
      <DialogTrigger asChild>
        {typeof trigger === "string" ? (
          <Button {...(disabled ? { disabled: true } : {})}>{trigger}</Button>
        ) : (
          trigger
        )}
      </DialogTrigger>
      <DialogContent className={cn("sm:max-w-lg", className)}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description !== undefined && (
            <DialogDescription>{description}</DialogDescription>
          )}
        </DialogHeader>
        {typeof children === "function" ? children(() => setOpen(false)) : children}
      </DialogContent>
    </Dialog>
  );
}
