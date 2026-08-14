const SUBJECT_KINDS = new Set(["arxiv", "msc"]);
// A code is not free text, and neither of these is long. Truncating rather
// than refusing outright keeps a mistyped link answering "no such code" from
// the page instead of putting an unbounded string into a request.
const CODE_PARAMETER_LIMIT = 32;
// One click reads one day of the archive, and keeps reading only while the days
// it finds hold nothing a reader has not already seen. The bound is what stops
// a code whose newest fifty span a busy week from walking the whole year to
// find its fifty-first row.
const MAX_DAYS_PER_STEP = 20;

function rowKey(row) {
  return `${row.id}-v${row.version}`;
}

/**
 * The archive of one code, newest first, a day at a time.
 *
 * The head names years, a year names its days and their page ranges, and the
 * page a row is on is a pure function of its identifier. Nothing names every
 * page of a code, deliberately: such a document would be rewritten whenever the
 * code changed, and a code can hold a sizeable fraction of the registry. So the
 * walk is three levels, in reverse, and holds only its own position.
 */
function createArchiveWalk({ years, loadYear, loadPage }) {
  const remaining = [...years].reverse();
  let yearIndex = 0;
  let days = null;
  let dayIndex = 0;

  /**
   * The day the walk is standing on, without stepping off it.
   *
   * Separate from stepping, so that a failed read leaves the position where it
   * was. A walk that advanced first would skip the failed day for good on the
   * retry, and the reader would be told the archive was read when a day of it
   * had silently gone missing.
   */
  async function currentDay() {
    while (yearIndex < remaining.length) {
      if (days === null) {
        days = [...(await loadYear(remaining[yearIndex])).days].reverse();
        dayIndex = 0;
      }
      if (dayIndex < days.length) return days[dayIndex];
      days = null;
      yearIndex += 1;
    }
    return null;
  }

  /**
   * That there is certainly nothing left, decided without a request.
   *
   * "Not certainly" is not "no". Standing at the end of a year whose successor
   * has not been read is the one position this cannot answer, and it answers
   * false there, so the reader keeps the control and one more click settles
   * it. The alternative is a year document fetched to decide whether to draw a
   * button, on a page that may never be clicked again.
   */
  function atEnd() {
    if (days === null) return yearIndex >= remaining.length;
    if (dayIndex < days.length) return false;
    return yearIndex >= remaining.length - 1;
  }

  /**
   * The next rows a reader has not seen, newest first.
   *
   * A day's pages are read from the last to the first because serials count
   * upwards within a day, so the highest page holds the newest rows and each
   * page's own rows are in increasing identity order. Empty days are skipped
   * without a request: a seeded page that no current version lands on says so
   * in the day row's count.
   *
   * A day is held whole. Its rows are published as one ordered run, so half of
   * one shown now and the rest after a retry would be a listing out of the
   * order it claims to be in.
   */
  async function next(seen) {
    const rows = [];
    for (let read = 0; read < MAX_DAYS_PER_STEP && rows.length === 0; read += 1) {
      const day = await currentDay();
      if (day === null) return { rows, exhausted: true };
      if (day.versions !== 0) {
        const found = [];
        for (let page = day.last_page; page >= day.first_page; page -= 1) {
          const loaded = await loadPage(day.day, page);
          for (const row of [...loaded.entries].reverse()) {
            if (!seen.has(rowKey(row))) found.push(row);
          }
        }
        rows.push(...found);
      }
      dayIndex += 1;
    }
    return { rows, exhausted: atEnd() };
  }

  return { next };
}

/**
 * Orchestrate the subject route around the data loader and row composer.
 *
 * The caller retains those two domain boundaries. This module owns URL input,
 * progressive visibility, the archive walk's position, and the route's public
 * failure text, so those state transitions are testable without importing the
 * whole browser application.
 */
export async function renderSubjectPage({
  params,
  document,
  loadSubjectHead,
  loadSubjectYear,
  loadSubjectPage,
  renderHeading,
  renderRows,
}) {
  const status = document.querySelector("#status");
  const content = document.querySelector("#subject-content");
  const more = document.querySelector("#subject-more");
  const moreStatus = document.querySelector("#subject-more-status");
  const kind = params.get("kind");
  const code = (params.get("code") || "").slice(0, CODE_PARAMETER_LIMIT);
  if (!SUBJECT_KINDS.has(kind) || !code) {
    status.textContent = "This subject link has a missing or invalid classification scheme or code.";
    status.classList.add("error");
    return;
  }

  let head;
  try {
    head = await loadSubjectHead(kind, code);
  } catch (error) {
    // A code the registry has never used has no document, and that is an
    // answer rather than a fault: every code it has ever used keeps one.
    status.textContent = error.status === 404
      ? `No result has ever been classified ${code}.`
      : `This subject could not be loaded: ${error.message}`;
    status.classList.add("error");
    return;
  }

  renderHeading(kind, code, head, content);
  const seen = new Set();
  const show = (rows) => {
    for (const row of rows) seen.add(rowKey(row));
    renderRows(rows, content);
  };
  show(head.entries);
  if (!head.entries.length) {
    // Published, and empty. A code whose last classifier was superseded or
    // withdrawn keeps answering rather than starting to 404 at a URL somebody
    // has linked, so this is what that answer looks like.
    content.append(emptyNotice(document, code));
  }
  status.hidden = true;
  content.hidden = false;

  const walk = createArchiveWalk({
    years: head.years,
    loadYear: (year) => loadSubjectYear(kind, code, year),
    loadPage: (day, page) => loadSubjectPage(kind, code, day, page),
  });
  // Exhaustion is the archive's own answer, and the count is the head's. A
  // reader is offered the button only while both still expect a row: a code
  // whose pages hold fewer rows than its head claims would otherwise leave a
  // control that could never do anything, and say so once per click forever.
  let exhausted = head.years.length === 0;
  const updateMore = () => {
    more.hidden = exhausted || seen.size >= head.versions;
  };
  updateMore();
  more.addEventListener("click", async () => {
    more.disabled = true;
    moreStatus.textContent = "";
    moreStatus.classList.remove("error");
    try {
      const step = await walk.next(seen);
      exhausted = step.exhausted;
      show(step.rows);
      // The walk is bounded per click, so an empty step is "not yet" as long
      // as there is archive left to read.
      if (!step.rows.length && !exhausted && seen.size < head.versions) {
        moreStatus.textContent = "No earlier results in the days read. Ask again to keep going.";
      }
    } catch (error) {
      // What is already on the page stays on it, and the walk has not stepped
      // past the day that failed. An archive read that failed can be asked for
      // again, and the rest of the listing is still true.
      moreStatus.textContent = `Earlier results could not be loaded: ${error.message}`;
      moreStatus.classList.add("error");
    } finally {
      more.disabled = false;
      updateMore();
    }
  });
}

function emptyNotice(document, code) {
  const notice = document.createElement("p");
  notice.className = "status empty";
  notice.textContent =
    `No current version is classified ${code}. Results registered under it have ` +
    "since been superseded or withdrawn.";
  return notice;
}
