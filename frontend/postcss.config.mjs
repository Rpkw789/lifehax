// Tailwind is here only for the vendored Tremor chart in src/vendor/tremor.
// The rest of the app is CSS Modules; see src/app/tremor.css for why preflight
// is deliberately not imported.
export default {
  plugins: { "@tailwindcss/postcss": {} },
};
