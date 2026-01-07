import { EngineEvent } from '@pulumi/pulumi/automation';

/**
 * Structured JSON output schema for Pulumi operations.
 * This is exposed as the `output-json` action output when `json: true` or `pretty: true`.
 */
export interface PulumiOutputJson {
  result: 'succeeded' | 'failed';
  changeSummary: {
    create: number;
    update: number;
    delete: number;
    replace: number;
    same: number;
  };
  resources: Array<{
    urn: string;
    name: string;
    type: string;
    operation: string;
    diffs?: string[];
    parent?: string;
  }>;
  diagnostics: Array<{
    severity: 'info' | 'warning' | 'error';
    message: string;
    urn?: string;
  }>;
  durationSeconds?: number;
  permalink?: string;
}

/**
 * Default empty change summary for when no summary event is received.
 */
const DEFAULT_CHANGE_SUMMARY: PulumiOutputJson['changeSummary'] = {
  create: 0,
  update: 0,
  delete: 0,
  replace: 0,
  same: 0,
};

/**
 * EventCollector collects structured data from Pulumi Automation API events.
 * It aggregates resource operations, diagnostics, and summary information
 * into a structured JSON format.
 */
export class EventCollector {
  private resources: PulumiOutputJson['resources'] = [];
  private diagnostics: PulumiOutputJson['diagnostics'] = [];
  private changeSummary: PulumiOutputJson['changeSummary'] | null = null;
  private duration: number | undefined;

  /**
   * Event handler to be passed to Pulumi Automation API operations.
   * This method is bound to the instance and can be passed directly as a callback.
   */
  onEvent = (event: EngineEvent): void => {
    // Handle resource pre-event (resource about to be modified)
    if (event.resourcePreEvent) {
      const meta = event.resourcePreEvent.metadata;
      this.resources.push({
        urn: meta.urn,
        name: this.extractName(meta.urn),
        type: meta.type,
        operation: meta.op,
        diffs: meta.diffs,
        parent: meta.new?.parent || meta.old?.parent,
      });
    }

    // Handle diagnostic events (warnings, errors)
    if (event.diagnosticEvent) {
      const diag = event.diagnosticEvent;
      // Filter out 'info' severity to reduce noise
      if (diag.severity !== 'info') {
        this.diagnostics.push({
          severity: this.mapSeverity(diag.severity),
          message: this.cleanMessage(diag.message),
          urn: diag.urn,
        });
      }
    }

    // Handle summary event (end of operation)
    if (event.summaryEvent) {
      const summary = event.summaryEvent;
      this.changeSummary = {
        create: summary.resourceChanges?.create ?? 0,
        update: summary.resourceChanges?.update ?? 0,
        delete: summary.resourceChanges?.delete ?? 0,
        replace: summary.resourceChanges?.replace ?? 0,
        same: summary.resourceChanges?.same ?? 0,
      };
      this.duration = summary.durationSeconds;
    }
  };

  /**
   * Convert collected events to structured JSON output.
   * @param result - Whether the operation succeeded or failed
   * @param permalink - Optional permalink to Pulumi Cloud
   */
  toJson(result: 'succeeded' | 'failed', permalink?: string): PulumiOutputJson {
    return {
      result,
      changeSummary: this.changeSummary ?? DEFAULT_CHANGE_SUMMARY,
      resources: this.resources,
      diagnostics: this.diagnostics,
      durationSeconds: this.duration,
      permalink,
    };
  }

  /**
   * Extract resource name from URN.
   * URN format: urn:pulumi:stack::project::type::name
   * @param urn - The full URN string
   * @returns The resource name (last segment after ::)
   */
  private extractName(urn: string): string {
    const parts = urn.split('::');
    return parts[parts.length - 1] || urn;
  }

  /**
   * Map Pulumi severity strings to our simplified severity type.
   * Pulumi uses: 'info' | 'info#err' | 'warning' | 'error'
   * @param severity - The Pulumi severity string
   */
  private mapSeverity(severity: string): 'info' | 'warning' | 'error' {
    if (severity === 'error' || severity === 'info#err') {
      return 'error';
    }
    if (severity === 'warning') {
      return 'warning';
    }
    return 'info';
  }

  /**
   * Clean diagnostic message by removing ANSI codes and trimming whitespace.
   * @param message - The raw diagnostic message
   */
  private cleanMessage(message: string): string {
    // Remove ANSI escape codes
    // eslint-disable-next-line no-control-regex
    const ansiRegex = /\x1B(?:[@-Z\\-_]|[[0-?]*[ -/]*[@-~])/g;
    return message.replace(ansiRegex, '').trim();
  }
}
