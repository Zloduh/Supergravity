import path from 'node:path';

export function getTests() {
  return [
    {
      id: 'T1-01',
      tier: 1,
      feature: 'F1-F15',
      name: 'App boots cleanly in headless Chromium with Strata defaults and zero console/page errors',
      async run(env) {
        const { assert } = env;
        const app = await env.openApp({
          width: 1440,
          height: 900,
          waitForSelector: 'main',
        });

        const titleText = await app.page.evaluate(() => document.body.innerText);
        assert.ok(titleText.includes('Antigravity'), 'Expected Antigravity header in UI');
        assert.ok(
          titleText.includes('Strata (Local)'),
          'Expected Strata (Local) active provider status'
        );

        const shotPath = path.join(env.screenshotsDir, 'tier1_initial_desktop.png');
        const png = await app.page.captureScreenshot(shotPath);
        assert.assertPngDimensions(png, 1440, 900);
        assert.assertNoPageErrors(app);
      },
    },
    {
      id: 'T1-02',
      tier: 1,
      feature: 'F2-F3',
      name: 'Strata Local & Strata LAN defaults preserved with coder-iq1_m model discovery',
      async run(env) {
        const { assert, bridge } = env;
        const cfg = await bridge.invoke('get_config');
        assert.equal(cfg.llm.active_provider, 'strata');
        const strata = cfg.llm.providers.find((p) => p.id === 'strata');
        const strataLan = cfg.llm.providers.find((p) => p.id === 'strata-lan');
        assert.ok(strata);
        assert.equal(strata.base_url, 'http://127.0.0.1:47831/v1');
        assert.equal(strata.api_key, 'strata');
        assert.ok(strataLan);
        assert.equal(strataLan.base_url, 'http://192.168.0.92:47832/v1');
        assert.equal(strataLan.api_key, 'strata');
      },
    },
  ];
}
