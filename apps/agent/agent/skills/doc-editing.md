---
description: Creating, editing, or renaming a document — filling stub SOPs, surgical edits to existing docs, rewrites, record titles. Load BEFORE any create_document / update_document / rename_document call.
---

# Document writing procedure

You are about to create or change a document. Follow this procedure — it
exists because every step below was once skipped and shipped a bug.

## Editing an existing document

1. `read_document` FIRST — it returns the full body as faithful HTML.
   Never say you can't read a document's contents; you can.
2. Make the surgical change in the returned HTML. Everything the requester
   didn't ask you to touch stays byte-identical.
3. Send the FULL revised body back with `update_document` and
   `mode: "replace"`. A revision is stashed automatically, so a bad
   replace is recoverable — but never rely on that as an excuse to skip
   step 2's care.
4. Only `mode: "append"` when the ask is genuinely additive (a new section
   at the end); appends merge cleanly with concurrent human edits.

## Titles are yours to set

- The RECORD title (what lists, artifact cards, and search show) is
  separate from the body's `<h1>`. Set it with `rename_document`, or
  `update_document`'s `new_title` to rename and rewrite in one call.
  NEVER tell someone to rename a doc in the UI themselves.
- A doc titled "Untitled" whose body has a real `<h1>` just needs
  `rename_document` to that heading — and `update_document` does this for
  you when you write into an untitled doc without passing `new_title`.
  Check its result and tell the requester what the doc is now called.

## Confirmation rules

- Requested edits, stub-filling, and renames need NO confirmation — do
  them and reply with the link.
- Before REPLACING meaningful content in ways the requester didn't ask
  for, confirm first.
- `archive_document` is approval-gated by the system: call it normally,
  the requester gets an action preview and decides.

## Composing content

- Write complete, finished content — the no-placeholder rule applies with
  full force here: no "TO CONFIRM", no "TBD", no bracketed blanks. A
  missing fact is either asked for, or left out and tracked with a task.
- The tool description lists the allowed HTML vocabulary (headings, lists,
  tables, blockquote, code, callouts). Stay inside it — unknown tags are
  stripped.
- Reply with the document's link (the `url` from the tool result) so the
  requester can open it, and say what the doc is now called.
