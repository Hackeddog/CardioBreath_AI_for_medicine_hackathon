import path from "node:path";
import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const SAMPLES = path.resolve(__dirname, "../../sample_uploads");

// Scoped: Next.js adds its own empty role="alert" route announcer.
const notice = (page: Page) => page.getByRole("region", { name: "Screening workbench" }).getByRole("alert");
const triage = (page: Page) => page.getByRole("region", { name: "Screening result" });

async function loadSample(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Try a sample night" }).first().click();
  await expect(triage(page)).toContainText("37.9");
  await expect(page.getByText("Updating result…")).toHaveCount(0);
}

test("sample night is requested once and shows the x08 result", async ({ page }) => {
  const analyzeCalls: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/api/analyze/case/")) analyzeCalls.push(r.url());
  });
  await loadSample(page);
  const t = triage(page);
  await expect(t).toContainText("Severe");
  await expect(t).toContainText("35.5 to 40.3");
  await expect(t).toContainText("Sleep-lab reference 37.6");
  await expect(t).toContainText(/priority PSG referral/i);
  await page.waitForTimeout(1000);
  expect(analyzeCalls).toHaveLength(1);
});

test("valid CSV upload replaces the sample result", async ({ page }) => {
  await loadSample(page);
  await page.locator('input[type="file"]').setInputFiles(path.join(SAMPLES, "sample_apnea_10min.csv"));
  await expect(triage(page)).toContainText("Uploaded ECG");
  await expect(notice(page)).toHaveCount(0);
});

test("non-numeric CSV shows a plain-language 400 message with the expected format", async ({ page }) => {
  await loadSample(page);
  await page.locator('input[type="file"]').setInputFiles({
    name: "bad.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("time,ecg\nabc,def\nghi,jkl\n"),
  });
  const alert = notice(page);
  await expect(alert).toContainText("We couldn't read this ECG file");
  await expect(alert).toContainText("Expected format");
});

test("expired upload on re-analysis says to upload again", async ({ page }) => {
  await loadSample(page);
  await page.locator('input[type="file"]').setInputFiles(path.join(SAMPLES, "sample_normal_8min.csv"));
  await expect(triage(page)).toContainText("Uploaded ECG");
  await page.route("**/api/analyze/case/**", (r) => r.fulfill({ status: 404, json: { detail: "Unknown case_id" } }));
  await page.getByRole("button", { name: "10 dB" }).click();
  await expect(notice(page)).toContainText("This upload has expired");
});

test("server errors never show internals", async ({ page }) => {
  await loadSample(page);
  await page.route("**/api/analyze/case/**", (r) =>
    r.fulfill({ status: 500, body: "Traceback (most recent call last): File \"/app/backend/app/inference.py\"" })
  );
  await page.getByRole("button", { name: "5 dB" }).click();
  const alert = notice(page);
  await expect(alert).toContainText("Something went wrong on our side");
  await expect(alert).not.toContainText("Traceback");
  await expect(alert).not.toContainText("inference.py");
});

test("dragging the cutoff: the last value wins", async ({ page }) => {
  await loadSample(page);
  const slider = page.locator("#threshold");
  await slider.focus();
  // Pauses longer than the debounce, so several requests overlap in flight.
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press("ArrowLeft");
    await page.waitForTimeout(450);
  }
  await page.keyboard.press("Home");
  await expect(slider).toHaveValue("0.25");
  const cutoff = page.locator("svg text", { hasText: "cutoff" });
  await expect(cutoff).toHaveText("cutoff 0.25");
  await expect(page.getByText("Updating result…")).toHaveCount(0);
  await page.waitForTimeout(1500);
  await expect(cutoff).toHaveText("cutoff 0.25");
});

test("keyboard reaches every control, including both sliders", async ({ page }) => {
  await loadSample(page);
  await page.locator("body").focus();
  const seen = new Set<string>();
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press("Tab");
    seen.add(
      await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        return el?.id || el?.getAttribute("aria-label") || el?.textContent?.trim().slice(0, 40) || "";
      })
    );
  }
  expect(seen).toContain("threshold");
  expect(seen).toContain("Selected minute of the night");
  expect(seen).toContain("case-select");

  const timeline = page.getByRole("slider", { name: "Selected minute of the night" });
  const before = Number(await timeline.getAttribute("aria-valuenow"));
  await timeline.focus();
  await page.keyboard.press("ArrowRight");
  await expect(timeline).toHaveAttribute("aria-valuenow", String(before + 1));
});

for (const scheme of ["light", "dark"] as const) {
  test(`no serious or critical axe violations (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await loadSample(page);
    await page.getByRole("heading", { name: /Signal inspector ·/ }).waitFor();
    const check = async (view: string) => {
      const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
      const bad = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
      expect(bad.map((v) => `${view}: ${v.id} (${v.nodes.length})`)).toEqual([]);
    };
    await check("workbench");
    await page.getByRole("button", { name: "Research" }).click();
    await page.getByRole("heading", { name: "Validation and limitations" }).waitFor();
    await check("research");
  });
}

test.describe("reduced motion", () => {
  test.use({ reducedMotion: "reduce" });
  test("transitions are effectively off", async ({ page }) => {
    await loadSample(page);
    const d = await page.locator(".btn-primary").first().evaluate((el) => getComputedStyle(el).transitionDuration);
    expect(parseFloat(d)).toBeLessThan(0.001);
  });
});
