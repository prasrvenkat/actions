import { PulumiOutputJson } from '../events';
import { formatAsMarkdown } from '../formatter';

describe('formatter.ts', () => {
  describe('formatAsMarkdown', () => {
    const baseOutput: PulumiOutputJson = {
      result: 'succeeded',
      changeSummary: {
        create: 0,
        update: 0,
        delete: 0,
        replace: 0,
        same: 0,
      },
      resources: [],
      diagnostics: [],
    };

    it('should format successful preview with changes', () => {
      const data: PulumiOutputJson = {
        ...baseOutput,
        changeSummary: {
          create: 3,
          update: 2,
          delete: 1,
          replace: 0,
          same: 45,
        },
        resources: [
          { urn: 'urn:pulumi:dev::proj::aws:s3/bucket:Bucket::my-bucket', name: 'my-bucket', type: 'aws:s3/bucket:Bucket', operation: 'create' },
          { urn: 'urn:pulumi:dev::proj::aws:lambda/function:Function::my-func', name: 'my-func', type: 'aws:lambda/function:Function', operation: 'update' },
          { urn: 'urn:pulumi:dev::proj::aws:sqs/queue:Queue::old-queue', name: 'old-queue', type: 'aws:sqs/queue:Queue', operation: 'delete' },
        ],
        durationSeconds: 32,
        permalink: 'https://app.pulumi.com/org/project/stack',
      };

      const result = formatAsMarkdown(data, 'preview', 'my-stack');

      expect(result).toContain('## ✅ Pulumi Preview: `my-stack`');
      expect(result).toContain('🟢 Create');
      expect(result).toContain('🟡 Update');
      expect(result).toContain('🔴 Delete');
      expect(result).toContain('| 3 | 2 | 1 | 0 | 45 |');
      expect(result).toContain('⏱️ **Duration**: 32s');
      expect(result).toContain('### Resource Changes');
      expect(result).toContain('my-bucket');
      expect(result).toContain('aws:s3/bucket:Bucket');
      expect(result).toContain('🔗 [View in Pulumi Cloud](https://app.pulumi.com/org/project/stack)');
    });

    it('should format failed operation', () => {
      const data: PulumiOutputJson = {
        ...baseOutput,
        result: 'failed',
        diagnostics: [
          { severity: 'error', message: 'Error creating bucket: BucketAlreadyExists', urn: 'urn:pulumi:dev::proj::aws:s3/bucket:Bucket::my-bucket' },
        ],
      };

      const result = formatAsMarkdown(data, 'up', 'prod-stack');

      expect(result).toContain('## ❌ Pulumi Update: `prod-stack`');
      expect(result).toContain('> [!CAUTION]');
      expect(result).toContain('`my-bucket`: Error creating bucket: BucketAlreadyExists');
    });

    it('should format warnings using GitHub Alert syntax', () => {
      const data: PulumiOutputJson = {
        ...baseOutput,
        diagnostics: [
          { severity: 'warning', message: 'Deprecated runtime nodejs14.x', urn: 'urn:pulumi:dev::proj::aws:lambda/function:Function::func1' },
        ],
      };

      const result = formatAsMarkdown(data, 'preview', 'dev');

      expect(result).toContain('> [!WARNING]');
      expect(result).toContain('`func1`: Deprecated runtime nodejs14.x');
    });

    it('should filter out same operations from resource tree', () => {
      const data: PulumiOutputJson = {
        ...baseOutput,
        changeSummary: {
          create: 1,
          update: 0,
          delete: 0,
          replace: 0,
          same: 5,
        },
        resources: [
          { urn: 'urn:pulumi:dev::proj::aws:s3/bucket:Bucket::bucket1', name: 'bucket1', type: 'aws:s3/bucket:Bucket', operation: 'create' },
          { urn: 'urn:pulumi:dev::proj::aws:s3/bucket:Bucket::bucket2', name: 'bucket2', type: 'aws:s3/bucket:Bucket', operation: 'same' },
          { urn: 'urn:pulumi:dev::proj::aws:s3/bucket:Bucket::bucket3', name: 'bucket3', type: 'aws:s3/bucket:Bucket', operation: 'same' },
        ],
      };

      const result = formatAsMarkdown(data, 'preview', 'dev');

      expect(result).toContain('### Resource Changes');
      expect(result).toContain('bucket1');
      expect(result).not.toContain('bucket2');
      expect(result).not.toContain('bucket3');
    });

    it('should not show resource changes section when all resources are same', () => {
      const data: PulumiOutputJson = {
        ...baseOutput,
        changeSummary: {
          create: 0,
          update: 0,
          delete: 0,
          replace: 0,
          same: 10,
        },
        resources: [
          { urn: 'urn:pulumi:dev::proj::aws:s3/bucket:Bucket::bucket1', name: 'bucket1', type: 'aws:s3/bucket:Bucket', operation: 'same' },
        ],
      };

      const result = formatAsMarkdown(data, 'preview', 'dev');

      expect(result).not.toContain('### Resource Changes');
    });

    it('should format duration correctly', () => {
      const testCases = [
        { seconds: 5, expected: '5s' },
        { seconds: 45, expected: '45s' },
        { seconds: 60, expected: '1m' },
        { seconds: 90, expected: '1m 30s' },
        { seconds: 125, expected: '2m 5s' },
      ];

      testCases.forEach(({ seconds, expected }) => {
        const data: PulumiOutputJson = {
          ...baseOutput,
          durationSeconds: seconds,
        };

        const result = formatAsMarkdown(data, 'preview', 'dev');
        expect(result).toContain(`⏱️ **Duration**: ${expected}`);
      });
    });

    it('should not show duration if not available', () => {
      const data: PulumiOutputJson = {
        ...baseOutput,
      };

      const result = formatAsMarkdown(data, 'preview', 'dev');

      expect(result).not.toContain('Duration');
    });

    it('should not show permalink if not available', () => {
      const data: PulumiOutputJson = {
        ...baseOutput,
      };

      const result = formatAsMarkdown(data, 'preview', 'dev');

      expect(result).not.toContain('View in Pulumi Cloud');
    });

    it('should handle different commands', () => {
      const commands = [
        { cmd: 'preview', display: 'Preview' },
        { cmd: 'up', display: 'Update' },
        { cmd: 'update', display: 'Update' },
        { cmd: 'refresh', display: 'Refresh' },
        { cmd: 'destroy', display: 'Destroy' },
      ];

      commands.forEach(({ cmd, display }) => {
        const result = formatAsMarkdown(baseOutput, cmd, 'test-stack');
        expect(result).toContain(`Pulumi ${display}: \`test-stack\``);
      });
    });

    it('should handle replace operation emoji', () => {
      const data: PulumiOutputJson = {
        ...baseOutput,
        changeSummary: { create: 0, update: 0, delete: 0, replace: 1, same: 0 },
        resources: [
          { urn: 'urn:pulumi:dev::proj::aws:s3/bucket:Bucket::bucket1', name: 'bucket1', type: 'aws:s3/bucket:Bucket', operation: 'replace' },
        ],
      };

      const result = formatAsMarkdown(data, 'preview', 'dev');

      expect(result).toContain('🟣');
    });

    it('should truncate large resource lists', () => {
      const resources = Array.from({ length: 100 }, (_, i) => ({
        urn: `urn:pulumi:dev::proj::aws:s3/bucket:Bucket::bucket${i}`,
        name: `bucket${i}`,
        type: 'aws:s3/bucket:Bucket',
        operation: 'create',
      }));

      const data: PulumiOutputJson = {
        ...baseOutput,
        changeSummary: { create: 100, update: 0, delete: 0, replace: 0, same: 0 },
        resources,
      };

      const result = formatAsMarkdown(data, 'preview', 'dev');

      expect(result).toContain('... and 50 more');
      // Should show first 50
      expect(result).toContain('bucket0');
      expect(result).toContain('bucket49');
      // Should not show beyond 50
      expect(result).not.toContain('bucket50');
      expect(result).not.toContain('bucket99');
    });

    it('should handle diagnostic without URN', () => {
      const data: PulumiOutputJson = {
        ...baseOutput,
        diagnostics: [
          { severity: 'warning', message: 'Global warning message' },
        ],
      };

      const result = formatAsMarkdown(data, 'preview', 'dev');

      expect(result).toContain('> [!WARNING]');
      expect(result).toContain('Global warning message');
    });

    it('should show errors before warnings', () => {
      const data: PulumiOutputJson = {
        ...baseOutput,
        result: 'failed',
        diagnostics: [
          { severity: 'warning', message: 'Warning 1' },
          { severity: 'error', message: 'Error 1' },
          { severity: 'warning', message: 'Warning 2' },
        ],
      };

      const result = formatAsMarkdown(data, 'up', 'dev');

      const errorIndex = result.indexOf('[!CAUTION]');
      const warningIndex = result.indexOf('[!WARNING]');

      expect(errorIndex).toBeLessThan(warningIndex);
    });

    it('should group multiple diagnostics of same severity', () => {
      const data: PulumiOutputJson = {
        ...baseOutput,
        diagnostics: [
          { severity: 'warning', message: 'Warning 1', urn: 'urn:pulumi:dev::proj::aws:s3/bucket:Bucket::bucket1' },
          { severity: 'warning', message: 'Warning 2', urn: 'urn:pulumi:dev::proj::aws:s3/bucket:Bucket::bucket2' },
        ],
      };

      const result = formatAsMarkdown(data, 'preview', 'dev');

      // Should have single WARNING block with multiple items
      const warningCount = (result.match(/\[!WARNING\]/g) || []).length;
      expect(warningCount).toBe(1);
      expect(result).toContain('> - `bucket1`: Warning 1');
      expect(result).toContain('> - `bucket2`: Warning 2');
    });

    it('should render tree structure with parent-child relationships', () => {
      const data: PulumiOutputJson = {
        ...baseOutput,
        changeSummary: { create: 2, update: 0, delete: 0, replace: 0, same: 0 },
        resources: [
          {
            urn: 'urn:pulumi:dev::proj::aws:s3/bucket:Bucket::parent-bucket',
            name: 'parent-bucket',
            type: 'aws:s3/bucket:Bucket',
            operation: 'create',
          },
          {
            urn: 'urn:pulumi:dev::proj::aws:s3/bucketPolicy:BucketPolicy::child-policy',
            name: 'child-policy',
            type: 'aws:s3/bucketPolicy:BucketPolicy',
            operation: 'create',
            parent: 'urn:pulumi:dev::proj::aws:s3/bucket:Bucket::parent-bucket',
          },
        ],
      };

      const result = formatAsMarkdown(data, 'preview', 'dev');

      expect(result).toContain('parent-bucket');
      expect(result).toContain('child-policy');
      // Should have tree connectors
      expect(result).toContain('└──');
    });

    it('should show unchanged parent if it has changed children', () => {
      const data: PulumiOutputJson = {
        ...baseOutput,
        changeSummary: { create: 1, update: 0, delete: 0, replace: 0, same: 1 },
        resources: [
          {
            urn: 'urn:pulumi:dev::proj::aws:s3/bucket:Bucket::parent-bucket',
            name: 'parent-bucket',
            type: 'aws:s3/bucket:Bucket',
            operation: 'same',
          },
          {
            urn: 'urn:pulumi:dev::proj::aws:s3/bucketPolicy:BucketPolicy::child-policy',
            name: 'child-policy',
            type: 'aws:s3/bucketPolicy:BucketPolicy',
            operation: 'create',
            parent: 'urn:pulumi:dev::proj::aws:s3/bucket:Bucket::parent-bucket',
          },
        ],
      };

      const result = formatAsMarkdown(data, 'preview', 'dev');

      // Parent should be shown (without emoji) because child is changed
      expect(result).toContain('parent-bucket');
      expect(result).toContain('child-policy');
    });
  });
});
