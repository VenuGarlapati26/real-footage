// Content pillars: scoring from real results, and next week's allocation (proven winners + testing the rest).
import assert from "node:assert/strict";
import { allocate, loadPillars, pillarWeights, scorePillars } from "../growth/pillars";

const pf = await loadPillars(), ids = pf.pillars.map(p => p.id);
assert.ok(ids.length >= 8 && new Set(ids).size === ids.length, "many distinct pillars");
assert.ok(pf.pillars.every(p => p.seeds.length && p.wiki.length && p.footage.length), "every pillar can find ideas and footage");

// nothing published yet: the first weeks rotate through untested pillars, no repeats
const w1 = allocate(ids, {}, 3, pf.explore, 1); assert.equal(new Set(w1).size, 3);
// results: wildlife Shorts do 4x the channel median, space 0.5x
const rows = [...Array(4)].flatMap(() => [{ pillar: "wildlife", format: "short" as const, views: 4000 }, { pillar: "space", format: "short" as const, views: 500 }, { pillar: "ocean", format: "short" as const, views: 1000 }]);
const perf = scorePillars(rows);
assert.ok(perf.wildlife.short.score > perf.ocean.short.score && perf.ocean.short.score > perf.space.short.score);
const wt = pillarWeights(ids, perf, "short"); assert.ok(wt.wildlife > wt.space && wt.history === 1.2, "untested pillars keep an optimistic weight");
const plan = allocate(ids, perf, 5, 0.3, 7);
assert.equal(plan[0], "wildlife", "the winner leads"); assert.ok(plan.filter(p => p === "wildlife").length >= 1 && plan.some(p => !["wildlife", "ocean", "space"].includes(p)), "and ~30% keeps testing other pillars");
// the "only space" trap: one pillar with a little data must not take over the week
const onlySpace = scorePillars([{ pillar: "space", format: "short", views: 900 }, { pillar: "space", format: "short", views: 1100 }, { pillar: "space", format: "short", views: 1000 }]);
const wk = allocate(ids, onlySpace, 4, pf.explore, 5);
assert.ok(wk.filter(x => x === "space").length <= 2 && new Set(wk).size >= 3, `varied week: ${wk}`);
assert.ok(wk.every((x, i) => i === 0 || x !== wk[i - 1]), "never the same pillar twice in a row");
// even a huge winner gets at most a third of the week
const big = scorePillars([...Array(6)].flatMap(() => [{ pillar: "wildlife", format: "short" as const, views: 9000 }, { pillar: "ocean", format: "short" as const, views: 100 }]));
const wk2 = allocate(ids, big, 6, pf.explore, 2); assert.ok(wk2.filter(x => x === "wildlife").length <= 2, `${wk2}`);
const { nextPillar, varietyOrder } = await import("../growth/pillars");
assert.notEqual(nextPillar(ids, ["space", "extreme-earth", "space"]), "space");
const order = varietyOrder([{ topic: "space", id: 1 }, { topic: "space", id: 2 }, { topic: "food", id: 3 }], ["ocean", "space"]);
assert.equal(order[0].topic, "food", "today's Short is not yesterday's topic");
console.log("pillar tests passed");

// Actions-minutes guard: 4K when the month has room, lower when it doesn't
const { chooseLongRes, record } = await import("../autopilot/budget");
const fresh = { month: "2026-11", minutes: 0, rate: {} };
const base = { wanted: "2160p" as const, budgetMinutes: 2000, longSeconds: 240, shortSeconds: 35, shortsPerDay: 1 };
assert.equal(chooseLongRes({ ...base, usage: fresh, daysLeft: 8, longDaysLeft: 4 }).res, "2160p", "late in the month with room: 4K");
assert.equal(chooseLongRes({ ...base, usage: fresh, daysLeft: 30, longDaysLeft: 17 }).res, "1440p", "a full month of 4K would not fit: 1440p");
assert.equal(chooseLongRes({ ...base, usage: { ...fresh, minutes: 1750 }, daysLeft: 5, longDaysLeft: 3 }).res, "1080p", "nearly spent: 1080p, never skipped");
const u2 = record(fresh, "long-2160p", 100, 2000); assert.equal(u2.rate["long-2160p"], 20); assert.equal(u2.minutes, 33.3);
console.log("budget tests passed");

// story formats: many ways to tell a story, chosen the same way
const { loadFormats } = await import("../growth/pillars");
const ff = await loadFormats(), fids = ff.formats.map(f => f.id);
assert.ok(fids.length >= 8 && ff.formats.every(f => f.recipe.length > 40), "8+ story formats with recipes");
const week = allocate(fids, {}, 8, ff.explore, 3); assert.equal(new Set(week).size, 8, "first weeks: every format tried, none repeated");
console.log("story format tests passed");
