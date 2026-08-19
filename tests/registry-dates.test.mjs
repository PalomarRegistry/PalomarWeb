import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_ORDER,
  FIRST_REGISTRATION_ORDER,
  LATEST_VERSION_ORDER,
  cardDates,
  compareRows,
  dayWindow,
  firstRegistrationDay,
  normalizeOrder,
  orderedDay,
  parseDay,
  registrationDay,
  withinWindow,
} from "../assets/registry-dates.mjs";

const first = { id: "PALOMAR-2026-07-29-000123", registeredAt: "2026-08-02T09:14:07Z" };
const second = { id: "PALOMAR-2026-07-29-000124", registeredAt: "2026-07-29T09:14:07Z" };
const third = { id: "PALOMAR-2026-08-13-000001", registeredAt: "2026-08-13T11:00:00Z" };

test("a result's first registration is the day in its identifier", () => {
  assert.equal(firstRegistrationDay(first.id), "2026-07-29");
  assert.equal(orderedDay(first, FIRST_REGISTRATION_ORDER), "2026-07-29");
  assert.equal(orderedDay(first, LATEST_VERSION_ORDER), "2026-08-02");
  assert.throws(() => firstRegistrationDay("PALOMAR-2026-07-29-12345"), /valid identifier/);
  assert.throws(() => firstRegistrationDay(undefined), /valid identifier/);
});

test("a registration day is the UTC day of the instant", () => {
  assert.equal(registrationDay("2026-08-02T23:59:59Z"), "2026-08-02");
  assert.throws(() => registrationDay("2026-08-02"), /valid registration date/);
  assert.throws(() => registrationDay(null), /valid registration date/);
});

test("an unrecognised order is the default rather than an error", () => {
  assert.equal(DEFAULT_ORDER, LATEST_VERSION_ORDER);
  assert.equal(normalizeOrder(FIRST_REGISTRATION_ORDER), FIRST_REGISTRATION_ORDER);
  assert.equal(normalizeOrder("sideways"), LATEST_VERSION_ORDER);
  assert.equal(normalizeOrder(undefined), LATEST_VERSION_ORDER);
});

test("the latest-version order is the instant, and identifiers break its ties", () => {
  const rows = [second, first, third];
  assert.deepEqual(
    [...rows].sort((left, right) => compareRows(left, right, LATEST_VERSION_ORDER))
      .map((row) => row.id),
    [third.id, first.id, second.id],
  );
  const sameInstant = { id: "PALOMAR-2026-07-29-000200", registeredAt: second.registeredAt };
  assert.deepEqual(
    [second, sameInstant].sort((left, right) => compareRows(left, right, LATEST_VERSION_ORDER))
      .map((row) => row.id),
    [sameInstant.id, second.id],
  );
});

test("the first-registration order is the identifier, day and serial together", () => {
  // A new version of an older result does not move it ahead of a result that
  // was registered after it, which is the whole point of asking for this order.
  assert.deepEqual(
    [first, second, third].sort((left, right) =>
      compareRows(left, right, FIRST_REGISTRATION_ORDER)).map((row) => row.id),
    [third.id, second.id, first.id],
  );
});

test("a day is a calendar day or nothing", () => {
  assert.equal(parseDay("2026-08-02"), "2026-08-02");
  assert.equal(parseDay("  2026-08-02  "), "2026-08-02");
  assert.equal(parseDay("2026-02-31"), null);
  assert.equal(parseDay("2026-8-2"), null);
  assert.equal(parseDay("last tuesday"), null);
  assert.equal(parseDay(""), null);
  assert.equal(parseDay(undefined), null);
});

test("both ends of the window are inclusive", () => {
  const range = dayWindow({ from: "2026-08-02", to: "2026-08-13" });
  assert.equal(range.active, true);
  assert.equal(range.empty, false);
  assert.deepEqual(range.malformed, []);
  assert.equal(withinWindow("2026-08-02", range), true);
  assert.equal(withinWindow("2026-08-13", range), true);
  assert.equal(withinWindow("2026-08-01", range), false);
  assert.equal(withinWindow("2026-08-14", range), false);
});

test("an open end bounds nothing, and no window bounds nothing", () => {
  const from = dayWindow({ from: "2026-08-02", to: "" });
  assert.equal(withinWindow("2026-12-31", from), true);
  assert.equal(withinWindow("2026-08-01", from), false);
  const to = dayWindow({ to: "2026-08-02" });
  assert.equal(withinWindow("2020-01-01", to), true);
  assert.equal(withinWindow("2026-08-03", to), false);
  const none = dayWindow({});
  assert.equal(none.active, false);
  assert.equal(withinWindow("1999-12-31", none), true);
});

test("a window that cannot be read, or cannot contain a day, matches nothing", () => {
  const malformed = dayWindow({ from: "yesterday", to: "2026-08-13" });
  assert.deepEqual(malformed.malformed, ["from"]);
  assert.equal(malformed.active, true);
  assert.equal(withinWindow("2026-08-13", malformed), false);
  const backwards = dayWindow({ from: "2026-08-13", to: "2026-08-02" });
  assert.equal(backwards.empty, true);
  assert.equal(withinWindow("2026-08-05", backwards), false);
});

test("a card leads with the day its listing is arranged by", () => {
  assert.deepEqual(cardDates(first, LATEST_VERSION_ORDER), [
    { className: "entry-date", label: "Registered", day: "2026-08-02" },
    { className: "entry-origin-date", label: "First registered", day: "2026-07-29" },
  ]);
  assert.deepEqual(cardDates(first, FIRST_REGISTRATION_ORDER), [
    { className: "entry-date", label: "First registered", day: "2026-07-29" },
    { className: "entry-origin-date", label: "Latest version", day: "2026-08-02" },
  ]);
});

test("a result registered once carries one date under either order", () => {
  for (const order of [LATEST_VERSION_ORDER, FIRST_REGISTRATION_ORDER]) {
    assert.deepEqual(cardDates(second, order), [
      { className: "entry-date", label: "Registered", day: "2026-07-29" },
    ]);
  }
});
