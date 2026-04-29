import { expect, test } from "@playwright/test";
import { login } from "./helpers";

test("article geometry, indent, and external-link pilcrow match spec", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page);
  await page.getByRole("link", { name: "Godel" }).click();

  const bodyBox = await page.locator(".article-body").boundingBox();
  expect(bodyBox).not.toBeNull();
  const expectedLeft = 1440 * 0.38;
  expect(Math.abs((bodyBox?.x || 0) - expectedLeft)).toBeLessThanOrEqual(1440 * 0.02);

  const indent = await page.locator(".article-body > p:nth-of-type(2)").evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      fontSize: Number.parseFloat(style.fontSize),
      textIndent: Number.parseFloat(style.textIndent)
    };
  });
  expect(indent.textIndent).toBeCloseTo(indent.fontSize * 1.2, 1);

  const pilcrow = await page.locator('a.external-link').evaluate((element) => {
    return getComputedStyle(element, "::after").content;
  });
  expect(pilcrow).toBe('" ¶"');
});
