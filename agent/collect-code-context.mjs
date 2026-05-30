import fs from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_EVIDENCE_DIR,
  ROOT_DIR,
  ensureDir,
  evidencePath,
  readJson,
  readText,
  rel,
  truncateEnd,
  writeJson,
} from './maintenance-utils.mjs';

const evidenceDir = DEFAULT_EVIDENCE_DIR;
const outputPath = evidencePath(evidenceDir, 'code-context-summary.json');
const failureTargetsPath = evidencePath(evidenceDir, 'failure-targets.json');
const MAX_CONTENT_CHARS = 30_000;
const SOURCE_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx']);

function regexFallbackDependencies(filePath) {
  const source = readText(filePath);
  if (!source) return [];

  const imports = [];
  const patterns = [
    /(?:import\s+[^'"]*from\s+|import\s*\(\s*|require\s*\()\s*['"]([^'"]+)['"]/g,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(source))) {
      const specifier = match[1];
      if (!specifier.startsWith('.')) continue;

      const base = path.resolve(path.dirname(filePath), specifier);
      const candidates = [
        base,
        ...Array.from(SOURCE_EXTENSIONS).map((extension) => `${base}${extension}`),
        ...Array.from(SOURCE_EXTENSIONS).map((extension) => path.join(base, `index${extension}`)),
      ];
      const resolved = candidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
      if (resolved) imports.push(resolved);
    }
  }

  return imports;
}

function collectFallbackGraph(entryFile, seen = new Set()) {
  if (seen.has(entryFile)) return [];
  seen.add(entryFile);
  const deps = regexFallbackDependencies(entryFile);
  return [entryFile, ...deps.flatMap((dep) => collectFallbackGraph(dep, seen))];
}

async function collectWithDependencyTree(entryFile) {
  const dependencyTree = await import('dependency-tree');
  const tree = dependencyTree.default || dependencyTree;
  return tree.toList({
    filename: entryFile,
    directory: ROOT_DIR,
    filter: (filePath) => !filePath.includes(`${path.sep}node_modules${path.sep}`),
    tsConfig: path.join(ROOT_DIR, 'tsconfig.json'),
  });
}

function fileSummary(filePath, relevance, resolutionMethod) {
  const content = readText(filePath) || '';
  const truncated = truncateEnd(content, MAX_CONTENT_CHARS);
  return {
    path: rel(filePath),
    relevance,
    resolutionMethod,
    sizeBytes: Buffer.byteLength(content),
    truncated: truncated.truncated,
    content: truncated.text,
  };
}

ensureDir(evidenceDir);

const failureTargets = readJson(failureTargetsPath);
const specs = [
  ...new Set(
    (failureTargets?.failedTests || [])
      .map((target) => target.specFile)
      .filter(Boolean)
      .map((file) => path.resolve(ROOT_DIR, file)),
  ),
].filter((file) => fs.existsSync(file));

const files = new Map();
const resolutionErrors = [];

for (const spec of specs) {
  try {
    for (const file of await collectWithDependencyTree(spec)) {
      files.set(file, {
        relevance: file === spec ? 100 : 80,
        resolutionMethod: 'dependency-tree',
      });
    }
  } catch (error) {
    resolutionErrors.push({ specFile: rel(spec), error: error.message });
    for (const file of collectFallbackGraph(spec)) {
      files.set(file, {
        relevance: file === spec ? 100 : 70,
        resolutionMethod: 'regex-fallback',
      });
    }
  }
}

for (const supportFile of ['playwright.config.js', 'package.json']) {
  const absolute = path.join(ROOT_DIR, supportFile);
  if (fs.existsSync(absolute)) {
    files.set(absolute, {
      relevance: supportFile === 'playwright.config.js' ? 60 : 50,
      resolutionMethod: 'support-file',
    });
  }
}

const summaries = [...files.entries()]
  .sort((a, b) => b[1].relevance - a[1].relevance || rel(a[0]).localeCompare(rel(b[0])))
  .map(([file, meta]) => fileSummary(file, meta.relevance, meta.resolutionMethod));

writeJson(outputPath, {
  schemaVersion: '3A-plus-code-context-v1',
  generatedAt: new Date().toISOString(),
  available: summaries.length > 0,
  sourceFailureTargets: rel(failureTargetsPath),
  entrySpecFiles: specs.map(rel),
  resolutionErrors,
  files: summaries,
});

console.log(`[collect-code-context] wrote ${outputPath}`);
