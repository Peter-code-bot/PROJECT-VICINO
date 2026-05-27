"use client";

import { forwardRef } from "react";
import * as RadixPopover from "@radix-ui/react-popover";
import { cn } from "@/lib/utils";

export const Popover = RadixPopover.Root;
export const PopoverTrigger = RadixPopover.Trigger;
export const PopoverAnchor = RadixPopover.Anchor;
export const PopoverClose = RadixPopover.Close;

type PopoverContentProps = React.ComponentPropsWithoutRef<typeof RadixPopover.Content>;

export const PopoverContent = forwardRef<
  React.ElementRef<typeof RadixPopover.Content>,
  PopoverContentProps
>(({ className, align = "center", sideOffset = 6, ...props }, ref) => (
  <RadixPopover.Portal>
    <RadixPopover.Content
      ref={ref}
      align={align}
      sideOffset={sideOffset}
      className={cn(
        "z-50 min-w-[12rem] rounded-xl border border-border bg-popover p-2 text-popover-foreground shadow-[var(--shadow-lg)]",
        "outline-none",
        "data-[state=open]:animate-scale-in",
        className,
      )}
      {...props}
    />
  </RadixPopover.Portal>
));
PopoverContent.displayName = "PopoverContent";
