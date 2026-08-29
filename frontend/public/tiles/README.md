# Livestream tile captures

The clips a tile falls back to when there is no live Browserbase session —
either because the agent is scripted, or because its session has closed.

One clip per tile, assigned by the agent's seat, so no two tiles play the same
footage. The manifest is `TILE_CLIPS` in `src/lib/fixtures.ts`; add a file here
and add its name there.

    sephora.mp4  shein.mp4  footlocker.mp4  sweelee.mp4  footlocker2.mp4

Each plays muted, looping, `object-fit: cover`, and starts at an offset derived
from the seat so they do not loop in lockstep. `muted` is required — browsers
block autoplay without it.

## Keep them small

Source recordings were ~20 MB each; the tile renders them about 340px wide, so
that resolution is wasted and it bloats the repo permanently. Re-encode before
committing:

    avconvert --source raw.mp4 --output clip.m4v --preset PresetAppleM4V480pSD
    mv clip.m4v frontend/public/tiles/clip.mp4

That took 98 MB down to 8.6 MB with no visible difference at tile size.

A missing file is fine: the tile falls back to the stylized `PageSkeleton`.
