import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Markdown } from "./Markdown.tsx";

const render = (text: string) => renderToStaticMarkup(createElement(Markdown, { text, links: [] }));

describe("Markdown", () => {
  it("draws <u>…</u> as underline, in running text, bold, headings and tables", () => {
    expect(render("A <u>marked</u> word.")).toContain("<p>A <u>marked</u> word.</p>");
    expect(render("**<u>both</u>**")).toContain("<strong><u>both</u></strong>");
    expect(render("## <u>Tides</u>")).toContain("<h2><u>Tides</u></h2>");
    expect(render("| a |\n| - |\n| <u>cell</u> |")).toContain("<td><u>cell</u></td>");
  });

  it("shows a tag without its partner as text, and other HTML is never drawn", () => {
    expect(render("an <u>open tag")).toContain("<p>an &lt;u&gt;open tag</p>");
    expect(render("<b>bold?</b>")).not.toContain("<b>");
  });
});
