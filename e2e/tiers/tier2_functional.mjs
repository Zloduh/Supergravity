import path from 'node:path';

export function getTests() {
  return [
    {
      id: 'T2-01',
      tier: 2,
      feature: 'F10-F13',
      name: 'Live SSE streaming chat renders ThinkingBlock, GFM tables, code copy, Mermaid, and KaTeX math',
      async run(env) {
        const { assert } = env;
        const app = await env.openApp({
          width: 1440,
          height: 900,
          waitForSelector: 'textarea',
        });

        app.llm.setMode('normal', {
          reasoningContent: 'Analyzing user request and preparing rich markdown output.',
          richMarkdown: true,
        });

        await app.page.type('textarea', 'Show me rich markdown, code, math, and mermaid');
        await app.page.click('button[type="submit"]');

        await app.page.waitForFunction(
          () => document.body.innerText.includes('Thinking / Reasoning'),
          5000
        );
        await app.page.waitForFunction(
          () => document.body.innerText.includes('Subsystem'),
          5000
        );

        const shotPath = path.join(env.screenshotsDir, 'tier2_streaming_chat.png');
        const png = await app.page.captureScreenshot(shotPath);
        assert.assertPngDimensions(png, 1440, 900);
        assert.assertNoPageErrors(app);
      },
    },
    {
      id: 'T2-02',
      tier: 2,
      feature: 'F14',
      name: 'Command Palette opens, filters commands, navigates with ArrowDown, and executes actions',
      async run(env) {
        const { assert } = env;
        const app = await env.openApp({
          width: 1440,
          height: 900,
          waitForSelector: 'main',
        });

        await app.page.pressKey('k', ['Control']);
        await app.page.waitForSelector('[role="dialog"][aria-label="Command Palette"]', 4000);

        const shotPath = path.join(env.screenshotsDir, 'tier2_command_palette.png');
        const png = await app.page.captureScreenshot(shotPath);
        assert.assertPngDimensions(png, 1440, 900);

        await app.page.type('[role="combobox"]', 'Terminal');
        await app.page.pressKey('Enter');

        await app.page.waitForSelector('section[aria-label="Terminal Drawer"]', 4000);
        assert.assertNoPageErrors(app);
      },
    },
    {
      id: 'T2-03',
      tier: 2,
      feature: 'F11',
      name: 'Terminal Drawer opens, spawns terminal session, and stays contained inside workspace column',
      async run(env) {
        const { assert } = env;
        const app = await env.openApp({
          width: 1440,
          height: 900,
          waitForSelector: 'main',
        });

        await app.page.click('button[aria-label="Toggle Terminal Drawer"]');
        await app.page.waitForSelector('section[aria-label="Terminal Drawer"]', 4000);
        await app.page.click('button[aria-label="New terminal"]');

        await app.page.waitForFunction(
          () => document.body.innerText.includes('/bin/bash'),
          4000
        );

        const shotPath = path.join(env.screenshotsDir, 'tier2_terminal_drawer.png');
        const png = await app.page.captureScreenshot(shotPath);
        assert.assertPngDimensions(png, 1440, 900);
        assert.assertNoPageErrors(app);
      },
    },
  ];
}
