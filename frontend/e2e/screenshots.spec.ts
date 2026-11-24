import { test } from "@playwright/test";

// Not a regression check: captures before/after shots for the PR. Run with SHOTS=<label>.
const label = process.env.SHOTS;
const schemes = (process.env.SHOTS_SCHEMES ?? "light,dark").split(",") as ("light" | "dark")[];
const widths = [375, 768, 1280, 1440];

test.skip(!label, "set SHOTS=<label> to capture screenshots");

for (const scheme of schemes) {
  for (const width of widths) {
    test(`${scheme} ${width}px`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/");
      await page.getByText(/37\.9/).first().waitFor();
      await page.waitForTimeout(1500); // let the inspector window finish loading
      // Scroll through once so scroll-reveal sections and draw-on traces are in their final state.
      await page.evaluate(async () => {
        for (let y = 0; y < document.body.scrollHeight; y += 400) {
          window.scrollTo(0, y);
          await new Promise((r) => setTimeout(r, 60));
        }
        window.scrollTo(0, 0);
      });
      await page.waitForTimeout(2800);
      const dir = `../docs/ui-redesign/${label}`;
      await page.screenshot({ path: `${dir}/workbench-${width}-${scheme}.png`, fullPage: true });
      await page.getByRole("button", { name: /Benchmark|Research/ }).first().click();
      await page.waitForTimeout(1000);
      await page.screenshot({ path: `${dir}/research-${width}-${scheme}.png`, fullPage: true });
    });
  }
}
