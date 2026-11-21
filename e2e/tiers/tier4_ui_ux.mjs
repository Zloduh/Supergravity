import path from 'node:path';

export function getTests() {
  return [
    {
      id: 'T4-01',
      tier: 4,
      feature: 'F12-F14',
      name: 'Responsive layout at narrow viewport (820x640) and collapsed sidebar rail has zero overlap or horizontal overflow',
      async run(env) {
        const { assert } = env;
        const app = await env.openApp({
          width: 820,
          height: 640,
          waitForSelector: 'main',
        });

        // Collapse sidebar to compact rail
        await app.page.click('button[aria-label="Close sidebar"]');
        await app.page.waitForSelector('aside[aria-label="Collapsed sidebar"]', 3000);

        // Verify no horizontal overflow and main header doesn't collide with collapsed rail
        const layoutCheck = await app.page.evaluate(() => {
          const rail = document.querySelector('aside[aria-label="Collapsed sidebar"]');
          const main = document.querySelector('main');
          const railRect = rail?.getBoundingClientRect();
          const mainRect = main?.getBoundingClientRect();
          return {
            docWidth: document.documentElement.scrollWidth,
            winWidth: window.innerWidth,
            railRight: railRect?.right ?? 0,
            mainLeft: mainRect?.left ?? 0,
          };
        });

        assert.ok(
          layoutCheck.docWidth <= layoutCheck.winWidth,
          `Expected no horizontal overflow (${layoutCheck.docWidth} <= ${layoutCheck.winWidth})`
        );
        assert.ok(
          layoutCheck.mainLeft >= layoutCheck.railRight - 1,
          `Expected main content (${layoutCheck.mainLeft}) not to overlap collapsed sidebar rail (${layoutCheck.railRight})`
        );

        const shotNarrow = path.join(env.screenshotsDir, 'tier4_narrow_820x640.png');
        const png = await app.page.captureScreenshot(shotNarrow);
        assert.assertPngDimensions(png, 820, 640);
        assert.assertNoPageErrors(app);
      },
    },
    {
      id: 'T4-02',
      tier: 4,
      feature: 'F3-F13',
      name: 'Graceful inline error banner when LLM provider returns 401 Invalid API key',
      async run(env) {
        const { assert } = env;
        const app = await env.openApp({
          width: 1440,
          height: 900,
          waitForSelector: 'main',
        });

        app.llm.setMode('401');
        await app.page.type('textarea', 'Test 401 handling');
        await app.page.click('button[type="submit"]');

        await app.page.waitForSelector('[role="alert"]', 4000);
        const alertText = await app.page.evaluate(
          () => document.querySelector('[role="alert"]')?.textContent || ''
        );
        assert.ok(
          alertText.includes('401') || alertText.includes('Invalid API key') || alertText.includes('Configure Provider'),
          `Expected inline error banner, got: ${alertText}`
        );

        const shotError = path.join(env.screenshotsDir, 'tier4_inline_error_banner.png');
        await app.page.captureScreenshot(shotError);
        assert.assertNoPageErrors(app);
      },
    },
  ];
}
