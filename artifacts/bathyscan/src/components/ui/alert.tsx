import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { X } from "lucide-react"

import { cn } from "@/lib/utils"
import { CopyButton } from "@/components/ui/CopyButton"
import { useAutoDismiss } from "@/hooks/useAutoDismiss"

const alertVariants = cva(
  "relative w-full rounded-lg border px-4 py-3 text-sm [&>svg+div]:translate-y-[-3px] [&>svg]:absolute [&>svg]:left-4 [&>svg]:top-4 [&>svg]:text-foreground [&>svg~*]:pl-7",
  {
    variants: {
      variant: {
        default: "bg-background text-foreground",
        destructive:
          "border-destructive/50 text-destructive dark:border-destructive [&>svg]:text-destructive",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

interface AlertExtraProps {
  onDismiss?: () => void
  autoDismissMs?: number
  copyText?: string
}

const Alert = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> &
    VariantProps<typeof alertVariants> &
    AlertExtraProps
>(({ className, variant, onDismiss, autoDismissMs, copyText, children, ...props }, ref) => {
  const { onMouseEnter, onMouseLeave } = useAutoDismiss(
    autoDismissMs,
    onDismiss,
  )

  const showControls = onDismiss !== undefined || copyText !== undefined

  return (
    <div
      ref={ref}
      role="alert"
      className={cn(alertVariants({ variant }), className)}
      onMouseEnter={autoDismissMs ? onMouseEnter : undefined}
      onMouseLeave={autoDismissMs ? onMouseLeave : undefined}
      {...props}
    >
      {children}
      {showControls && (
        <div className="absolute right-2 top-2 flex items-center gap-1">
          {copyText && <CopyButton text={copyText} />}
          {onDismiss && (
            <button
              type="button"
              aria-label="Dismiss"
              onClick={onDismiss}
              className="rounded p-0.5 opacity-70 hover:opacity-100 transition-opacity focus:outline-none focus:ring-1 focus:ring-current"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}
    </div>
  )
})
Alert.displayName = "Alert"

const AlertTitle = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <h5
    ref={ref}
    className={cn("mb-1 font-medium leading-none tracking-tight", className)}
    {...props}
  />
))
AlertTitle.displayName = "AlertTitle"

const AlertDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("text-sm [&_p]:leading-relaxed", className)}
    {...props}
  />
))
AlertDescription.displayName = "AlertDescription"

export { Alert, AlertTitle, AlertDescription }
