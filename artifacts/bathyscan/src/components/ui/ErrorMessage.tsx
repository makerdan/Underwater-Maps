import * as React from "react";
import { CopyButton } from "@/components/ui/CopyButton";
import { cn } from "@/lib/utils";

export interface ErrorMessageProps extends React.HTMLAttributes<HTMLDivElement> {
  message: string;
  /** Optional heading included in the copied diagnostic. */
  title?: string;
  /** Additional server/exception detail included in the copied diagnostic. */
  detail?: string | null;
  copyText?: string;
  showCopy?: boolean;
}

/** Selectable error content with one consistent, accessible copy action. */
export const ErrorMessage = React.forwardRef<HTMLDivElement, ErrorMessageProps>(
  ({ message, title, detail, copyText, showCopy = true, className, children, ...props }, ref) => {
    const diagnostic = copyText ?? [title, message, detail].filter(Boolean).join("\n");
    return (
      <div
        ref={ref}
        className={cn("relative select-text", className)}
        {...props}
      >
        <div className="pr-20">
          {title && <div className="font-medium">{title}</div>}
          <div>{message}</div>
          {detail && detail !== message && <div>{detail}</div>}
          {children}
        </div>
        {showCopy && diagnostic && (
          <CopyButton
            text={diagnostic}
            className="absolute right-1 top-1"
          />
        )}
      </div>
    );
  },
);
ErrorMessage.displayName = "ErrorMessage";