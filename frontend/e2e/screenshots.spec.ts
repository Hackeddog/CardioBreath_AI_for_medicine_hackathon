import { test } from "@playwright/test";

// Not a regression check: captures one shot per stage for the PR. Run with SHOTS=<label>.
const label = process.env.SHOTS;
const widths = [375, 768, 1440];
const stages = ["start", "result", "night", "signals", "how", "research"];

test.skip(!label, "set SHOTS=<label> to capture screenshots");

for (const width of widths) {
  test(`stages at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width < 600 ? 812 : 900 });
    await page.goto("/");
    await page.getByRole("button", { name: "Pause scene" }).click(); // freeze cars so shots are stable
    await page.getByText(/37\.9/).first().waitFor();
    await page.waitForTimeout(3000); // hero ECG finishes drawing, inspector window loads
    for (const id of stages) {
      await page.evaluate((h) => (window.location.hash = h), `/${id}`);
      await page.waitForTimeout(1300);
      await page.screenshot({ path: `../docs/ui-redesign/${label}/${id}-${width}.png` });
    }
  });
}
