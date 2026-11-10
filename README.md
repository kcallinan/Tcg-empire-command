# TCG Empire Command

Local-first shop dashboard with full JSON backup/restore and reviewed incremental gameplay synchronization.

## Development

Open `index.html` through a static web server. Run the sync-engine regression suite with:

```sh
npm test
```

Thread 3 package authors should use [`THREAD3-SYNC-INSTRUCTIONS.md`](THREAD3-SYNC-INSTRUCTIONS.md), the exact v1 schema, and the Day 197 non-applying template. A template cannot advance the dashboard checkpoint until real gameplay events replace its empty event list and `template` is set to `false`.
