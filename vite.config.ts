import license from "rollup-plugin-license";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // the site is served from a sub-path on GitHub Pages
  base: process.env.BASE_PATH ?? "/",
  build: {
    target: "es2022",
    // pdf.js is large; it is split into its own file
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        // serve the pdf.js worker as .js, which every static host knows
        assetFileNames: (asset) =>
          asset.names.some((name) => name.endsWith(".mjs"))
            ? "assets/[name]-[hash].js"
            : "assets/[name]-[hash][extname]",
      },
      plugins: [
        // collect the licences of the bundled packages for
        // scripts/third-party-notices.js
        license({
          thirdParty: {
            includePrivate: false,
            output: {
              file: "node_modules/.cache/third-party-licences.json",
              template: (dependencies) =>
                JSON.stringify(
                  dependencies.map(
                    ({
                      name,
                      version,
                      license: id,
                      licenseText,
                      noticeText,
                      repository,
                    }) => ({
                      name,
                      version,
                      license: id,
                      licenseText,
                      noticeText,
                      repository:
                        typeof repository === "string" ? repository : repository?.url,
                    }),
                  ),
                  null,
                  2,
                ),
            },
          },
        }),
      ],
    },
  },
  worker: {
    format: "es",
  },
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
