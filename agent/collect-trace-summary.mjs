import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  DEFAULT_EVIDENCE_DIR,
  ROOT_DIR,
  ensureDir,
  evidencePath,
  listFilesRecursive,
  rel,
  writeJson,
} from './maintenance-utils.mjs';

const evidenceDir = DEFAULT_EVIDENCE_DIR;
const outputPath = evidencePath(evidenceDir, 'trace-summary.json');
const testResultsDir = path.join(ROOT_DIR, 'test-results');
const MAX_EVENTS_PER_TRACE = 200;

function parseJsonLine(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function readJsonlEntry(zip, entryName) {
  const text = execFileSync('unzip', ['-p', zip, entryName], {
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  });
  return text
    .split(/\r?\n/)
    .filter(Boolean)
    .map(parseJsonLine)
    .filter(Boolean);
}

function addUnique(array, value, limit = 100) {
  if (!value || array.includes(value) || array.length >= limit) return;
  array.push(value);
}

function selectorFromEvent(event) {
  return event.selector || event.params?.selector || event.metadata?.selector || event.apiName?.match(/locator\((.+)\)/)?.[1] || null;
}

function summarizeEvents(events, networkEvents) {
  const urlsVisited = [];
  const actionsAttempted = [];
  const selectorsUsed = [];
  const networkErrors = [];
  const snapshotReferences = [];
  const screenshotReferences = [];
  let failedAction = null;

  for (const event of events.slice(0, MAX_EVENTS_PER_TRACE)) {
    addUnique(urlsVisited, event.url || event.params?.url || event.metadata?.url);
    const apiName = event.apiName || event.method || event.type;
    if (apiName && /click|fill|goto|press|check|select|expect|locator/i.test(apiName)) {
      actionsAttempted.push({
        apiName,
        selector: selectorFromEvent(event),
        url: event.url || event.metadata?.url || null,
        error: event.error?.message || event.error || null,
      });
    }
    addUnique(selectorsUsed, selectorFromEvent(event));
    addUnique(snapshotReferences, event.snapshot || event.snapshotId || event.beforeSnapshot || event.afterSnapshot);
    addUnique(screenshotReferences, event.screenshot || event.sha1);
    if (!failedAction && event.error) {
      failedAction = {
        apiName,
        selector: selectorFromEvent(event),
        error: event.error?.message || String(event.error),
      };
    }
  }

  for (const event of networkEvents.slice(0, MAX_EVENTS_PER_TRACE)) {
    addUnique(urlsVisited, event.url || event.request?.url);
    const error = event.errorText || event.failureText || event.error;
    if (error) {
      networkErrors.push({
        url: event.url || event.request?.url || null,
        error: typeof error === 'string' ? error : JSON.stringify(error),
      });
    }
  }

  return {
    eventCount: events.length,
    networkEventCount: networkEvents.length,
    urlsVisited,
    actionsAttempted,
    selectorsUsed,
    failedAction,
    networkErrors,
    snapshotReferences,
    screenshotReferences,
  };
}

function summarizeTraceZip(tracePath) {
  const entries = execFileSync('unzip', ['-Z1', tracePath], {
    encoding: 'utf8',
    maxBuffer: 2 * 1024 * 1024,
  })
    .split(/\r?\n/)
    .filter(Boolean);
  const traceEntry = entries.find((entry) => /(^|\/)trace\.trace$/.test(entry));
  const networkEntry = entries.find((entry) => /(^|\/)trace\.network$/.test(entry));

  const events = traceEntry ? readJsonlEntry(tracePath, traceEntry) : [];
  const networkEvents = networkEntry ? readJsonlEntry(tracePath, networkEntry) : [];

  return {
    traceFilePath: rel(tracePath),
    available: Boolean(traceEntry || networkEntry),
    traceEntry: traceEntry || null,
    networkEntry: networkEntry || null,
    ...summarizeEvents(events, networkEvents),
  };
}

ensureDir(evidenceDir);

const traceFiles = listFilesRecursive(testResultsDir, (filePath) => path.basename(filePath) === 'trace.zip');

if (!traceFiles.length) {
  writeJson(outputPath, {
    schemaVersion: '3A-plus-trace-summary-v1',
    generatedAt: new Date().toISOString(),
    available: false,
    reason: 'no trace.zip files found under test-results/',
    traces: [],
  });
  console.log(`[collect-trace-summary] wrote ${outputPath}`);
  process.exit(0);
}

const traces = [];
for (const traceFile of traceFiles) {
  try {
    traces.push(summarizeTraceZip(traceFile));
  } catch (error) {
    traces.push({
      traceFilePath: rel(traceFile),
      available: false,
      reason: error.message,
    });
  }
}

writeJson(outputPath, {
  schemaVersion: '3A-plus-trace-summary-v1',
  generatedAt: new Date().toISOString(),
  available: traces.some((trace) => trace.available),
  reason: traces.some((trace) => trace.available) ? null : 'trace parsing was partial or unavailable',
  traces,
});

console.log(`[collect-trace-summary] wrote ${outputPath}`);
