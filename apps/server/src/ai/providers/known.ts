/**
 * What a model can do, for the providers whose model list does not say. These are read from the
 * model's name, by family, and only where the family is well known; anything else is left
 * unknown (null) rather than guessed. Prices are never guessed.
 */
import type { ModelAbilities } from "@frontier/schema";

export interface Known {
  abilities: ModelAbilities;
  textOut: boolean | null;
  /** Leave the model out of the list: embeddings, speech, moderation and the like. */
  skip?: boolean;
}

const unknown: Known = {
  abilities: {
    structuredOutput: null,
    imagesIn: null,
    imageOut: null,
    reasoning: null,
    tools: null,
  },
  textOut: null,
};

const imageOnly: Known = {
  abilities: {
    structuredOutput: false,
    imagesIn: null,
    imageOut: true,
    reasoning: false,
    tools: false,
  },
  textOut: false,
};

export function openaiModel(id: string): Known {
  const m = id.toLowerCase();
  if (
    /(embedding|whisper|tts|transcribe|moderation|davinci|babbage|realtime|audio|search|computer-use|codex-mini|sora)/.test(
      m,
    )
  ) {
    return { ...unknown, skip: true };
  }
  if (/^(gpt-image|dall-e|chatgpt-image)/.test(m)) return imageOnly;
  const reasoning = /^(o\d|gpt-5)/.test(m);
  // json_schema answers came with gpt-4o (2024-08) and the o1 that followed its preview.
  const structured =
    /^(gpt-4o|gpt-4\.1|gpt-4\.5|gpt-5|o1(?!-preview|-mini)|o3|o4|chatgpt-4o)/.test(m) &&
    !/gpt-4o-2024-05-13/.test(m);
  if (/^(gpt-|o\d|chatgpt-)/.test(m)) {
    return {
      abilities: {
        structuredOutput: structured ? true : /^gpt-(3\.5|4)(?!o|\.)/.test(m) ? false : null,
        imagesIn: /^(gpt-4o|gpt-4\.1|gpt-4\.5|gpt-5|o1(?!-mini|-preview)|o3|o4|chatgpt-4o)/.test(m)
          ? true
          : null,
        imageOut: false,
        reasoning,
        tools: /^(gpt-|o3|o4|o1(?!-mini|-preview))/.test(m) ? true : null,
      },
      textOut: true,
    };
  }
  return unknown;
}

export function xaiModel(id: string): Known {
  const m = id.toLowerCase();
  if (/embed/.test(m)) return { ...unknown, skip: true };
  if (/image|imagine/.test(m)) return imageOnly;
  if (!m.startsWith("grok")) return unknown;
  return {
    abilities: {
      // Structured answers: grok-2-1212 and every grok after it.
      structuredOutput: /^grok-(2-1212|2-vision-1212|[3-9])/.test(m) ? true : null,
      imagesIn: /vision|^grok-4/.test(m) ? true : null,
      imageOut: false,
      reasoning: /^grok-(3-mini|4)/.test(m) ? true : /^grok-(2|3)(?!-mini)/.test(m) ? false : null,
      tools: true,
    },
    textOut: true,
  };
}

export function anthropicModel(id: string): Known {
  const m = id.toLowerCase();
  if (!m.startsWith("claude")) return unknown;
  const old = /^claude-(instant|2|3-(haiku|sonnet|opus)|3-5)/.test(m);
  return {
    abilities: {
      // Older models answer through a forced tool call, which the adapter falls back to.
      structuredOutput: true,
      imagesIn: !/^claude-(instant|2)/.test(m),
      imageOut: false,
      reasoning: old ? false : true,
      tools: !/^claude-(instant|2)/.test(m),
    },
    textOut: true,
  };
}

export function googleModel(id: string, methods: string[], thinking: unknown): Known {
  const m = id.toLowerCase();
  if (/embedding|aqa|tts|native-audio|live/.test(m)) return { ...unknown, skip: true };
  const generates = methods.length === 0 || methods.includes("generateContent");
  if (!generates) return { ...unknown, skip: true };
  if (/^imagen/.test(m)) return { ...imageOnly, skip: true }; // :predict, not generateContent
  const imageOut = /image/.test(m);
  return {
    abilities: {
      structuredOutput: /^gemma/.test(m) ? false : imageOut ? false : true,
      imagesIn: /^gemini/.test(m) ? true : null,
      imageOut,
      reasoning:
        typeof thinking === "boolean" ? thinking : /^gemini-(2\.5|[3-9])/.test(m) ? true : null,
      tools: /^gemini/.test(m) && !imageOut ? true : null,
    },
    textOut: true,
  };
}

export const unknownModel = (): Known => unknown;
