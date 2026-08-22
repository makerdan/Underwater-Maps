/**
 * CopyButton — copies `text` to the clipboard and shows a brief "Copied!"
 * confirmation in place of the icon label for ~1.5 s.
 */
import { useState, useCallback } from "react";
import { Copy, Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface CopyButtonProps {
  text: string;
  className?: string;
}

export function CopyButton({ text, className }: CopyButtonProps) {
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");

  const handleCopy = useCallback(async () => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setStatus("copied");
      setTimeout(() => setStatus("idle"), 1500);
    } catch {
      // Fallback for environments without clipboard API
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        if (!document.execCommand("copy")) throw new Error("Clipboard copy was rejected");
        document.body.removeChild(ta);
        setStatus("copied");
        setTimeout(() => setStatus("idle"), 1500);
      } catch {
        setStatus("failed");
        setTimeout(() => setStatus("idle"), 2000);
      }
    }
  }, [text]);

  return (
    <button
      type="button"
      aria-label={status === "copied" ? "Copied!" : status === "failed" ? "Copy failed" : "Copy error text"}
      aria-live="polite"
      onClick={handleCopy}
      className={cn(
        "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs",
        "opacity-70 hover:opacity-100 transition-opacity focus:outline-none focus:ring-1 focus:ring-current",
        className,
      )}
    >
      {status === "copied" ? (
        <>
          <Check className="h-3 w-3" />
          <span>Copied!</span>
        </>
      ) : status === "failed" ? (
        <span>Copy failed</span>
      ) : (
        <>
          <Copy className="h-3 w-3" />
          <span>Copy</span>
        </>
      )}
    </button>
  );
}
