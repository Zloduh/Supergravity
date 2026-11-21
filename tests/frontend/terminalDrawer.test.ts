import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createMockTauriEnv } from './mock_tauri.ts';

createMockTauriEnv();
const { TerminalDrawer } = await import('../../src/components/TerminalDrawer.tsx');

describe('TerminalDrawer SSR & layout verification', () => {
  it('renders nothing when closed and workspace-contained flex drawer when open', () => {
    const closedHtml = renderToStaticMarkup(
      React.createElement(TerminalDrawer, { isOpen: false, onClose: () => {} })
    );
    assert.equal(closedHtml, '');

    const openHtml = renderToStaticMarkup(
      React.createElement(TerminalDrawer, { isOpen: true, onClose: () => {} })
    );

    assert.equal(
      openHtml.includes('fixed bottom-0'),
      false,
      'Drawer must not use fixed overlay positioning'
    );
    assert.equal(openHtml.includes('z-50'), false, 'Drawer must not use z-50 overlay');
    assert.match(openHtml, /<section[^>]*aria-label="Terminal Drawer"/);
    assert.match(openHtml, /role="separator"/);
    assert.match(openHtml, /aria-label="New terminal"/);
    assert.match(openHtml, /aria-label="Close terminal drawer"/);
    assert.match(openHtml, /Start Terminal/);
  });
});
