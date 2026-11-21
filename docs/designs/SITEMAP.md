# Design documents

| Design | Date | Author | Components | Description |
| --- | --- | --- | --- | --- |
| [Frontier](frontier.md) | 2026-11-20 | Elad Haviv | Whole app; file-level plan for stages 1 and 2 (foundation, reader and editor) | Master specification: product, architecture and data formats for all nine stages of the Avalymia worldbuilding app. |
| [Frontier's own library](own-library.md) | 2026-11-21 | Elad Haviv | Where the knowledge base lives; versions; import; export | Changes the method: Frontier keeps its own library and is its only writer, instead of sharing a GitHub repository. Newer than the parent where they differ. |
| [Stage 3: review inbox, AI basics, structured fields](stage-3-review-and-ai-basics.md) | 2026-11-21 | Elad Haviv | Inbox for agent branches; fields, schema and ids; AI provider, cost log and field proposals; quarantine; passkey | Formats and rules for stage 3, in five parts built in order. |
| [Stage 4: maps](stage-4-maps.md) | 2026-11-21 | Elad Haviv | Map files, the WebGL viewer for flat maps and globes, markers, paths, zones, layers, measuring | Formats and rules for stage 4, in five parts built in order. |

Status: Approved on 2026-11-20 after a five-stage review. The review reports are in this repository's Git
history (removed from the working tree in the commit that approved the design).

The stage 3 and stage 4 designs are drafts, each revised after one implementation-readiness review.
The author has not yet read them. Stage 3 is built; stage 4 is being built.

Later stages (5 to 9) each get their own design document, registered here before they are built.
