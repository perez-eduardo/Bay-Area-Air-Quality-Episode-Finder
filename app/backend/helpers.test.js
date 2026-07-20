/*
 * Bay Area Air Quality Episode Finder — Railway backend.
 * Unit tests for the PURE helpers exported by analysis.js (_pure).
 * Node's built-in test runner only: `npm test` → `node --test`.
 * Nothing here touches Earth Engine or the network.
 */

'use strict';

var test = require('node:test');
var assert = require('node:assert/strict');

var pure = require('./analysis.js')._pure;

/* ------------------------------------------------- date validation */

test('isValidDateString accepts real YYYY-MM-DD dates', function () {
  assert.equal(pure.isValidDateString('2023-01-20'), true);
  assert.equal(pure.isValidDateString('2018-06-28'), true);
  assert.equal(pure.isValidDateString('2024-02-29'), true); // leap day
});

test('isValidDateString rejects malformed input', function () {
  assert.equal(pure.isValidDateString('2023-2-1'), false);
  assert.equal(pure.isValidDateString('20230201'), false);
  assert.equal(pure.isValidDateString('abcd-ef-gh'), false);
  assert.equal(pure.isValidDateString(''), false);
  assert.equal(pure.isValidDateString(null), false);
  assert.equal(pure.isValidDateString(20230201), false);
  assert.equal(pure.isValidDateString('2023-01-20T00:00:00Z'), false);
});

test('isValidDateString rejects impossible calendar dates',
    function () {
  assert.equal(pure.isValidDateString('2026-02-31'), false);
  assert.equal(pure.isValidDateString('2023-02-29'), false); // not leap
  assert.equal(pure.isValidDateString('2023-13-01'), false);
  assert.equal(pure.isValidDateString('2023-00-10'), false);
  assert.equal(pure.isValidDateString('2023-04-31'), false);
});

test('previous/nextDateString cross month and year boundaries',
    function () {
  assert.equal(pure.previousDateString('2023-01-01'), '2022-12-31');
  assert.equal(pure.previousDateString('2023-03-01'), '2023-02-28');
  assert.equal(pure.nextDateString('2024-02-28'), '2024-02-29');
  assert.equal(pure.nextDateString('2024-12-31'), '2025-01-01');
});

/* --------------------------------------------- supported-range rule */

test('isWithinRange is inclusive at both ends', function () {
  var min = '2018-06-28';
  var max = '2026-07-09';
  assert.equal(pure.isWithinRange('2018-06-28', min, max), true);
  assert.equal(pure.isWithinRange('2026-07-09', min, max), true);
  assert.equal(pure.isWithinRange('2018-06-27', min, max), false);
  assert.equal(pure.isWithinRange('2026-07-10', min, max), false);
  assert.equal(pure.isWithinRange('2022-01-15', min, max), true);
});

test('monthDateStrings enumerates whole calendar months', function () {
  var feb2024 = pure.monthDateStrings(2024, 2);
  assert.equal(feb2024.length, 29);
  assert.equal(feb2024[0], '2024-02-01');
  assert.equal(feb2024[28], '2024-02-29');

  var feb2023 = pure.monthDateStrings(2023, 2);
  assert.equal(feb2023.length, 28);

  var dec = pure.monthDateStrings(2022, 12);
  assert.equal(dec.length, 31);
  assert.equal(dec[30], '2022-12-31');
});

/* --------------------------------------- baseline statistics rules */

test('median: empty input stays null, never zero', function () {
  assert.equal(pure.median([]), null);
  assert.equal(pure.median(null), null);
});

test('median of odd and even samples', function () {
  assert.equal(pure.median([3, 1, 2]), 2);
  assert.equal(pure.median([4, 1, 3, 2]), 2.5);
  assert.equal(pure.median([-5]), -5); // valid negatives preserved
});

test('percentileLeq implements the adopted <= convention',
    function () {
  var values = [1, 2, 3, 4];
  assert.equal(pure.percentileLeq(values, 2.5), 50);
  assert.equal(pure.percentileLeq(values, 4), 100);
  assert.equal(pure.percentileLeq(values, 0), 0);
  assert.equal(pure.percentileLeq(values, 1), 25);
});

test('percentileLeq: missing sample or target stays null', function () {
  assert.equal(pure.percentileLeq([], 1), null);
  assert.equal(pure.percentileLeq(null, 1), null);
  assert.equal(pure.percentileLeq([1, 2], null), null);
});

/* ------------------------------------ symmetric display stretch */

test('symmetricRange takes max(|p2|, |p98|)', function () {
  assert.equal(pure.symmetricRange(-2, 5), 5);
  assert.equal(pure.symmetricRange(-7, 3), 7);
  assert.equal(pure.symmetricRange(-4, -1), 4);
});

test('symmetricRange: degenerate or missing bounds give null',
    function () {
  assert.equal(pure.symmetricRange(0, 0), null);
  assert.equal(pure.symmetricRange(null, 5), null);
  assert.equal(pure.symmetricRange(-2, null), null);
  assert.equal(pure.symmetricRange(undefined, undefined), null);
});

/* -------------------------------------------- bounded cache rules */

test('cache: TTL expiry via injectable clock', function () {
  var now = 1000;
  var cache = pure.createBoundedCache(5, 100,
      function () { return now; });
  cache.set('a', 1);
  assert.equal(cache.get('a'), 1);
  now += 100;
  assert.equal(cache.get('a'), 1);   // exactly at TTL: still valid
  now += 1;
  assert.equal(cache.get('a'), undefined); // past TTL: expired
  assert.equal(cache.size(), 0);     // expired entry was dropped
});

test('cache: bounded size evicts the oldest insertion', function () {
  var cache = pure.createBoundedCache(2, 100000,
      function () { return 0; });
  cache.set('a', 1);
  cache.set('b', 2);
  cache.set('c', 3);
  assert.equal(cache.size(), 2);
  assert.equal(cache.get('a'), undefined); // oldest evicted
  assert.equal(cache.get('b'), 2);
  assert.equal(cache.get('c'), 3);
});

test('cache: re-setting a key refreshes its insertion order',
    function () {
  var cache = pure.createBoundedCache(2, 100000,
      function () { return 0; });
  cache.set('a', 1);
  cache.set('b', 2);
  cache.set('a', 10);   // 'a' becomes newest
  cache.set('c', 3);    // evicts 'b', not 'a'
  assert.equal(cache.get('a'), 10);
  assert.equal(cache.get('b'), undefined);
  assert.equal(cache.get('c'), 3);
});

test('cache: a failed request leaves no entry, and a later retry ' +
    'can store a fresh success (miss -> retry path)', function () {
  var cache = pure.createBoundedCache(5, 100,
      function () { return 0; });
  // Failure path: getAnalysis only calls set() on success, so a
  // failure means no set() happened — the key stays a miss.
  assert.equal(cache.get('2026-07-09'), undefined);
  // Retry path: the next successful request stores normally.
  cache.set('2026-07-09', {ok: true});
  assert.deepEqual(cache.get('2026-07-09'), {ok: true});
});

test('cache: after TTL expiry the key is a miss and can be ' +
    'repopulated by a retry', function () {
  var now = 0;
  var cache = pure.createBoundedCache(5, 100,
      function () { return now; });
  cache.set('k', 'stale');
  now = 101;                              // past TTL
  assert.equal(cache.get('k'), undefined); // expired -> miss
  cache.set('k', 'fresh');                 // retry repopulates
  assert.equal(cache.get('k'), 'fresh');
});

/* --------------------------- canonical-grid compatibility (08a v2) */

var CANONICAL = {crs: 'EPSG:4326',
                 transform: [0.01, 0, -180, 0, 0.01, -90]};

test('grid check: the canonical transform itself is compatible',
    function () {
  var verdict = pure.canonicalGridCheck(CANONICAL);
  assert.equal(verdict.compatible, true);
});

test('grid check: integer pixel offsets are compatible', function () {
  var verdict = pure.canonicalGridCheck({
    crs: 'EPSG:4326',
    transform: [0.01, 0, -180 + 0.01 * 1234, 0, 0.01, -90 + 0.01 * 567]
  });
  assert.equal(verdict.compatible, true);
});

test('grid check: fractional pixel offsets are incompatible',
    function () {
  var verdict = pure.canonicalGridCheck({
    crs: 'EPSG:4326',
    transform: [0.01, 0, -180.005, 0, 0.01, -90]
  });
  assert.equal(verdict.compatible, false);
});

test('grid check: differing CRS, scale, or shear is incompatible',
    function () {
  assert.equal(pure.canonicalGridCheck({
    crs: 'EPSG:3310', transform: CANONICAL.transform
  }).compatible, false);
  assert.equal(pure.canonicalGridCheck({
    crs: 'EPSG:4326', transform: [0.02, 0, -180, 0, 0.01, -90]
  }).compatible, false);
  assert.equal(pure.canonicalGridCheck({
    crs: 'EPSG:4326', transform: [0.01, 0.001, -180, 0, 0.01, -90]
  }).compatible, false);
});

test('grid check: missing numeric transform is incompatible',
    function () {
  assert.equal(pure.canonicalGridCheck(null).compatible, false);
  assert.equal(pure.canonicalGridCheck({crs: 'EPSG:4326'})
      .compatible, false);
  assert.equal(pure.canonicalGridCheck({
    crs: 'EPSG:4326', transform: [0.01, 0, -180]
  }).compatible, false);
});

test('grid check: tolerance boundaries follow the accepted rule',
    function () {
  // Scale differences at 1e-9 pass; larger differences fail.
  assert.equal(pure.canonicalGridCheck({
    crs: 'EPSG:4326',
    transform: [0.01 + 1e-9, 0, -180, 0, 0.01, -90]
  }).compatible, true);
  assert.equal(pure.canonicalGridCheck({
    crs: 'EPSG:4326',
    transform: [0.01 + 1e-6, 0, -180, 0, 0.01, -90]
  }).compatible, false);
});

/* ----------------------- PRODUCT_QUALITY status mapping (scripts) */
/*
 * Three DISTINCT concepts for contributing products:
 *   explicit 'NOMINAL'            -> known nominal;
 *   explicit value != 'NOMINAL'   -> non-NOMINAL (flagged, retained);
 *   absent or null ('(missing)')  -> unknown — reported as unknown and
 *                                    NEVER counted as non-NOMINAL.
 */

test('quality: no contributors reports unknown, never nominal',
    function () {
  var summary = pure.qualitySummary([]);
  assert.equal(summary.status, 'unknown');
  assert.equal(summary.hasNonNominalContributors, false);
  assert.equal(summary.nonNominalProductCount, 0);
  assert.equal(summary.unknownProductQualityCount, 0);
});

test('quality: all NOMINAL contributors report nominal', function () {
  var summary = pure.qualitySummary(['NOMINAL', 'NOMINAL']);
  assert.equal(summary.status, 'nominal');
  assert.equal(summary.hasNonNominalContributors, false);
  assert.equal(summary.nonNominalProductCount, 0);
  assert.equal(summary.unknownProductQualityCount, 0);
});

test('quality: one explicit non-NOMINAL contributor is flagged, ' +
    'never excluded', function () {
  var summary = pure.qualitySummary(['NOMINAL', 'DEGRADED']);
  assert.equal(summary.status, 'non_nominal');
  assert.equal(summary.hasNonNominalContributors, true);
  assert.equal(summary.nonNominalProductCount, 1);
  assert.equal(summary.unknownProductQualityCount, 0);
});

test('quality: all-missing metadata reports unknown, not non-NOMINAL',
    function () {
  var summary = pure.qualitySummary(['(missing)', '(missing)']);
  assert.equal(summary.status, 'unknown');
  assert.equal(summary.hasNonNominalContributors, false);
  assert.equal(summary.nonNominalProductCount, 0);
  assert.equal(summary.unknownProductQualityCount, 2);
});

test('quality: nominal plus missing reports unknown status; missing ' +
    'never counts as non-NOMINAL', function () {
  var summary = pure.qualitySummary(['NOMINAL', '(missing)']);
  assert.equal(summary.status, 'unknown'); // absent is NOT nominal
  assert.equal(summary.hasNonNominalContributors, false);
  assert.equal(summary.nonNominalProductCount, 0);
  assert.equal(summary.unknownProductQualityCount, 1);
});

test('quality: explicit non-NOMINAL plus missing reports non_nominal ' +
    'and counts only the explicit value', function () {
  var summary = pure.qualitySummary(['DEGRADED', '(missing)']);
  assert.equal(summary.status, 'non_nominal');
  assert.equal(summary.hasNonNominalContributors, true);
  assert.equal(summary.nonNominalProductCount, 1);
  assert.equal(summary.unknownProductQualityCount, 1);
});

test('quality: null/undefined metadata is unknown, like (missing)',
    function () {
  var summary = pure.qualitySummary(['NOMINAL', null, undefined]);
  assert.equal(summary.status, 'unknown');
  assert.equal(summary.hasNonNominalContributors, false);
  assert.equal(summary.nonNominalProductCount, 0);
  assert.equal(summary.unknownProductQualityCount, 2);
});

/* -------------------------------------- overall-deadline budget */

test('deadline budget: sub-operation caps clamp to remaining time',
    function () {
  var now = 0;
  var budget = pure.createDeadlineBudget(480000,
      function () { return now; });
  assert.equal(budget(60000), 60000);   // full sub-cap available
  now = 450000;
  assert.equal(budget(60000), 30000);   // clamped to remaining
  now = 480000;
  assert.ok(budget(60000) <= 0);        // exhausted exactly at deadline
  now = 500000;
  assert.ok(budget(60000) <= 0);        // exhausted past deadline
});
