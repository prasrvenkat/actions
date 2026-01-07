import { PulumiOutputJson } from './events';

/**
 * Colored circle emoji icons for resource operations.
 */
const OP_EMOJI: Record<string, string> = {
  create: '🟢',
  update: '🟡',
  delete: '🔴',
  replace: '🟣',
  same: '⚪',
  'create-replacement': '🟣',
  'delete-replaced': '🟣',
  read: '🔵',
};

/**
 * Result status emojis.
 */
const RESULT_EMOJI: Record<string, string> = {
  succeeded: '✅',
  failed: '❌',
};

/**
 * Command display names (capitalized for headers).
 */
const COMMAND_DISPLAY: Record<string, string> = {
  preview: 'Preview',
  up: 'Update',
  update: 'Update',
  refresh: 'Refresh',
  destroy: 'Destroy',
};

/**
 * Maximum number of resources to show in the tree.
 */
const MAX_RESOURCES_TO_SHOW = 50;

/**
 * Tree node for building resource hierarchy.
 */
interface TreeNode {
  resource: PulumiOutputJson['resources'][0];
  children: TreeNode[];
}

/**
 * Format Pulumi output as styled markdown for GitHub PR comments and summaries.
 *
 * @param data - The structured Pulumi output JSON
 * @param command - The Pulumi command that was run (preview, up, etc.)
 * @param stackName - The name of the stack
 * @returns Formatted markdown string
 */
export function formatAsMarkdown(
  data: PulumiOutputJson,
  command: string,
  stackName: string,
): string {
  const lines: string[] = [];

  // Header with result emoji and command
  const resultEmoji = RESULT_EMOJI[data.result] || '';
  const commandDisplay = COMMAND_DISPLAY[command] || command;
  lines.push(`## ${resultEmoji} Pulumi ${commandDisplay}: \`${stackName}\``);
  lines.push('');

  // Change summary table
  lines.push(formatChangeSummaryTable(data.changeSummary));
  lines.push('');

  // Duration and permalink on same line if both available
  const metaLine: string[] = [];
  if (data.durationSeconds !== undefined) {
    metaLine.push(`⏱️ **Duration**: ${formatDuration(data.durationSeconds)}`);
  }
  if (data.permalink) {
    metaLine.push(`🔗 [View in Pulumi Cloud](${data.permalink})`);
  }
  if (metaLine.length > 0) {
    lines.push(metaLine.join(' · '));
    lines.push('');
  }

  // Diagnostics (grouped by severity) using GitHub Alerts - show early for visibility
  const warnings = data.diagnostics.filter(d => d.severity === 'warning');
  const errors = data.diagnostics.filter(d => d.severity === 'error');

  // Errors first (more critical)
  if (errors.length > 0) {
    lines.push(formatDiagnosticGroup(errors, 'CAUTION'));
    lines.push('');
  }

  // Then warnings
  if (warnings.length > 0) {
    lines.push(formatDiagnosticGroup(warnings, 'WARNING'));
    lines.push('');
  }

  // Resource changes tree (only non-same operations)
  const changedResources = data.resources.filter(r => r.operation !== 'same');
  if (changedResources.length > 0) {
    lines.push('### Resource Changes');
    lines.push('');
    lines.push(formatResourceTree(data.resources));
    lines.push('');
  }

  return lines.join('\n').trim();
}

/**
 * Format the change summary as a markdown table.
 */
function formatChangeSummaryTable(summary: PulumiOutputJson['changeSummary']): string {
  const lines: string[] = [];

  lines.push(`| ${OP_EMOJI.create} Create | ${OP_EMOJI.update} Update | ${OP_EMOJI.delete} Delete | ${OP_EMOJI.replace} Replace | ${OP_EMOJI.same} Same |`);
  lines.push('|----------|----------|----------|-----------|------|');
  lines.push(`| ${summary.create} | ${summary.update} | ${summary.delete} | ${summary.replace} | ${summary.same} |`);

  return lines.join('\n');
}

/**
 * Build a tree structure from flat resource list using parent references.
 */
function buildTree(resources: PulumiOutputJson['resources']): TreeNode[] {
  const nodeMap = new Map<string, TreeNode>();
  const roots: TreeNode[] = [];

  // Create nodes for all resources
  for (const resource of resources) {
    nodeMap.set(resource.urn, { resource, children: [] });
  }

  // Build parent-child relationships
  for (const resource of resources) {
    const node = nodeMap.get(resource.urn)!;
    if (resource.parent && nodeMap.has(resource.parent)) {
      nodeMap.get(resource.parent)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}

/**
 * Format resources as a tree view with emoji indicators.
 */
function formatResourceTree(resources: PulumiOutputJson['resources']): string {
  const tree = buildTree(resources);
  const lines: string[] = ['```'];
  let count = 0;

  function renderNode(node: TreeNode, prefix: string, isLast: boolean, isRoot: boolean): void {
    if (count >= MAX_RESOURCES_TO_SHOW) return;

    const resource = node.resource;
    const emoji = resource.operation === 'same' ? '  ' : OP_EMOJI[resource.operation] || '  ';
    const connector = isRoot ? '' : (isLast ? '└── ' : '├── ');
    const displayName = `${resource.type} ${resource.name}`;

    // Only show changed resources, but traverse all to maintain tree structure
    if (resource.operation !== 'same') {
      lines.push(`${emoji} ${prefix}${connector}${displayName}`);
      count++;
    } else if (hasChangedDescendants(node)) {
      // Show unchanged parents if they have changed children
      lines.push(`   ${prefix}${connector}${displayName}`);
      count++;
    }

    // Render children
    const childPrefix = isRoot ? '' : prefix + (isLast ? '    ' : '│   ');
    const visibleChildren = node.children.filter(c =>
      c.resource.operation !== 'same' || hasChangedDescendants(c)
    );

    visibleChildren.forEach((child, index) => {
      const isLastChild = index === visibleChildren.length - 1;
      renderNode(child, childPrefix, isLastChild, false);
    });
  }

  // Check if a node has any changed descendants
  function hasChangedDescendants(node: TreeNode): boolean {
    if (node.resource.operation !== 'same') return true;
    return node.children.some(child => hasChangedDescendants(child));
  }

  // Render all root nodes
  tree.forEach((root, index) => {
    const isLast = index === tree.length - 1;
    renderNode(root, '', isLast, true);
  });

  // Show truncation message if needed
  const totalChanged = resources.filter(r => r.operation !== 'same').length;
  if (totalChanged > MAX_RESOURCES_TO_SHOW) {
    lines.push(`   ... and ${totalChanged - MAX_RESOURCES_TO_SHOW} more resources`);
  }

  lines.push('```');
  return lines.join('\n');
}

/**
 * Format a group of diagnostics using GitHub Alert syntax.
 */
function formatDiagnosticGroup(
  diagnostics: PulumiOutputJson['diagnostics'],
  alertType: 'WARNING' | 'CAUTION',
): string {
  const lines: string[] = [];

  lines.push(`> [!${alertType}]`);

  for (const diagnostic of diagnostics) {
    if (diagnostic.urn) {
      const resourceName = extractResourceName(diagnostic.urn);
      lines.push(`> - \`${resourceName}\`: ${diagnostic.message}`);
    } else {
      lines.push(`> - ${diagnostic.message}`);
    }
  }

  return lines.join('\n');
}

/**
 * Format duration in seconds to a human-readable string.
 */
function formatDuration(seconds: number): string {
  if (seconds < 60) {
    return `${Math.round(seconds)}s`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);

  if (remainingSeconds === 0) {
    return `${minutes}m`;
  }

  return `${minutes}m ${remainingSeconds}s`;
}

/**
 * Extract resource name from URN.
 */
function extractResourceName(urn: string): string {
  const parts = urn.split('::');
  return parts[parts.length - 1] || urn;
}
