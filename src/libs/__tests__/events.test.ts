import { EngineEvent } from '@pulumi/pulumi/automation';
import { EventCollector } from '../events';

describe('events.ts', () => {
  describe('EventCollector', () => {
    let collector: EventCollector;

    beforeEach(() => {
      collector = new EventCollector();
    });

    it('should collect resource pre-events', () => {
      const event: EngineEvent = {
        sequence: 1,
        timestamp: Date.now(),
        resourcePreEvent: {
          metadata: {
            urn: 'urn:pulumi:dev::my-project::aws:s3/bucket:Bucket::my-bucket',
            type: 'aws:s3/bucket:Bucket',
            op: 'create',
            provider: 'urn:pulumi:dev::my-project::pulumi:providers:aws::default',
          },
        },
      };

      collector.onEvent(event);

      const result = collector.toJson('succeeded');
      expect(result.resources).toHaveLength(1);
      expect(result.resources[0]).toEqual({
        urn: 'urn:pulumi:dev::my-project::aws:s3/bucket:Bucket::my-bucket',
        name: 'my-bucket',
        type: 'aws:s3/bucket:Bucket',
        operation: 'create',
        diffs: undefined,
        parent: undefined,
      });
    });

    it('should collect parent URN from resource events', () => {
      const event: EngineEvent = {
        sequence: 1,
        timestamp: Date.now(),
        resourcePreEvent: {
          metadata: {
            urn: 'urn:pulumi:dev::proj::aws:s3/bucketPolicy:BucketPolicy::my-policy',
            type: 'aws:s3/bucketPolicy:BucketPolicy',
            op: 'create',
            provider: '',
            new: {
              type: 'aws:s3/bucketPolicy:BucketPolicy',
              urn: 'urn:pulumi:dev::proj::aws:s3/bucketPolicy:BucketPolicy::my-policy',
              id: '',
              parent: 'urn:pulumi:dev::proj::aws:s3/bucket:Bucket::my-bucket',
              inputs: {},
              outputs: {},
              provider: '',
            },
          },
        },
      };

      collector.onEvent(event);

      const result = collector.toJson('succeeded');
      expect(result.resources[0].parent).toBe('urn:pulumi:dev::proj::aws:s3/bucket:Bucket::my-bucket');
    });

    it('should collect multiple resource events', () => {
      const events: EngineEvent[] = [
        {
          sequence: 1,
          timestamp: Date.now(),
          resourcePreEvent: {
            metadata: {
              urn: 'urn:pulumi:dev::proj::aws:s3/bucket:Bucket::bucket1',
              type: 'aws:s3/bucket:Bucket',
              op: 'create',
              provider: '',
            },
          },
        },
        {
          sequence: 2,
          timestamp: Date.now(),
          resourcePreEvent: {
            metadata: {
              urn: 'urn:pulumi:dev::proj::aws:lambda/function:Function::func1',
              type: 'aws:lambda/function:Function',
              op: 'update',
              provider: '',
              diffs: ['code', 'timeout'],
            },
          },
        },
        {
          sequence: 3,
          timestamp: Date.now(),
          resourcePreEvent: {
            metadata: {
              urn: 'urn:pulumi:dev::proj::aws:sqs/queue:Queue::queue1',
              type: 'aws:sqs/queue:Queue',
              op: 'delete',
              provider: '',
            },
          },
        },
      ];

      events.forEach(e => collector.onEvent(e));

      const result = collector.toJson('succeeded');
      expect(result.resources).toHaveLength(3);
      expect(result.resources[0].operation).toBe('create');
      expect(result.resources[1].operation).toBe('update');
      expect(result.resources[1].diffs).toEqual(['code', 'timeout']);
      expect(result.resources[2].operation).toBe('delete');
    });

    it('should collect diagnostic events (warnings and errors)', () => {
      const events: EngineEvent[] = [
        {
          sequence: 1,
          timestamp: Date.now(),
          diagnosticEvent: {
            urn: 'urn:pulumi:dev::proj::aws:lambda/function:Function::func1',
            message: 'Deprecated runtime nodejs14.x',
            severity: 'warning',
            color: '',
          },
        },
        {
          sequence: 2,
          timestamp: Date.now(),
          diagnosticEvent: {
            urn: 'urn:pulumi:dev::proj::aws:s3/bucket:Bucket::bucket1',
            message: 'Error creating bucket: BucketAlreadyExists',
            severity: 'error',
            color: '',
          },
        },
      ];

      events.forEach(e => collector.onEvent(e));

      const result = collector.toJson('failed');
      expect(result.diagnostics).toHaveLength(2);
      expect(result.diagnostics[0]).toEqual({
        severity: 'warning',
        message: 'Deprecated runtime nodejs14.x',
        urn: 'urn:pulumi:dev::proj::aws:lambda/function:Function::func1',
      });
      expect(result.diagnostics[1]).toEqual({
        severity: 'error',
        message: 'Error creating bucket: BucketAlreadyExists',
        urn: 'urn:pulumi:dev::proj::aws:s3/bucket:Bucket::bucket1',
      });
    });

    it('should filter out info severity diagnostics', () => {
      const event: EngineEvent = {
        sequence: 1,
        timestamp: Date.now(),
        diagnosticEvent: {
          message: 'Some informational message',
          severity: 'info',
          color: '',
        },
      };

      collector.onEvent(event);

      const result = collector.toJson('succeeded');
      expect(result.diagnostics).toHaveLength(0);
    });

    it('should map info#err severity to error', () => {
      const event: EngineEvent = {
        sequence: 1,
        timestamp: Date.now(),
        diagnosticEvent: {
          message: 'Some error message',
          severity: 'info#err',
          color: '',
        },
      };

      collector.onEvent(event);

      const result = collector.toJson('failed');
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0].severity).toBe('error');
    });

    it('should collect summary event', () => {
      const event: EngineEvent = {
        sequence: 10,
        timestamp: Date.now(),
        summaryEvent: {
          maybeCorrupt: false,
          durationSeconds: 45,
          resourceChanges: {
            create: 3,
            update: 2,
            delete: 1,
            replace: 0,
            same: 10,
          },
          policyPacks: {},
        },
      };

      collector.onEvent(event);

      const result = collector.toJson('succeeded');
      expect(result.changeSummary).toEqual({
        create: 3,
        update: 2,
        delete: 1,
        replace: 0,
        same: 10,
      });
      expect(result.durationSeconds).toBe(45);
    });

    it('should provide default change summary when no summary event received', () => {
      const result = collector.toJson('succeeded');
      expect(result.changeSummary).toEqual({
        create: 0,
        update: 0,
        delete: 0,
        replace: 0,
        same: 0,
      });
    });

    it('should include permalink in output', () => {
      const result = collector.toJson('succeeded', 'https://app.pulumi.com/org/project/stack/updates/123');
      expect(result.permalink).toBe('https://app.pulumi.com/org/project/stack/updates/123');
    });

    it('should clean ANSI codes from diagnostic messages', () => {
      const event: EngineEvent = {
        sequence: 1,
        timestamp: Date.now(),
        diagnosticEvent: {
          message: '\x1b[31mError:\x1b[0m Something went wrong',
          severity: 'error',
          color: '',
        },
      };

      collector.onEvent(event);

      const result = collector.toJson('failed');
      expect(result.diagnostics[0].message).toBe('Error: Something went wrong');
    });

    it('should extract resource name from URN correctly', () => {
      const testCases = [
        {
          urn: 'urn:pulumi:dev::my-project::aws:s3/bucket:Bucket::my-bucket',
          expectedName: 'my-bucket',
        },
        {
          urn: 'urn:pulumi:prod::app::kubernetes:apps/v1:Deployment::web-server',
          expectedName: 'web-server',
        },
        {
          urn: 'urn:pulumi:staging::infra::pulumi:pulumi:Stack::infra-staging',
          expectedName: 'infra-staging',
        },
      ];

      testCases.forEach(({ urn, expectedName }) => {
        const newCollector = new EventCollector();
        newCollector.onEvent({
          sequence: 1,
          timestamp: Date.now(),
          resourcePreEvent: {
            metadata: {
              urn,
              type: 'test:type',
              op: 'create',
              provider: '',
            },
          },
        });

        const result = newCollector.toJson('succeeded');
        expect(result.resources[0].name).toBe(expectedName);
      });
    });

    it('should produce complete JSON output', () => {
      // Simulate a full operation with multiple events
      const events: EngineEvent[] = [
        {
          sequence: 1,
          timestamp: Date.now(),
          resourcePreEvent: {
            metadata: {
              urn: 'urn:pulumi:dev::proj::aws:s3/bucket:Bucket::bucket1',
              type: 'aws:s3/bucket:Bucket',
              op: 'create',
              provider: '',
            },
          },
        },
        {
          sequence: 2,
          timestamp: Date.now(),
          diagnosticEvent: {
            message: 'Warning message',
            severity: 'warning',
            color: '',
          },
        },
        {
          sequence: 3,
          timestamp: Date.now(),
          summaryEvent: {
            maybeCorrupt: false,
            durationSeconds: 30,
            resourceChanges: {
              create: 1,
              same: 5,
            },
            policyPacks: {},
          },
        },
      ];

      events.forEach(e => collector.onEvent(e));

      const result = collector.toJson('succeeded', 'https://example.com/update/1');

      expect(result).toMatchObject({
        result: 'succeeded',
        changeSummary: {
          create: 1,
          update: 0,
          delete: 0,
          replace: 0,
          same: 5,
        },
        resources: [
          {
            name: 'bucket1',
            type: 'aws:s3/bucket:Bucket',
            operation: 'create',
          },
        ],
        diagnostics: [
          {
            severity: 'warning',
            message: 'Warning message',
          },
        ],
        durationSeconds: 30,
        permalink: 'https://example.com/update/1',
      });
    });
  });
});
