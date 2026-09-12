// Copyright (C) 2026 AugmentedQuill contributors
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/** Purpose: Verify linked outlines navigate live Markdown without replacing or writing it. */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { EditorView } from '@codemirror/view';
import {
  expect,
  test,
  type Page,
  type Request,
  type Response,
  type Route,
} from '@playwright/test';
import {
  BACKEND,
  DEMO_PROJECT,
  gotoApp,
  openSidebar,
  selectProject,
} from './support/helpers';

const source = [
  '\uFEFF# Navigation fixture',
  '',
  '🌊 Café opening.',
  '',
  '## Arrival',
  'A gull called.',
  '',
  '***',
  'The pier creaked.',
  '',
  '<!--scene:quay:start-->## Evening',
  'Nightfall.<!--scene:quay:end-->',
].join('\r\n');
const roots: string[] = [];
const secondSource = '# Second chapter\n\n## New chapter section\nA different shore.';

async function openLinkedProject(
  page: Page,
  content: string = source
): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'aq-linked-outline-'));
  roots.push(root);
  const file = join(root, 'chapter-01.md');
  await writeFile(file, content, { mode: 0o640 });
  await writeFile(join(root, 'chapter-02.md'), secondSource);
  const project = `Linked outline ${root.split('/').at(-1)}`;
  const created = await page.request.post(`${BACKEND}/api/v1/projects/create`, {
    data: { name: project, type: 'novel', language: 'en' },
  });
  expect(created.ok(), await created.text()).toBe(true);
  const linked = await page.request.post(
    `${BACKEND}/api/v1/projects/${encodeURIComponent(project)}/manuscript/link`,
    { data: { source_root: root, files: ['chapter-01.md', 'chapter-02.md'] } }
  );
  expect(linked.ok(), await linked.text()).toBe(true);
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoApp(page, project);
  await page.getByRole('button', { name: 'Raw', exact: true }).click();
  await openSidebar(page);
  return file;
}

async function editorState(page: Page): Promise<{
  text: string;
  anchor: number;
  head: number;
  line: number;
  from: number;
}> {
  return page.evaluate(() => {
    const view = (window as unknown as { __aqEditorView: EditorView }).__aqEditorView;
    const { anchor, head } = view.state.selection.main;
    const line = view.state.doc.lineAt(head);
    return {
      text: view.state.sliceDoc(),
      anchor,
      head,
      line: line.number,
      from: line.from,
    };
  });
}

function recordNavigationRequests(page: Page): { scenes: string[]; writes: string[] } {
  const recorded = { scenes: [] as string[], writes: [] as string[] };
  page.on('request', (request: Request): void => {
    if (
      new URL(request.url()).pathname.startsWith('/api/') &&
      /\/scenes(?:[/?]|$)/u.test(request.url())
    )
      recorded.scenes.push(request.url());
    if (
      request.method() !== 'GET' &&
      /\/chapters\/\d+\/content(?:\?|$)/u.test(request.url())
    ) {
      recorded.writes.push(request.url());
    }
  });
  return recorded;
}

test.afterEach(async ({ page }: { page: Page }): Promise<void> => {
  // Failed tests restart the worker and invoke afterAll early. Select the
  // stable demo project before releasing this worker's linked fixtures.
  await selectProject(page, DEMO_PROJECT);
  await page.close();
});
test.afterAll(async (): Promise<void> => {
  // The backend retains the active project between tests; keep every linked
  // source available until all browser contexts have closed.
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

test('Show scenes opens Split and all outline navigation is read-only and exact', async ({
  page,
}: {
  page: Page;
}) => {
  const file = await openLinkedProject(page);
  const originalView = await page.evaluateHandle(
    () => (window as unknown as { __aqEditorView: EditorView }).__aqEditorView
  );
  const original = await editorState(page);
  const requests = recordNavigationRequests(page);
  const outline = page.getByRole('region', {
    name: 'Scenes and sections',
    exact: true,
  });

  await page.getByRole('button', { name: 'Show scenes view', exact: true }).click();
  await expect(outline).toBeVisible();
  await expect(
    page.locator(
      'header button[title="Show scenes and sections beside the manuscript"]'
    )
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.cm-content')).toBeVisible();
  const outlineBounds = await outline.boundingBox();
  const rawBounds = await page
    .getByRole('button', { name: 'Raw', exact: true })
    .boundingBox();
  const titleBounds = await outline
    .getByRole('heading', { name: 'Scenes and sections', exact: true })
    .boundingBox();
  expect(rawBounds!.x).toBeGreaterThanOrEqual(outlineBounds!.x + outlineBounds!.width);
  expect(titleBounds!.x + titleBounds!.width).toBeLessThanOrEqual(
    outlineBounds!.x + outlineBounds!.width
  );
  expect(
    await page.evaluate(
      (view: EditorView): boolean =>
        view === (window as unknown as { __aqEditorView: EditorView }).__aqEditorView,
      originalView
    )
  ).toBe(true);

  for (const [label, line] of [
    ['Arrival', 5],
    ['Scene break', 8],
    ['Scene marker quay', 11],
  ] as const) {
    await outline.getByRole('button', { name: new RegExp(label, 'u') }).click();
    await expect.poll(async () => (await editorState(page)).line).toBe(line);
    const state = await editorState(page);
    expect(state.anchor).toBe(state.head);
    expect(state.head).toBe(state.from);
    expect(state.text).toBe(original.text);
  }

  await page.locator('header button[title="Scenes and sections"]').click();
  await expect(outline).toBeVisible();
  await expect(page.locator('.cm-editor')).toBeAttached();
  expect(
    await page
      .locator('.cm-content')
      .evaluate((element: HTMLElement): boolean =>
        Boolean(element.closest('[inert][aria-hidden="true"]'))
      )
  ).toBe(true);
  await page.keyboard.press('Tab');
  expect(
    await page.evaluate((): boolean =>
      Boolean(document.activeElement?.closest('.cm-editor'))
    )
  ).toBe(false);
  await outline.getByRole('button', { name: /Heading.*Evening/u }).click();
  await expect(outline).toHaveCount(0);
  await expect(page.locator('header button[title="Page Mode"]')).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  await expect(page.locator('.cm-content')).toBeFocused();
  expect((await editorState(page)).line).toBe(11);
  expect(
    await page.evaluate(
      (view: EditorView): boolean =>
        view === (window as unknown as { __aqEditorView: EditorView }).__aqEditorView,
      originalView
    )
  ).toBe(true);

  await page.locator('header button[title="Scenes and sections"]').click();
  await page.locator('header button[title="Page Mode"]').click();
  await page.getByRole('button', { name: 'Show scenes view', exact: true }).click();
  await outline.getByRole('button', { name: 'Refresh outline', exact: true }).click();
  await outline.getByRole('button', { name: 'Back to page', exact: true }).click();
  // Allow any accidental editor debounce caused by a mode switch to surface.
  await page.waitForTimeout(400);
  expect((await editorState(page)).text).toBe(original.text);
  expect(requests).toEqual({ scenes: [], writes: [] });
  expect(await readFile(file)).toEqual(Buffer.from(source, 'utf8'));

  const savedSplit = page.waitForResponse(
    (response: Response): boolean =>
      response.url().endsWith('/view-state') &&
      response.request().method() === 'PUT' &&
      response.request().postDataJSON()?.workspace_mode === 'split'
  );
  await page.getByRole('button', { name: 'Show scenes view', exact: true }).click();
  expect((await savedSplit).ok()).toBe(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(
    outline.getByRole('button', { name: /Heading.*Arrival/u })
  ).toBeVisible();
  await expect(outline.getByText(/still loading/u)).toHaveCount(0);
  await openSidebar(page);
  const afterReload = recordNavigationRequests(page);
  await page.getByRole('button', { name: /^chapter-02\b/u }).click();
  await expect(
    outline.getByRole('button', { name: /New chapter section/u })
  ).toBeVisible();
  await expect(outline.getByRole('button', { name: /Arrival/u })).toHaveCount(0);
  await outline.getByRole('button', { name: /New chapter section/u }).click();
  expect((await editorState(page)).line).toBe(3);
  expect((await editorState(page)).text).toBe(secondSource);
  expect(afterReload).toEqual({ scenes: [], writes: [] });
  expect(await readFile(file.replace('chapter-01.md', 'chapter-02.md'))).toEqual(
    Buffer.from(secondSource, 'utf8')
  );
});

test('changed outline refuses an old position and mode switches preserve dirty text and undo', async ({
  page,
}: {
  page: Page;
}) => {
  const file = await openLinkedProject(page);
  const originalView = await page.evaluateHandle(
    () => (window as unknown as { __aqEditorView: EditorView }).__aqEditorView
  );
  const original = await editorState(page);
  // This test alone keeps the synthetic buffer dirty and never forwards writes.
  await page.route(
    '**/api/v1/projects/*/chapters/*/content',
    async (route: Route): Promise<void> => {
      if (route.request().method() === 'PUT') await route.abort('failed');
      else await route.continue();
    }
  );
  await page.getByRole('button', { name: 'Show scenes view', exact: true }).click();
  const outline = page.getByRole('region', {
    name: 'Scenes and sections',
    exact: true,
  });
  const result = await outline
    .getByRole('button', { name: /Arrival/u })
    .evaluate(async (element: HTMLElement) => {
      const view = (window as unknown as { __aqEditorView: EditorView }).__aqEditorView;
      const section = element.closest('section');
      view.dispatch({ selection: { anchor: 0, head: 0 } });
      // Edit and click in one browser turn: the outline must read the live buffer
      // before the 300 ms chapter-content debounce updates the parent props.
      view.dispatch({
        changes: { from: view.state.doc.line(3).from, insert: 'Unsaved 🌊 line.\r\n' },
      });
      element.click();
      await new Promise<void>((resolve: () => void): number =>
        requestAnimationFrame(() => resolve())
      );
      return {
        head: view.state.selection.main.head,
        notice: section?.querySelector('[role="status"]')?.textContent,
      };
    });
  expect(result.head).toBe(0);
  expect(result.notice).toBe(
    'The text changed. The outline is refreshed; choose an entry again.'
  );
  await outline.getByRole('button', { name: /Arrival/u }).click();
  expect((await editorState(page)).line).toBe(6);

  await page.locator('header button[title="Scenes and sections"]').click();
  await expect(outline).toBeVisible();
  expect(
    await page
      .locator('.cm-content')
      .evaluate((element: HTMLElement): boolean => Boolean(element.closest('[inert]')))
  ).toBe(true);
  await outline.getByRole('button', { name: 'Back to page', exact: true }).click();
  expect(
    await page.evaluate(
      (view: EditorView): boolean =>
        view === (window as unknown as { __aqEditorView: EditorView }).__aqEditorView,
      originalView
    )
  ).toBe(true);
  expect((await editorState(page)).text).toContain('Unsaved 🌊 line.');
  await page.locator('.cm-content').focus();
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await editorState(page)).text).toBe(original.text);
  expect(await readFile(file)).toEqual(Buffer.from(source, 'utf8'));
});

test('a chapter with ordinary paragraphs has one honest opening entry', async ({
  page,
}: {
  page: Page;
}) => {
  const plain = '# Plain chapter\n\nA first paragraph.\n\nA second paragraph.';
  const file = await openLinkedProject(page, plain);
  const requests = recordNavigationRequests(page);
  await page.getByRole('button', { name: 'Show scenes view', exact: true }).click();
  const outline = page.getByRole('region', {
    name: 'Scenes and sections',
    exact: true,
  });
  await expect(
    outline.getByText(
      'No explicit scene breaks or headings were found. You can add a Markdown heading or *** between scenes in the editor.',
      { exact: true }
    )
  ).toBeVisible();
  await expect(outline.getByRole('listitem')).toHaveCount(1);
  await outline.getByRole('button', { name: /Chapter opening/u }).click();
  expect((await editorState(page)).head).toBe(0);
  expect(requests).toEqual({ scenes: [], writes: [] });
  expect(await readFile(file)).toEqual(Buffer.from(plain, 'utf8'));
});
