import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_EVIDENCE_DIR = path.join(ROOT_DIR, 'maintenance', 'evidence');
export const MANIFEST_DIR = path.join(ROOT_DIR, 'maintenance', 'manifests');
export const REPORTS_DIR = path.join(ROOT_DIR, 'maintenance', 'reports');

export const MANIFEST_PATH = path.join(MANIFEST_DIR, 'latest-change-manifest.json');
export const REPORT_PATH = path.join(REPORTS_DIR, 'latest-maintenance-report.md');

export const LOCKED_SCHEMA_VERSION = '3A-plus-v1';

export const CLASSIFICATIONS = new Set([
  'no-failures',
  'test-maintenance',
  'app-regression',
  'environment-issue',
  'insufficient-evidence',
  'mixed',
]);

export const FINDING_CLASSIFICATIONS = new Set([
  'test-maintenance',
  'app-regression',
  'environment-issue',
  'insufficient-evidence',
]);

export const FAILURE_TYPES = new Set([
  'selector-missing',
  'assertion-mismatch',
  'url-change',
  'timeout',
  'network-error',
  'auth-failure',
  'test-data-change',
  'flaky-retry-recovered',
  'unknown',
]);

export function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    dryRun: false,
    fixture: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dry-run') {
      args.dryRun = true;
    } else if (arg === '--fixture') {
      args.fixture = argv[index + 1] ? path.resolve(ROOT_DIR, argv[index + 1]) : null;
      index += 1;
    }
  }

  return args;
}

export function getEvidenceDir(args = {}) {
  return args.fixture || DEFAULT_EVIDENCE_DIR;
}

export function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

export function readText(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

export function readJson(filePath) {
  const text = readText(filePath);
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function writeJson(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export function writeText(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, value, 'utf8');
}

export function rel(filePath) {
  if (!filePath) return null;
  return path.relative(ROOT_DIR, filePath).replaceAll(path.sep, '/');
}

export function evidencePath(evidenceDir, relativePath) {
  return path.join(evidenceDir, relativePath);
}

export function existingEvidenceFile(evidenceDir, relativePath) {
  const fullPath = evidencePath(evidenceDir, relativePath);
  return fs.existsSync(fullPath) ? rel(fullPath) : null;
}

export function listFilesRecursive(dirPath, predicate = () => true) {
  if (!fs.existsSync(dirPath)) return [];

  const results = [];
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      results.push(...listFilesRecursive(fullPath, predicate));
    } else if (entry.isFile() && predicate(fullPath)) {
      results.push(fullPath);
    }
  }
  return results;
}

export function lastLines(text, maxLines) {
  const lines = String(text || '').split(/\r?\n/);
  if (lines.length <= maxLines) {
    return { text: String(text || ''), truncated: false, originalSize: String(text || '').length };
  }
  const sliced = lines.slice(-maxLines).join('\n');
  return { text: sliced, truncated: true, originalSize: String(text || '').length, truncatedSize: sliced.length };
}

export function truncateEnd(text, maxChars) {
  const value = String(text || '');
  if (value.length <= maxChars) {
    return { text: value, truncated: false, originalSize: value.length };
  }
  const sliced = value.slice(0, maxChars);
  return { text: sliced, truncated: true, originalSize: value.length, truncatedSize: sliced.length };
}

export function truncateMiddle(text, maxChars) {
  const value = String(text || '');
  if (value.length <= maxChars) {
    return { text: value, truncated: false, originalSize: value.length };
  }

  const marker = '\n[...truncated...]\n';
  const sideSize = Math.max(0, Math.floor((maxChars - marker.length) / 2));
  const sliced = `${value.slice(0, sideSize)}${marker}${value.slice(value.length - sideSize)}`;
  return { text: sliced, truncated: true, originalSize: value.length, truncatedSize: sliced.length };
}

export function clampConfidence(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0.0;
  return Math.max(0.0, Math.min(1.0, number));
}

export function normalizeFinding(finding, index = 0) {
  const classification = FINDING_CLASSIFICATIONS.has(finding?.classification)
    ? finding.classification
    : 'insufficient-evidence';
  const failureType = FAILURE_TYPES.has(finding?.failureType) ? finding.failureType : 'unknown';
  const rationale = Array.isArray(finding?.classificationRationale)
    ? finding.classificationRationale
        .filter((item) => item && typeof item === 'object')
        .map((item) => ({
          evidenceFile: typeof item.evidenceFile === 'string' ? item.evidenceFile : 'unknown',
          fact: typeof item.fact === 'string' ? item.fact : '',
          supports: typeof item.supports === 'string' ? item.supports : '',
        }))
    : [];

  return {
    id: typeof finding?.id === 'string' ? finding.id : `finding-${index + 1}`,
    testTitle: typeof finding?.testTitle === 'string' ? finding.testTitle : '',
    specFile: typeof finding?.specFile === 'string' ? finding.specFile : '',
    line: Number.isFinite(Number(finding?.line)) ? Number(finding.line) : 0,
    failureType,
    expected: typeof finding?.expected === 'string' ? finding.expected : null,
    actual: typeof finding?.actual === 'string' ? finding.actual : null,
    observedInLiveUi: Boolean(finding?.observedInLiveUi),
    relatedUrl: typeof finding?.relatedUrl === 'string' ? finding.relatedUrl : null,
    affectedAutomationFiles: Array.isArray(finding?.affectedAutomationFiles)
      ? finding.affectedAutomationFiles.filter((item) => typeof item === 'string')
      : [],
    likelyCause: typeof finding?.likelyCause === 'string' ? finding.likelyCause : '',
    classification: rationale.length ? classification : 'insufficient-evidence',
    confidence: clampConfidence(finding?.confidence),
    safeToAutoFixLater: Boolean(finding?.safeToAutoFixLater),
    classificationRationale: rationale,
    suggestedNextStep: typeof finding?.suggestedNextStep === 'string' ? finding.suggestedNextStep : '',
  };
}

export function normalizeManifest(manifest, defaults = {}) {
  const findings = Array.isArray(manifest?.findings)
    ? manifest.findings.map((finding, index) => normalizeFinding(finding, index))
    : [];
  const overallClassification = CLASSIFICATIONS.has(manifest?.overallClassification)
    ? manifest.overallClassification
    : findings.length
      ? 'insufficient-evidence'
      : 'no-failures';
  const confidence = clampConfidence(manifest?.confidence);
  const humanReviewRequired = Boolean(manifest?.humanReviewRequired);
  const evidenceFiles = {
    playwrightJson: null,
    playwrightOutput: null,
    failureTargets: null,
    traceSummary: null,
    liveUiSummary: null,
    appDiff: null,
    codeContext: null,
    ...(defaults.evidenceFiles || {}),
    ...(manifest?.evidenceFiles || {}),
  };
  const runContext = {
    baseUrl: defaults.baseUrl || '',
    eventName: defaults.eventName || null,
    model: defaults.model || '',
    generatedAt: new Date().toISOString(),
    appDiffAvailable: false,
    traceAvailable: false,
    liveUiEvidenceAvailable: false,
    playwrightJsonAvailable: false,
    truncationApplied: false,
    ...(defaults.runContext || {}),
    ...(manifest?.runContext || {}),
  };

  const canProceedToPatchPlanning = Boolean(
    overallClassification === 'test-maintenance' &&
      confidence >= 0.8 &&
      findings.length > 0 &&
      findings.every((finding) => finding.classification === 'test-maintenance' && finding.confidence >= 0.8) &&
      humanReviewRequired === false &&
      manifest?.canProceedToPatchPlanning === true,
  );

  return {
    schemaVersion: LOCKED_SCHEMA_VERSION,
    runContext,
    overallSummary:
      typeof manifest?.overallSummary === 'string'
        ? manifest.overallSummary
        : findings.length
          ? 'AI maintenance analysis did not provide a summary.'
          : 'No failed tests detected in this run.',
    overallClassification,
    confidence,
    humanReviewRequired,
    canProceedToPatchPlanning,
    findings,
    evidenceFiles,
    reviewNotes: typeof manifest?.reviewNotes === 'string' ? manifest.reviewNotes : '',
  };
}

export function buildNoFailuresManifest(defaults = {}) {
  return normalizeManifest(
    {
      overallSummary: 'No failed tests detected in this run.',
      overallClassification: 'no-failures',
      confidence: 1.0,
      humanReviewRequired: false,
      canProceedToPatchPlanning: false,
      findings: [],
      reviewNotes: '',
    },
    defaults,
  );
}

export function safeJsonForPrompt(value) {
  return JSON.stringify(value ?? null, null, 2);
}
