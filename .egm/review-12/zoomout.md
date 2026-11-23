# Stage 12 — zoom out + inventive (raw)

B1 pandoc 3.1.3 parses <u> as RawInline html; docx/typst lose underline. Fix: in oneDocument() rewrite <u>x</u> -> [x]{.underline} before pandoc; test docx and typst.
M1 paste/drop images already work in CodeEditor (lines 32,102-105); drop Paste tab and drop zone; dialog = Library + Upload… button + URL field; reword Problem.
M2 editCommands.ts exists (wrap, linePrefix, wrapCommand) — extend it.
M3 Ctrl+Shift+W closes window in Chrome; drop. Ctrl+Alt+digit = AltGr on EU layouts; use Ctrl+Shift+1-6 or none.
M4 address block list incomplete; invert: allow only ipaddr.process(a).range()==='unicast' (ipaddr.js direct dep); keep pinning.
M5 phone: no second sticky line; slim line title becomes entry › heading + outline button (shell title context, coordinate with 11b).
M6 rename then move: replace pending intent (delete old, post one from published path to final).
M7 offline image upload not accepted in brief; say online-only until stage 15.
Nits: library order one rule (existing order: used first); draft images missing from /api/gallery — include drafts; heading ids: observe rendered .prose headings directly; toolbar overflow via CSS container queries; lists: check lang-markdown renumber; Shift+Tab already bound keys.ts:316; drop item 6; delete Rename.tsx, plain redirect; one name-check helper in @frontier/vault; remarkUnderline dependency-free or in web; ED ids wrong (Preview = ED-1); G11 section; mention Properties already moved in 11b; History/Export: option to author (list-only panel; Export submenu) — author asked for side bar, keep; context menu: Shift+right-click falls through.
