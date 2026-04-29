import { expect, test } from "@playwright/test";
import { login } from "./helpers";

test("home to article to valid wikilink flow works", async ({ page }) => {
  await login(page);

  await expect(page.getByText("RECENTLY UPDATED")).toBeVisible();
  await page.getByRole("link", { name: "Godel" }).click();

  await expect(page.getByRole("heading", { name: "Godel" })).toBeVisible();

  const validWikilink = page.locator("a.wikilink").first();
  await validWikilink.hover();
  await expect(page.locator(".hover-preview")).toContainText("UPDATED");

  await validWikilink.click();
  await expect(page.getByRole("heading", { name: "Set Theory" })).toBeVisible();

  await page.goBack();
  await expect(page.getByRole("heading", { name: "Godel" })).toBeVisible();
});
