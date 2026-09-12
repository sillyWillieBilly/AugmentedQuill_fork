// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Verify sidebar scrolling with enough chapters to exceed the viewport, including
 * restored oversized panel preferences, window resizing and section focus.
 */

import { expect, test, type Locator, type Page } from '@playwright/test';
import { BACKEND, gotoApp } from './support/helpers';

async function openLongNovel(page: Page, oversized: boolean): Promise<void> {
  const project = `Sidebar scrolling ${oversized ? 'saved' : 'default'} ${Date.now()}`;
  const created = await page.request.post(`${BACKEND}/api/v1/projects/create`, {
    data: { name: project, type: 'novel', language: 'en' },
  });
  expect(created.ok()).toBe(true);
  for (let chapter = 1; chapter <= 17; chapter += 1) {
    const response = await page.request.post(
      `${BACKEND}/api/v1/projects/${encodeURIComponent(project)}/chapters`,
      {
        data: {
          title: `Sidebar chapter ${chapter}`,
          content: `This is the body of sidebar chapter ${chapter}.`,
        },
      }
    );
    expect(response.ok()).toBe(true);
  }
  await page.addInitScript((restoreOversized: boolean): void => {
    localStorage.setItem(
      'augmentedquill_editor_settings',
      JSON.stringify({
        sidebar: restoreOversized ? { storyHeight: 300, chaptersHeight: 1900 } : {},
      })
    );
  }, oversized);
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoApp(page, project);
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await expect(page.getByRole('navigation', { name: 'Project sidebar' })).toBeVisible();
}

async function expectPanelsInViewport(page: Page): Promise<void> {
  const sidebar = page.getByRole('navigation', { name: 'Project sidebar' });
  await expect(
    sidebar.locator('button[aria-controls]').filter({ hasText: 'Story' })
  ).toBeInViewport();
  await expect(
    sidebar.locator('button[aria-controls]').filter({ hasText: 'Chapters' })
  ).toBeInViewport();
  await expect(
    sidebar.locator('button[aria-controls]').filter({ hasText: 'Sourcebook' })
  ).toBeInViewport();
  const bounds = await sidebar.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(
    page.viewportSize()!.height + 1
  );
}

async function wheelTo(page: Page, target: Locator): Promise<void> {
  const chapterList = page.locator('#chapter-list');
  const scroller = chapterList.locator(':scope > div.overflow-y-auto').last();
  await expect
    .poll(() =>
      scroller.evaluate(
        (element: HTMLElement) => element.scrollHeight > element.clientHeight
      )
    )
    .toBe(true);
  const box = await scroller.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(
    box!.x + box!.width / 2,
    box!.y + Math.min(box!.height / 2, 80)
  );
  // Wheel events are intentional: click() or scrollIntoViewIfNeeded() would hide
  // the original bug by programmatically scrolling a clipped, unbounded panel.
  for (let step = 0; step < 24; step += 1) {
    const visible = await target.evaluate((element: HTMLElement) => {
      const rect = element.getBoundingClientRect();
      const scrollRect = element.closest('#chapter-list')!.getBoundingClientRect();
      return rect.top >= scrollRect.top + 65 && rect.bottom <= scrollRect.bottom;
    });
    if (visible) break;
    const before = await scroller.evaluate((element: HTMLElement) => element.scrollTop);
    await page.mouse.wheel(0, 100);
    await expect
      .poll(() => scroller.evaluate((element: HTMLElement) => element.scrollTop))
      .toBeGreaterThan(before);
  }
  await expect(target).toBeInViewport({ ratio: 1 });
}

for (const oversized of [false, true]) {
  test(`chapter list scrolls with ${oversized ? 'oversized saved' : 'default'} section heights`, async ({
    page,
  }: {
    page: Page;
  }) => {
    await openLongNovel(page, oversized);
    await expectPanelsInViewport(page);
    const chapterFive = page.getByRole('button', { name: /^Sidebar chapter 5\b/ });
    await wheelTo(page, chapterFive);
    await chapterFive.click();
    await expect(page.locator('.cm-content')).toContainText(
      'body of sidebar chapter 5.'
    );

    const sidebar = page.getByRole('navigation', { name: 'Project sidebar' });
    const storyToggle = sidebar
      .locator('button[aria-controls]')
      .filter({ hasText: 'Story' });
    await storyToggle.click();
    await expect(storyToggle).toHaveAttribute('aria-expanded', 'false');
    await expectPanelsInViewport(page);
    await storyToggle.click();
    await expect(storyToggle).toHaveAttribute('aria-expanded', 'true');

    await sidebar.locator('button[title="Chapters"]').click();
    await expect(storyToggle).toHaveCount(0);
    await wheelTo(page, page.getByRole('button', { name: /^Sidebar chapter 17\b/ }));
    await expect(page.locator('.cm-content')).toContainText(
      'body of sidebar chapter 5.'
    );
    await sidebar.locator('button[title="Chapters"]').click();
    await expectPanelsInViewport(page);

    await page.setViewportSize({ width: 1440, height: 550 });
    await expectPanelsInViewport(page);
    await page.setViewportSize({ width: 860, height: 550 });
    await expectPanelsInViewport(page);
    if (oversized) {
      const saved = await page.evaluate(
        () =>
          JSON.parse(localStorage.getItem('augmentedquill_editor_settings')!).sidebar
      );
      expect(saved.storyHeight).toBe(300);
      expect(saved.chaptersHeight).toBe(1900);
    }
  });
}
