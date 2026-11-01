#!/usr/bin/env node
// Checks the agent layer: skill frontmatter, relative links, pointer integrity, that nothing in the
// repo is wired for one harness, that every eval folder names a skill, that every Jev CLI is in
// its registry, and that no command the docs give agents carries what a shell guard refuses.
//
// This is the repo's deterministic check for the class of mistake an agent makes most often when
// editing skills or AGENTS.md: a renamed folder, a missing description, a pointer to a file that
// moved, a context file for one harness. It is deliberately dependency-free so it runs in CI and
// in any sandbox.
//
// `checkRepo(root)` is exported for check-skills.test.mjs; running the file checks this repo.

import { lstat, readFile, readdir } from 'node:fs/promises';
import { existsSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
// Limits from the Agent Skills specification, https://agentskills.io/specification.
const MAX_NAME = 64;
const MAX_DESCRIPTION = 1024;
const MAX_COMPATIBILITY = 500;
// Harnesses cap how much of a context file they load, and some truncate silently; 32 KiB is the
// smallest common default. The line budget is the tighter rule; this one catches very long lines.
const MAX_AGENTS_BYTES = 32 * 1024;
const KNOWN_FRONTMATTER_KEYS = new Set([
  'name',
  'description',
  'disable-model-invocation',
  'argument-hint',
  'metadata',
  'license',
  'allowed-tools',
  'compatibility',
]);

// Files and folders that exist for one harness. The template gives every agent the same base
// (ADR-0001), so none may appear: a second context file drifts from AGENTS.md, and per-harness
// wiring means agents start from different places. Paths are relative to the repo root.
const HARNESS_SPECIFIC = [
  'CLAUDE.md',
  'CLAUDE.local.md',
  'GEMINI.md',
  'AGENTS.override.md',
  '.cursorrules',
  '.windsurfrules',
  '.claude',
  '.codex',
  '.cursor',
  '.gemini',
  '.windsurf',
  '.github/copilot-instructions.md',
];

// A block-scalar header: style, then an optional chomping and indentation indicator in either
// order, then an optional comment, as in `>`, `|-`, `>2`, `|+1` or `> # note`.
const BLOCK_HEADER = /^([|>])(?:[1-9][+-]?|[+-][1-9]?)?(?:[ \t]+#.*)?$/;

// YAML line folding for a `>` block: a break between two text lines becomes a space, and each
// blank line becomes a break. More-indented lines are not special-cased: the reader trims indentation.
function fold(lines) {
  let out = '';
  lines.forEach((line, i) => {
    if (line === '') out += '\n';
    else out += (i > 0 && lines[i - 1] !== '' ? ' ' : '') + line;
  });
  return out;
}

// Minimal YAML frontmatter reader. Handles the flat `key: value` shape these skills use, block
// scalars (`|` keeps line breaks and blank lines, `>` folds them as `fold` does; indentation and
// surrounding blank lines are trimmed), and nested maps, which it skips rather than mis-parses.
// Exported for check-skills.test.mjs.
export function parseFrontmatter(source, label, { err }) {
  if (!source.startsWith('---\n') && !source.startsWith('---\r\n')) {
    err(`${label}: missing YAML frontmatter (file must start with ---)`);
    return null;
  }
  const end = source.indexOf('\n---', 3);
  if (end === -1) {
    err(`${label}: frontmatter is not terminated with ---`);
    return null;
  }
  const raw = source.slice(source.indexOf('\n') + 1, end);
  const fields = {};
  let currentKey = null;
  let block = null; // the style and lines of the block scalar being read, if any
  const endBlock = () => {
    if (block) fields[block.key] = (block.style === '>' ? fold(block.lines) : block.lines.join('\n')).trim();
    block = null;
  };
  for (const line of raw.split('\n')) {
    if (block && (/^\s+\S/.test(line) || !line.trim())) {
      block.lines.push(line.trim());
      continue;
    }
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const topLevel = /^([A-Za-z][\w-]*):(.*)$/.exec(line);
    if (topLevel) {
      endBlock();
      currentKey = topLevel[1];
      let value = topLevel[2].trim();
      const blockStyle = BLOCK_HEADER.exec(value);
      if (blockStyle) {
        block = { key: currentKey, style: blockStyle[1], lines: [] };
      } else if (value === '') {
        fields[currentKey] = undefined; // nested map; presence is what matters
      } else {
        if (
          (value.startsWith('"') && value.endsWith('"') && value.length > 1) ||
          (value.startsWith("'") && value.endsWith("'") && value.length > 1)
        ) {
          value = value.slice(1, -1);
        }
        fields[currentKey] = value;
      }
      continue;
    }
    if (currentKey && /^\s+\S/.test(line) && fields[currentKey] === undefined) {
      fields[currentKey] = fields[currentKey] ?? null;
    }
  }
  endBlock();
  return fields;
}

// Collect relative link targets from markdown, ignoring anything with a scheme or a bare anchor.
// Targets are percent-decoded, as GitHub resolves them. Code is stripped first: links there are
// examples. A fence closes only on a run of its own character at least as long as its opener, and an
// unclosed fence runs to the end of the file. Code spans pair backtick runs of equal length, so a
// stray backtick stays literal. Inline links, `[a](target)` or `[a](<target>)`, with any CommonMark
// title and with brackets or an image in the text, count; so do reference definitions, `[a]: target`,
// inside block quotes and list items but not where they would continue a paragraph. Indented code
// blocks are not detected, so a link in one is checked: that fails safe. Lines end in LF, CRLF or a lone
// CR, as in CommonMark, so a Windows checkout parses the same as a Unix one.
const CONTAINER = /^(?:[ \t]*(?:>|[-*+]|\d{1,9}[.)])(?=[ \t]|$))*[ \t]*/;
const FENCE_OPEN = /^(`{3,}|~{3,})/;
const ATX_HEADING = /^#{1,6}(?:[ \t]|$)/;
const TITLE = String.raw`(?:"[^"]*"|'[^']*'|\([^()]*\))`;
const REFERENCE_DEFINITION = new RegExp(
  String.raw`^\[(?!\^)(?:[^\[\]\\]|\\.)+\]:[ \t]*(?:<([^>\n]+)>|(\S+))(?:[ \t]+${TITLE})?[ \t]*$`,
);
const CODE_SPAN = /(?<!`)(`+)(?!`)(?:(?!\n[ \t]*\n)[\s\S])*?(?<!`)\1(?!`)/g;
const INLINE_LINK = new RegExp(
  String.raw`\[((?:[^\[\]]|\[[^\[\]]*\])*)\]\((?:<([^>\n]+)>|((?:[^\s()]|\([^\s()]*\))+))(?:\s+${TITLE})?\s*\)`,
  'g',
);

function decode(target) {
  try {
    return decodeURIComponent(target);
  } catch {
    return target;
  }
}

function inlineTargets(text, out) {
  for (const match of text.matchAll(INLINE_LINK)) {
    out.push(match[2] ?? match[3]);
    inlineTargets(match[1], out); // an image or link inside the link text, as in a README badge
  }
}

export function relativeLinks(markdown) {
  const targets = [];
  const prose = [];
  let fence = null;
  let blockStart = true; // a definition cannot interrupt a paragraph
  let lastMarkers = '';
  for (const line of markdown.split(/\r\n?|\n/)) {
    const prefix = CONTAINER.exec(line)[0];
    const content = line.slice(prefix.length);
    const markers = prefix.replace(/[ \t]/g, '');
    if (fence) {
      const run = /^(`+|~+)[ \t]*$/.exec(content);
      if (run && run[1][0] === fence[0] && run[1].length >= fence.length) fence = null;
      blockStart = !fence;
      prose.push('');
      continue;
    }
    const opener = FENCE_OPEN.exec(content);
    if (opener && !(opener[1][0] === '`' && content.slice(opener[1].length).includes('`'))) {
      fence = opener[1];
      prose.push('');
      continue;
    }
    // A new block quote or list item starts a block even right after a paragraph line; a line that
    // drops its markers is a lazy continuation, so it does not.
    const newContainer = markers !== '' && (markers !== lastMarkers || /[^>]/.test(markers));
    lastMarkers = markers;
    const definition = (blockStart || newContainer) && REFERENCE_DEFINITION.exec(content);
    if (definition) {
      targets.push(definition[1] ?? definition[2]);
      blockStart = true;
      prose.push('');
      continue;
    }
    prose.push(content);
    blockStart = content.trim() === '' || ATX_HEADING.test(content);
  }
  inlineTargets(prose.join('\n').replace(CODE_SPAN, ''), targets);

  const out = [];
  for (const target of targets) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(target)) continue;
    if (target.startsWith('#')) continue;
    out.push(decode(target.split('#')[0]));
  }
  return out.filter(Boolean);
}

async function checkSkill(skillsDir, skillName, { err, warn }) {
  const dir = path.join(skillsDir, skillName);
  const skillFile = path.join(dir, 'SKILL.md');
  const label = `.agents/skills/${skillName}/SKILL.md`;

  if (!existsSync(skillFile)) {
    err(`${label}: missing SKILL.md`);
    return;
  }

  const source = await readFile(skillFile, 'utf8');
  const fields = parseFrontmatter(source, label, { err });
  if (fields) {
    if (!fields.name) {
      err(`${label}: frontmatter must set \`name\``);
    } else if (fields.name !== skillName) {
      err(`${label}: frontmatter name "${fields.name}" does not match folder "${skillName}"`);
    }
    if (!NAME_RE.test(fields.name ?? '')) {
      err(`${label}: name must be kebab-case ([a-z0-9-])`);
    } else if (fields.name.length > MAX_NAME) {
      err(`${label}: name is ${fields.name.length} chars, over the ${MAX_NAME} limit`);
    }

    const description = fields.description;
    if (!description) {
      err(`${label}: frontmatter must set a non-empty \`description\``);
    } else {
      if (description.length > MAX_DESCRIPTION) {
        err(`${label}: description is ${description.length} chars, over the ${MAX_DESCRIPTION} limit`);
      }
      const userInvoked = fields['disable-model-invocation'] === 'true';
      // A model-invoked skill's description is its trigger, so it must say when to reach for it.
      // A user-invoked skill's description is human-facing, so it need not.
      if (!userInvoked && !/\buse when\b|\bwhen the user\b|\buse for\b/i.test(description)) {
        warn(`${label}: model-invoked description names no trigger ("Use when ...")`);
      }
    }

    const compatibility = fields.compatibility;
    if (typeof compatibility === 'string' && compatibility.length > MAX_COMPATIBILITY) {
      err(`${label}: compatibility is ${compatibility.length} chars, over the ${MAX_COMPATIBILITY} limit`);
    }

    const dmi = fields['disable-model-invocation'];
    if (dmi !== undefined && dmi !== 'true' && dmi !== 'false') {
      err(`${label}: disable-model-invocation must be true or false, got "${dmi}"`);
    }

    for (const key of Object.keys(fields)) {
      if (!KNOWN_FRONTMATTER_KEYS.has(key)) {
        warn(`${label}: unrecognised frontmatter key "${key}"`);
      }
    }
  }
}

async function present(p) {
  try {
    await lstat(p);
    return true;
  } catch {
    return false;
  }
}

export function insideRoot(root, p) {
  const rel = path.relative(root, p);
  return rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
}

async function markdownFiles(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true, recursive: true })) {
    if (entry.isFile() && entry.name.endsWith('.md')) out.push(path.join(entry.parentPath, entry.name));
  }
  return out.sort();
}

// Every relative link in the agent layer must resolve: a moved doc breaks a pointer an agent follows.
async function checkLinks(root, file, { err }) {
  const label = path.relative(root, file);
  for (const link of relativeLinks(await readFile(file, 'utf8'))) {
    const resolved = path.resolve(path.dirname(file), link);
    if (!insideRoot(root, resolved)) {
      err(`${label}: link escapes the repo: ${link}`);
    } else if (!existsSync(resolved)) {
      err(`${label}: broken relative link -> ${link}`);
    }
  }
}

// Commands an agent types must run as written under the strictest non-interactive shell guard seen
// (ADR-0003). That guard reads braces as shell expansion, refuses jq flags that read a file, and
// refuses `cd <dir>` chained to another command. So a GraphQL query lives in a file named with
// `-F query=@<file>`, a jq filter stays inline without braces, and a folder is addressed with
// `git -C`, never entered. gh's own placeholders are not shell syntax.
const SHELL_FENCE = new Set(['', 'bash', 'sh', 'shell', 'console', 'zsh']);
const RUNS_TOOL = /(?:^|[\s;&|(`])(?:gh|git|jq)\s/;
const GH_PLACEHOLDER = /\{(?:owner|repo)\}/g;
// A jq flag that reads a file: a short-flag bundle holding f (`-f`, `-cf`, `-nrf`), -L or
// -L<dir>, or a long one. Checked on unquoted shell words only, so a filter's text never counts.
const JQ_FILE_FLAG = /^(?:-[a-zA-Z]*f[a-zA-Z]*|-L.*|--(?:from-file|rawfile|slurpfile|argfile)(?:=.*)?)$/;

// A command's simple commands, each a list of shell words: quotes group a word and are kept
// apart from the text (`quoted`), and an unquoted |, ;, &, (, ) or newline ends the command.
export function simpleCommands(command) {
  const commands = [[]];
  let word = null;
  let quote = null;
  const end = () => {
    if (word) commands.at(-1).push(word);
    word = null;
  };
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (quote) {
      if (c === quote) quote = null;
      else if (quote === '"' && c === '\\' && i + 1 < command.length) word.text += command[++i];
      else word.text += c;
    } else if (c === "'" || c === '"') {
      word ??= { text: '', quoted: false };
      word.quoted = true;
      quote = c;
    } else if (c === '\\' && i + 1 < command.length) {
      word ??= { text: '', quoted: false };
      word.text += command[++i];
    } else if (/[|;&()\n]/.test(c)) {
      end();
      if (commands.at(-1).length) commands.push([]);
    } else if (/\s/.test(c)) {
      end();
    } else {
      word ??= { text: '', quoted: false };
      word.text += c;
    }
  }
  end();
  return commands.filter((words) => words.length);
}

// True when a jq invocation in the command, not gh's --jq, gives jq a flag that reads a file.
export function jqReadsFile(command) {
  return simpleCommands(command).some((words) => {
    const at = words.findIndex((w) => !w.quoted && (w.text === 'jq' || w.text.endsWith('/jq')));
    return at !== -1 && words.slice(at + 1).some((w) => !w.quoted && JQ_FILE_FLAG.test(w.text));
  });
}
const NAMED_FILE = /-F query=@([^\s'"`|<]+)(?=[\s'"`|]|$)/g;

// The commands in a markdown file: each code span, and each logical line of a shell fence, with
// backslash continuations and lines inside an open single quote joined. Whitespace is collapsed.
export function shellCommands(markdown) {
  const out = [];
  const prose = [];
  let fence = null;
  let shell = false;
  let pending = '';
  for (const line of markdown.split(/\r\n?|\n/)) {
    const content = line.slice(CONTAINER.exec(line)[0].length);
    if (fence) {
      const run = /^(`+|~+)[ \t]*$/.exec(content);
      if (run && run[1][0] === fence[0] && run[1].length >= fence.length) {
        if (pending) out.push(pending);
        fence = null;
        pending = '';
      } else if (shell) {
        pending = `${pending} ${line.trim()}`.trim();
        if (pending.endsWith('\\')) pending = pending.slice(0, -1).trimEnd();
        else if ((pending.match(/'/g) ?? []).length % 2 === 0) {
          out.push(pending);
          pending = '';
        }
      }
      prose.push('');
      continue;
    }
    const opener = /^(`{3,}|~{3,})(.*)$/.exec(content);
    if (opener && !(opener[1][0] === '`' && opener[2].includes('`'))) {
      fence = opener[1];
      shell = SHELL_FENCE.has(opener[2].trim().split(/\s/)[0]);
      prose.push('');
      continue;
    }
    prose.push(content);
  }
  if (pending) out.push(pending);
  for (const match of prose.join('\n').matchAll(CODE_SPAN)) {
    out.push(match[0].slice(match[1].length, -match[1].length));
  }
  return out.map((c) => c.replace(/\s+/g, ' ').trim().replace(/^\$ /, '')).filter(Boolean);
}

async function checkCommands(root, file, { err }) {
  const label = path.relative(root, file);
  for (const command of shellCommands(await readFile(file, 'utf8'))) {
    if (/^cd\s/.test(command) && /&&|;/.test(command)) {
      err(`${label}: command starts with cd and chains another; address the folder with git -C (ADR-0003): ${command}`);
    } else if (RUNS_TOOL.test(command) && /[{}]/.test(command.replace(GH_PLACEHOLDER, ''))) {
      err(`${label}: command inlines braces; put a query in a file, build jq objects with pick (ADR-0003): ${command}`);
    }
    if (jqReadsFile(command)) {
      err(`${label}: jq reads a file through a flag a shell guard refuses; keep the filter inline (ADR-0003): ${command}`);
    }
    if (!RUNS_TOOL.test(command)) continue;
    for (const [, named] of command.matchAll(NAMED_FILE)) {
      if (!existsSync(path.join(root, named))) err(`${label}: command names ${named}, which does not exist`);
    }
  }
}

export async function checkRepo(root) {
  const skillsDir = path.join(root, '.agents', 'skills');
  const agentsMd = path.join(root, 'AGENTS.md');
  const docsDir = path.join(root, 'docs');
  const skillsReadme = path.join(skillsDir, 'README.md');
  const evalsDir = path.join(root, 'evals');

  const errors = [];
  const warnings = [];
  const err = (msg) => errors.push(msg);
  const warn = (msg) => warnings.push(msg);

  // A missing skills folder is one error, not a reason to skip the checks that follow.
  const hasSkills = existsSync(skillsDir);
  if (!hasSkills) err('.agents/skills/ does not exist');
  const skillNames = hasSkills
    ? (await readdir(skillsDir, { withFileTypes: true }))
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
        .sort()
    : [];

  if (hasSkills && skillNames.length === 0) err('.agents/skills/ contains no skill folders');

  for (const name of skillNames) await checkSkill(skillsDir, name, { err, warn });

  // AGENTS.md must exist and stay inside its line and byte budgets.
  if (!existsSync(agentsMd)) {
    err('AGENTS.md does not exist');
  } else {
    const agents = await readFile(agentsMd, 'utf8');
    const lines = agents.split('\n').length;
    if (lines > 200) {
      err(`AGENTS.md is ${lines} lines, over its own 200-line budget (see its header)`);
    }
    const bytes = Buffer.byteLength(agents, 'utf8');
    if (bytes > MAX_AGENTS_BYTES) {
      err(`AGENTS.md is ${bytes} bytes, over the ${MAX_AGENTS_BYTES}-byte budget`);
    }
  }

  // Nothing for one harness (ADR-0001), at the root or inside a skill. lstat, so a symlink counts
  // even when its target is gone.
  const harnessPaths = [
    ...HARNESS_SPECIFIC,
    ...skillNames.map((name) => `.agents/skills/${name}/agents`),
  ];
  for (const rel of harnessPaths) {
    if (await present(path.join(root, rel))) {
      err(`${rel}: harness-specific; every agent gets the same base (ADR-0001)`);
    }
  }

  // Every root-level .md (AGENTS.md, README.md, and GLOSSARY.md or CODING_STANDARDS.md once a skill
  // creates them), plus everything under docs/, the skills and their evals.
  const rootDocs = (await readdir(root, { withFileTypes: true }))
    .filter((e) => e.isFile() && e.name.endsWith('.md'))
    .map((e) => path.join(root, e.name))
    .sort();
  const linked = [
    ...rootDocs,
    ...(await markdownFiles(docsDir)),
    ...(await markdownFiles(skillsDir)),
    ...(await markdownFiles(evalsDir)),
  ];
  for (const file of linked) if (existsSync(file)) await checkLinks(root, file, { err });

  // Commands agents type: AGENTS.md, the tracker and workflow docs, the skills and the eval cases.
  // ADRs and specs are left out: they quote the old commands they replace.
  const commanded = [
    agentsMd,
    ...(await markdownFiles(path.join(docsDir, 'agents'))),
    path.join(docsDir, 'workflow.md'),
    ...(await markdownFiles(skillsDir)),
    ...(await markdownFiles(evalsDir)),
  ];
  for (const file of commanded) if (existsSync(file)) await checkCommands(root, file, { err });

  // Every skill must be indexed in the skills README, so none is silently unreachable.
  if (hasSkills && !existsSync(skillsReadme)) {
    err('.agents/skills/README.md does not exist');
  } else if (hasSkills) {
    const readme = await readFile(skillsReadme, 'utf8');
    for (const name of skillNames) {
      if (!readme.includes(`./${name}/`) && !readme.includes(`${name}/SKILL.md`)) {
        err(`.agents/skills/README.md: skill "${name}" is not indexed`);
      }
    }
  }

  // Every eval folder must name a skill, so a renamed or removed skill cannot leave cases that no
  // PR ever runs (evals/README.md).
  if (existsSync(evalsDir)) {
    const skills = new Set(skillNames);
    const folders = (await readdir(evalsDir, { withFileTypes: true }))
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
    for (const name of folders) {
      if (!skills.has(name)) err(`evals/${name}/: names no skill in .agents/skills/`);
    }
  }

  // Every Jev CLI must be in the registry, so a step can name the tool and point there (ADR-0002).
  const jevDir = path.join(root, 'scripts', 'jev');
  const jevRegistry = path.join(root, 'docs', 'agents', 'jev.md');
  if (existsSync(jevDir)) {
    const registry = existsSync(jevRegistry) ? await readFile(jevRegistry, 'utf8') : '';
    const clis = (await readdir(jevDir)).filter((name) => name.endsWith('-cli.mjs')).sort();
    for (const cli of clis) {
      if (!registry.includes(`scripts/jev/${cli}`)) {
        err(`scripts/jev/${cli}: Jev CLI not listed in docs/agents/jev.md`);
      }
    }
  }

  return { skillCount: skillNames.length, errors, warnings };
}

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const { skillCount, errors, warnings } = await checkRepo(root);
  const report = [];
  if (errors.length) report.push(...errors.map((m) => `error   ${m}`));
  if (warnings.length) report.push(...warnings.map((m) => `warning ${m}`));
  if (report.length) console.log(report.join('\n'));

  console.log(
    `\nagent layer: ${skillCount} skills, ${errors.length} error(s), ${warnings.length} warning(s)`,
  );
  process.exit(errors.length ? 1 : 0);
}

// Node reports the main module by its realpath, so argv[1] must be resolved the same way. Without
// that, a run through a symlinked path never calls main() and exits 0 having checked nothing.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
