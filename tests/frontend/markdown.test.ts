import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createMockTauriEnv } from './mock_tauri.ts';

createMockTauriEnv();
const { MarkdownRenderer, extractPlainText } = await import(
  '../../src/components/MarkdownRenderer.tsx'
);

describe('MarkdownRenderer & extractPlainText', () => {
  it('extractPlainText recursively extracts text without [object Object]', () => {
    const highlightedTree = [
      React.createElement('span', { className: 'hljs-keyword', key: '1' }, 'const'),
      ' ',
      React.createElement('span', { className: 'hljs-title', key: '2' }, 'answer'),
      ': ',
      React.createElement('span', { className: 'hljs-type', key: '3' }, 'number'),
      ' = ',
      React.createElement('span', { className: 'hljs-number', key: '4' }, 42),
      ';',
      React.createElement('br', { key: '5' }),
      null,
      undefined,
      false,
      'return answer;',
    ];

    const text = extractPlainText(highlightedTree);
    assert.equal(text, 'const answer: number = 42;\nreturn answer;');
    assert.equal(text.includes('[object Object]'), false);
  });

  it('renders rich markdown without nested <pre> or node="[object Object]"', () => {
    const md = [
      '# Heading 1',
      '',
      'Inline `code` and **bold** text.',
      '',
      '- item one',
      '- item two',
      '',
      '> quote line',
      '',
      '| Col A | Col B |',
      '| --- | --- |',
      '| 1 | 2 |',
      '',
      'Math: $x^2 + y^2 = z^2$',
      '',
      '```ts',
      'const greeting: string = "hello";',
      '```',
      '',
      '```c++',
      'int main() { return 0; }',
      '```',
      '',
      '```mermaid',
      'graph TD; A-->B;',
      '```',
    ].join('\n');

    const html = renderToStaticMarkup(React.createElement(MarkdownRenderer, { content: md }));

    assert.equal(html.includes('[object Object]'), false, 'HTML must not contain [object Object]');
    assert.equal(html.includes('node='), false, 'HTML must not leak ReactMarkdown node prop');
    assert.equal(/<pre[^>]*>\s*<div/.test(html), false, 'Must not wrap CodeBlock div inside outer <pre>');

    assert.match(html, /<h1[^>]*>Heading 1<\/h1>/);
    assert.match(html, /<ul[^>]*>/);
    assert.match(html, /<blockquote[^>]*>/);
    assert.match(html, /<table[^>]*>/);
    assert.match(html, /katex/);
    assert.match(html, />ts<\/span>/);
    assert.match(html, />c\+\+<\/span>/);
    assert.match(html, /hljs/);
    assert.match(html, /Rendering diagram/);
  });
});
