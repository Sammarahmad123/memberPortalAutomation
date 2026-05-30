import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';
import {
  DEFAULT_EVIDENCE_DIR,
  ensureDir,
  evidencePath,
  readJson,
  rel,
  writeJson,
  writeText,
} from './maintenance-utils.mjs';

const evidenceDir = DEFAULT_EVIDENCE_DIR;
const liveUiDir = evidencePath(evidenceDir, 'live-ui');
const htmlDir = path.join(liveUiDir, 'html');
const outputPath = path.join(liveUiDir, 'page-summary.json');
const BASE_URL = process.env.BASE_URL || '';
const MAX_TARGETS = 10;
const PER_PAGE_TIMEOUT_MS = 10_000;

function addTarget(targets, target, source) {
  if (!target || typeof target !== 'string') return;
  if (/^(about:|data:|javascript:|mailto:|tel:)/i.test(target)) return;
  targets.set(target, { target, source });
}

function routeFromUrl(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}${parsed.hash}` || '/';
  } catch {
    return null;
  }
}

function deriveTargets() {
  const targets = new Map();
  const failureTargets = readJson(evidencePath(evidenceDir, 'failure-targets.json'));
  const traceSummary = readJson(evidencePath(evidenceDir, 'trace-summary.json'));
  const report = readJson(evidencePath(evidenceDir, 'playwright-report.json'));
  const codeContext = readJson(evidencePath(evidenceDir, 'code-context-summary.json'));

  for (const target of [...(failureTargets?.failedTests || []), ...(failureTargets?.flakyRecoveredTests || [])]) {
    addTarget(targets, target.relatedUrl, 'failure-targets');
  }

  for (const trace of traceSummary?.traces || []) {
    for (const url of trace.urlsVisited || []) {
      addTarget(targets, routeFromUrl(url) || url, 'trace-summary');
    }
  }

  for (const suite of report?.suites || []) {
    JSON.stringify(suite).replace(/"url"\s*:\s*"([^"]+)"/g, (_match, url) => {
      addTarget(targets, routeFromUrl(url) || url, 'playwright-report');
      return _match;
    });
  }

  for (const file of codeContext?.files || []) {
    const content = file.content || '';
    const gotoPattern = /\.goto\(\s*['"`]([^'"`]+)['"`]/g;
    let match;
    while ((match = gotoPattern.exec(content))) {
      addTarget(targets, match[1], `code-context:${file.path}`);
    }
  }

  return [...targets.values()].slice(0, MAX_TARGETS);
}

function targetToUrl(target) {
  if (/^https?:\/\//i.test(target)) return target;
  if (!BASE_URL) return null;
  return new URL(target || '/', BASE_URL).toString();
}

async function collectPage(page, url, index) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: PER_PAGE_TIMEOUT_MS });
  const html = await page.content();
  const htmlFile = path.join(htmlDir, `page-${index + 1}.html`);
  writeText(htmlFile, html);

  const summary = await page.evaluate(() => {
    const textOf = (element) => (element.innerText || element.textContent || '').trim().replace(/\s+/g, ' ');
    const attrs = (element, names) => Object.fromEntries(names.map((name) => [name, element.getAttribute(name)]).filter(([, value]) => value));
    const elements = (selector, mapper) => Array.from(document.querySelectorAll(selector)).slice(0, 100).map(mapper);

    return {
      currentUrl: location.href,
      title: document.title,
      visibleTextSummary: document.body?.innerText?.replace(/\s+/g, ' ').trim().slice(0, 5000) || '',
      buttons: elements('button,[role="button"],input[type="button"],input[type="submit"]', (element) => ({
        text: textOf(element) || element.value || '',
        ...attrs(element, ['id', 'name', 'class', 'data-testid', 'aria-label', 'role']),
      })),
      inputs: elements('input,textarea', (element) => ({
        type: element.getAttribute('type') || element.tagName.toLowerCase(),
        value: element.value || '',
        ...attrs(element, ['id', 'name', 'placeholder', 'data-testid', 'aria-label']),
      })),
      links: elements('a[href]', (element) => ({
        text: textOf(element),
        href: element.href,
        ...attrs(element, ['id', 'class', 'data-testid']),
      })),
      selects: elements('select', (element) => ({
        ...attrs(element, ['id', 'name', 'data-testid', 'aria-label']),
        options: Array.from(element.options || []).map((option) => ({ text: option.text, value: option.value })),
      })),
      dataTestIds: Array.from(document.querySelectorAll('[data-testid]'))
        .map((element) => element.getAttribute('data-testid'))
        .filter(Boolean),
      htmlSnapshot: document.documentElement.outerHTML.replace(/\s+/g, ' ').trim().slice(0, 20_000),
    };
  });

  return {
    available: true,
    url,
    htmlFile: rel(htmlFile),
    ...summary,
  };
}

ensureDir(htmlDir);

const targets = deriveTargets();
if (!targets.length) {
  writeJson(outputPath, {
    schemaVersion: '3A-plus-live-ui-v1',
    generatedAt: new Date().toISOString(),
    available: false,
    reason: 'no targets derived',
    baseUrl: BASE_URL || null,
    pages: [],
  });
  console.log(`[collect-live-ui] wrote ${outputPath}`);
  process.exit(0);
}

const browser = await chromium.launch();
const pages = [];

try {
  for (let index = 0; index < targets.length; index += 1) {
    const derived = targets[index];
    const url = targetToUrl(derived.target);
    if (!url) {
      pages.push({
        available: false,
        target: derived.target,
        source: derived.source,
        reason: 'BASE_URL is not set and target is not absolute',
      });
      continue;
    }

    const page = await browser.newPage();
    page.setDefaultTimeout(PER_PAGE_TIMEOUT_MS);
    try {
      pages.push({
        target: derived.target,
        source: derived.source,
        ...(await collectPage(page, url, index)),
      });
    } catch (error) {
      pages.push({
        available: false,
        target: derived.target,
        source: derived.source,
        url,
        reason: error.message,
      });
    } finally {
      await page.close().catch(() => {});
    }
  }
} finally {
  await browser.close().catch(() => {});
}

writeJson(outputPath, {
  schemaVersion: '3A-plus-live-ui-v1',
  generatedAt: new Date().toISOString(),
  available: pages.some((page) => page.available),
  reason: pages.some((page) => page.available) ? null : 'all derived targets failed or timed out',
  baseUrl: BASE_URL || null,
  pages,
});

console.log(`[collect-live-ui] wrote ${outputPath}`);
