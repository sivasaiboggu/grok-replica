// Grok Replica — small, safe Markdown renderer.
// Escapes HTML first, so model output can never inject markup.
// Supports: fenced code blocks (with language label), inline code,
// headings, bold, italic, links, unordered/ordered lists, blockquotes,
// horizontal rules, paragraphs. Everything else stays plain text.
// No dependencies. Pure functions — tested in tests/markdown.test.js.

export function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const CODE_PLACEHOLDER = '\u0000CODE';
let codeCounter = 0;

// Pull fenced code blocks out before inline formatting runs, so their
// contents are never mangled by bold/italic/link rules.
export function extractCodeBlocks(text) {
  const blocks = [];
  codeCounter = 0;
  const out = text.replace(/```(\w*)\n?([\s\S]*?)(?:```|$)/g, (_m, lang, code) => {
    const id = codeCounter++;
    blocks.push({ id, lang: (lang || '').trim(), code: code.replace(/\n$/, '') });
    return `${CODE_PLACEHOLDER}${id}\u0000`;
  });
  return { text: out, blocks };
}

function renderInline(text) {
  // text is already HTML-escaped.
  let out = text;
  // inline code first so `**` inside code stays literal
  out = out.replace(/`([^`\n]+)`/g, (_m, code) => `<code>${code}</code>`);
  // links: [label](https://...)
  out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    (_m, label, url) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`);
  // bold, then italic (bold first so ** survives)
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(^|[^*\w])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  return out;
}

function restoreCodeBlocks(html, blocks) {
  let out = html;
  for (const block of blocks) {
    const label = block.lang ? escapeHtml(block.lang) : 'code';
    const codeHtml =
      `<div class="code-block" data-code-block>` +
      `<div class="code-block-head"><span>${label}</span>` +
      `<button type="button" data-copy-code="${block.id}" aria-label="Copy code">` +
      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>` +
      `Copy</button></div>` +
      `<pre><code>${escapeHtml(block.code)}</code></pre></div>`;
    out = out.split(`${CODE_PLACEHOLDER}${block.id}\u0000`).join(codeHtml);
  }
  return out;
}

export function getCodeBlockById(blocks, id) {
  return blocks.find((b) => String(b.id) === String(id)) || null;
}

// Render one paragraph-ish chunk (no blank lines inside) to HTML.
function renderBlock(chunk, blocks) {
  const lines = chunk.split('\n');
  const first = lines[0];

  // fenced code placeholder on its own line
  if (lines.length === 1 && first.startsWith(CODE_PLACEHOLDER)) {
    return restoreCodeBlocks(first, blocks);
  }

  // headings
  const heading = /^(#{1,3})\s+(.*)$/.exec(first);
  if (heading) {
    const level = heading[1].length;
    return `<h${level}>${renderInline(heading[2].trim())}</h${level}>`;
  }

  // horizontal rule
  if (/^\s*(-{3,}|\*{3,})\s*$/.test(first) && lines.length === 1) return '<hr>';

  // blockquote
  if (lines.every((l) => l.startsWith('&gt;') || l.trim() === '')) {
    const inner = lines.map((l) => l.replace(/^&gt;\s?/, '')).join('\n').trim();
    return `<blockquote>${renderInline(inner)}</blockquote>`;
  }

  // lists (single-level)
  const isUnordered = lines.every((l) => /^\s*[-*]\s+/.test(l));
  const isOrdered = lines.every((l) => /^\s*\d+\.\s+/.test(l));
  if (isUnordered || isOrdered) {
    const tag = isUnordered ? 'ul' : 'ol';
    const items = lines.map((l) => {
      const text = l.replace(/^\s*[-*]\s+/, '').replace(/^\s*\d+\.\s+/, '');
      return `<li>${renderInline(text)}</li>`;
    }).join('');
    return `<${tag}>${items}</${tag}>`;
  }

  // plain paragraph (soft line breaks become spaces, like chat apps)
  return `<p>${renderInline(lines.join(' ').trim())}</p>`;
}

export function renderMarkdown(source) {
  if (!source || !String(source).trim()) return '';
  const { text, blocks } = extractCodeBlocks(String(source));
  const escaped = escapeHtml(text);
  const rawChunks = escaped.split(/\n\s*\n/).map((c) => c.trim()).filter(Boolean);
  // A code placeholder on its own line gets its own chunk, so a code
  // block never lands inside a <p>.
  const chunks = [];
  for (const chunk of rawChunks) {
    const lines = chunk.split('\n');
    let current = [];
    for (const line of lines) {
      if (/^\u0000CODE\d+\u0000$/.test(line.trim())) {
        if (current.length) chunks.push(current.join('\n'));
        chunks.push(line.trim());
        current = [];
      } else current.push(line);
    }
    if (current.length) chunks.push(current.join('\n'));
  }
  const html = chunks.map((chunk) => renderBlock(chunk, blocks)).join('\n');
  return restoreCodeBlocks(html, blocks);
}
