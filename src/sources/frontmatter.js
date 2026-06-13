// Minimal YAML-frontmatter reader. Parses `key: value` scalar pairs between the
// leading `---` fences — enough to pull `name`/`description`/`type` out of
// SKILL.md and memory files. Nested keys (e.g. `metadata:` → `  type:`) are
// flattened to their leaf name; top-level keys win over nested ones on collision.
function parseFrontmatter(text) {
  if (typeof text !== 'string') return {};
  const lines = text.split('\n');
  if (lines[0].trim() !== '---') return {};

  const out = {};
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '---') break;        // end of frontmatter
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    // strip a single layer of surrounding quotes
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!key || value === '') continue;      // skip parent keys (empty value)
    if (!(key in out)) out[key] = value;     // first (top-level) wins
  }
  return out;
}

module.exports = { parseFrontmatter };
