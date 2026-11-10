'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Sync = require('../sync-engine.js');

function baseState() {
  return Sync.initializeState({
    schemaVersion: 3,
    meta: { createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
    profile: { currentDay: 196, cash: 100 },
    daily: [{ id: 'daily-day-196', day: 196, revenue: 10 }],
    grading: [],
    inventory: [{ id: 'inventory-existing', card: 'Existing card', status: 'Held' }],
    tournaments: []
  });
}

function packageFor(overrides = {}) {
  return {
    format: Sync.FORMAT,
    version: Sync.VERSION,
    syncId: 'sync-day197-test-0001',
    gameDay: 197,
    sourceThread: 'Thread 3 — Live Gameplay Command',
    previousSyncCheckpoint: 'day-196-full-backup',
    nextSyncCheckpoint: 'day-197-sync-test-0001',
    createdAt: '2026-01-02T00:00:00.000Z',
    template: false,
    events: [{
      eventId: 'event-day197-eod-0001',
      eventType: 'eod_report',
      operation: 'create',
      recordId: 'daily-day-197',
      baseRevision: null,
      changes: { day: 197, revenue: 20 },
      evidence: { status: 'verified', confidence: 1, source: 'Thread 3' }
    }],
    ...overrides
  };
}

test('applies once and rejects the same sync and event on repeat', () => {
  const original = baseState();
  const pkg = packageFor();
  const first = Sync.apply(original, pkg, {}).state;
  assert.equal(first.daily.length, 2);
  assert.equal(first.sync.currentCheckpoint, pkg.nextSyncCheckpoint);
  assert.equal(original.daily.length, 1, 'apply must not mutate the input state');
  const repeated = Sync.preview(first, pkg);
  assert.match(repeated.blockingErrors.join(' '), /already applied/);
  assert.throws(() => Sync.apply(first, pkg, {}), /already applied/);
  assert.equal(first.daily.length, 2);
});

test('blocks an out-of-order checkpoint and earlier game day', () => {
  const state = baseState();
  const pkg = packageFor({ previousSyncCheckpoint: 'day-195-sync', gameDay: 195 });
  const report = Sync.preview(state, pkg);
  assert.equal(report.canApply, false);
  assert.match(report.blockingErrors.join(' '), /Out-of-sequence package/);
  assert.match(report.blockingErrors.join(' '), /Out-of-sequence game day/);
  assert.throws(() => Sync.apply(state, pkg, {}), /Out-of-sequence/);
});

test('invalid or unsupported fields cannot alter dashboard data', () => {
  const state = baseState();
  const before = JSON.stringify(state);
  const pkg = packageFor();
  pkg.events[0].changes.overwriteDatabase = true;
  assert.throws(() => Sync.preview(state, pkg), /not accepted/);
  assert.equal(JSON.stringify(state), before);
});

test('preserves existing records and survives a persistence round trip', () => {
  const state = baseState();
  const applied = Sync.apply(state, packageFor(), {}).state;
  const persisted = Sync.initializeState(JSON.parse(JSON.stringify(applied)));
  assert.ok(persisted.inventory.some(record => record.id === 'inventory-existing'));
  assert.ok(persisted.daily.some(record => record.id === 'daily-day-196'));
  assert.ok(persisted.daily.some(record => record.id === 'daily-day-197'));
  assert.equal(persisted.sync.lastAppliedSync.syncId, 'sync-day197-test-0001');
  assert.deepEqual(persisted.sync.appliedEventIds, ['event-day197-eod-0001']);
});

test('requires manual resolution and preserves superseded history', () => {
  const state = baseState();
  const pkg = packageFor({
    syncId: 'sync-day197-conflict-0001',
    nextSyncCheckpoint: 'day-197-conflict-checkpoint',
    events: [{
      eventId: 'event-day197-conflict-0001',
      eventType: 'inventory',
      operation: 'update',
      recordId: 'inventory-existing',
      baseRevision: 1,
      changes: { status: 'Listed' },
      evidence: { status: 'provisional', confidence: 0.8, source: 'Thread 3' }
    }]
  });
  const report = Sync.preview(state, pkg);
  assert.equal(report.conflicts[0].conflict.code, 'revision_mismatch');
  assert.throws(() => Sync.apply(state, pkg, {}), /requires a resolution/);
  const kept = Sync.apply(state, pkg, { 'event-day197-conflict-0001': 'keep_dashboard' }).state;
  assert.equal(kept.inventory[0].status, 'Held');
  const replaced = Sync.apply(state, pkg, { 'event-day197-conflict-0001': 'use_sync' }).state;
  assert.equal(replaced.inventory[0].status, 'Listed');
  assert.equal(replaced.sync.supersededRecords.length, 1);
  assert.equal(replaced.sync.supersededRecords[0].record.status, 'Held');
});

test('Day 197 template validates but is intentionally non-applying', () => {
  const template = require('../examples/day-197-gameplay-sync.template.json');
  assert.doesNotThrow(() => Sync.validatePackage(template));
  const report = Sync.preview(baseState(), template);
  assert.equal(report.canApply, false);
  assert.match(report.blockingErrors.join(' '), /Template packages cannot be applied/);
});
