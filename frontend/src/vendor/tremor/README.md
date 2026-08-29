# Vendored Tremor

Copied from https://github.com/tremorlabs/tremor, not installed.

`@tremor/react` on npm still peers to React 18 and this app is on React 19, and
the `tremor-raw` package the docs name is not on the registry. Copying the
source is the path Tremor itself documents for this case.

Two edits were made: the import paths were rewritten, and `@ts-nocheck` was
added at the top because this repo runs `strict` and Tremor does not. **Do not edit these files** — to take an
upstream fix, re-copy and redo that one rewrite.

Styling needs Tailwind, which is why `src/app/tremor.css` exists. It imports
Tailwind's theme and utilities but NOT preflight, whose global reset would
restyle the five screens that use CSS Modules.
