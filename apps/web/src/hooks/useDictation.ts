import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/** The parts of the browser's speech recognition that Frontier uses. */
interface Recognizer {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onresult:
    | ((e: {
        results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
      }) => void)
    | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}
type RecognizerClass = new () => Recognizer;

const recognizerClass = (): RecognizerClass | null => {
  const w = globalThis as unknown as {
    SpeechRecognition?: RecognizerClass;
    webkitSpeechRecognition?: RecognizerClass;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
};

/** What was said, set after what the box held when dictation began. */
export function joinSpeech(base: string, spoken: string): string {
  const said = spoken.trim();
  if (said === "") return base;
  const before = base.replace(/\s+$/, "");
  return before === "" ? said : `${before} ${said}`;
}

/** Why dictation stopped, in words, for the codes the browser gives; null when nothing is wrong. */
export function dictationProblem(code: string): string | null {
  switch (code) {
    case "not-allowed":
    case "service-not-allowed":
      return "Microphone access was refused. Allow it in the browser's settings, or type instead.";
    case "audio-capture":
      return "No microphone was found. Connect one, or type instead.";
    case "network":
      return "Dictation needs a connection in this browser. Type instead, or try again.";
    case "no-speech":
      return "Heard nothing. Try again.";
    case "aborted":
      return null;
    default:
      return "Dictation stopped. Try again, or type instead.";
  }
}

/**
 * Dictation with the browser's own speech recognition: tap to start, tap to stop. The words are
 * given to `onText` as the whole text, the box's earlier text first, so the box stays editable and
 * nothing is sent. Browsers without it report `supported` as false.
 */
export function useDictation(onText: (text: string) => void) {
  const supported = useMemo(() => recognizerClass() !== null, []);
  const [listening, setListening] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const rec = useRef<Recognizer | null>(null);
  const latest = useRef(onText);
  latest.current = onText;

  const start = useCallback((base: string) => {
    const Recognition = recognizerClass();
    if (!Recognition || rec.current) return;
    const r = new Recognition();
    r.continuous = true;
    r.interimResults = true;
    r.lang = globalThis.navigator?.language || "en-US";
    r.onresult = (e) => {
      let spoken = "";
      for (let i = 0; i < e.results.length; i += 1) spoken += e.results[i]![0]!.transcript;
      latest.current(joinSpeech(base, spoken));
    };
    r.onerror = (e) => setProblem(dictationProblem(e.error));
    r.onend = () => {
      rec.current = null;
      setListening(false);
    };
    setProblem(null);
    rec.current = r;
    try {
      r.start();
      setListening(true);
    } catch {
      rec.current = null;
      setProblem(dictationProblem("other"));
    }
  }, []);

  const stop = useCallback(() => rec.current?.stop(), []);
  useEffect(() => () => rec.current?.abort(), []);

  return { supported, listening, problem, start, stop, clearProblem: () => setProblem(null) };
}
