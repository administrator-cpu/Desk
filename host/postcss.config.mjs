// This app doesn't use Tailwind/PostCSS plugins — plain CSS only
// (see src/renderer/index.css). This file exists purely so
// postcss-load-config stops its upward directory search here, instead of
// picking up a different project's postcss.config.mjs from a parent folder.
export default {
  plugins: {},
};
