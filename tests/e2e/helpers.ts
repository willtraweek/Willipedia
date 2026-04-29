import { expect, type Page } from "@playwright/test";

export async function login(page: Page): Promise<void> {
  await page.goto("auth");
  await page.locator('input[name="bearer"]').fill("valid-bearer");
  await page.getByRole("button", { name: "ENTER →" }).click();
  await expect(page).toHaveURL(/\/wiki\/$/);
}
