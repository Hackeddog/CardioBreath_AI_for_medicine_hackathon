import path from "node:path";
import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const SAMPLES = path.resolve(__dirname, "../../sample_uploads");

// Next.js adds its own empty role="alert" route announcer, so only count alerts with text.
const notice = (page: Page) => page.getByRole("alert").filter({ hasText: /\S/ });
const triage = (page: Page) => page.getByRole("region", { name: "Screening result" });
const stageTab = (page: Page, name: string) =>
  page.getByRole("navigation", { name: "Stages" }).getByRole("button", { name, exact: true });

// The cutoff slider lives in a disclosure under the result.
async function openCutoff(page: Page) {
  await page.getByText("Adjust cutoff, compare baseline").click();
  await expect(page.locator("#threshold")).toBeVisible();
}

async function loadSample(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Try a sample night" }).first().click();
  await expect(page).toHaveURL(/#\/result$/);
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

test("stages move sideways with arrow keys, tabs and the back button", async ({ page }) => {
  await page.goto("/");
  await page.locator("body").press("ArrowRight");
  await expect(page).toHaveURL(/#\/result$/);
  await stageTab(page, "Research").click();
  await expect(page).toHaveURL(/#\/research$/);
  await expect(page.getByRole("heading", { name: "Validation and limitations" })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/#\/result$/);
  await page.goto("/#/night");
  await expect(page.getByText("Stage 3 of 6 · Night")).toBeVisible();
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
  await openCutoff(page);
  const slider = page.locator("#threshold");
  await slider.focus();
  // Pauses longer than the debounce, so several requests overlap in flight.
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press("ArrowLeft");
    await page.waitForTimeout(450);
  }
  await page.keyboard.press("Home");
  await expect(slider).toHaveValue("0.25");
  await expect(page).toHaveURL(/#\/result$/); // arrows on a slider must not change the stage
  const cutoff = page.locator("svg text", { hasText: "cutoff" });
  await expect(cutoff).toHaveText("cutoff 0.25");
  await expect(page.getByText("Updating result…")).toHaveCount(0);
  await page.waitForTimeout(1500);
  await expect(cutoff).toHaveText("cutoff 0.25");
});

test("keyboard reaches every control, including both sliders", async ({ page }) => {
  await loadSample(page);
  await openCutoff(page);
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
  expect(seen).toContain("case-select");

  await stageTab(page, "Night").click();
  const timeline = page.getByRole("slider", { name: "Selected minute of the night" });
  const before = Number(await timeline.getAttribute("aria-valuenow"));
  await timeline.focus();
  await page.keyboard.press("ArrowRight");
  await expect(timeline).toHaveAttribute("aria-valuenow", String(before + 1));
  await expect(page).toHaveURL(/#\/night$/);
});

test("guided tour walks through the stages and closes with Escape", async ({ page }) => {
  await loadSample(page);
  await page.getByRole("button", { name: "Tour", exact: true }).click();
  const tour = page.getByRole("dialog");
  await expect(tour).toContainText("Step 1 of 8");
  await expect(page).toHaveURL(/#\/start$/);
  for (let i = 0; i < 4; i++) await tour.getByRole("button", { name: "Next" }).click();
  await expect(tour).toContainText("Step 5 of 8");
  await expect(page).toHaveURL(/#\/night$/);
  await page.keyboard.press("Escape");
  await expect(tour).toHaveCount(0);
});

test("background scene runs by default and can be paused", async ({ page }) => {
  await page.goto("/");
  const scene = page.locator("canvas[data-scene]");
  await expect(scene).toHaveAttribute("data-running", "true");
  // The canvas actually changes between frames while running.
  const shot = () => scene.evaluate((c: HTMLCanvasElement) => c.toDataURL().length + ":" + c.toDataURL().slice(-200));
  await page.waitForTimeout(1500);
  const a = await shot();
  await page.waitForTimeout(400);
  expect(await shot()).not.toBe(a);
  await page.getByRole("button", { name: "Pause scene" }).click();
  await expect(scene).toHaveAttribute("data-running", "false");
  await expect(page.getByRole("button", { name: "Play scene" })).toBeVisible();
});

test("music starts only when asked and stops again", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  const music = page.getByRole("button", { name: "Music" });
  await expect(music).toHaveAttribute("aria-pressed", "false");
  await music.click();
  await expect(music).toHaveAttribute("aria-pressed", "true");
  await page.waitForTimeout(1200); // let the scheduler run a few bars of notes
  await music.click();
  await expect(music).toHaveAttribute("aria-pressed", "false");
  expect(errors).toEqual([]);
});

test("no serious or critical axe violations on any stage", async ({ page }) => {
  await loadSample(page);
  for (const name of ["Start", "Result", "Night", "Signals", "How it works", "Research"]) {
    await stageTab(page, name).click();
    await page.waitForTimeout(700);
    const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
    const bad = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(bad.map((v) => `${name}: ${v.id} @ ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
  }
});

test.describe("reduced motion", () => {
  test.use({ reducedMotion: "reduce" });
  test("transitions are off and the scene starts paused", async ({ page }) => {
    await loadSample(page);
    const d = await page.locator(".btn-primary").first().evaluate((el) => getComputedStyle(el).transitionDuration);
    expect(parseFloat(d)).toBeLessThan(0.001);
    await expect(page.getByRole("button", { name: "Play scene" })).toBeVisible();
  });
});
