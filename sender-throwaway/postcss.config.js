// This app doesn't use Tailwind/PostCSS plugins — plain CSS only
// (see src/index.css). This file exists purely so postcss-load-config
// stops its upward directory search here, instead of picking up a
// different project's postcss.config.mjs from a parent folder (which is
// what caused the "Cannot find module 'tailwindcss'" error — that config
// belongs to the `viewer` app, not this one).
export default {
  plugins: {},
};
