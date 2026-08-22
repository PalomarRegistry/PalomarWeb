/**
 * The two dates a registered result has, and what a listing does with them.
 *
 * A result's identifier carries the day its version 1 was registered, and
 * every later version inherits it. A listing row's registration instant is the
 * moment the version on the card was registered, which for a v2 is a later day
 * than the identifier's. Both are real answers to "when": a reader looking for
 * results that are new to the registry means the first, and a reader looking
 * for what has changed since they last read means the second. Neither can
 * stand in for the other, so this module owns both, the order each one
 * implies, and the inclusive day window a toolbar filters by.
 *
 * The first-registration day is read from the identifier rather than from a
 * row field, because that is where it is: the publisher requires an entry's
 * `first_registered_on` to equal its identifier's day, and a landing row is
 * projected from the same identity. Reading it here costs no addition to the
 * closed landing-row contract.
 */

const ID_DAY_RE = /^PALOMAR-([0-9]{4}-[0-9]{2}-[0-9]{2})-[0-9]{6}$/;
const DAY_RE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;

/** Order by the instant the listed version was registered. The publisher's own order. */
export const LATEST_VERSION_ORDER = "updated";
/** Order by the day the result first entered the registry, newest first. */
export const FIRST_REGISTRATION_ORDER = "registered";

export const ORDERS = [LATEST_VERSION_ORDER, FIRST_REGISTRATION_ORDER];
export const DEFAULT_ORDER = LATEST_VERSION_ORDER;

/**
 * The requested order, or the default.
 *
 * Anything unrecognised is the default rather than an error: an order is a way
 * of arranging what the page already holds, and a stale or mistyped link
 * should still show the registry.
 */
export function normalizeOrder(value) {
  return ORDERS.includes(value) ? value : DEFAULT_ORDER;
}

/**
 * The day of a registration instant.
 *
 * A record's timestamps are UTC and the days derived from them are UTC days,
 * so the slice is the answer and a local-time conversion would be a different
 * question.
 */
export function registrationDay(value) {
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}T/.test(value || "")) {
    throw new Error("entry is missing a valid registration date");
  }
  return value.slice(0, 10);
}

/** The day version 1 of this result was registered, from its identifier. */
export function firstRegistrationDay(id) {
  const match = ID_DAY_RE.exec(String(id ?? ""));
  if (!match) throw new Error("entry is missing a valid identifier");
  return match[1];
}

/** The day a listing keys on under one order. */
export function orderedDay({ id, registeredAt }, order) {
  return normalizeOrder(order) === FIRST_REGISTRATION_ORDER
    ? firstRegistrationDay(id)
    : registrationDay(registeredAt);
}

/**
 * Newest first, under either order.
 *
 * Under the latest-version order this is the instant, and identifiers break
 * its ties, which is exactly the order the publisher writes its newest-first
 * selection in: applying it to that document changes nothing.
 *
 * Under the first-registration order it is the identifier alone. Serials are
 * allocated contiguously within a day in the order results are registered, so
 * a whole identifier already sorts results by when they entered the registry,
 * to a finer resolution than its day.
 */
export function compareRows(left, right, order) {
  if (normalizeOrder(order) === FIRST_REGISTRATION_ORDER) {
    return compareIdentifiers(left.id, right.id);
  }
  const difference = Date.parse(right.registeredAt) - Date.parse(left.registeredAt);
  if (difference) return difference;
  return compareIdentifiers(left.id, right.id);
}

function compareIdentifiers(left, right) {
  if (left === right) return 0;
  return left < right ? 1 : -1;
}

/**
 * A calendar day, or null.
 *
 * `type="date"` inputs hold this shape or nothing, but a deep link holds
 * whatever it was written with, and a browser without the control holds
 * whatever was typed. A day that does not exist is not a day.
 */
export function parseDay(value) {
  const day = String(value ?? "").trim();
  if (!DAY_RE.test(day)) return null;
  const when = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(when.getTime())) return null;
  return when.toISOString().slice(0, 10) === day ? day : null;
}

/**
 * The window the two date controls describe.
 *
 * Both ends are inclusive: a reader who asks for the 3rd to the 5th means
 * three days. An end that cannot be read is reported rather than dropped
 * silently, because a filter that quietly does nothing shows a wider selection
 * than the one that was asked for.
 */
export function dayWindow({ from, to } = {}) {
  const parsed = { from: parseDay(from), to: parseDay(to) };
  const malformed = [];
  if (String(from ?? "").trim() && !parsed.from) malformed.push("from");
  if (String(to ?? "").trim() && !parsed.to) malformed.push("to");
  return {
    from: parsed.from,
    to: parsed.to,
    malformed,
    // Asked for and empty, which is not the same as not asked for.
    empty: Boolean(parsed.from && parsed.to && parsed.from > parsed.to),
    active: Boolean(parsed.from || parsed.to || malformed.length),
  };
}

/**
 * Whether a day is inside the window. An unasked-for end bounds nothing.
 *
 * A window that cannot be read matches nothing, as an unreadable classification
 * code does: a filter the reader can see and the page ignores would show a
 * wider selection than the one on screen claims to be.
 */
export function withinWindow(day, range) {
  if (!range || !range.active) return true;
  if (range.malformed.length || range.empty) return false;
  if (range.from && day < range.from) return false;
  if (range.to && day > range.to) return false;
  return true;
}

/**
 * The dates a card shows, in the order they are shown.
 *
 * The order's own day comes first, so that the leading date on every card runs
 * down the page in the page's order: a card led by a day the page is not
 * arranged by reads as though the listing were unsorted. The other day follows
 * only when it differs, which for a single-version result is never.
 */
export function cardDates({ id, registeredAt }, order) {
  const first = firstRegistrationDay(id);
  const latest = registrationDay(registeredAt);
  if (first === latest) {
    return [{ className: "entry-date", label: "Registered", day: latest }];
  }
  if (normalizeOrder(order) === FIRST_REGISTRATION_ORDER) {
    return [
      { className: "entry-date", label: "First registered", day: first },
      { className: "entry-origin-date", label: "Latest version", day: latest },
    ];
  }
  return [
    { className: "entry-date", label: "Registered", day: latest },
    { className: "entry-origin-date", label: "First registered", day: first },
  ];
}
