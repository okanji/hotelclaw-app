/**
 * Direct-messages landing — the "nothing selected" state for the DMs section.
 *
 * DM conversations render at `/dms/<channelId>` (their own route, distinct
 * from team channels at `/chat/<channelId>`); this index is just the empty
 * state shown until one is picked. The DM list itself lives in the section
 * sidebar (`DmsSection`).
 */
export default function DmsIndex() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-12 text-center">
      <h2 className="text-lg font-semibold">No conversation selected</h2>
      <p className="text-sm text-muted-foreground">
        Pick a direct message from the sidebar, or start a new one with the
        + button.
      </p>
    </div>
  );
}
