import { type ReactNode, useEffect, useRef, useState } from "react";
import { useToast } from "./ui/Toast.tsx";

/**
 * Copies text to the clipboard. When the browser refuses (an insecure page, a locked-down
 * browser), the text is shown in a read-only box, all of it selected, to copy by hand, as the
 * invite link is. `box` goes where that box should appear.
 */
export function useCopyText(name: string): {
  copy: (text: string) => Promise<void>;
  box: ReactNode;
} {
  const toast = useToast();
  const [shown, setShown] = useState<string | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (shown === null) return;
    area.current?.focus();
    area.current?.select();
  }, [shown]);

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setShown(null);
      toast({ message: `Copied the text of ${name}.` });
    } catch {
      setShown(text);
      toast({ message: "The text is selected below. Copy it with your keyboard or menu." });
    }
  }

  const box =
    shown === null ? null : (
      <textarea
        ref={area}
        className="copy-text-box"
        readOnly
        rows={6}
        value={shown}
        aria-label={`The text of ${name}, selected to copy`}
        onFocus={(e) => e.currentTarget.select()}
      />
    );
  return { copy, box };
}
