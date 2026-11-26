import { test } from "@playwright/test";

// Not a regression check: captures one shot per stage for the PR, in scene mode and in Clinical mode.
// Run with SHOTS=<label>; files land in docs/ui-redesign/<label>/<mode>/.
const label = process.env.SHOTS;
const sizes = [[375, 812], [768, 900], [1280, 720], [1440, 900], [1920, 1080]];
const stages = ["start", "result", "night", "signals", "how", "research"];

test.skip(!label, "set SHOTS=<label> to capture screenshots");

for (const mode of ["scene", "clinical"] as const) {
  for (const [width, height] of sizes) {
    test(`${mode} stages at ${width}px`, async ({ page }) => {
      await page.addInitScript((v) => localStorage.setItem("cb-clinical", v), mode === "clinical" ? "on" : "off");
      await page.setViewportSize({ width, height });
      await page.goto("/");
      await page.getByRole("button", { name: "Try a sample night" }).first().click(); // nothing loads until asked
      await page.getByText(/37\.9/).first().waitFor();
      await page.evaluate(() => (window.location.hash = "/start"));
      await page.waitForTimeout(6000); // hero ECG finishes drawing, a sheep reaches the fence
      const pause = page.getByRole("button", { name: "Pause scene" });
      if (await pause.count()) await pause.click(); // freeze the sheep so shots are stable
      for (const id of stages) {
        await page.evaluate((h) => (window.location.hash = h), `/${id}`);
        await page.waitForTimeout(1300);
        await page.screenshot({ path: `../docs/ui-redesign/${label}/${mode}/${id}-${width}.png` });
      }
    });
  }
}
