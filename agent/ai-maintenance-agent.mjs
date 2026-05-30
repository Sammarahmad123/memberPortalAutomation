/**
 * Phase 3A - Gemini-powered Playwright failure analysis.
 *
 * This phase is analysis/reporting only. It does not edit tests, create
 * branches, create PRs, or deploy anything.
 */

import { GoogleGenAI } from '@google/genai';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');

const EVIDENCE_DIR = path.join(ROOT_DIR, 'maintenance', 'evidence');
const MANIFEST_DIR = path.join(ROOT_DIR, 'maintenance', 'manifests');
const REPORTS_DIR = path.join(ROOT_DIR, 'maintenance', 'reports');

const FAILURE_LOG_PATH = path.join(EVIDENCE_DIR, 'playwright-output.txt');
const MANIFEST_PATH = path.join(MANIFEST_DIR, 'latest-change-manifest.json');
const REPORT_PATH = path.join(REPORTS_DIR, 'latest-maintenance-report.md');

const CONTEXT_DIRS = [
  'tests',
  'pages',
  'page-objects',
  'pageObjects',
  'src/pages',
  'src/page-objects',
  'src/pageObjects',
];

const SOURCE_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx']);
const MAX_FILE_CHARS = 20_000;
const MAX_TOTAL_CONTEXT_CHARS = 120_000;

const MODEL = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const BASE_URL = process.env.BASE_URL || '(not set)';

if (!GEMINI_API_KEY) {
  console.error('[ai-maintenance] GEMINI_API_KEY is not set.');
  process.exit(1);
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function readTextFile(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

function truncate(value, maxChars) {
  if (!value || value.length <= maxChars) {
    return value || '';
  }

  return `${value.slice(0, maxChars)}\n\n[truncated: original length ${value.length} chars]`;
}

function walkSourceFiles(dirPath) {
  if (!fs.existsSync(dirPath)) {
    return [];
  }

  const files = [];
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      if (['node_modules', '.git', 'test-results', 'playwright-report'].includes(entry.name)) {
        continue;
      }
      files.push(...walkSourceFiles(fullPath));
      continue;
    }

    if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
      files.push(fullPath);
    }
  }

  return files;
}

function collectCodeContext() {
  const files = [];
  const seen = new Set();
  let totalChars = 0;

  for (const relativeDir of CONTEXT_DIRS) {
    const absoluteDir = path.join(ROOT_DIR, relativeDir);

    for (const filePath of walkSourceFiles(absoluteDir)) {
      if (seen.has(filePath) || totalChars >= MAX_TOTAL_CONTEXT_CHARS) {
        continue;
      }

      const source = readTextFile(filePath);
      if (!source) {
        continue;
      }

      const truncatedSource = truncate(source, MAX_FILE_CHARS);
      totalChars += truncatedSource.length;
      seen.add(filePath);
      files.push({
        path: path.relative(ROOT_DIR, filePath),
        source: truncatedSource,
      });
    }
  }

  return files;
}

function formatCodeContext(files) {
  if (!files.length) {
    return '(no test or page object source files found)';
  }

  return files
    .map((file) => {
      const extension = path.extname(file.path).replace('.', '') || 'text';
      return `### ${file.path}\n\`\`\`${extension}\n${file.source}\n\`\`\``;
    })
    .join('\n\n');
}

function buildPrompt({ failureLog, codeContext }) {
  return `
You are an expert Playwright automation maintenance analyst.

The automation suite failed against this application URL:
BASE_URL: ${BASE_URL}

This is Phase 3A. You must analyse and report only. Do not propose direct file patches, branch operations, pull requests, deployments, or commands that mutate the repository.

## Playwright failure log
\`\`\`text
${failureLog}
\`\`\`

## Current automation code context
${codeContext}

## Task
Infer the most likely application-side change or test-maintenance issue from the evidence.

Return ONLY a valid JSON object with exactly these top-level fields:
{
  "summary": "one sentence describing what likely failed and why",
  "changeType": "selector-change | url-change | content-change | timing-issue | network-error | auth-failure | test-data-change | unknown",
  "confidence": 0,
  "canAutoFix": false,
  "affectedFiles": ["relative/path/to/file.js"],
  "suggestedChanges": [
    {
      "file": "relative/path/to/file.js",
      "description": "what should change and why",
      "currentValue": "current selector/text/url/value if identifiable",
      "suggestedValue": "new selector/text/url/value if identifiable"
    }
  ],
  "humanReviewRequired": true,
  "reviewNotes": "caveats, risks, and what a human should verify"
}

Rules:
- Return JSON only. No markdown fences. No prose outside JSON.
- confidence must be a number from 0 to 100.
- canAutoFix may be true only if the evidence identifies a narrow, safe maintenance update.
- affectedFiles must include only automation files likely to need maintenance.
- suggestedChanges can be empty when the fix is unclear.
- Do not invent files that are not present in the provided code context.
`.trim();
}

function cleanJsonResponse(rawText) {
  return rawText
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
}

function normalizeManifest(candidate) {
  const manifest = candidate && typeof candidate === 'object' ? candidate : {};
  const confidence = Number(manifest.confidence);

  return {
    summary: typeof manifest.summary === 'string' ? manifest.summary : 'Gemini did not provide a summary.',
    changeType: typeof manifest.changeType === 'string' ? manifest.changeType : 'unknown',
    confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(100, confidence)) : 0,
    canAutoFix: Boolean(manifest.canAutoFix),
    affectedFiles: Array.isArray(manifest.affectedFiles) ? manifest.affectedFiles.filter((item) => typeof item === 'string') : [],
    suggestedChanges: Array.isArray(manifest.suggestedChanges)
      ? manifest.suggestedChanges.map((change) => ({
          file: typeof change?.file === 'string' ? change.file : '',
          description: typeof change?.description === 'string' ? change.description : '',
          currentValue: typeof change?.currentValue === 'string' ? change.currentValue : '',
          suggestedValue: typeof change?.suggestedValue === 'string' ? change.suggestedValue : '',
        }))
      : [],
    humanReviewRequired: Boolean(manifest.humanReviewRequired),
    reviewNotes: typeof manifest.reviewNotes === 'string' ? manifest.reviewNotes : '',
  };
}

function markdownEscapeTable(value) {
  return String(value ?? '').replace(/\|/g, '\\|').replace(/\n/g, '<br>');
}

function renderReport(manifest) {
  const affectedFiles = manifest.affectedFiles.length
    ? manifest.affectedFiles.map((file) => `- \`${file}\``).join('\n')
    : '_None identified._';

  const suggestedChanges = manifest.suggestedChanges.length
    ? manifest.suggestedChanges
        .map((change) => {
          const lines = [
            `### ${change.file || 'Unspecified file'}`,
            '',
            change.description || '_No description provided._',
          ];

          if (change.currentValue) {
            lines.push('', `- Current value: \`${change.currentValue}\``);
          }

          if (change.suggestedValue) {
            lines.push(`- Suggested value: \`${change.suggestedValue}\``);
          }

          return lines.join('\n');
        })
        .join('\n\n')
    : '_No specific code changes suggested._';

  return `# AI Automation Maintenance Report

Generated: ${manifest._meta.generatedAt}
Model: \`${manifest._meta.model}\`
BASE_URL: ${manifest._meta.baseUrl}

This Phase 3A report is analysis only. No test files were patched and no pull request was created.

## Summary

${manifest.summary}

## Diagnosis

| Field | Value |
| --- | --- |
| Change type | \`${markdownEscapeTable(manifest.changeType)}\` |
| Confidence | ${manifest.confidence}/100 |
| Can auto-fix | ${manifest.canAutoFix ? 'Yes' : 'No'} |
| Human review required | ${manifest.humanReviewRequired ? 'Yes' : 'No'} |

## Affected files

${affectedFiles}

## Suggested changes

${suggestedChanges}

## Review notes

${manifest.reviewNotes || '_None provided._'}
`;
}

async function main() {
  ensureDir(EVIDENCE_DIR);
  ensureDir(MANIFEST_DIR);
  ensureDir(REPORTS_DIR);

  console.log('[ai-maintenance] Phase 3A Gemini analysis starting.');
  console.log(`[ai-maintenance] BASE_URL: ${BASE_URL}`);
  console.log(`[ai-maintenance] Model: ${MODEL}`);

  const failureLog = readTextFile(FAILURE_LOG_PATH);
  if (!failureLog) {
    console.error(`[ai-maintenance] Missing Playwright failure log: ${FAILURE_LOG_PATH}`);
    process.exit(1);
  }

  const codeFiles = collectCodeContext();
  const codeContext = formatCodeContext(codeFiles);
  const prompt = buildPrompt({
    failureLog: truncate(failureLog, MAX_TOTAL_CONTEXT_CHARS),
    codeContext,
  });

  const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
  let rawResponse;

  try {
    const response = await ai.models.generateContent({
      model: MODEL,
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
      },
    });
    rawResponse = response.text;
  } catch (error) {
    console.error(`[ai-maintenance] Gemini request failed: ${error.message}`);
    process.exit(1);
  }

  let parsed;
  try {
    parsed = JSON.parse(cleanJsonResponse(rawResponse));
  } catch (error) {
    console.error(`[ai-maintenance] Gemini did not return parseable JSON: ${error.message}`);
    console.error(rawResponse);
    process.exit(1);
  }

  const manifest = normalizeManifest(parsed);
  manifest._meta = {
    generatedAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    model: MODEL,
    failureLogPath: path.relative(ROOT_DIR, FAILURE_LOG_PATH),
    failureLogLength: failureLog.length,
    contextFiles: codeFiles.map((file) => file.path),
    phase: '3A-analysis-reporting-only',
  };

  fs.writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  fs.writeFileSync(REPORT_PATH, renderReport(manifest), 'utf8');

  console.log(`[ai-maintenance] Manifest written: ${MANIFEST_PATH}`);
  console.log(`[ai-maintenance] Report written: ${REPORT_PATH}`);
  console.log(`[ai-maintenance] Summary: ${manifest.summary}`);
}

main().catch((error) => {
  console.error(`[ai-maintenance] Unexpected failure: ${error.stack || error.message}`);
  process.exit(1);
});
