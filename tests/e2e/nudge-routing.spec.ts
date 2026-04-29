import { expect, test } from "@playwright/test";
import { login } from "./helpers";

test("broken wikilinks and direct typos share the 404 route", async ({ page }) => {
  await login(page);
  await page.getByRole("link", { name: "Godel" }).click();

  await page.getByRole("link", { name: "Missing Topic" }).click();
  await expect(page).toHaveURL(/\/wiki\/404\?slug=Missing%20Topic$/);
  await expect(page.getByRole("button", { name: "RESEARCH THIS TOPIC AND DRAFT A PAGE" })).toHaveAttribute("aria-disabled", "true");
  await expect(page.getByText("[QUEUED FOR v0.2]")).toBeVisible();

  await page.goto("banana");
  await expect(page).toHaveURL(/\/wiki\/banana$/);
  await expect(page.getByText("Nothing turned up.")).toBeVisible();
});
