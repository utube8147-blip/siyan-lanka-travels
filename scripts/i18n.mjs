#!/usr/bin/env node
// Language packs for the app.
//   node scripts/i18n.mjs build   i18n/messages/*.mjs → lib/i18n-ta.ts, lib/i18n-si.ts
//   node scripts/i18n.mjs check   every text in the code has Tamil + Sinhala (exit 1 if not)
//   node scripts/i18n.mjs missing prints the missing English keys as a ready-to-fill file
// The staff area (app/admin) is English only: text used only there is not
// required and is left out of the packs.
// Text is found in: tx('…'), t('…'), tr('…'), N_('…'), txMessage-able keys and <Tx k="…" />.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const MSG_DIR = path.join(ROOT, 'i18n/messages');
const CODE_DIRS = ['app', 'components', 'lib', 'contexts', 'config'];
const FUNCS = new Set(['tx', 't', 'tr', 'N_', 'txr', 'txMessage']);

async function loadMessages() {
  const all = {};
  const where = {};
  const problems = [];
  for (const f of fs.readdirSync(MSG_DIR).filter((x) => x.endsWith('.mjs')).sort()) {
    const mod = await import(pathToFileURL(path.join(MSG_DIR, f)).href + `?v=${Date.now()}`);
    for (const [k, v] of Object.entries(mod.default)) {
      if (where[k] && JSON.stringify(all[k]) !== JSON.stringify(v)) problems.push(`"${k}" is in ${where[k]} and ${f} with different translations`);
      all[k] = v;
      where[k] = f;
    }
  }
  return { all, where, problems };
}

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(tsx?|mjs)$/.test(e.name) && !/^i18n-(ta|si)\.ts$/.test(e.name)) out.push(p);
  }
  return out;
}

const STAFF_ONLY = path.join(ROOT, 'app/admin') + path.sep;

function extractKeys({ withStaff = false } = {}) {
  const keys = new Map(); // key → first place seen
  const dynamic = [];
  for (const d of CODE_DIRS) {
    const dir = path.join(ROOT, d);
    if (!fs.existsSync(dir)) continue;
    for (const file of walk(dir)) {
      if (!withStaff && file.startsWith(STAFF_ONLY)) continue;
      const text = fs.readFileSync(file, 'utf8');
      if (!/\b(tx|t|tr|N_|txr|txn)\(|<Tx /.test(text)) continue;
      const src = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
      const rel = path.relative(ROOT, file);
      const visit = (n) => {
        if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'txn') {
          for (const a of n.arguments.slice(1, 3)) {
            if (ts.isStringLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a)) {
              if (!keys.has(a.text)) keys.set(a.text, `${rel}:${src.getLineAndCharacterOfPosition(a.getStart()).line + 1}`);
            } else dynamic.push(`${rel}:${src.getLineAndCharacterOfPosition(a.getStart()).line + 1} txn(${a.getText().slice(0, 60)})`);
          }
        }
        if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && FUNCS.has(n.expression.text) && n.arguments.length) {
          const a = n.arguments[0];
          // A literal, or a ? b : c where both sides are literals.
          const lits = (e) => {
            if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return [e];
            if (ts.isParenthesizedExpression(e)) return lits(e.expression);
            if (ts.isConditionalExpression(e)) {
              const x = lits(e.whenTrue), y = lits(e.whenFalse);
              return x && y ? [...x, ...y] : null;
            }
            return null;
          };
          const found = lits(a);
          if (found) {
            for (const l of found) if (!keys.has(l.text)) keys.set(l.text, `${rel}:${src.getLineAndCharacterOfPosition(l.getStart()).line + 1}`);
          } else if (n.expression.text !== 't' || /i18n|useT/.test(text)) dynamic.push(`${rel}:${src.getLineAndCharacterOfPosition(a.getStart()).line + 1} ${n.expression.text}(${a.getText().slice(0, 60)})`);
        }
        if (ts.isJsxSelfClosingElement(n) && n.tagName.getText() === 'Tx') {
          for (const at of n.attributes.properties) {
            if (ts.isJsxAttribute(at) && at.name.getText() === 'k' && at.initializer) {
              const init = ts.isJsxExpression(at.initializer) ? at.initializer.expression : at.initializer;
              if (init && (ts.isStringLiteral(init) || ts.isNoSubstitutionTemplateLiteral(init))) {
                if (!keys.has(init.text)) keys.set(init.text, `${rel}:${src.getLineAndCharacterOfPosition(init.getStart()).line + 1}`);
              }
            }
          }
        }
        ts.forEachChild(n, visit);
      };
      visit(src);
    }
  }
  return { keys, dynamic };
}

const placeholders = (s) => [...s.matchAll(/\{(\w+)\}|<(\w+)>/g)].map((m) => m[1] ?? '<' + m[2]).sort().join(',');

function writePack(file, entries) {
  const body = entries.map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},`).join('\n');
  fs.writeFileSync(file, `// Made by \`npm run i18n\` from i18n/messages/*.mjs — don't edit by hand.\nconst pack: Record<string, string> = {\n${body}\n};\nexport default pack;\n`);
}

const cmd = process.argv[2] ?? 'check';
const { all, problems } = await loadMessages();

if (cmd === 'build') {
  // Keep what the translated pages use, and messages that never appear in the
  // code (database errors, matched by txMessage). Drop staff-area-only text.
  const used = extractKeys().keys;
  const everywhere = extractKeys({ withStaff: true }).keys;
  const sorted = Object.entries(all)
    .filter(([k]) => used.has(k) || !everywhere.has(k))
    .sort(([a], [b]) => (a < b ? -1 : 1));
  writePack(path.join(ROOT, 'lib/i18n-ta.ts'), sorted.filter(([, v]) => v[0]).map(([k, v]) => [k, v[0]]));
  writePack(path.join(ROOT, 'lib/i18n-si.ts'), sorted.filter(([, v]) => v[1]).map(([k, v]) => [k, v[1]]));
  console.log(`Wrote ${sorted.length} entries to lib/i18n-ta.ts and lib/i18n-si.ts`);
  if (problems.length) console.log(problems.join('\n'));
} else if (cmd === 'check' || cmd === 'missing') {
  const { keys, dynamic } = extractKeys();
  const missing = [], half = [], badPh = [];
  for (const [k, at] of keys) {
    const v = all[k];
    if (!v) missing.push([k, at]);
    else if (!v[0] || !v[1]) half.push([k, at]);
    else for (const [i, lang] of [[0, 'ta'], [1, 'si']]) if (placeholders(v[i]) !== placeholders(k)) badPh.push(`${lang}: "${k}" → "${v[i]}"`);
  }
  if (cmd === 'missing') {
    console.log('export default {\n' + missing.map(([k, at]) => `  // ${at}\n  ${JSON.stringify(k)}: ['', ''],`).join('\n') + '\n};');
  } else {
  const unused = Object.keys(all).filter((k) => !keys.has(k));
  console.log(`${keys.size} texts in the app; ${Object.keys(all).length} translated entries.`);
  if (missing.length) console.log(`\nNo translation (${missing.length}):\n` + missing.slice(0, 400).map(([k, at]) => `  ${at}  ${JSON.stringify(k)}`).join('\n'));
  if (half.length) console.log(`\nOnly one language (${half.length}):\n` + half.map(([k, at]) => `  ${at}  ${JSON.stringify(k)}`).join('\n'));
  if (badPh.length) console.log(`\nPlaceholders differ (${badPh.length}):\n  ` + badPh.join('\n  '));
  if (problems.length) console.log('\n' + problems.join('\n'));
  if (process.argv.includes('--unused') && unused.length) console.log(`\nNot used in the code (${unused.length}):\n  ` + unused.join('\n  '));
  if (process.argv.includes('--dynamic') && dynamic.length) console.log(`\nComputed keys (check by hand):\n  ` + dynamic.join('\n  '));
  // exitCode (not exit()) so long output isn't cut off when piped
  process.exitCode = missing.length || half.length || badPh.length || problems.length ? 1 : 0;
  }
}
