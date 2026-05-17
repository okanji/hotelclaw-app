/**
 * Direct-messages landing — the "nothing selected" state for the DMs section.
 *
 * DM conversations render at `/chat/<channelId>`, shared with team channels,
 * so DMs need their own index: the `/chat` index redirects to the first team
 * channel, which would wrongly surface a channel under the DMs rail. The DM
 * list itself lives in the section sidebar (`DmsSection`).
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
