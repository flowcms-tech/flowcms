"use client";

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import { Slot } from "radix-ui";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const elementButtonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg border border-transparent bg-clip-padding font-medium text-sm whitespace-nowrap transition-all outline-none select-none cursor-pointer focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 active:translate-y-px disabled:pointer-events-none disabled:opacity-50 disabled:cursor-not-allowed [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        primary:
          "bg-primary text-primary-foreground shadow-sm hover:bg-primary/90",
        outline:
          "border-2 border-primary bg-background text-primary hover:bg-primary hover:text-primary-foreground dark:border-primary dark:bg-input/30 dark:hover:bg-primary/90",
        cancel:
          "border border-border bg-background text-foreground hover:bg-muted hover:text-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50",
        ghost:
          "hover:bg-muted hover:text-foreground dark:hover:bg-muted/50",
        destructive:
          "bg-destructive/10 text-destructive hover:bg-destructive/20 focus-visible:border-destructive/40 focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:hover:bg-destructive/30 dark:focus-visible:ring-destructive/40",
        link:
          "text-primary underline-offset-4 hover:underline",
      },
      size: {
        sm: "h-7 gap-1 rounded-[min(var(--radius-md),12px)] px-2.5 text-[0.8rem]",
        default: "h-8 gap-1.5 px-2.5",
        lg: "h-9 gap-1.5 px-2.5",
        icon: "size-8 p-0",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "default",
    },
  }
);

interface ElementButtonClassNames {
  root?: string;
  spinner?: string;
}

interface ElementButtonProps
  extends React.ComponentProps<"button">,
    VariantProps<typeof elementButtonVariants> {
  isLoading?: boolean;
  asChild?: boolean;
  classNames?: ElementButtonClassNames;
  /** When provided, wraps the button in a Tooltip showing this text. */
  tooltip?: React.ReactNode;
  tooltipSide?: "top" | "right" | "bottom" | "left";
}

export default function ElementButton({
  children,
  className,
  variant = "primary",
  size = "lg",
  isLoading = false,
  disabled = false,
  asChild = false,
  classNames = {},
  tooltip,
  tooltipSide = "top",
  ...props
}: ElementButtonProps) {
  const Comp = asChild ? Slot.Root : "button";

  const button = (
    <Comp
      data-slot="button"
      className={cn(elementButtonVariants({ variant, size }), classNames.root, className)}
      disabled={isLoading || disabled}
      {...props}
    >
      {asChild ? children : (
        <>
          {isLoading && (
            <Loader2
              size={16}
              className={cn("animate-spin", classNames.spinner)}
            />
          )}
          {children}
        </>
      )}
    </Comp>
  );

  if (!tooltip) return button;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>{button}</TooltipTrigger>
        <TooltipContent side={tooltipSide}>{tooltip}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export { elementButtonVariants };
export type { ElementButtonProps };