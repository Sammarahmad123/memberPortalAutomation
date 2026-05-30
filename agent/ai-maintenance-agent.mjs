/**
 * Phase 3A+ - evidence-driven Gemini Playwright maintenance analysis.
 *
 * Analysis/reporting only. This script never patches tests, creates branches,
 * creates PRs, or deploys anything.
 */

import { GoogleGenAI } from '@google/genai';
import path from 'node:path';
import {
  DEFAULT_EVIDENCE_DIR,
  LOCKED_SCHEMA_VERSION,
  MANIFEST_PATH,
  REPORT_PATH,
  buildNoFailuresManifest,
  existingEvidenceFile,
  getEvidenceDir,
  normalizeManifest,
  parseArgs,
  readJson,
  readText,
  safeJsonForPrompt,
  truncateEnd,
  truncateMiddle,
  lastLines,
  writeJson,
  writeText,
} from './maintenance-utils.mjs';

const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const BASE_URL = process.env.BASE_URL || '(not set)';
const EVENT_NAME = process.env.GITHUB_EVENT_NAME || null;

const args = parseArgs();
const evidenceDir = getEvidenceDir(args);

function evidenceFile(relativePath) {
  return path.join(evidenceDir, relativePath);
}

function isQuotaError(error) {
  const status = error?.status || error?.code || error?.response?.status;
  const message = String(error?.message || error || '').toLowerCase();
  return status === 429 || message.includes('429') || message.includes('quota');
}

function evidenceFiles() {
  return {
    playwrightJson: existingEvidenceFile(evidenceDir, 'playwright-report.json'),
    playwrightOutput: existingEvidenceFile(evidenceDir, 'playwright-output.txt'),
    failureTargets: existingEvidenceFile(evidenceDir, 'failure-targets.json'),
    traceSummary: existingEvidenceFile(evidenceDir, 'trace-summary.json'),
    liveUiSummary: existingEvidenceFile(evidenceDir, 'live-ui/page-summary.json'),
    appDiff: existingEvidenceFile(evidenceDir, 'app-diff.txt'),
    codeContext: existingEvidenceFile(evidenceDir, 'code-context-summary.json'),
  };
}

function runContext(overrides = {}) {
  const traceSummary = readJson(evidenceFile('trace-summary.json'));
  const liveUiSummary = readJson(evidenceFile('live-ui/page-summary.json'));
  return {
    baseUrl: BASE_URL,
    eventName: EVENT_NAME,
    model: MODEL,
    generatedAt: new Date().toISOString(),
    appDiffAvailable: Boolean(existingEvidenceFile(evidenceDir, 'app-diff.txt')),
    traceAvailable: Boolean(traceSummary?.available),
    liveUiEvidenceAvailable: Boolean(liveUiSummary?.available),
    playwrightJsonAvailable: Boolean(existingEvidenceFile(evidenceDir, 'playwright-report.json')),
    truncationApplied: false,
    ...overrides,
  };
}

function defaults(overrides = {}) {
  return {
    baseUrl: BASE_URL,
    eventName: EVENT_NAME,
    model: MODEL,
    runContext: runContext(overrides.runContext || {}),
    evidenceFiles: evidenceFiles(),
  };
}

function buildFlakyFinding(target, index) {
  return {
    id: `flaky-${index + 1}`,
    testTitle: target.testTitle || '',
    specFile: target.specFile || '',
    line: target.line || 0,
    failureType: 'flaky-retry-recovered',
    expected: target.expected || null,
    actual: target.actual || null,
    observedInLiveUi: false,
    relatedUrl: null,
    affectedAutomationFiles: target.specFile ? [target.specFile] : [],
    likelyCause: 'The test failed on an earlier retry but passed on a later attempt.',
    classification: 'environment-issue',
    confidence: 1.0,
    safeToAutoFixLater: false,
    classificationRationale: [
      {
        evidenceFile: evidenceFiles().failureTargets || 'maintenance/evidence/failure-targets.json',
        fact: `Retry attempts recovered for "${target.testTitle || 'unknown test'}".`,
        supports: 'flaky-retry-recovered environment-issue classification',
      },
    ],
    suggestedNextStep: 'Monitor recurrence and inspect environment stability before considering test maintenance.',
  };
}

function writeManifestAndReport(manifest) {
  const normalized = normalizeManifest(manifest, defaults({ runContext: manifest.runContext || {} }));
  writeJson(MANIFEST_PATH, normalized);
  writeText(REPORT_PATH, renderReport(normalized));
  console.log(`[ai-maintenance] Manifest written: ${MANIFEST_PATH}`);
  console.log(`[ai-maintenance] Report written: ${REPORT_PATH}`);
  console.log(`[ai-maintenance] Summary: ${normalized.overallSummary}`);
  return normalized;
}

function renderReport(manifest) {
  if (manifest.overallClassification === 'no-failures') {
    return `# AI Automation Maintenance Report\n\nNo failed tests detected in this run.\n`;
  }

  const findings = manifest.findings.length
    ? manifest.findings
        .map((finding) => {
          const rationale = finding.classificationRationale.length
            ? finding.classificationRationale
                .map((item) => `- ${item.evidenceFile}: ${item.fact} (${item.supports})`)
                .join('\n')
            : '- No rationale supplied.';
          return `## ${finding.id}: ${finding.testTitle || 'Unknown test'}

- Classification: ${finding.classification}
- Failure type: ${finding.failureType}
- Confidence: ${finding.confidence}
- Safe to auto-fix later: ${finding.safeToAutoFixLater ? 'yes' : 'no'}
- Spec: ${finding.specFile}:${finding.line}
- Likely cause: ${finding.likelyCause}
- Suggested next step: ${finding.suggestedNextStep}

### Rationale

${rationale}`;
        })
        .join('\n\n')
    : '_No findings._';

  return `# AI Automation Maintenance Report

Generated: ${manifest.runContext.generatedAt}
Model: \`${manifest.runContext.model}\`
BASE_URL: ${manifest.runContext.baseUrl}

This Phase 3A+ report is analysis only. No test files were patched and no pull request was created.

## Overall Summary

${manifest.overallSummary}

## Diagnosis

| Field | Value |
| --- | --- |
| Classification | \`${manifest.overallClassification}\` |
| Confidence | ${manifest.confidence} |
| Human review required | ${manifest.humanReviewRequired ? 'Yes' : 'No'} |
| Can proceed to patch planning | ${manifest.canProceedToPatchPlanning ? 'Yes' : 'No'} |
| Truncation applied | ${manifest.runContext.truncationApplied ? 'Yes' : 'No'} |

${findings}

## Review Notes

${manifest.reviewNotes || '_None._'}
`;
}

function readEvidenceJson(relativePath) {
  return readJson(evidenceFile(relativePath));
}

function preparePromptEvidence() {
  const truncations = [];
  const playwrightJson = readEvidenceJson('playwright-report.json');
  const failureTargets = readEvidenceJson('failure-targets.json');
  const traceSummary = readEvidenceJson('trace-summary.json');
  const codeContext = readEvidenceJson('code-context-summary.json');
  const liveUiSummary = readEvidenceJson('live-ui/page-summary.json');
  const appDiff = readText(evidenceFile('app-diff.txt'));
  const output = readText(evidenceFile('playwright-output.txt'));

  const preparedTrace = traceSummary
    ? {
        ...traceSummary,
        traces: (traceSummary.traces || []).map((trace) => {
          const actions = trace.actionsAttempted || [];
          if (actions.length > 200) {
            truncations.push({
              file: 'maintenance/evidence/trace-summary.json',
              originalSize: actions.length,
              truncatedSize: 200,
              reason: 'actionsAttempted limited to 200 events per trace',
            });
          }
          return {
            ...trace,
            actionsAttempted: actions.slice(0, 200),
          };
        }),
      }
    : null;

  const files = codeContext?.files || [];
  if (files.length > 50) {
    truncations.push({
      file: 'maintenance/evidence/code-context-summary.json',
      originalSize: files.length,
      truncatedSize: 50,
      reason: 'code context limited to 50 files',
    });
  }
  const preparedCodeContext = codeContext ? { ...codeContext, files: files.slice(0, 50) } : null;

  const livePages = liveUiSummary?.pages || [];
  const preparedLivePages = livePages.slice(0, 10).map((page) => {
    if (!page.htmlSnapshot) return page;
    const truncated = truncateEnd(page.htmlSnapshot, 5 * 1024);
    if (truncated.truncated) {
      truncations.push({
        file: page.htmlFile || 'maintenance/evidence/live-ui/page-summary.json',
        originalSize: truncated.originalSize,
        truncatedSize: truncated.truncatedSize,
        reason: 'live UI HTML snapshot limited to 5KB per page',
      });
    }
    return { ...page, htmlSnapshot: truncated.text };
  });
  if (livePages.length > 10) {
    truncations.push({
      file: 'maintenance/evidence/live-ui/page-summary.json',
      originalSize: livePages.length,
      truncatedSize: 10,
      reason: 'live UI pages limited to 10',
    });
  }
  const preparedLiveUi = liveUiSummary ? { ...liveUiSummary, pages: preparedLivePages } : null;

  let preparedAppDiff = null;
  if (appDiff !== null) {
    const truncated = truncateMiddle(appDiff, 200 * 1024);
    if (truncated.truncated) {
      truncations.push({
        file: 'maintenance/evidence/app-diff.txt',
        originalSize: truncated.originalSize,
        truncatedSize: truncated.truncatedSize,
        reason: 'app diff limited to 200KB with middle truncation',
      });
    }
    preparedAppDiff = truncated.text;
  }

  let preparedOutput = null;
  if (output !== null) {
    const truncated = lastLines(output, 500);
    if (truncated.truncated) {
      truncations.push({
        file: 'maintenance/evidence/playwright-output.txt',
        originalSize: truncated.originalSize,
        truncatedSize: truncated.truncatedSize,
        reason: 'Playwright output limited to last 500 lines',
      });
    }
    preparedOutput = truncated.text;
  }

  return {
    evidence: {
      playwrightJson,
      failureTargets,
      traceSummary: preparedTrace,
      codeContext: preparedCodeContext,
      liveUiSummary: preparedLiveUi,
      appDiff: preparedAppDiff,
      playwrightOutput: preparedOutput,
    },
    truncations,
  };
}

function buildPrompt(evidence) {
  return `
You are an expert Playwright automation maintenance analyst. This is Phase 3A+ analysis/reporting only. Do not patch tests, create branches, create PRs, deploy anything, or rubber-stamp current app behaviour as correct.

Locked schema version: ${LOCKED_SCHEMA_VERSION}

Evidence files:

## maintenance/evidence/playwright-report.json
${safeJsonForPrompt(evidence.playwrightJson)}

## maintenance/evidence/failure-targets.json
${safeJsonForPrompt(evidence.failureTargets)}

## maintenance/evidence/trace-summary.json
${safeJsonForPrompt(evidence.traceSummary)}

## maintenance/evidence/code-context-summary.json
${safeJsonForPrompt(evidence.codeContext)}

## maintenance/evidence/live-ui/page-summary.json
${safeJsonForPrompt(evidence.liveUiSummary)}

## maintenance/evidence/app-diff.txt
${evidence.appDiff ?? '(unavailable)'}

## maintenance/evidence/playwright-output.txt
${evidence.playwrightOutput ?? '(unavailable)'}

Classification rules:
- Missing getByTestId does NOT automatically mean safe selector update.
- A selector rename is only likely test-maintenance if evidence shows behaviour, label, role, and outcome were preserved.
- Assertion text/value changes may be a valid app change or an app regression. Use app diff and live evidence before deciding.
- Timeout is timing-issue only if evidence shows the element exists but was slow or unavailable.
- If current app behaviour changed and no diff confirms it was intentional, classify as insufficient-evidence or app-regression, never as test-maintenance.
- Never update tests just to match whatever the app currently shows.

Step 1
Summarise app-diff.txt in up to 3 bullets. If unavailable, state:
"app diff is unavailable; reasoning must rely on live UI evidence
and trace evidence."

Step 2
For each failed test in failure-targets.json, state the single most
likely hypothesis in one sentence.

Step 3
For each hypothesis, populate the classificationRationale array on
the corresponding finding with at least one entry. Each entry must
have:
  evidenceFile (path),
  fact (verbatim or paraphrased fact from that file),
  supports (which hypothesis or classification this fact supports
            or refutes).
Any finding without at least one rationale entry MUST be classified
as insufficient-evidence.

Step 4
Classify each finding using the locked enum:
test-maintenance, app-regression, environment-issue,
insufficient-evidence. If evidence is not strong enough, classify
as insufficient-evidence. Do not guess.

Step 5
Only set humanReviewRequired = false if:
- every finding classification is test-maintenance
- every finding confidence is >= 0.8
- behaviour, text, role, and outcome appear preserved in evidence

Step 6
Return JSON only using the locked schema. No markdown. No prose
outside JSON.
`.trim();
}

function dryRunResponse(preparedEvidence, truncations) {
  const target =
    preparedEvidence.failureTargets?.failedTests?.[0] ||
    preparedEvidence.failureTargets?.allTargets?.find((item) => !item.retryRecovered) ||
    {};
  return {
    schemaVersion: LOCKED_SCHEMA_VERSION,
    runContext: runContext({ truncationApplied: true }),
    overallSummary: 'Dry-run analysis identified an example selector-related failure requiring human review.',
    overallClassification: 'insufficient-evidence',
    confidence: 0.42,
    humanReviewRequired: true,
    canProceedToPatchPlanning: false,
    findings: [
      {
        id: 'finding-1',
        testTitle: target.testTitle || 'valid login reaches dashboard with correct member info',
        specFile: target.specFile || 'tests/e2e.spec.js',
        line: target.line || 15,
        failureType: 'selector-missing',
        expected: target.expected || 'Welcome, Sarah Chen',
        actual: target.actual || null,
        observedInLiveUi: true,
        relatedUrl: '/dashboard.html',
        affectedAutomationFiles: ['tests/e2e.spec.js', 'tests/fixtures.js'],
        likelyCause: 'The dry-run fixture suggests a locator or dashboard heading changed, but intent is not proven.',
        classification: 'insufficient-evidence',
        confidence: 0.42,
        safeToAutoFixLater: false,
        classificationRationale: [
          {
            evidenceFile: 'maintenance/evidence/failure-targets.json',
            fact: 'The synthetic failure target reports a missing or mismatched dashboard heading assertion.',
            supports: 'supports a test failure, but not enough evidence to classify it as safe test maintenance',
          },
        ],
        suggestedNextStep: 'Review app diff and trace snapshots before planning any patch.',
      },
    ],
    evidenceFiles: evidenceFiles(),
    reviewNotes:
      'Dry-run stub response. This exercises schema validation, reporting, and truncation handling without calling Gemini. Truncation is intentionally flagged in dry-run mode.',
  };
}

function parseGeminiJson(responseText) {
  let raw = String(responseText || '').trim();
  raw = raw.replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
  return JSON.parse(raw);
}

function appendTruncationNotes(reviewNotes, truncations) {
  if (!truncations.length) return reviewNotes || '';

  const lines = truncations.map(
    (item) =>
      `- ${item.file}: ${item.reason}; original=${item.originalSize}, truncated=${item.truncatedSize}`,
  );
  return `${reviewNotes || ''}${reviewNotes ? '\n\n' : ''}Truncation applied:\n${lines.join('\n')}`;
}

function fallbackManifest({ summary, classification = 'insufficient-evidence', reviewNotes, truncations = [] }) {
  return normalizeManifest(
    {
      runContext: runContext({ truncationApplied: truncations.length > 0 }),
      overallSummary: summary,
      overallClassification: classification,
      confidence: 0.0,
      humanReviewRequired: true,
      canProceedToPatchPlanning: false,
      findings: [],
      evidenceFiles: evidenceFiles(),
      reviewNotes: appendTruncationNotes(reviewNotes, truncations),
    },
    defaults({ runContext: { truncationApplied: truncations.length > 0 } }),
  );
}

async function callGemini(prompt) {
  if (!GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is not set.');
  }
  const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
  const response = await ai.models.generateContent({
    model: MODEL,
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
    },
  });
  return response.text;
}

async function main() {
  console.log('[ai-maintenance] Phase 3A+ analysis starting.');
  console.log(`[ai-maintenance] Evidence: ${evidenceDir === DEFAULT_EVIDENCE_DIR ? 'maintenance/evidence' : evidenceDir}`);
  console.log(`[ai-maintenance] BASE_URL: ${BASE_URL}`);
  console.log(`[ai-maintenance] Model: ${MODEL}`);

  const failureTargets = readEvidenceJson('failure-targets.json');
  const failedTests = failureTargets?.failedTests || [];
  const flakyRecoveredTests = failureTargets?.flakyRecoveredTests || [];

  if (!failedTests.length && !flakyRecoveredTests.length) {
    writeManifestAndReport(buildNoFailuresManifest(defaults()));
    return;
  }

  if (!failedTests.length && flakyRecoveredTests.length) {
    writeManifestAndReport(
      normalizeManifest(
        {
          runContext: runContext(),
          overallSummary: 'Only retry-recovered flaky failures were detected; no test maintenance analysis was run.',
          overallClassification: 'environment-issue',
          confidence: 1.0,
          humanReviewRequired: false,
          canProceedToPatchPlanning: false,
          findings: flakyRecoveredTests.map(buildFlakyFinding),
          evidenceFiles: evidenceFiles(),
          reviewNotes: 'Gemini analysis was skipped because all failures recovered on retry.',
        },
        defaults(),
      ),
    );
    return;
  }

  const { evidence, truncations } = preparePromptEvidence();
  const prompt = buildPrompt(evidence);

  let parsed;
  if (args.dryRun) {
    parsed = dryRunResponse(evidence, truncations);
  } else {
    let rawResponse = '';
    try {
      rawResponse = await callGemini(prompt);
      parsed = parseGeminiJson(rawResponse);
    } catch (error) {
      if (isQuotaError(error)) {
        writeManifestAndReport(
          fallbackManifest({
            summary: 'AI maintenance analysis could not be completed because the Gemini API quota was exceeded.',
            classification: 'insufficient-evidence',
            reviewNotes:
              'Gemini returned a quota or rate-limit error, so no AI diagnosis was produced. Evidence artifacts were still collected for human review.',
            truncations,
          }),
        );
        return;
      }

      if (error instanceof SyntaxError) {
        const rawPath = evidenceFile('gemini-raw-response.txt');
        writeText(rawPath, rawResponse || error.message);
        writeManifestAndReport(
          fallbackManifest({
            summary: 'AI maintenance analysis could not be completed because Gemini returned invalid JSON.',
            reviewNotes: `Failed to parse Gemini JSON response. Raw response or parse detail was written to ${rawPath}. ${error.message}`,
            truncations,
          }),
        );
        return;
      }

      throw error;
    }
  }

  const flakyFindings = flakyRecoveredTests.map(buildFlakyFinding);
  const normalized = normalizeManifest(
    {
      ...parsed,
      runContext: {
        ...runContext({ truncationApplied: truncations.length > 0 }),
        ...(parsed.runContext || {}),
        truncationApplied: args.dryRun || truncations.length > 0 || Boolean(parsed.runContext?.truncationApplied),
      },
      findings: [...(parsed.findings || []), ...flakyFindings],
      evidenceFiles: {
        ...evidenceFiles(),
        ...(parsed.evidenceFiles || {}),
      },
      reviewNotes: appendTruncationNotes(parsed.reviewNotes, truncations),
    },
    defaults({ runContext: { truncationApplied: truncations.length > 0 } }),
  );

  writeManifestAndReport(normalized);
}

main().catch((error) => {
  console.error(`[ai-maintenance] Unexpected failure: ${error.stack || error.message}`);
  const manifest = fallbackManifest({
    summary: 'AI maintenance analysis could not be completed due to an unexpected agent error.',
    reviewNotes: error.stack || error.message,
  });
  writeManifestAndReport(manifest);
  process.exit(0);
});
