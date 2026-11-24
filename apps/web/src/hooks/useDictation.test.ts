import { afterEach, describe, expect, it, vi } from "vitest";
import { dictationProblem, joinSpeech } from "./useDictation.ts";

afterEach(() => vi.unstubAllGlobals());

describe("joinSpeech", () => {
  it("puts what was said after what the box held, with one space between", () => {
    expect(joinSpeech("How do the Nirani", "keep time")).toBe("How do the Nirani keep time");
    expect(joinSpeech("A line.  \n", " and more ")).toBe("A line. and more");
  });
  it("starts the box with the words when it was empty, and changes nothing for silence", () => {
    expect(joinSpeech("", "  hello ")).toBe("hello");
    expect(joinSpeech("kept as it was ", "   ")).toBe("kept as it was ");
  });
});

describe("dictationProblem", () => {
  it("says in words why dictation stopped", () => {
    expect(dictationProblem("not-allowed")).toMatch(/refused/);
    expect(dictationProblem("service-not-allowed")).toMatch(/refused/);
    expect(dictationProblem("audio-capture")).toMatch(/microphone/i);
    expect(dictationProblem("network")).toMatch(/connection/);
    expect(dictationProblem("no-speech")).toBe("Heard nothing. Try again.");
    expect(dictationProblem("something-else")).toMatch(/stopped/);
  });
  it("is silent when the author stopped it", () => {
    expect(dictationProblem("aborted")).toBeNull();
  });
});
