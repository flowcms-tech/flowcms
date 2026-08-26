import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import React from "react";

const elementBadgeVariants = cva(
  "w-fit inline-flex items-center capitalize rounded-full border px-2.5 py-0.5 text-xs font-medium leading-4 transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 select-none whitespace-nowrap",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-primary text-primary-foreground hover:bg-primary/80",
        secondary:
          "border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80",
        destructive:
          "border-transparent bg-destructive/15 text-destructive hover:bg-destructive/25 dark:bg-destructive/25 dark:hover:bg-destructive/35",
        outline:
          "border-border text-foreground bg-transparent hover:bg-muted",
        success:
          "border-transparent bg-success-light text-success hover:bg-success/20",
        warning:
          "border-transparent bg-warning-light text-warning hover:bg-warning/20",
        info:
          "border-transparent bg-info-light text-info hover:bg-info/20",
        muted:
          "border-transparent bg-muted text-muted-foreground hover:bg-muted/70",
      },
      size: {
        xs: "px-2.5 py-0.5 text-xs",
        sm: "px-3 py-1 text-sm",
        base: "px-4 py-1.5 text-base",
      },
      position: {
        start: "justify-start",
        center: "justify-center",
        end: "justify-end",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "xs",
      position: "center",
    },
  }
);

export interface ElementBadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof elementBadgeVariants> {
  startContent?: React.ReactNode;
  endContent?: React.ReactNode;
}

export default function ElementBadge({
  variant,
  size,
  position,
  className,
  startContent,
  endContent,
  children,
  ...props
}: ElementBadgeProps) {
  return (
    <div
      className={cn(
        elementBadgeVariants({ variant, size, position }),
        "gap-1 overflow-hidden text-ellipsis",
        className
      )}
      {...props}
    >
      {startContent && <span className="flex items-center">{startContent}</span>}
      {children}
      {endContent && <span className="flex items-center">{endContent}</span>}
    </div>
  );
}

export { elementBadgeVariants };