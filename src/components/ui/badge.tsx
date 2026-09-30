import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium",
  {
    variants: {
      variant: {
        matched: "border-lagoon/40 bg-lagoon/15 text-lagoon-bright",
        missing: "border-coral/40 bg-coral/15 text-coral",
        needs_review: "border-brass/40 bg-brass/15 text-brass-bright",
        neutral: "border-wood-light/30 bg-wood-dark/40 text-parchment/80",
      },
    },
    defaultVariants: { variant: "neutral" },
  }
);

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
