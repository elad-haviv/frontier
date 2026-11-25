import * as Popover from "@radix-ui/react-popover";
import {
  allBiomes,
  type Biome,
  BIOME_GROUP_NAMES,
  BIOME_GROUPS,
  type CustomBiome,
  type Pattern,
  speedWords,
} from "@frontier/schema";
import { Command } from "cmdk";
import { Check, ChevronsUpDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { drawSwatch } from "../../map/biomeLegend.ts";
import { Icon } from "../ui/Icon.tsx";
import "../ui/Combobox.css";
import "./Biomes.css";

/** A biome drawn small: its colour with its pattern over it; dashed for a suggestion. */
export function BiomeSwatch({
  colour,
  pattern,
  ghost = false,
  width = 30,
  height = 18,
}: {
  colour: string;
  pattern: Pattern | null;
  ghost?: boolean;
  width?: number;
  height?: number;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = canvas.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx) return;
    const ratio = window.devicePixelRatio || 1;
    c.width = Math.round(width * ratio);
    c.height = Math.round(height * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    drawSwatch(ctx, { colour, pattern, ghost }, 0, 0, width, height, ratio);
  }, [colour, pattern, ghost, width, height]);
  return (
    <canvas
      ref={canvas}
      className="biome-swatch"
      style={{ width, height }}
      aria-hidden="true"
      data-pattern={pattern ?? "none"}
    />
  );
}

/** The biomes in the picker's groups: Water, Cold, Temperate, Warm, High, Made by you. */
export function biomeGroups(custom: readonly CustomBiome[]): { group: string; biomes: Biome[] }[] {
  const all = allBiomes(custom);
  return BIOME_GROUPS.map((g) => ({
    group: BIOME_GROUP_NAMES[g],
    biomes: all.filter((b) => b.group === g),
  })).filter((g) => g.biomes.length > 0);
}

/**
 * Chooses a zone's biome: a button showing the choice, which opens a list of the biomes with
 * their patterns, grouped, each with its cart speed so the choice has visible weight. Typing
 * narrows it; the arrow keys move through it, Enter picks and Esc closes. On a phone the list
 * opens as a sheet at the foot of the screen.
 */
export function BiomePicker({
  value,
  onChange,
  custom,
  label = "Biome",
  none = "No biome",
  colourOf,
  compact = false,
}: {
  value: string | null;
  onChange: (biome: string | null) => void;
  custom: readonly CustomBiome[];
  /** The picker's name, read by a screen reader. */
  label?: string;
  /** What "no biome" is called here. */
  none?: string;
  /** The colour a biome's swatch is drawn in: its usual one unless said. */
  colourOf?: (b: Biome) => string;
  /** In a tool's bar: a smaller button. */
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const groups = biomeGroups(custom);
  const chosen = groups.flatMap((g) => g.biomes).find((b) => b.id === value) ?? null;
  const colour = (b: Biome) => colourOf?.(b) ?? b.color;
  const pick = (next: string | null) => {
    onChange(next);
    setOpen(false);
  };
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-label={`${label}: ${chosen?.name ?? none}`}
          className={`ui-combobox-trigger biome-trigger${compact ? " is-compact" : ""}`}
        >
          {chosen ? (
            <BiomeSwatch colour={colour(chosen)} pattern={chosen.pattern} width={24} height={16} />
          ) : (
            <span className="biome-swatch biome-swatch-none" aria-hidden="true" />
          )}
          <span className={`ui-combobox-value${chosen ? "" : " is-empty"}`}>
            {chosen?.name ?? none}
          </span>
          <Icon icon={ChevronsUpDown} size="sm" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="ui-combobox biome-list"
          align="start"
          sideOffset={4}
          collisionPadding={8}
        >
          <Command label={`Choose a ${label.toLowerCase()}`} loop>
            <Command.Input className="ui-combobox-find" placeholder="Find a biome" />
            <Command.List className="ui-combobox-list">
              <Command.Empty className="ui-combobox-empty">No biome is called that.</Command.Empty>
              <Command.Item value={none} className="ui-combobox-item" onSelect={() => pick(null)}>
                <span className="biome-option">
                  <span className="biome-swatch biome-swatch-none" aria-hidden="true" />
                  {none}
                </span>
                {value === null && <Icon icon={Check} size="sm" />}
              </Command.Item>
              {groups.map((g) => (
                <Command.Group key={g.group} heading={g.group} className="biome-group">
                  {g.biomes.map((b) => (
                    <Command.Item
                      key={b.id}
                      value={`${b.name} ${b.id}`}
                      className="ui-combobox-item"
                      onSelect={() => pick(b.id)}
                    >
                      <span className="biome-option">
                        <BiomeSwatch colour={colour(b)} pattern={b.pattern} />
                        <span>{b.name}</span>
                      </span>
                      <span className="biome-option-note">
                        cart {speedWords(b.speed.cart)}
                        {b.id === value && <Icon icon={Check} size="sm" />}
                      </span>
                    </Command.Item>
                  ))}
                </Command.Group>
              ))}
            </Command.List>
          </Command>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
