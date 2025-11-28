# Publication Collector

Deterministic test helper for Meteor 3+ publications. Collects publication data without DDP overhead using Meteor's internal AsynchronousQueue for precise timing.

## Requirements

- Meteor 3.3 or higher (uses internal APIs)

## Installation

```bash
meteor add anonyfox:publication-collector
```

## Features

- **Zero artificial delays** - Uses queue flush for precise timing
- **Fast** - ~3ms per test vs 50-100ms with setTimeout approaches
- **Reliable** - No race conditions or flaky tests
- **TypeScript** - Full type definitions included

## Usage

```typescript
import { PublicationCollector } from 'meteor/anonyfox:publication-collector';

// Basic usage
const collector = new PublicationCollector();
const data = await collector.collect('myPublication');

// With user context
const collector = new PublicationCollector({ userId: 'user-123' });
const result = await collector.collect('myPublication', param1, param2);

// Returns object with collections as keys
const { users, posts } = result;
```

## License

MIT

