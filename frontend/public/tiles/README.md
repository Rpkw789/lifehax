# Livestream tile captures

Drop an mp4 here named after the agent id. Only the four ids in
`TILE_IDS` (`src/lib/fixtures.ts`) get a tile:

    A02.mp4  A03.mp4  A08.mp4  A09.mp4

Each plays muted, looping, `object-fit: cover` inside the tile viewport.
`muted` is required — browsers block autoplay without it.

A missing file is fine: the tile falls back to the stylized `PageSkeleton`,
so you can ship with none, some, or all four.

Keep them short (5-15s) and roughly 4:3 — they loop, and the ring, caption
and log lines are drawn on top, so avoid captures with important detail in
the bottom strip.
