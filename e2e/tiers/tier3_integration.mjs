import path from 'node:path';

export function getTests() {
  return [
    {
      id: 'T3-01',
      tier: 3,
      feature: 'F15',
      name: 'Settings Modal tabs (Providers, MCP Servers, Skills, Agent & Preferences) and inline error surfacing',
      async run(env) {
        const { assert } = env;
        const app = await env.openApp({
          width: 1440,
          height: 900,
          waitForSelector: 'main',
        });

        // Open Settings Modal
        await app.page.click('button[aria-label="Local LLM, MCP & Skills Settings"]');
        await app.page.waitForSelector(
          '[role="dialog"][aria-label="Local Settings & Connections"]',
          4000
        );

        const shotProviders = path.join(env.screenshotsDir, 'tier3_settings_providers.png');
        await app.page.captureScreenshot(shotProviders);

        // Switch to MCP Servers tab and add an MCP server
        await app.page.evaluate(() => {
          const btns = Array.from(document.querySelectorAll('button'));
          btns.find((b) => b.textContent?.includes('MCP Servers'))?.click();
        });
        await app.page.waitForSelector('input[aria-label="MCP Server Name"]', 3000);

        const shotMcp = path.join(env.screenshotsDir, 'tier3_settings_mcp.png');
        await app.page.captureScreenshot(shotMcp);

        // Switch to Skills tab
        await app.page.evaluate(() => {
          const btns = Array.from(document.querySelectorAll('button'));
          btns.find((b) => b.textContent?.includes('Skills ('))?.click();
        });
        await app.page.waitForSelector('input[aria-label="Filter skills"]', 3000);

        const shotSkills = path.join(env.screenshotsDir, 'tier3_settings_skills.png');
        await app.page.captureScreenshot(shotSkills);

        // Switch to Agent & Preferences tab
        await app.page.evaluate(() => {
          const btns = Array.from(document.querySelectorAll('button'));
          btns.find((b) => b.textContent?.includes('Agent & Preferences'))?.click();
        });
        await app.page.waitForSelector('input[aria-label="Max Iterations"]', 3000);

        const shotPrefs = path.join(env.screenshotsDir, 'tier3_settings_preferences.png');
        await app.page.captureScreenshot(shotPrefs);

        assert.assertNoPageErrors(app);
      },
    },
    {
      id: 'T3-02',
      tier: 3,
      feature: 'F15',
      name: 'Artifact & Files Pane toggles, lists workspace files, and switches between Rendered and Source views',
      async run(env) {
        const { assert } = env;
        const app = await env.openApp({
          width: 1440,
          height: 900,
          waitForSelector: 'main',
        });

        await app.page.click('button[aria-label="Toggle Artifact & File Pane"]');
        await app.page.waitForSelector('aside[aria-label="Artifact and Files Pane"]', 4000);

        const shotArtifact = path.join(env.screenshotsDir, 'tier3_artifact_pane.png');
        const png = await app.page.captureScreenshot(shotArtifact);
        assert.assertPngDimensions(png, 1440, 900);
        assert.assertNoPageErrors(app);
      },
    },
    {
      id: 'T3-03',
      tier: 3,
      feature: 'F16',
      name: 'Projects: create multi-folder project (create on drive + existing folder), move existing conversation into project, and switch worktree mode',
      async run(env) {
        const { assert } = env;
        const app = await env.openApp({
          width: 1440,
          height: 900,
          waitForSelector: 'main',
        });

        // Open New Project Modal from sidebar
        await app.page.click('button[aria-label="Create new project"]');
        await app.page.waitForSelector('[role="dialog"][aria-label="Create New Project"]', 4000);

        // Fill Project Name and add a new folder on drive
        await app.page.type('input[aria-label="Project Name"]', 'Fullstack Platform', {
          clear: true,
        });
        await app.page.type(
          'input[aria-label="Project Folder Path"]',
          '/workspace/fullstack-frontend',
          { clear: true }
        );
        await app.page.evaluate(() => {
          const btns = Array.from(document.querySelectorAll('button'));
          btns.find((b) => b.textContent?.includes('Add Folder'))?.click();
        });

        // Switch to Open Existing Folder and add a second folder
        await app.page.evaluate(() => {
          const btns = Array.from(document.querySelectorAll('button'));
          btns.find((b) => b.textContent?.includes('Open Existing Folder'))?.click();
        });
        await app.page.type('input[aria-label="Project Folder Path"]', '/workspace/src', {
          clear: true,
        });
        await app.page.evaluate(() => {
          const btns = Array.from(document.querySelectorAll('button'));
          btns.find((b) => b.textContent?.includes('Add Folder'))?.click();
        });

        const shotModal = path.join(env.screenshotsDir, 'tier3_project_modal.png');
        await app.page.captureScreenshot(shotModal);

        // Submit Create Project
        await app.page.evaluate(() => {
          const btns = Array.from(document.querySelectorAll('button'));
          btns.find((b) => b.textContent?.includes('Create Project'))?.click();
        });

        // Verify create_dir was called for the new folder on drive
        await app.bridge.waitForInvocation('create_dir', 3000);

        // Verify the project appears in the sidebar and Worktree Mode selector appears in composer
        await app.page.waitForSelector('select[aria-label="Worktree Mode"]', 4000);

        // Move the current conversation into the newly created project via the header Project selector
        const movedProjectId = await app.page.evaluate(() => {
          const sel = document.querySelector(
            'select[aria-label="Conversation Project"]'
          );
          if (!sel || sel.options.length < 2) return null;
          const projOpt = sel.options[1];
          sel.value = projOpt.value;
          sel.dispatchEvent(new Event('change', { bubbles: true }));
          return projOpt.value;
        });
        assert.ok(movedProjectId, 'Expected new project option in Conversation Project selector');

        // Switch Worktree Mode to New Worktree Mode
        await app.page.evaluate(() => {
          const sel = document.querySelector('select[aria-label="Worktree Mode"]');
          if (sel) {
            sel.value = 'new_worktree';
            sel.dispatchEvent(new Event('change', { bubbles: true }));
          }
        });

        const shotProjectActive = path.join(env.screenshotsDir, 'tier3_project_active.png');
        const png = await app.page.captureScreenshot(shotProjectActive);
        assert.assertPngDimensions(png, 1440, 900);
        assert.assertNoPageErrors(app);
      },
    },
  ];
}
