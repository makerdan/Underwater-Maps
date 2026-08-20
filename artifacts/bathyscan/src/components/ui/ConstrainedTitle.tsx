import * as React from "react";

import { cn } from "@/lib/utils";

/** A row-safe title that still exposes its complete value to assistive tech. */
export function ConstrainedTitle({
  children,
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { children: string }) {
  return (
    <div
      {...props}
      className={cn("min-w-0 overflow-hidden text-ellipsis whitespace-nowrap", className)}
      title={children}
      aria-label={children}
    >
      {children}
    </div>
  );
}