import path from "node:path";
import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const SAMPLES = path.resolve(__dirname, "../../sample_uploads");

// Next.js adds its own empty role="alert" route announcer, so only count alerts with text.
const notice = (page: Page) => page.getByRole("alert").filter({ hasText: /\S/ });
const triage = (page: Page) => page.getByRole("region", { name: "Screening result" });
const stageTab = (page: Page, name: string) =>
  page.getByRole("navigation", { name: "Stages" }).getByRole("button", { name, exact: true });
const clinicalToggle = (page: Page) => page.getByRole("button", { name: "Clinical mode" });
const scene = (page: Page) => page.locator("canvas[data-scene]");
// Two reads of the canvas pixels: equal means nothing moved.
const sceneFrame = (page: Page) => scene(page).evaluate((c: HTMLCanvasElement) => c.toDataURL().length + ":" + c.toDataURL().slice(-200));
const preferClinical = (page: Page, value: "on" | "off") =>
  page.addInitScript((v) => localStorage.setItem("cb-clinical", v), value);

test.beforeEach(async ({ page }, info) => {
  if (!info.title.includes("first-time tour prompt")) {
    await page.addInitScript(() => localStorage.setItem("cardiobreath_tour_prompted_v1", "true"));
  }
});

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

test("nothing is analyzed until asked; then the sample night is requested once (#16)", async ({ page }) => {
  const analyzeCalls: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/api/analyze/")) analyzeCalls.push(r.url());
  });
  await page.goto("/");
  await expect(page.getByText("Model ready")).toBeVisible();
  await page.waitForTimeout(1500);
  expect(analyzeCalls).toEqual([]); // only health, cases and the static evaluation report on load
  await expect(page.getByText("Not analyzed yet")).toBeVisible();
  await stageTab(page, "Result").click();
  await expect(page.getByText("No recording loaded")).toBeVisible();
  await stageTab(page, "Start").click();
  await page.getByRole("button", { name: "Try a sample night" }).first().click();
  await expect(page).toHaveURL(/#\/result$/);
  await expect(triage(page)).toContainText("37.9");
  await expect(page.getByText("Updating result…")).toHaveCount(0);
  const t = triage(page);
  await expect(t).toContainText("Severe");
  await expect(t).toContainText("35.5 to 40.3");
  await expect(t).toContainText("Sleep-lab reference 37.6");
  await expect(t).toContainText(/priority PSG referral/i);
  await page.waitForTimeout(1000);
  expect(analyzeCalls.filter((u) => u.includes("/api/analyze/case/"))).toHaveLength(1);
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
  // #17: the failed 5 dB run must not stay selected over the clean result still shown
  await expect(page.getByRole("button", { name: "Clean" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "5 dB" })).toHaveAttribute("aria-pressed", "false");
  await expect(triage(page)).toContainText("37.9");
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

test("night farm scene runs on the start stage and can be paused", async ({ page }) => {
  await page.goto("/");
  await expect(scene(page)).toBeVisible();
  await expect(scene(page)).toHaveAttribute("data-running", "true");
  // The canvas actually changes between frames while running.
  await page.waitForTimeout(1500);
  const a = await sceneFrame(page);
  await page.waitForTimeout(400);
  expect(await sceneFrame(page)).not.toBe(a);
  await page.getByRole("button", { name: "Pause scene" }).click();
  await expect(scene(page)).toHaveAttribute("data-running", "false");
  await expect(page.getByRole("button", { name: "Play scene" })).toBeVisible();
});

test("scene is a still, dimmed frame behind data stages and moves again on How it works", async ({ page }) => {
  await preferClinical(page, "off");
  await page.goto("/#/night");
  await expect(scene(page)).toBeVisible();
  await expect(scene(page)).toHaveAttribute("data-running", "false");
  await page.waitForTimeout(1500);
  const a = await sceneFrame(page);
  await page.waitForTimeout(800);
  expect(await sceneFrame(page)).toBe(a);
  for (const name of ["Result", "Signals", "Research"]) {
    await stageTab(page, name).click();
    await expect(scene(page)).toHaveAttribute("data-running", "false");
  }
  await stageTab(page, "How it works").click();
  await expect(scene(page)).toHaveAttribute("data-running", "true");
});

test("clinical mode: off by default on every stage, remembered, hides the scene and stops music", async ({ page }) => {
  // Record every AudioContext so the test checks that the music really stopped, not just its button.
  await page.addInitScript(() => {
    const Real = window.AudioContext;
    const made: AudioContext[] = [];
    (window as unknown as { __audio: AudioContext[] }).__audio = made;
    window.AudioContext = class extends Real {
      constructor(o?: AudioContextOptions) {
        super(o);
        made.push(this);
      }
    };
  });
  await page.goto("/#/result");
  await expect(clinicalToggle(page)).toHaveAttribute("aria-pressed", "false");
  await expect(scene(page)).toBeVisible();
  await stageTab(page, "Start").click();
  await expect(clinicalToggle(page)).toHaveAttribute("aria-pressed", "false");
  await expect(scene(page)).toBeVisible();

  const music = page.getByRole("button", { name: "Music" });
  await music.click();
  await expect(music).toHaveAttribute("aria-pressed", "true");
  await clinicalToggle(page).click();
  await expect(clinicalToggle(page)).toHaveAttribute("aria-pressed", "true");
  await expect(scene(page)).toBeHidden();
  await expect(music).toHaveCount(0);
  await expect(page.getByRole("button", { name: /scene/ })).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __audio: AudioContext[] }).__audio.map((c) => c.state)))
    .toEqual(["closed"]);

  await page.reload(); // the choice is remembered, even on the start stage
  await expect(clinicalToggle(page)).toHaveAttribute("aria-pressed", "true");
  await expect(scene(page)).toBeHidden();
  await clinicalToggle(page).click();
  await stageTab(page, "Night").click();
  await expect(clinicalToggle(page)).toHaveAttribute("aria-pressed", "false");
  await expect(scene(page)).toBeVisible();
});

test("no stage overflows or hides content at laptop and projector sizes", async ({ page }) => {
  await loadSample(page);
  await page.waitForTimeout(2500); // inspector window loads
  const sizes = [[1280, 720], [1366, 768], [1440, 900], [1533, 686], [1920, 1080]];
  const bad: string[] = [];
  for (const [width, height] of sizes) {
    await page.setViewportSize({ width, height });
    for (const id of ["start", "result", "night", "signals", "how", "research"]) {
      await page.evaluate((h) => (window.location.hash = h), `/${id}`);
      await page.waitForTimeout(700);
      const over = await page.locator(`section[data-page="${id}"]`).evaluate((s) => s.scrollHeight - s.clientHeight);
      if (over > 0) bad.push(`${id} @ ${width}x${height}: ${over}px`);
    }
  }
  expect(bad).toEqual([]);
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

test("stage bar buttons stay clear of the Netlify free-tier badge", async ({ page }) => {
  await page.goto("/");
  // Stand-in for the badge Netlify injects on free sites: a fixed iframe in the bottom-right corner.
  await page.evaluate(() => {
    const f = document.createElement("iframe");
    f.id = "nl-badge-frame";
    f.style.cssText = "position:fixed;bottom:0;right:0;width:197px;height:64px;border:0;z-index:2147483645";
    document.body.appendChild(f);
  });
  const bad: string[] = [];
  for (const [width, height] of [[1535, 695], [1280, 720], [1920, 1080], [768, 1024], [375, 812]]) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(200);
    const hits = await page.evaluate(() => {
      const b = document.getElementById("nl-badge-frame")!.getBoundingClientRect();
      const overlap = (r: DOMRect) => r.width > 0 && r.left < b.right && r.right > b.left && r.top < b.bottom && r.bottom > b.top;
      return [...document.querySelectorAll('nav[aria-label="Stage navigation"] button, nav[aria-label="Stage navigation"] p')]
        .filter((el) => overlap(el.getBoundingClientRect()))
        .map((el) => el.textContent?.trim() || el.getAttribute("aria-label") || "?");
    });
    if (hits.length) bad.push(`${width}x${height}: ${hits.join(", ")}`);
  }
  expect(bad).toEqual([]);
});

test.describe("reduced motion", () => {
  test.use({ reducedMotion: "reduce" });
  test("transitions are off and the scene is a still frame", async ({ page }) => {
    await page.goto("/");
    const d = await page.locator(".btn-primary").first().evaluate((el) => getComputedStyle(el).transitionDuration);
    expect(parseFloat(d)).toBeLessThan(0.001);
    await expect(page.getByRole("button", { name: "Play scene" })).toBeVisible();
    await expect(scene(page)).toHaveAttribute("data-running", "false");
    await page.waitForTimeout(1500);
    const a = await sceneFrame(page);
    await page.waitForTimeout(800);
    expect(await sceneFrame(page)).toBe(a);
  });
});

test("first-time tour prompt launches tour, remembers dismissal, and allows manual reopen", async ({ page }) => {
  await page.goto("/");
  const prompt = page.getByRole("dialog", { name: "Take a quick tour of CardioBreath?" });
  await expect(prompt).toBeVisible();
  await prompt.getByRole("button", { name: "Take the guided tour" }).click();
  await expect(prompt).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "Welcome to CardioBreath" })).toBeVisible();
  await page.keyboard.press("Escape");

  await page.reload();
  await expect(prompt).toHaveCount(0);

  await page.evaluate(() => localStorage.removeItem("cardiobreath_tour_prompted_v1"));
  await page.reload();
  await expect(prompt).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(prompt).toHaveCount(0);

  await page.reload();
  await expect(prompt).toHaveCount(0);
  await page.getByRole("button", { name: "Tour", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Welcome to CardioBreath" })).toBeVisible();
test("live elapsed timer ticks during sample screening and noise reanalysis", async ({ page }) => {
  await page.route("**/api/analyze/case/**", async (route) => {
    await new Promise((r) => setTimeout(r, 700));
    await route.continue();
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Try a sample night" }).first().click();
  await expect(page).toHaveURL(/#\/result$/);
  await expect(page.getByText(/\d+\.\ds/)).toBeVisible();
  await expect(triage(page)).toContainText("37.9");

  await page.getByRole("button", { name: "10 dB" }).click();
  await expect(page.getByText("Updating result…")).toBeVisible();
  await expect(triage(page)).toContainText(/\d+\.\ds/);
  await expect(page.getByText("Updating result…")).toHaveCount(0);
});
