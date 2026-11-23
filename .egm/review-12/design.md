# Stage 12 — design critic (raw)

B1 pandoc <u> -> raw html; rewrite to [x]{.underline} in pandoc input (skip code), test docx/typst/pptx.
M2 allowlist ipaddr.js unicast after IPv4-mapped; check every resolved address; undici Agent connect.lookup pin; no proxy env; redirect manual + recheck.
M3 ports 80/443 only; refuse host's own public addresses; one generic error message; detail in log.
M4 refuse SVG from web addresses (rasterise or refuse).
M5 format->ext table (jpeg->jpg, png, webp, gif, heif->avif), refuse others; reuse upload name cleaning + length cap + nextFreeName.
M6 DNS via dns.promises.Resolver with timeout; Content-Length >25MB refuse early; count decoded bytes; Accept-Encoding identity.
M7 library order data absent; include image drafts (unpublished); one order; lazy render.
M8 context menu kills spell-check: Shift+right-click native, or only when selection; selection captured on pointerdown, focus back; paste via view.dispatch input.paste with normalisation, clipboard.read() images to upload; cut deletes after writeText.
M9 long press on iOS conflicts; phones use toolbar ⋯ instead, no long-press menu.
M10 Ctrl+Shift+W reserved.
M11 heading ids: rehype step ids by position/source line; strip marks in sticky/outline; duplicates.
M12 rename then move: modify pending intent in place.
Nits: underline plugin on any inline parent; html block cases; plainForQuotes (ai/lore.ts:327) & search snippets strip <u>; anchors use raw offsets — drop sentence; extend editCommands.ts; Tab outside lists, list indent width (3 under "1."), toggle/unwrap; wrong refs §6->§7, ED-1; Paste button clipboard.read; History with pending rename/follow; Export offline; add alternatives (native menu; fetch worker) and risks.
