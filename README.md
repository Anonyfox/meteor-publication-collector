# Publication Collector

Fast, deterministic testing for Meteor 3+ publications. Leverages Meteor's async `AsynchronousQueue.flush()` to collect publication data synchronously without DDP overhead or artificial delays.

**Designed for Meteor 3.3+** — Uses internal APIs (`_publishCursor`, `initialAddsSent`, `_multiplexer._queue.flush()`) specifically built for Meteor's async collections and pub/sub system.

## Why This Exists

Testing publications in Meteor traditionally required DDP connections or unreliable `setTimeout()` polling. This package directly invokes publication handlers and waits for Meteor's internal async queues to drain, providing **deterministic, race-condition-free tests** that run in ~3ms vs 50-100ms.

## Installation

```bash
meteor add anonyfox:publication-collector
```

## Usage

```typescript
import { PublicationCollector } from "meteor/anonyfox:publication-collector";

// Basic: collect all documents from a publication
const collector = new PublicationCollector();
const result = await collector.collect("posts.recent");
// result = { posts: [{ _id: '1', title: '...' }, ...] }

// With user context and arguments
const collector = new PublicationCollector({ userId: "user123" });
const { users } = await collector.collect("users.byRole", "admin");

// Multiple collections (array of cursors)
const { posts, comments } = await collector.collect(
  "posts.withComments",
  postId
);

// Manual this.added/changed/removed
const { customData } = await collector.collect("aggregatedPublication");
```

## What It Supports

- **Single/multiple cursors** — Returns `Cursor` or `[Cursor, ...]`
- **Manual DDP methods** — `this.added()`, `this.changed()`, `this.removed()`
- **Async publications** — Awaits promises, handles async/await
- **User context** — `this.userId` simulation
- **Field projection** — Respects `fields` option in cursors
- **Error handling** — Propagates sync/async errors from publications

## How It Works

1. Directly calls `Meteor.server.publish_handlers[name]` with collector as `this` context
2. If cursors returned, calls `cursor._publishCursor(this)` to start observation
3. Waits for `observeHandle.initialAddsSent` (MongoDB fetch completes)
4. Calls `observeHandle._multiplexer._queue.flush()` to drain all queued callbacks
5. Returns collected documents grouped by collection name

No polling, no delays, no DDP — just direct async queue synchronization.

## TypeScript

Full type definitions included. Works out of the box with TypeScript projects.

---

<div align="center">

### Support

If this package helps your project, consider sponsoring its maintenance:

[![GitHub Sponsors](https://img.shields.io/badge/Sponsor-EA4AAA?style=for-the-badge&logo=github&logoColor=white)](https://github.com/sponsors/Anonyfox)

---

**[Anonyfox](https://anonyfox.com) • [MIT License](LICENSE)**

</div>
