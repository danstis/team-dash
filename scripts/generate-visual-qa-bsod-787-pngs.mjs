/** Render the BSOD-787 component captures with the built app CSS. */
import { homedir } from "node:os";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

import { chromium } from "playwright-core";

const root = process.cwd();
const captureDir = resolve(root, ".multica/visual-qa");
const outputDir = resolve(root, "docs/visual-qa");
const chromiumPath = resolve(
  homedir(),
  ".cache/ms-playwright/chromium-1234/chrome-linux64/chrome",
);
const states = ["default", "all-time", "custom-editor"];
const viewports = [
  { name: "desktop", width: 1280, height: 720 },
  { name: "narrow", width: 390, height: 760 },
];

const cssFiles = (await readdir(resolve(root, "dist/assets"))).filter((name) =>
  name.endsWith(".css"),
);
if (cssFiles.length !== 1) {
  throw new Error(
    `Expected one built app stylesheet; found ${cssFiles.length}`,
  );
}
const css = await readFile(resolve(root, "dist/assets", cssFiles[0]), "utf8");
const browser = await chromium.launch({
  headless: true,
  executablePath: chromiumPath,
});

try {
  for (const viewport of viewports) {
    const context = await browser.newContext({
      viewport,
      deviceScaleFactor: 1,
      colorScheme: "light",
    });
    const page = await context.newPage();
    for (const state of states) {
      const body = await readFile(
        resolve(captureDir, `bsod-787-${state}.html`),
        "utf8",
      );
      await page.setContent(
        `<!doctype html><html lang="en-AU" data-theme="light"><head>` +
          `<meta charset="utf-8"><style>${css}</style></head>` +
          `<body>${body}</body></html>`,
        { waitUntil: "load" },
      );
      const output = resolve(
        outputDir,
        `bsod-787-${viewport.name}-${state}.png`,
      );
      await page.screenshot({ path: output, fullPage: true });

      const layout = await page.evaluate(() => {
        const identity = document.querySelector(".td-dashboard__identity");
        const period = document.querySelector(".td-dashboard__period");
        const actions = document.querySelector(".td-dashboard__actions");
        const select = document.querySelector(".td-dashboard__period-select");
        const label = document.querySelector(".td-dashboard__period-label");
        if (!identity || !period || !actions || !select || !label) {
          throw new Error("The captured dashboard controls are incomplete");
        }
        const rectangles = [identity, period, actions].map((element) =>
          element.getBoundingClientRect(),
        );
        const overlaps = rectangles.some((left, index) =>
          rectangles
            .slice(index + 1)
            .some(
              (right) =>
                left.left < right.right &&
                right.left < left.right &&
                left.top < right.bottom &&
                right.top < left.bottom,
            ),
        );
        return {
          horizontalOverflow:
            document.documentElement.scrollWidth > window.innerWidth + 1,
          headerOverlap: overlaps,
          labelMargin: getComputedStyle(label).margin,
          selectWidth: getComputedStyle(select).width,
        };
      });
      process.stdout.write(`${output}: ${JSON.stringify(layout)}\n`);
      if (layout.horizontalOverflow || layout.headerOverlap) {
        throw new Error(`Layout defect in ${viewport.name} ${state}`);
      }
    }
    await context.close();
  }
} finally {
  await browser.close();
}
