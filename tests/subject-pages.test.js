import assert from "node:assert/strict";
import test from "node:test";

import { renderSubjectPage } from "../assets/subject-pages.mjs";

function classList() {
  const names = new Set();
  return {
    add: (...values) => values.forEach((value) => names.add(value)),
    remove: (...values) => values.forEach((value) => names.delete(value)),
    contains: (value) => names.has(value),
  };
}

function node({ hidden = false } = {}) {
  return {
    children: [],
    classList: classList(),
    className: "",
    disabled: false,
    hidden,
    textContent: "",
    append(...children) {
      this.children.push(...children);
    },
  };
}

function button() {
  const element = { ...node({ hidden: true }), listeners: [] };
  element.addEventListener = (name, handler) => {
    if (name === "click") element.listeners.push(handler);
  };
  element.click = async () => {
    for (const handler of element.listeners) await handler();
  };
  return element;
}

function pageDocument() {
  const nodes = new Map([
    ["#status", node()],
    ["#subject-content", node({ hidden: true })],
    ["#subject-more", button()],
    ["#subject-more-status", node()],
  ]);
  return {
    nodes,
    document: {
      title: "",
      querySelector: (selector) => nodes.get(selector) || null,
      createElement: () => node(),
    },
  };
}

const ROW = (day, serial) => ({
  id: `PALOMAR-${day}-${String(serial).padStart(6, "0")}`,
  version: 1,
  title: `Result ${serial}`,
  status: "accepted",
  path: `entries/PALOMAR-${day}-${String(serial).padStart(6, "0")}-v1.json`,
  published_at: `${day}T09:00:${String(serial).padStart(2, "0")}Z`,
  classification: { arxiv: ["math.AG"], msc2020: ["14A10"] },
});

/**
 * Two days of two rows each, of which the head already carries the newest two.
 *
 * Small enough to state, and large enough that the walk has a day it has
 * already shown, a day it has not, and an end to reach.
 */
function archive({ versions = 4 } = {}) {
  const newer = [ROW("2026-06-02", 1), ROW("2026-06-02", 2)];
  const older = [ROW("2026-06-01", 1), ROW("2026-06-01", 2)];
  return {
    head: {
      schema_version: 1,
      kind: "arxiv",
      code: "math.AG",
      entries: [newer[1], newer[0]],
      results: versions,
      versions,
      years: [{ year: "2026", days: 2, results: 4, versions: 4 }],
    },
    year: {
      schema_version: 1,
      year: "2026",
      days: [
        { day: "2026-06-01", first_page: 1, last_page: 1, results: 2, versions: 2 },
        { day: "2026-06-02", first_page: 1, last_page: 1, results: 2, versions: 2 },
      ],
    },
    pages: new Map([
      ["2026-06-01:1", { schema_version: 1, day: "2026-06-01", page: 1, entries: older }],
      ["2026-06-02:1", { schema_version: 1, day: "2026-06-02", page: 1, entries: newer }],
    ]),
  };
}

function subjectPage(overrides = {}) {
  const view = pageDocument();
  const shown = [];
  const fixture = archive();
  return {
    fixture,
    shown,
    view,
    settings: {
      params: new URLSearchParams("kind=arxiv&code=math.AG"),
      document: view.document,
      loadSubjectHead: async () => fixture.head,
      loadSubjectYear: async () => fixture.year,
      loadSubjectPage: async (_kind, _code, day, page) => {
        const document = fixture.pages.get(`${day}:${page}`);
        if (!document) throw new Error(`no such page ${day}/${page}`);
        return document;
      },
      renderHeading() {},
      renderRows: (rows) => shown.push(...rows),
      ...overrides,
    },
  };
}

test("a subject route refuses a scheme or code it was never going to request", async () => {
  for (const search of ["kind=feeds&code=math.CO", "kind=arxiv", "code=math.CO"]) {
    const view = pageDocument();
    await renderSubjectPage({
      params: new URLSearchParams(search),
      document: view.document,
      loadSubjectHead: () => assert.fail("a malformed subject link must not be requested"),
    });
    assert.match(view.nodes.get("#status").textContent, /missing or invalid classification/);
    assert.equal(view.nodes.get("#status").classList.contains("error"), true);
    assert.equal(view.nodes.get("#subject-content").hidden, true);
  }
});

test("a code never used is absent, and a code with nothing current is empty", async () => {
  const absent = subjectPage({
    loadSubjectHead: async () => {
      const error = new Error("404 Not Found");
      error.status = 404;
      throw error;
    },
  });
  await renderSubjectPage(absent.settings);
  assert.equal(
    absent.view.nodes.get("#status").textContent,
    "No result has ever been classified math.AG.",
  );
  assert.equal(absent.view.nodes.get("#subject-content").hidden, true);

  // Published and empty, which is a different answer from "no such code" and
  // the one a reader can act on.
  const empty = subjectPage({
    loadSubjectHead: async () => ({
      schema_version: 1,
      kind: "arxiv",
      code: "math.AG",
      entries: [],
      results: 0,
      versions: 0,
      years: [],
    }),
  });
  await renderSubjectPage(empty.settings);
  assert.equal(empty.view.nodes.get("#status").hidden, true);
  assert.equal(empty.view.nodes.get("#subject-content").hidden, false);
  assert.match(
    empty.view.nodes.get("#subject-content").children[0].textContent,
    /No current version is classified math\.AG/,
  );
  assert.equal(empty.view.nodes.get("#subject-more").hidden, true);
});

test("the archive walk skips what is shown, keeps its order, and stops at the end", async () => {
  const page = subjectPage();
  await renderSubjectPage(page.settings);

  assert.deepEqual(page.shown.map((row) => row.id), [
    "PALOMAR-2026-06-02-000002",
    "PALOMAR-2026-06-02-000001",
  ]);
  const more = page.view.nodes.get("#subject-more");
  assert.equal(more.hidden, false);

  // The newest day is already on the page, so one click walks past it to the
  // day that is not, rather than reporting that there is nothing to show.
  await more.click();
  assert.deepEqual(page.shown.map((row) => row.id), [
    "PALOMAR-2026-06-02-000002",
    "PALOMAR-2026-06-02-000001",
    "PALOMAR-2026-06-01-000002",
    "PALOMAR-2026-06-01-000001",
  ]);
  assert.equal(more.hidden, true);
  assert.equal(page.view.nodes.get("#subject-more-status").textContent, "");
});

test("an archive whose pages hold fewer rows than its head claims still ends", async () => {
  // The counts and the pages are written by the same publisher and should
  // agree. If they ever do not, the reader must not be left with a button that
  // can never do anything and says so once per click forever.
  const page = subjectPage();
  page.fixture.head.versions = 9;
  page.fixture.head.results = 9;
  await renderSubjectPage(page.settings);
  const more = page.view.nodes.get("#subject-more");

  await more.click();
  assert.equal(page.shown.length, 4);
  assert.equal(more.hidden, true, "an exhausted archive must retire its own control");
});

test("a failed archive read keeps the page it has and does not step over the day", async () => {
  const page = subjectPage();
  let failures = 1;
  const serve = page.settings.loadSubjectPage;
  page.settings.loadSubjectPage = async (kind, code, day, number) => {
    if (day === "2026-06-01" && failures > 0) {
      failures -= 1;
      throw new Error("503 Service Unavailable");
    }
    return serve(kind, code, day, number);
  };
  await renderSubjectPage(page.settings);
  const more = page.view.nodes.get("#subject-more");
  const status = page.view.nodes.get("#subject-more-status");

  await more.click();
  assert.equal(page.shown.length, 2, "a failed read must not half-show a day");
  assert.match(status.textContent, /Earlier results could not be loaded: 503/);
  assert.equal(status.classList.contains("error"), true);
  assert.equal(more.hidden, false, "a day that failed is still a day to read");
  assert.equal(more.disabled, false);

  // The retry reads the day that failed, not the one after it. A walk that had
  // already stepped would drop those rows for good and call the archive read.
  await more.click();
  assert.deepEqual(page.shown.map((row) => row.id).slice(2), [
    "PALOMAR-2026-06-01-000002",
    "PALOMAR-2026-06-01-000001",
  ]);
  assert.equal(status.textContent, "");
  assert.equal(status.classList.contains("error"), false);
  assert.equal(more.hidden, true);
});
