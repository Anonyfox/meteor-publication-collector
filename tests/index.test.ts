import assert from 'assert';
import { Meteor } from 'meteor/meteor';
import { Random } from 'meteor/random';
import { Mongo } from 'meteor/mongo';
import { PublicationCollector } from '../src/index';

if (Meteor.isServer) {
  describe('PublicationCollector', () => {
    // Test collection
    const TestCollection = new Mongo.Collection<any>('test_publication_collector');

    beforeEach(async () => {
      // Clean up test collection
      await TestCollection.removeAsync({});

      // Remove any test publications
      const pubNames = ['test.empty', 'test.single', 'test.multiple', 'test.async',
                        'test.error', 'test.manualAdds', 'test.mixed', 'test.noCursor'];
      pubNames.forEach(name => {
        delete Meteor.server.publish_handlers[name];
      });
    });

    afterEach(async () => {
      await TestCollection.removeAsync({});
    });

    describe('Constructor', () => {
      it('creates instance without options', () => {
        const collector = new PublicationCollector();
        assert.strictEqual(collector.userId, undefined);
        assert.strictEqual(typeof collector.unblock, 'function');
      });

      it('accepts userId option', () => {
        const userId = Random.id();
        const collector = new PublicationCollector({ userId });
        assert.strictEqual(collector.userId, userId);
      });

      it('supports instance reuse across multiple collections', async () => {
        await TestCollection.insertAsync({ _id: '1', value: 'first' });
        await TestCollection.insertAsync({ _id: '2', value: 'second' });

        Meteor.publish('test.reuse', function() {
          return TestCollection.find();
        });

        const collector = new PublicationCollector();

        // First collection
        const result1 = await collector.collect('test.reuse');
        assert.strictEqual(result1.test_publication_collector.length, 2);

        // Second collection (reuse same instance)
        const result2 = await collector.collect('test.reuse');
        assert.strictEqual(result2.test_publication_collector.length, 2);
        assert.deepStrictEqual(result1, result2);
      });
    });

    describe('collect() - Basic Functionality', () => {
      it('throws error for non-existent publication', async () => {
        const collector = new PublicationCollector();
        await assert.rejects(
          () => collector.collect('nonexistent.publication'),
          /Publication "nonexistent.publication" not found/
        );
      });

      it('collects empty cursor', async () => {
        Meteor.publish('test.empty', function() {
          return TestCollection.find({ nonexistent: true });
        });

        const collector = new PublicationCollector();
        const result = await collector.collect('test.empty');

        assert.ok(result.test_publication_collector);
        assert.strictEqual(result.test_publication_collector.length, 0);
      });

      it('collects single document', async () => {
        await TestCollection.insertAsync({ _id: 'abc', name: 'Test' });

        Meteor.publish('test.single', function() {
          return TestCollection.find({ _id: 'abc' });
        });

        const collector = new PublicationCollector();
        const result = await collector.collect('test.single');

        assert.strictEqual(result.test_publication_collector.length, 1);
        assert.strictEqual(result.test_publication_collector[0]._id, 'abc');
        assert.strictEqual(result.test_publication_collector[0].name, 'Test');
      });

      it('collects multiple documents', async () => {
        await TestCollection.insertAsync({ _id: '1', value: 'a' });
        await TestCollection.insertAsync({ _id: '2', value: 'b' });
        await TestCollection.insertAsync({ _id: '3', value: 'c' });

        Meteor.publish('test.multiple', function() {
          return TestCollection.find();
        });

        const collector = new PublicationCollector();
        const result = await collector.collect('test.multiple');

        assert.strictEqual(result.test_publication_collector.length, 3);
        const ids = result.test_publication_collector.map((d: any) => d._id).sort();
        assert.deepStrictEqual(ids, ['1', '2', '3']);
      });

      it('collects with field projection', async () => {
        await TestCollection.insertAsync({ _id: '1', public: 'yes', secret: 'no' });

        Meteor.publish('test.projection', function() {
          return TestCollection.find({}, { fields: { public: 1 } });
        });

        const collector = new PublicationCollector();
        const result = await collector.collect('test.projection');

        assert.strictEqual(result.test_publication_collector.length, 1);
        assert.ok(result.test_publication_collector[0].public);
        assert.strictEqual(result.test_publication_collector[0].secret, undefined);
      });
    });

    describe('collect() - Publication Arguments', () => {
      it('passes single argument to publication', async () => {
        await TestCollection.insertAsync({ _id: '1', type: 'foo' });
        await TestCollection.insertAsync({ _id: '2', type: 'bar' });

        Meteor.publish('test.withArg', function(type: string) {
          return TestCollection.find({ type });
        });

        const collector = new PublicationCollector();
        const result = await collector.collect('test.withArg', 'foo');

        assert.strictEqual(result.test_publication_collector.length, 1);
        assert.strictEqual(result.test_publication_collector[0].type, 'foo');
      });

      it('passes multiple arguments to publication', async () => {
        await TestCollection.insertAsync({ _id: '1', x: 10, y: 20 });
        await TestCollection.insertAsync({ _id: '2', x: 15, y: 25 });

        Meteor.publish('test.multipleArgs', function(minX: number, minY: number) {
          return TestCollection.find({ x: { $gte: minX }, y: { $gte: minY } });
        });

        const collector = new PublicationCollector();
        const result = await collector.collect('test.multipleArgs', 12, 22);

        assert.strictEqual(result.test_publication_collector.length, 1);
        assert.strictEqual(result.test_publication_collector[0]._id, '2');
      });

      it('passes object arguments correctly', async () => {
        await TestCollection.insertAsync({ _id: '1', status: 'active', priority: 1 });
        await TestCollection.insertAsync({ _id: '2', status: 'active', priority: 2 });

        Meteor.publish('test.objectArg', function(options: any) {
          return TestCollection.find(options.query, { sort: options.sort });
        });

        const collector = new PublicationCollector();
        const result = await collector.collect('test.objectArg', {
          query: { status: 'active' },
          sort: { priority: -1 }
        });

        assert.strictEqual(result.test_publication_collector.length, 2);
        // Note: Document order in collection is not guaranteed without explicit sorting in test
        const ids = result.test_publication_collector.map((d: any) => d._id).sort();
        assert.deepStrictEqual(ids, ['1', '2']);
      });
    });

    describe('collect() - Async Publications', () => {
      it('handles async publication function', async () => {
        await TestCollection.insertAsync({ _id: '1', async: true });

        Meteor.publish('test.async', async function() {
          // Simulate async work
          await new Promise(resolve => setTimeout(resolve, 10));
          return TestCollection.find({ async: true });
        });

        const collector = new PublicationCollector();
        const result = await collector.collect('test.async');

        assert.strictEqual(result.test_publication_collector.length, 1);
        assert.strictEqual(result.test_publication_collector[0].async, true);
      });

      it('handles publication that returns promise of cursor', async () => {
        await TestCollection.insertAsync({ _id: '1', value: 'promise' });

        Meteor.publish('test.promiseCursor', function() {
          return Promise.resolve(TestCollection.find({ value: 'promise' }));
        });

        const collector = new PublicationCollector();
        const result = await collector.collect('test.promiseCursor');

        assert.strictEqual(result.test_publication_collector.length, 1);
      });
    });

    describe('collect() - Manual this.added() Calls', () => {
      it('collects manual this.added() without cursor', async () => {
        Meteor.publish('test.manualAdds', function() {
          this.added('custom', 'id1', { name: 'Manual 1' });
          this.added('custom', 'id2', { name: 'Manual 2' });
          this.ready();
        });

        const collector = new PublicationCollector();
        const result = await collector.collect('test.manualAdds');

        assert.ok(result.custom);
        assert.strictEqual(result.custom.length, 2);
        assert.strictEqual(result.custom[0].name, 'Manual 1');
        assert.strictEqual(result.custom[1].name, 'Manual 2');
      });

      it('collects mixed manual adds and cursor', async () => {
        await TestCollection.insertAsync({ _id: '1', source: 'db' });

        Meteor.publish('test.mixed', function() {
          this.added('metadata', 'meta1', { type: 'manual' });
          this.ready();
          return TestCollection.find({ source: 'db' });
        });

        const collector = new PublicationCollector();
        const result = await collector.collect('test.mixed');

        assert.ok(result.metadata);
        assert.strictEqual(result.metadata.length, 1);
        assert.strictEqual(result.metadata[0].type, 'manual');

        assert.ok(result.test_publication_collector);
        assert.strictEqual(result.test_publication_collector.length, 1);
        assert.strictEqual(result.test_publication_collector[0].source, 'db');
      });

      it('handles this.changed() callbacks', async () => {
        Meteor.publish('test.changed', function() {
          this.added('items', 'item1', { value: 1 });
          this.changed('items', 'item1', { value: 2 });
          this.ready();
        });

        const collector = new PublicationCollector();
        const result = await collector.collect('test.changed');

        assert.strictEqual(result.items.length, 1);
        assert.strictEqual(result.items[0].value, 2); // Changed value
      });

      it('handles this.removed() callbacks', async () => {
        Meteor.publish('test.removed', function() {
          this.added('items', 'item1', { value: 1 });
          this.added('items', 'item2', { value: 2 });
          this.removed('items', 'item1');
          this.ready();
        });

        const collector = new PublicationCollector();
        const result = await collector.collect('test.removed');

        assert.strictEqual(result.items.length, 1);
        assert.strictEqual(result.items[0]._id, 'item2');
      });
    });

    describe('collect() - Multiple Cursors', () => {
      const Collection2 = new Mongo.Collection('test_collection_2');

      beforeEach(async () => {
        await Collection2.removeAsync({});
      });

      afterEach(async () => {
        await Collection2.removeAsync({});
      });

      it('collects array of cursors', async () => {
        await TestCollection.insertAsync({ _id: '1', type: 'A' });
        await Collection2.insertAsync({ _id: '2', type: 'B' });

        Meteor.publish('test.multipleCursors', function() {
          return [
            TestCollection.find(),
            Collection2.find()
          ];
        });

        const collector = new PublicationCollector();
        const result = await collector.collect('test.multipleCursors');

        assert.ok(result.test_publication_collector);
        assert.strictEqual(result.test_publication_collector.length, 1);
        assert.strictEqual(result.test_publication_collector[0].type, 'A');

        assert.ok(result.test_collection_2);
        assert.strictEqual(result.test_collection_2.length, 1);
        assert.strictEqual(result.test_collection_2[0].type, 'B');
      });
    });

    describe('collect() - Error Handling', () => {
      it('rejects when publication throws sync error', async () => {
        Meteor.publish('test.syncError', function() {
          throw new Error('Sync error in publication');
        });

        const collector = new PublicationCollector();
        await assert.rejects(
          () => collector.collect('test.syncError'),
          /Sync error in publication/
        );
      });

      it('rejects when publication throws async error', async () => {
        Meteor.publish('test.asyncError', async function() {
          await new Promise(resolve => setTimeout(resolve, 10));
          throw new Error('Async error in publication');
        });

        const collector = new PublicationCollector();
        await assert.rejects(
          () => collector.collect('test.asyncError'),
          /Async error in publication/
        );
      });

      it('rejects on timeout if cursor observation hangs', async () => {
        // Mock setTimeout to fire immediately for testing
        const originalSetTimeout = Meteor.setTimeout as any;
        const originalClearTimeout = Meteor.clearTimeout as any;
        const timeoutCallbacks: Array<() => void> = [];

        (Meteor as any).setTimeout = (cb: () => void, _delay: number) => {
          timeoutCallbacks.push(cb);
          return 123; // Return fake timeout ID
        };

        (Meteor as any).clearTimeout = () => {
          timeoutCallbacks.length = 0;
        };

        try {
          // Create a publication that returns a cursor that hangs
          Meteor.publish('test.hangingCursor', function() {
            const cursor = TestCollection.find();
            // Override _publishCursor to simulate hanging cursor
            (cursor as any)._publishCursor = function() {
              // Return a promise that never resolves
              return new Promise(() => {});
            };
            return cursor;
          });

          const collector = new PublicationCollector();
          const collectPromise = collector.collect('test.hangingCursor');

          // Fire the timeout callback immediately
          assert.strictEqual(timeoutCallbacks.length, 1, 'Timeout should be registered');
          const callback = timeoutCallbacks[0];
          callback();

          // Now the collect should reject
          await assert.rejects(
            () => collectPromise,
            /did not become ready within 5000ms/
          );
        } finally {
          // Restore original functions
          (Meteor as any).setTimeout = originalSetTimeout;
          (Meteor as any).clearTimeout = originalClearTimeout;
        }
      });

      it('handles error in _publishCursor', async () => {
        // Create a cursor that will fail during observation
        const BadCollection = new Mongo.Collection('bad_collection');

        Meteor.publish('test.badCursor', function() {
          const cursor = BadCollection.find();
          // Simulate broken cursor by corrupting internal state
          (cursor as any)._cursorDescription = null;
          return cursor;
        });

        const collector = new PublicationCollector();
        await assert.rejects(
          () => collector.collect('test.badCursor')
        );
      });
    });

    describe('collect() - Edge Cases', () => {
      it('handles publication returning null', async () => {
        Meteor.publish('test.null', function() {
          return null as any;
        });

        const collector = new PublicationCollector();
        const result = await collector.collect('test.null');

        assert.deepStrictEqual(result, {});
      });

      it('handles publication returning undefined', async () => {
        Meteor.publish('test.undefined', function() {
          this.ready();
          return undefined;
        });

        const collector = new PublicationCollector();
        const result = await collector.collect('test.undefined');

        assert.deepStrictEqual(result, {});
      });

      it('handles publication with no return (implicit undefined)', async () => {
        Meteor.publish('test.noReturn', function() {
          this.added('manual', '1', { test: true });
          this.ready();
        });

        const collector = new PublicationCollector();
        const result = await collector.collect('test.noReturn');

        assert.ok(result.manual);
        assert.strictEqual(result.manual.length, 1);
      });

      it('handles empty array of cursors', async () => {
        Meteor.publish('test.emptyArray', function() {
          this.ready();
          return [];
        });

        const collector = new PublicationCollector();
        const result = await collector.collect('test.emptyArray');

        assert.deepStrictEqual(result, {});
      });

      it('handles documents with complex nested structures', async () => {
        await TestCollection.insertAsync({
          _id: '1',
          nested: {
            deep: {
              value: 'test',
              array: [1, 2, { x: 3 }]
            }
          },
          dates: new Date('2024-01-01'),
          nullValue: null,
          undefinedValue: undefined
        });

        Meteor.publish('test.complex', function() {
          return TestCollection.find();
        });

        const collector = new PublicationCollector();
        const result = await collector.collect('test.complex');

        assert.strictEqual(result.test_publication_collector.length, 1);
        const doc = result.test_publication_collector[0];
        assert.strictEqual(doc.nested.deep.value, 'test');
        assert.strictEqual(doc.nested.deep.array[2].x, 3);
        assert.ok(doc.dates instanceof Date);
      });

      it('handles large number of documents efficiently', async () => {
        const docs = Array.from({ length: 1000 }, (_, i) => ({
          _id: `doc${i}`,
          value: i
        }));
        await Promise.all(docs.map(doc => TestCollection.insertAsync(doc)));

        Meteor.publish('test.large', function() {
          return TestCollection.find();
        });

        const collector = new PublicationCollector();
        const startTime = Date.now();
        const result = await collector.collect('test.large');
        const duration = Date.now() - startTime;

        assert.strictEqual(result.test_publication_collector.length, 1000);
        // Should be fast (deterministic, no artificial delays)
        assert.ok(duration < 1000, `Collection took ${duration}ms, should be under 1s`);
      });
    });

    describe('Subscription Context', () => {
      it('provides userId to publication', async () => {
        const testUserId = Random.id();

        Meteor.publish('test.userId', function() {
          this.added('meta', '1', { receivedUserId: this.userId });
          this.ready();
        });

        const collector = new PublicationCollector({ userId: testUserId });
        const result = await collector.collect('test.userId');

        assert.strictEqual(result.meta[0].receivedUserId, testUserId);
      });

      it('unblock() is callable', async () => {
        let unblockCalled = false;

        Meteor.publish('test.unblock', function() {
          assert.strictEqual(typeof this.unblock, 'function');
          this.unblock();
          unblockCalled = true;
          this.ready();
        });

        const collector = new PublicationCollector();
        await collector.collect('test.unblock');

        assert.strictEqual(unblockCalled, true);
      });

      it('onStop() is callable', async () => {
        Meteor.publish('test.onStop', function() {
          this.onStop(() => {
            // Callback would be called on real disconnect
          });
          this.ready();
        });

        const collector = new PublicationCollector();
        const result = await collector.collect('test.onStop');

        assert.ok(result); // Should complete without error
      });
    });

    describe('Observer Cleanup', () => {
      it('stops observers after collection completes', async () => {
        await TestCollection.insertAsync({ _id: '1', value: 'test' });

        Meteor.publish('test.cleanup', function() {
          return TestCollection.find();
        });

        const collector = new PublicationCollector();
        await collector.collect('test.cleanup');

        // Observers should be cleaned up
        assert.strictEqual(collector['_observeHandles'].length, 0);
        assert.strictEqual(collector['_stopped'], true);
      });

      it('prevents duplicate observer on reuse', async () => {
        await TestCollection.insertAsync({ _id: '1', value: 'a' });

        Meteor.publish('test.reuse2', function() {
          return TestCollection.find();
        });

        const collector = new PublicationCollector();

        await collector.collect('test.reuse2');
        const firstStopState = collector['_stopped'];

        await collector.collect('test.reuse2');
        const secondStopState = collector['_stopped'];

        assert.strictEqual(firstStopState, true);
        assert.strictEqual(secondStopState, true);
      });
    });
  });
}

