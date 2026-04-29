import { expect, test } from "@playwright/test";

test("auth page remains readable when Google font files are unavailable", async ({ page }) => {
  await page.route("https://fonts.gstatic.com/**", (route) => route.abort());
  await page.goto("auth");

  await expect(page.getByText("WILLIPEDIA")).toBeVisible();
  await expect(page.getByText("Enter the bearer to continue.")).toBeVisible();
  const wordmarkWidth = await page.locator(".masthead__wordmark").boundingBox();
  expect(wordmarkWidth?.width || 0).toBeGreaterThan(100);
});
