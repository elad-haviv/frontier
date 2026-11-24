import { Mic, Square } from "lucide-react";
import { Icon } from "./ui/Icon.tsx";
import "./Dictate.css";

/**
 * The microphone beside a text box: tap to start dictation, tap again to stop. While it listens
 * it is red and pulses. It stays focusable and says what it does for screen readers.
 */
export function DictateButton({
  listening,
  onToggle,
  disabled,
  small,
}: {
  listening: boolean;
  onToggle: () => void;
  disabled?: boolean | undefined;
  small?: boolean | undefined;
}) {
  return (
    <button
      type="button"
      className={`dictate${listening ? " is-on" : ""}${small ? " is-small" : ""}`}
      aria-label={listening ? "Stop dictation" : "Dictate"}
      aria-pressed={listening}
      title={listening ? "Stop dictation (Esc)" : "Dictate (Ctrl+Shift+M)"}
      disabled={disabled}
      onClick={onToggle}
    >
      <Icon icon={listening ? Square : Mic} size={small ? "sm" : "md"} />
    </button>
  );
}

/** On a phone, while listening: a bar at the bottom with Stop, so the mic stays under the thumb. */
export function ListeningBar({ onStop }: { onStop: () => void }) {
  return (
    <div className="listening-bar" role="status">
      <span className="listening-wave" aria-hidden="true">
        {Array.from({ length: 18 }, (_, i) => (
          <i key={i} style={{ animationDelay: `${i * 55}ms` }} />
        ))}
      </span>
      <span>Listening</span>
      <button type="button" className="dictate is-on" aria-label="Stop dictation" onClick={onStop}>
        <Icon icon={Square} size="md" />
      </button>
    </div>
  );
}
