import { useToast } from "@/hooks/use-toast"
import {
  Toast,
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport,
} from "@/components/ui/toast"
import { CopyButton } from "@/components/ui/CopyButton"

export function Toaster() {
  const { toasts } = useToast()

  return (
    <ToastProvider>
      {toasts.map(function ({ id, title, description, action, variant, ...props }) {
        const isDestructive = variant === "destructive"
        const copyText = [
          typeof title === "string" ? title : "",
          typeof description === "string" ? description : "",
        ]
          .filter(Boolean)
          .join("\n")

        return (
          <Toast key={id} variant={variant} {...props}>
            <div className="grid gap-1 flex-1 min-w-0">
              {title && <ToastTitle>{title}</ToastTitle>}
              {description && (
                <ToastDescription>{description}</ToastDescription>
              )}
            </div>
            {isDestructive && copyText && (
              <CopyButton
                text={copyText}
                className="shrink-0 self-start text-destructive-foreground/70 hover:text-destructive-foreground"
              />
            )}
            {action}
            <ToastClose />
          </Toast>
        )
      })}
      <ToastViewport />
    </ToastProvider>
  )
}
