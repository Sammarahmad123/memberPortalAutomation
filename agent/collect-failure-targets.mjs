import path from 'node:path';
import {
  DEFAULT_EVIDENCE_DIR,
  ensureDir,
  evidencePath,
  readJson,
  readText,
  rel,
  writeJson,
} from './maintenance-utils.mjs';

const evidenceDir = DEFAULT_EVIDENCE_DIR;
const outputPath = evidencePath(evidenceDir, 'failure-targets.json');
const reportPath = evidencePath(evidenceDir, 'playwright-report.json');
const outputLogPath = evidencePath(evidenceDir, 'playwright-output.txt');

function flattenSpecs(suites = [], parentTitle = []) {
  const specs = [];
  for (const suite of suites || []) {
    const titles = [...parentTitle, suite.title].filter(Boolean);
    specs.push(...(suite.specs || []).map((spec) => ({ ...spec, suiteTitles: titles })));
    specs.push(...flattenSpecs(suite.suites || [], titles));
  }
  return specs;
}

function flattenSteps(steps = []) {
  const flattened = [];
  for (const step of steps || []) {
    flattened.push(step);
    flattened.push(...flattenSteps(step.steps || []));
  }
  return flattened;
}

function isFailedStatus(status) {
  return ['failed', 'timedOut', 'interrupted'].includes(status);
}

function findLastErrorResult(results = []) {
  return [...results].reverse().find((result) => isFailedStatus(result.status) || result.error || result.errors?.length);
}

function attachmentPaths(results = [], matcher) {
  return results
    .flatMap((result) => result.attachments || [])
    .filter((attachment) => matcher(attachment))
    .map((attachment) => attachment.path)
    .filter(Boolean)
    .map((item) => rel(path.resolve(item)));
}

function extractExpectedActual(message = '') {
  const expected = message.match(/Expected(?: string)?:\s*([^\n]+)/i)?.[1]?.trim() || null;
  const actual = message.match(/Received(?: string)?:\s*([^\n]+)/i)?.[1]?.trim() || null;
  return { expected, actual };
}

function extractFailedAction(result) {
  const failedStep = flattenSteps(result?.steps || []).find((step) => step.error);
  if (!failedStep) return null;
  return {
    title: failedStep.title || null,
    category: failedStep.category || null,
    location: failedStep.location || null,
  };
}

function targetFromSpec(spec, test, index, source = 'playwright-json') {
  const results = test.results || [];
  const lastResult = results[results.length - 1] || {};
  const errorResult = findLastErrorResult(results) || lastResult;
  const message = errorResult.error?.message || errorResult.errors?.[0]?.message || '';
  const { expected, actual } = extractExpectedActual(message);
  const failedAction = extractFailedAction(errorResult);
  const retryRecovered = results.some((result) => isFailedStatus(result.status)) && lastResult.status === 'passed';
  const finalStatus = retryRecovered ? 'passed' : lastResult.status || test.status || (spec.ok ? 'passed' : 'failed');

  return {
    id: `target-${index + 1}`,
    source,
    testTitle: [...(spec.suiteTitles || []), spec.title].filter(Boolean).join(' > '),
    specFile: spec.file || null,
    line: Number(spec.line || 0),
    project: test.projectName || test.projectId || null,
    retryAttempts: results.length,
    finalStatus,
    failureType: retryRecovered ? 'flaky-retry-recovered' : 'unknown',
    retryRecovered,
    errorMessage: message || null,
    failedLocatorOrAction: failedAction?.title || null,
    expected,
    actual,
    tracePath: attachmentPaths(results, (attachment) => /trace/i.test(attachment.name || '') || /trace\.zip$/i.test(attachment.path || ''))[0] || null,
    screenshotPath:
      attachmentPaths(results, (attachment) => /screenshot|error-context/i.test(attachment.name || '') || /\.(png|jpg|jpeg)$/i.test(attachment.path || ''))[0] || null,
  };
}

function collectFromJson(report) {
  const specs = flattenSpecs(report.suites || []);
  const targets = [];
  let index = 0;

  for (const spec of specs) {
    for (const test of spec.tests || []) {
      const results = test.results || [];
      const lastResult = results[results.length - 1];
      const retryRecovered = results.some((result) => isFailedStatus(result.status)) && lastResult?.status === 'passed';
      const failed = retryRecovered || isFailedStatus(lastResult?.status) || test.status === 'unexpected';

      if (!failed) continue;

      targets.push(targetFromSpec(spec, test, index, 'playwright-json'));
      index += 1;
    }
  }

  return targets;
}

function collectFromTextLog(text) {
  if (!text) return [];

  const chunks = text.split(/\n\s*\d+\)\s+/).slice(1);
  return chunks.map((chunk, index) => {
    const firstLine = chunk.split('\n')[0] || `Failed test ${index + 1}`;
    return {
      id: `target-${index + 1}`,
      source: 'text-log-fallback',
      testTitle: firstLine.trim(),
      specFile: null,
      line: 0,
      project: null,
      retryAttempts: 1,
      finalStatus: 'failed',
      failureType: 'unknown',
      retryRecovered: false,
      errorMessage: chunk.slice(0, 2000).trim() || null,
      failedLocatorOrAction: null,
      expected: null,
      actual: null,
      tracePath: null,
      screenshotPath: null,
    };
  });
}

ensureDir(evidenceDir);

const report = readJson(reportPath);
const allTargets = report ? collectFromJson(report) : collectFromTextLog(readText(outputLogPath));
const flakyRecoveredTests = allTargets.filter((target) => target.retryRecovered);
const failedTests = allTargets.filter((target) => !target.retryRecovered && target.finalStatus !== 'passed');

writeJson(outputPath, {
  schemaVersion: '3A-plus-failure-targets-v1',
  generatedAt: new Date().toISOString(),
  available: Boolean(report || allTargets.length),
  source: report ? 'playwright-json' : 'text-log-fallback',
  playwrightJsonPath: report ? rel(reportPath) : null,
  failedTests,
  flakyRecoveredTests,
  allTargets,
});

console.log(`[collect-failure-targets] wrote ${outputPath}`);
