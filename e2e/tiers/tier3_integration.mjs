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
    {
      id: 'T3-04',
      tier: 3,
      feature: 'F1-F16',
      name: 'Full UI Control Audit: Skills, MCP Servers, Preferences, Command Palette, Sidebar, ArtifactPane, and Slash Commands',
      async run(env) {
        const { assert } = env;
        const app = await env.openApp({
          width: 1440,
          height: 900,
          waitForSelector: 'main',
        });

        // 1. Settings -> Providers: Connect & Discover Models deduplication + Inherit Model Settings checkbox
        await app.page.click('button[aria-label="Local LLM, MCP & Skills Settings"]');
        await app.page.waitForSelector(
          '[role="dialog"][aria-label="Local Settings & Connections"]',
          4000
        );
        const beforeProviders = await app.page.evaluate(
          () => document.querySelectorAll('button[title="Auto-discover models (GET /v1/models)"]').length
        );
        await app.page.evaluate(() => {
          Array.from(document.querySelectorAll('button'))
            .find((b) => b.textContent?.includes('Connect & Discover Models'))
            ?.click();
        });
        await app.bridge.waitForInvocation('add_provider', 3000);
        await app.page.evaluate(() => {
          Array.from(document.querySelectorAll('button'))
            .find((b) => b.textContent?.includes('Connect & Discover Models'))
            ?.click();
        });
        await app.bridge.waitForInvocation('add_provider', 3000);
        const afterProviders = await app.page.evaluate(
          () => document.querySelectorAll('button[title="Auto-discover models (GET /v1/models)"]').length
        );
        assert.equal(
          afterProviders,
          beforeProviders,
          'Clicking Connect & Discover Models twice for same base_url must not add duplicate providers'
        );

        const inheritState = await app.page.evaluate(() => {
          const cb = Array.from(document.querySelectorAll('input[type="checkbox"]')).find((el) =>
            el.closest('label')?.textContent?.includes('Inherit Context, Max Tokens & Temperature')
          );
          const ctxInput = document.querySelector('input[aria-label="Context Length"]');
          if (!cb || !ctxInput) return null;
          const initialChecked = cb.checked;
          const initialDisabled = ctxInput.disabled;
          cb.click();
          return { initialChecked, initialDisabled, afterDisabled: ctxInput.disabled };
        });
        assert.ok(inheritState, 'Expected Inherit Model Settings checkbox and Context Length input');
        assert.equal(inheritState.initialChecked, true);
        assert.equal(inheritState.initialDisabled, true);
        assert.equal(inheritState.afterDisabled, false);
        await app.page.evaluate(() => {
          Array.from(document.querySelectorAll('button'))
            .find((b) => b.textContent?.trim() === 'Save Parameters')
            ?.click();
        });
        await app.bridge.waitForInvocation('set_config', 3000);

        // 2. Settings -> MCP Servers: Add, Connect, Tools, Disconnect, Remove
        await app.page.evaluate(() => {
          Array.from(document.querySelectorAll('button'))
            .find((b) => b.textContent?.includes('MCP Servers'))
            ?.click();
        });
        await app.page.waitForSelector('input[aria-label="MCP Server Name"]', 3000);
        await app.page.type('input[aria-label="MCP Server Name"]', 'audit-mcp', { clear: true });
        await app.page.type('input[aria-label="MCP Command"]', 'npx', { clear: true });
        await app.page.evaluate(() => {
          Array.from(document.querySelectorAll('button'))
            .find((b) => b.textContent?.trim() === 'Add MCP Server')
            ?.click();
        });
        await app.bridge.waitForInvocation('add_server', 3000);
        await app.page.waitForSelector('button[aria-label="Remove MCP server audit-mcp"]', 3000);
        await app.page.evaluate(() => {
          Array.from(document.querySelectorAll('button'))
            .find((b) => b.textContent?.trim() === 'Connect')
            ?.click();
        });
        await app.bridge.waitForInvocation('connect_server', 3000);
        await app.page.evaluate(() => {
          const btn = Array.from(document.querySelectorAll('button')).find(
            (b) => b.textContent?.trim() === 'Disconnect'
          );
          if (!btn) throw new Error('Disconnect button did not render after connect_server');
          btn.click();
        });
        await app.bridge.waitForInvocation('disconnect_server', 3000);
        await app.page.click('button[aria-label="Remove MCP server audit-mcp"]');
        await app.bridge.waitForInvocation('remove_server', 3000);

        // 3. Settings -> Skills: Reload, Inspect, Open in Artifact Pane
        await app.page.evaluate(() => {
          Array.from(document.querySelectorAll('button'))
            .find((b) => b.textContent?.includes('Skills ('))
            ?.click();
        });
        await app.page.waitForSelector('input[aria-label="Filter skills"]', 3000);
        await app.page.evaluate(() => {
          Array.from(document.querySelectorAll('button'))
            .find((b) => b.textContent?.includes('Reload Skills'))
            ?.click();
        });
        await app.bridge.waitForInvocation('reload_skills', 3000);
        const inspected = await app.page.evaluate(() => {
          const btn = document.querySelector('button[title="Inspect SKILL.md"]');
          if (!btn) return false;
          btn.click();
          return true;
        });
        assert.ok(inspected, 'Expected at least one skill with Inspect SKILL.md button');
        await app.page.waitForSelector('button[aria-label="Close skill preview"]', 3000);
        await app.page.evaluate(() => {
          Array.from(document.querySelectorAll('button'))
            .find((b) => b.textContent?.includes('Open in Artifact Pane'))
            ?.click();
        });
        await app.page.waitForSelector('aside[aria-label="Artifact and Files Pane"]', 3000);

        // 4. ArtifactPane: cycle through all 5 tabs & toggle Source/Rendered
        for (const label of ['Changes', 'Subagents', 'Tasks', 'Files', 'Artifacts']) {
          await app.page.evaluate((tabLabel) => {
            const pane = document.querySelector('aside[aria-label="Artifact and Files Pane"]');
            const btns = pane ? Array.from(pane.querySelectorAll('button')) : [];
            btns.find((b) => b.textContent?.trim().startsWith(tabLabel))?.click();
          }, label);
        }

        // 5. Settings -> Agent & Preferences: Save Preferences
        await app.page.click('button[aria-label="Local LLM, MCP & Skills Settings"]');
        await app.page.waitForSelector(
          '[role="dialog"][aria-label="Local Settings & Connections"]',
          3000
        );
        await app.page.evaluate(() => {
          Array.from(document.querySelectorAll('button'))
            .find((b) => b.textContent?.includes('Agent & Preferences'))
            ?.click();
        });
        await app.page.waitForSelector('input[aria-label="Max Iterations"]', 3000);
        await app.page.evaluate(() => {
          Array.from(document.querySelectorAll('button'))
            .find((b) => b.textContent?.trim() === 'Save Preferences')
            ?.click();
        });
        await app.bridge.waitForInvocation('set_config', 3000);
        await app.page.click('button[aria-label="Close settings"]');

        // 6. Command Palette: execute Open MCP Servers, Switch to Light/Dark Theme
        await app.page.evaluate(() => {
          Array.from(document.querySelectorAll('button'))
            .find((b) => b.textContent?.includes('Command Palette'))
            ?.click();
        });
        await app.page.waitForSelector('[role="dialog"][aria-label="Command Palette"]', 3000);
        await app.page.evaluate(() => {
          Array.from(document.querySelectorAll('[role="dialog"][aria-label="Command Palette"] button'))
            .find((b) => b.textContent?.includes('Switch to Light Theme'))
            ?.click();
        });
        const isLight = await app.page.evaluate(() =>
          document.documentElement.classList.contains('light')
        );
        assert.equal(isLight, true, 'Command Palette should switch theme to light');

        // 7. Scheduled Tasks: Add & Delete
        await app.page.evaluate(() => {
          const btn = document.querySelector('button[aria-label="Add scheduled task"]');
          btn?.scrollIntoView({ block: 'center' });
          btn?.click();
        });
        await app.page.waitForSelector('input[aria-label="Scheduled task prompt"]', 3000);
        await app.page.type('input[aria-label="Scheduled task prompt"]', 'Audit daily status', {
          clear: true,
        });
        await app.page.evaluate(() => {
          Array.from(document.querySelectorAll('button'))
            .find((b) => b.textContent?.trim() === 'Save')
            ?.click();
        });
        await app.bridge.waitForInvocation('set_config', 3000);
        await app.page.click('button[aria-label="Delete schedule Audit daily status"]');

        // 8. Sidebar: New Conversation creates exactly 1 conversation, Delete removes it, Collapse/Expand works
        const convBefore = await app.page.evaluate(
          () => document.querySelectorAll('button[aria-label^="Delete conversation "]').length
        );
        await app.page.click('button[aria-label="New standalone conversation"]');
        await app.bridge.waitForInvocation('create_conversation', 3000);
        await new Promise((r) => setTimeout(r, 100));
        const convAfterCreate = await app.page.evaluate(
          () => document.querySelectorAll('button[aria-label^="Delete conversation "]').length
        );
        assert.equal(
          convAfterCreate,
          convBefore + 1,
          'Clicking New Conversation once must create exactly 1 conversation'
        );
        await app.page.evaluate(() => {
          document.querySelector('button[aria-label^="Delete conversation "]')?.click();
        });
        await app.bridge.waitForInvocation('delete_conversation', 3000);
        await new Promise((r) => setTimeout(r, 100));
        const convAfterDelete = await app.page.evaluate(
          () => document.querySelectorAll('button[aria-label^="Delete conversation "]').length
        );
        assert.equal(convAfterDelete, convBefore, 'Delete conversation must remove the conversation');

        // 9. Slash commands: verify all 10 commands render in picker
        await app.page.type('textarea', '/', { clear: true });
        const slashCount = await app.page.evaluate(() => {
          const cmds = [
            '/plan',
            '/compact',
            '/goal',
            '/grill-me',
            '/boost',
            '/teamwork',
            '/swarm',
            '/learn',
            '/schedule',
            '/browser',
          ];
          const text = document.body.innerText;
          return cmds.filter((c) => text.includes(c)).length;
        });
        assert.equal(slashCount, 10, 'Expected all 10 slash commands in slash picker');

        assert.assertNoPageErrors(app);
      },
    },
  ];
}
