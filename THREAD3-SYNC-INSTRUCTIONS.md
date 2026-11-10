# Thread 3 — Gameplay SYNC v1 handoff

Use the exact JSON Schema in [`schemas/gameplay-sync-v1.schema.json`](schemas/gameplay-sync-v1.schema.json). Start from the non-applying Day 197 template in [`examples/day-197-gameplay-sync.template.json`](examples/day-197-gameplay-sync.template.json).

## Day 197 workflow

1. Keep `format` as `tcg-empire-gameplay-sync` and `version` as `1`.
2. Replace `syncId` with a globally unique, stable ID. Never reuse a sync or event ID.
3. Keep `gameDay` at `197` and `previousSyncCheckpoint` at the dashboard's displayed checkpoint (`day-196-full-backup` for the confirmed Day 196 starting backup).
4. Replace `nextSyncCheckpoint` with a unique checkpoint that the next package will cite as its `previousSyncCheckpoint`.
5. Set `createdAt` to the real export time in ISO 8601 UTC format.
6. Add only observed gameplay events. Do not estimate or invent missing values.
7. Set `template` to `false` only after at least one real event has been added.
8. Import with **Import Gameplay SYNC**, review every change, resolve every conflict, and choose **Apply approved sync**.

## Event contract

Every event requires a unique `eventId`, one supported `eventType`, an `operation`, stable `recordId`, `baseRevision`, changed fields in `changes`, and evidence metadata.

- `create`: `baseRevision` must be `null`.
- `update`: use the current record revision. Records from the Day 196 full backup that have never been synced have revision `0`.
- `supersede`: same as update, plus `supersedesEventId` naming the event being corrected.
- `evidence.status`: `verified`, `provisional`, `disputed`, or `unverified`.
- `evidence.confidence`: decimal from `0` through `1`.

Supported event types are:

- `inventory`
- `acquisition`
- `trade`
- `grading`
- `premium_listing`
- `premium_sale`
- `tournament`
- `shop_profile`
- `eod_report`
- `ghost_collection`
- `card_opening_machine`
- `pack_operation`

Only fields listed for that event type in the schema and sync engine are accepted. The importer blocks duplicate IDs, invalid fields, templates, checkpoint gaps, and earlier game days before approval. Record collisions or stale revisions require an explicit **Keep dashboard record** or **Use sync values** decision. Replaced records are retained in sync history.

## Sequencing rule

Do not generate Day 198 until the dashboard confirms the Day 197 checkpoint. Each package must cite the exact current checkpoint. If a package is rejected as out of sequence, do not force it; rebuild it against the displayed checkpoint.
