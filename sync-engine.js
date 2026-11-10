(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.TCGSync = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const FORMAT = 'tcg-empire-gameplay-sync';
  const VERSION = 1;
  const MAX_PACKAGE_BYTES = 2 * 1024 * 1024;
  const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/;
  const CHECKPOINT = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/;
  const EVENT_TYPES = Object.freeze([
    'inventory', 'acquisition', 'trade', 'grading', 'premium_listing',
    'premium_sale', 'tournament', 'shop_profile', 'eod_report',
    'ghost_collection', 'card_opening_machine', 'pack_operation'
  ]);
  const OPERATIONS = Object.freeze(['create', 'update', 'supersede']);
  const EVIDENCE_STATUSES = Object.freeze(['verified', 'provisional', 'disputed', 'unverified']);
  const TARGETS = Object.freeze({
    inventory: 'inventory', acquisition: 'acquisitions', trade: 'trades',
    grading: 'grading', premium_listing: 'premiumListings', premium_sale: 'premiumSales',
    tournament: 'tournaments', shop_profile: 'profile', eod_report: 'daily',
    ghost_collection: 'ghostCollection', card_opening_machine: 'cardOpeningMachines',
    pack_operation: 'packOperations'
  });
  const COLLECTIONS = Object.freeze([...new Set(Object.values(TARGETS).filter(x => x !== 'profile'))]);
  const FIELDS = Object.freeze({
    inventory: ['card', 'set', 'finish', 'grade', 'cost', 'marketValue', 'listPrice', 'status', 'notes', 'quantity', 'location', 'acquiredDay', 'soldDay'],
    acquisition: ['day', 'kind', 'card', 'set', 'finish', 'quantity', 'totalCost', 'counterparty', 'notes'],
    trade: ['day', 'direction', 'itemsGiven', 'itemsReceived', 'cashDelta', 'counterparty', 'notes'],
    grading: ['batchId', 'batchName', 'company', 'tracking', 'card', 'set', 'finish', 'submittedDay', 'dueDay', 'cost', 'g10Value', 'priority', 'status', 'gradeReceived', 'returnedDay', 'resultDay', 'certNumber', 'notes'],
    premium_listing: ['inventoryId', 'listedDay', 'platform', 'listPrice', 'status', 'notes'],
    premium_sale: ['inventoryId', 'soldDay', 'platform', 'salePrice', 'fees', 'buyer', 'notes'],
    tournament: ['name', 'startDay', 'eventDay', 'entryFee', 'prizePool', 'registered', 'capacity', 'status', 'notes'],
    shop_profile: ['shopName', 'currentDay', 'shopLevel', 'shopA', 'shopB', 'tables', 'review', 'cash'],
    eod_report: ['day', 'visits', 'checkouts', 'dissatisfied', 'revenue', 'supplyCost', 'upgradeCost', 'profit', 'itemEarning', 'cardEarning', 'gameEarning', 'employeeCost', 'rentBills', 'itemsSold', 'cardsSold', 'playHours', 'notes'],
    ghost_collection: ['card', 'set', 'finish', 'grade', 'quantity', 'estimatedValue', 'status', 'notes'],
    card_opening_machine: ['day', 'machineId', 'machineName', 'status', 'cost', 'slots', 'notes'],
    pack_operation: ['day', 'machineId', 'setName', 'packType', 'packsLoaded', 'packsOpened', 'revenue', 'cost', 'notes']
  });
  const TOP_LEVEL_KEYS = ['format', 'version', 'syncId', 'gameDay', 'sourceThread', 'previousSyncCheckpoint', 'nextSyncCheckpoint', 'createdAt', 'template', 'events'];
  const EVENT_KEYS = ['eventId', 'eventType', 'operation', 'recordId', 'baseRevision', 'changes', 'evidence', 'supersedesEventId'];
  const EVIDENCE_KEYS = ['status', 'confidence', 'source', 'reference'];
  const forbiddenKeys = new Set(['__proto__', 'prototype', 'constructor']);

  function plainObject(value) {
    if (!value || Object.prototype.toString.call(value) !== '[object Object]') return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
  }
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function fail(message) { throw new Error(message); }
  function assert(condition, message) { if (!condition) fail(message); }
  function exactKeys(value, allowed, path) {
    for (const key of Object.keys(value)) assert(allowed.includes(key), `${path} contains unsupported field "${key}".`);
  }
  function safeJsonValue(value, path, depth) {
    assert(depth <= 5, `${path} is nested too deeply.`);
    if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) {
      if (typeof value === 'number') assert(Number.isFinite(value), `${path} must be a finite number.`);
      if (typeof value === 'string') assert(value.length <= 10000, `${path} is too long.`);
      return;
    }
    if (Array.isArray(value)) {
      assert(value.length <= 500, `${path} has too many items.`);
      value.forEach((item, index) => safeJsonValue(item, `${path}[${index}]`, depth + 1));
      return;
    }
    assert(plainObject(value), `${path} must contain JSON-safe values only.`);
    for (const [key, item] of Object.entries(value)) {
      assert(!forbiddenKeys.has(key), `${path} contains a forbidden key.`);
      safeJsonValue(item, `${path}.${key}`, depth + 1);
    }
  }
  function validateIdentifier(value, path, pattern) {
    assert(typeof value === 'string' && pattern.test(value), `${path} is not a valid identifier.`);
  }
  function validateEvent(event, index, template) {
    const path = `events[${index}]`;
    assert(plainObject(event), `${path} must be an object.`);
    exactKeys(event, EVENT_KEYS, path);
    for (const key of ['eventId', 'eventType', 'operation', 'recordId', 'baseRevision', 'changes', 'evidence']) {
      assert(Object.prototype.hasOwnProperty.call(event, key), `${path}.${key} is required.`);
    }
    validateIdentifier(event.eventId, `${path}.eventId`, IDENTIFIER);
    assert(EVENT_TYPES.includes(event.eventType), `${path}.eventType is not supported.`);
    assert(OPERATIONS.includes(event.operation), `${path}.operation is not supported.`);
    validateIdentifier(event.recordId, `${path}.recordId`, IDENTIFIER);
    if (event.eventType === 'shop_profile') assert(event.recordId === 'profile', `${path}.recordId must be "profile" for shop_profile events.`);
    if (event.operation === 'create') assert(event.baseRevision === null, `${path}.baseRevision must be null for create.`);
    else assert(Number.isInteger(event.baseRevision) && event.baseRevision >= 0, `${path}.baseRevision must be a nonnegative integer.`);
    assert(plainObject(event.changes), `${path}.changes must be an object.`);
    if (!template) assert(Object.keys(event.changes).length > 0, `${path}.changes cannot be empty.`);
    for (const [key, value] of Object.entries(event.changes)) {
      assert(!forbiddenKeys.has(key), `${path}.changes contains a forbidden key.`);
      assert(FIELDS[event.eventType].includes(key), `${path}.changes.${key} is not accepted for ${event.eventType}.`);
      safeJsonValue(value, `${path}.changes.${key}`, 0);
    }
    assert(plainObject(event.evidence), `${path}.evidence must be an object.`);
    exactKeys(event.evidence, EVIDENCE_KEYS, `${path}.evidence`);
    for (const key of ['status', 'confidence', 'source']) assert(Object.prototype.hasOwnProperty.call(event.evidence, key), `${path}.evidence.${key} is required.`);
    assert(EVIDENCE_STATUSES.includes(event.evidence.status), `${path}.evidence.status is not supported.`);
    assert(typeof event.evidence.confidence === 'number' && event.evidence.confidence >= 0 && event.evidence.confidence <= 1, `${path}.evidence.confidence must be between 0 and 1.`);
    assert(typeof event.evidence.source === 'string' && event.evidence.source.length > 0 && event.evidence.source.length <= 200, `${path}.evidence.source is invalid.`);
    if (event.evidence.reference !== undefined) assert(typeof event.evidence.reference === 'string' && event.evidence.reference.length <= 500, `${path}.evidence.reference is invalid.`);
    if (event.operation === 'supersede') validateIdentifier(event.supersedesEventId, `${path}.supersedesEventId`, IDENTIFIER);
    else assert(event.supersedesEventId === undefined || event.supersedesEventId === null, `${path}.supersedesEventId is only allowed for supersede.`);
  }
  function validatePackage(input) {
    assert(plainObject(input), 'Sync package must be a JSON object.');
    let byteLength;
    try { byteLength = new TextEncoder().encode(JSON.stringify(input)).length; }
    catch (_) { fail('Sync package must contain valid JSON-safe values.'); }
    assert(byteLength <= MAX_PACKAGE_BYTES, 'Sync package exceeds the 2 MB safety limit.');
    exactKeys(input, TOP_LEVEL_KEYS, 'package');
    for (const key of TOP_LEVEL_KEYS) assert(Object.prototype.hasOwnProperty.call(input, key), `package.${key} is required.`);
    assert(input.format === FORMAT, `package.format must be "${FORMAT}".`);
    assert(input.version === VERSION, `package.version must be ${VERSION}.`);
    validateIdentifier(input.syncId, 'package.syncId', IDENTIFIER);
    assert(Number.isInteger(input.gameDay) && input.gameDay >= 1, 'package.gameDay must be a positive integer.');
    assert(typeof input.sourceThread === 'string' && input.sourceThread.length > 0 && input.sourceThread.length <= 200, 'package.sourceThread is invalid.');
    validateIdentifier(input.previousSyncCheckpoint, 'package.previousSyncCheckpoint', CHECKPOINT);
    validateIdentifier(input.nextSyncCheckpoint, 'package.nextSyncCheckpoint', CHECKPOINT);
    assert(input.nextSyncCheckpoint !== input.previousSyncCheckpoint, 'package.nextSyncCheckpoint must advance the checkpoint.');
    assert(typeof input.createdAt === 'string' && !Number.isNaN(Date.parse(input.createdAt)), 'package.createdAt must be an ISO date-time string.');
    assert(typeof input.template === 'boolean', 'package.template must be true or false.');
    assert(Array.isArray(input.events) && input.events.length <= 500, 'package.events must be an array with at most 500 events.');
    if (!input.template) assert(input.events.length > 0, 'A live sync package must contain at least one event.');
    const eventIds = new Set(), targets = new Set();
    input.events.forEach((event, index) => {
      validateEvent(event, index, input.template);
      assert(!eventIds.has(event.eventId), `Duplicate eventId "${event.eventId}" in package.`);
      eventIds.add(event.eventId);
      const target = `${event.eventType}:${event.recordId}`;
      assert(!targets.has(target), `Multiple events target ${target}; combine them into one event.`);
      targets.add(target);
    });
    return clone(input);
  }
  function initializeState(input) {
    assert(plainObject(input), 'Dashboard state is invalid.');
    const state = input;
    COLLECTIONS.forEach(key => { if (!Array.isArray(state[key])) state[key] = []; });
    if (!plainObject(state.profile)) state.profile = {};
    const day = Number.isInteger(Number(state.profile.currentDay)) && Number(state.profile.currentDay) > 0 ? Number(state.profile.currentDay) : 1;
    if (!plainObject(state.sync)) state.sync = {};
    state.sync.currentCheckpoint = typeof state.sync.currentCheckpoint === 'string' ? state.sync.currentCheckpoint : `day-${day}-full-backup`;
    state.sync.lastGameDay = Number.isInteger(state.sync.lastGameDay) ? state.sync.lastGameDay : day;
    state.sync.lastAppliedSync = state.sync.lastAppliedSync || null;
    for (const key of ['appliedSyncIds', 'appliedEventIds', 'importLedger', 'supersededRecords']) if (!Array.isArray(state.sync[key])) state.sync[key] = [];
    return state;
  }
  function locate(state, event) {
    const key = TARGETS[event.eventType];
    if (key === 'profile') return { key, index: 0, record: state.profile };
    const index = state[key].findIndex(record => record && record.id === event.recordId);
    return { key, index, record: index >= 0 ? state[key][index] : null };
  }
  function conflictFor(location, event) {
    const record = location.record;
    if (event.operation === 'create' && record) return { code: 'record_exists', message: 'Create targets a record that already exists.' };
    if (event.operation !== 'create' && !record) return { code: 'record_missing', message: 'Update targets a record that does not exist.' };
    if (record && event.operation !== 'create') {
      const revision = Number.isInteger(record._sync?.revision) ? record._sync.revision : 0;
      if (revision !== event.baseRevision) return { code: 'revision_mismatch', message: `Dashboard revision ${revision} does not match package revision ${event.baseRevision}.` };
      if (event.operation === 'supersede' && record._sync?.lastEventId && record._sync.lastEventId !== event.supersedesEventId) {
        return { code: 'superseded_event_mismatch', message: 'The event being superseded is no longer the current record event.' };
      }
    }
    return null;
  }
  function preview(inputState, inputPackage) {
    const pkg = validatePackage(inputPackage);
    const state = initializeState(clone(inputState));
    const blockingErrors = [];
    if (pkg.template) blockingErrors.push('Template packages cannot be applied. Replace placeholders, add real events, and set template to false.');
    if (state.sync.appliedSyncIds.includes(pkg.syncId)) blockingErrors.push(`Sync ${pkg.syncId} was already applied.`);
    if (pkg.previousSyncCheckpoint !== state.sync.currentCheckpoint) blockingErrors.push(`Out-of-sequence package: expected checkpoint ${state.sync.currentCheckpoint}, received ${pkg.previousSyncCheckpoint}.`);
    if (pkg.gameDay < state.sync.lastGameDay) blockingErrors.push(`Out-of-sequence game day: dashboard is at Day ${state.sync.lastGameDay}, package is Day ${pkg.gameDay}.`);
    const appliedEvents = new Set(state.sync.appliedEventIds);
    const eventPreviews = pkg.events.map(event => {
      const location = locate(state, event);
      let conflict = null;
      if (appliedEvents.has(event.eventId)) blockingErrors.push(`Event ${event.eventId} was already applied.`);
      else conflict = conflictFor(location, event);
      return {
        eventId: event.eventId, eventType: event.eventType, operation: event.operation,
        recordId: event.recordId, changes: clone(event.changes), evidence: clone(event.evidence),
        currentRecord: location.record ? clone(location.record) : null, conflict
      };
    });
    return {
      package: pkg,
      blockingErrors: [...new Set(blockingErrors)],
      events: eventPreviews,
      conflicts: eventPreviews.filter(item => item.conflict),
      canApply: blockingErrors.length === 0
    };
  }
  function writeEvent(state, pkg, event, location) {
    const oldRecord = location.record ? clone(location.record) : null;
    if (oldRecord) state.sync.supersededRecords.push({
      syncId: pkg.syncId, eventId: event.eventId, eventType: event.eventType,
      recordId: event.recordId, capturedAt: new Date().toISOString(), record: oldRecord
    });
    const oldRevision = oldRecord && Number.isInteger(oldRecord._sync?.revision) ? oldRecord._sync.revision : 0;
    const next = Object.assign({}, oldRecord || {}, clone(event.changes), location.key === 'profile' ? {} : { id: event.recordId });
    next._sync = {
      revision: oldRecord ? oldRevision + 1 : 1,
      lastEventId: event.eventId,
      lastSyncId: pkg.syncId,
      evidence: clone(event.evidence)
    };
    if (location.key === 'profile') state.profile = next;
    else if (location.index >= 0) state[location.key][location.index] = next;
    else state[location.key].push(next);
  }
  function apply(inputState, inputPackage, resolutions) {
    const report = preview(inputState, inputPackage);
    assert(report.blockingErrors.length === 0, report.blockingErrors.join(' '));
    const choices = resolutions || {};
    for (const item of report.conflicts) assert(['keep_dashboard', 'use_sync'].includes(choices[item.eventId]), `Conflict ${item.eventId} requires a resolution.`);
    const state = initializeState(clone(inputState));
    const outcomes = [];
    for (const event of report.package.events) {
      const conflict = report.conflicts.find(item => item.eventId === event.eventId);
      const resolution = conflict ? choices[event.eventId] : 'use_sync';
      if (resolution === 'use_sync') writeEvent(state, report.package, event, locate(state, event));
      state.sync.appliedEventIds.push(event.eventId);
      outcomes.push({ eventId: event.eventId, outcome: resolution, conflict: conflict?.conflict?.code || null });
    }
    const appliedAt = new Date().toISOString();
    state.sync.appliedSyncIds.push(report.package.syncId);
    state.sync.currentCheckpoint = report.package.nextSyncCheckpoint;
    state.sync.lastGameDay = Math.max(state.sync.lastGameDay, report.package.gameDay);
    state.sync.lastAppliedSync = { syncId: report.package.syncId, checkpoint: report.package.nextSyncCheckpoint, gameDay: report.package.gameDay, appliedAt };
    state.sync.importLedger.push({
      syncId: report.package.syncId, sourceThread: report.package.sourceThread,
      gameDay: report.package.gameDay, previousSyncCheckpoint: report.package.previousSyncCheckpoint,
      nextSyncCheckpoint: report.package.nextSyncCheckpoint, appliedAt, outcomes
    });
    return { state, report, outcomes };
  }

  return Object.freeze({ FORMAT, VERSION, EVENT_TYPES, TARGETS, FIELDS, validatePackage, initializeState, preview, apply });
});
