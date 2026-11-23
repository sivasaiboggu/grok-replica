// Grok Replica — tests for the safe Markdown renderer.
// Run: npm test (node --test tests/*.test.js)
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { renderMarkdown, escapeHtml, extractCodeBlocks, getCodeBlockById } from '../src/markdown.js';

describe('escapeHtml', () => {
  it('escapes markup so model output can never inject HTML', () => {
    assert.equal(escapeHtml('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;');
    assert.equal(escapeHtml('a & b "c"'), 'a &amp; b &quot;c&quot;');
  });
});

describe('renderMarkdown', () => {
  it('renders a plain paragraph', () => {
    assert.equal(renderMarkdown('Hello world'), '<p>Hello world</p>');
  });

  it('escapes HTML in the source', () => {
    const out = renderMarkdown('Try <img src=x onerror=alert(1)> now');
    assert.ok(!out.includes('<img'), 'raw img tag leaked');
    assert.ok(out.includes('&lt;img'));
  });

  it('renders bold, italic and inline code', () => {
    const out = renderMarkdown('A **bold** and *italic* word with `code` inline.');
    assert.ok(out.includes('<strong>bold</strong>'));
    assert.ok(out.includes('<em>italic</em>'));
    assert.ok(out.includes('<code>code</code>'));
  });

  it('renders links with rel noopener and a new tab', () => {
    const out = renderMarkdown('See [Gemini](https://ai.google.dev) for docs.');
    assert.ok(out.includes('<a href="https://ai.google.dev" target="_blank" rel="noopener noreferrer">Gemini</a>'));
  });

  it('does not linkify bare URLs or non-http schemes', () => {
    const out = renderMarkdown('Run javascript:alert(1) now.');
    assert.ok(!out.includes('href="javascript:'));
  });

  it('renders headings', () => {
    assert.ok(renderMarkdown('# Title').includes('<h1>Title</h1>'));
    assert.ok(renderMarkdown('## Section').includes('<h2>Section</h2>'));
    assert.ok(renderMarkdown('### Sub').includes('<h3>Sub</h3>'));
  });

  it('renders unordered and ordered lists', () => {
    const ul = renderMarkdown('- one\n- two\n- three');
    assert.ok(ul.includes('<ul>') && ul.includes('<li>one</li>') && ul.includes('<li>three</li>'));
    const ol = renderMarkdown('1. first\n2. second');
    assert.ok(ol.includes('<ol>') && ol.includes('<li>first</li>'));
  });

  it('renders blockquotes and horizontal rules', () => {
    assert.ok(renderMarkdown('> quoted line').includes('<blockquote>quoted line</blockquote>'));
    assert.ok(renderMarkdown('before\n\n---\n\nafter').includes('<hr>'));
  });

  it('renders a fenced code block with language label and copy button', () => {
    const out = renderMarkdown('Here is code:\n\n```python\nprint("hi")\n```\n\nDone.');
    assert.ok(out.includes('class="code-block"'), 'code block missing');
    assert.ok(out.includes('<span>python</span>'), 'language label missing');
    assert.ok(out.includes('data-copy-code="0"'), 'copy button missing');
    assert.ok(out.includes('print(&quot;hi&quot;)'), 'code not escaped');
    assert.ok(!out.includes('<p><div'), 'code block nested inside a paragraph');
    assert.ok(out.includes('<p>Here is code:</p>'));
    assert.ok(out.includes('<p>Done.</p>'));
  });

  it('does not apply bold/italic inside code blocks', () => {
    const out = renderMarkdown('```\n**not bold** and *not italic*\n```');
    assert.ok(!out.includes('<strong>'), 'bold leaked into code');
    assert.ok(out.includes('**not bold**'));
  });

  it('keeps code block contents retrievable by id', () => {
    const { blocks } = extractCodeBlocks('```js\nconst a = 1;\n```');
    assert.equal(blocks.length, 1);
    assert.equal(getCodeBlockById(blocks, 0).code, 'const a = 1;');
    assert.equal(getCodeBlockById(blocks, 99), null);
  });

  it('handles an unclosed fence without crashing', () => {
    const out = renderMarkdown('```js\nconst a = 1;');
    assert.ok(out.includes('class="code-block"'));
    assert.ok(out.includes('const a = 1;'));
  });

  it('returns empty string for empty input', () => {
    assert.equal(renderMarkdown(''), '');
    assert.equal(renderMarkdown('   \n  '), '');
  });
});
