import * as core from '@actions/core';
import { context, getOctokit } from '@actions/github';
import dedent from 'dedent';
import invariant from 'ts-invariant';
import { Config } from '../config';
import { PulumiOutputJson } from './events';
import { formatAsMarkdown } from './formatter';
import { extractViewLiveLink, stripAnsiControlCodes } from './utils';

function trimOutputByCharacters(
  message: string,
  maxLength: number,
  alwaysIncludeSummary: boolean,
): [string, boolean] {
  /**
   *  Trim message to maxLength
   *  message: string to trim
   *  maxLength: Maximum number of characters of final message
   *  alwaysIncludeSummary: if true, trim message from front (if trimming is needed), otherwise from end
   *
   *  return message and information if message was trimmed
   */
  let trimmed = false;

  // Check if message exceeds max characters
  if (message.length > maxLength) {

    // Trim input message by number of exceeded characters from front or back as configured
    const dif: number = message.length - maxLength;

    if (alwaysIncludeSummary) {
      message = message.substring(dif, message.length);
    } else {
      message = message.substring(0, message.length - dif);
    }

    trimmed = true;
  }

  return [message, trimmed];
}

export async function handlePullRequestMessage(
  config: Config,
  projectName: string,
  output: string,
  jsonOutput?: PulumiOutputJson,
): Promise<void> {
  const {
    githubToken,
    command,
    stackName,
    editCommentOnPr,
    alwaysIncludeSummary,
    pretty,
  } = config;

  // Remove ANSI symbols from output because they are not supported in GitHub PR message
  output = stripAnsiControlCodes(output);

  // GitHub limits PR comment characters to 65_535, use lower max to keep buffer for variable values
  const MAX_CHARACTER_COMMENT = 64_000;

  let body: string;
  let heading: string;
  let summary: string;

  // Use pretty formatting if enabled and jsonOutput is available
  if (pretty && jsonOutput) {
    const formatted = formatAsMarkdown(jsonOutput, command, stackName);

    // For pretty output, we use a different heading/summary for edit detection
    heading = `## ${jsonOutput.result === 'succeeded' ? '✅' : '❌'} Pulumi`;
    summary = '<summary>Raw Output</summary>';

    // Trim raw output for the collapsible section
    const [trimmedOutput, wasTrimmed] = trimOutputByCharacters(output, MAX_CHARACTER_COMMENT - formatted.length - 200, alwaysIncludeSummary);

    body = dedent`
      ${formatted}

      <details>
      ${summary}

      ${wasTrimmed ? ':warning: Raw output was truncated.\n' : ''}\`\`\`
      ${trimmedOutput}
      \`\`\`
      </details>
    `;
  } else {
    // Existing behavior: raw output
    heading = `#### :tropical_drink: \`${command}\` on ${projectName}/${stackName}`;
    summary = '<summary>Pulumi report</summary>';

    const [message, trimmed]: [string, boolean] = trimOutputByCharacters(output, MAX_CHARACTER_COMMENT, alwaysIncludeSummary);

    const viewLiveLink = extractViewLiveLink(output);

    body = dedent`
      ${heading}

      <details>
      ${summary}
      ${viewLiveLink ? `\n[View in Pulumi Cloud](${viewLiveLink})\n` : ''}
      ${trimmed && alwaysIncludeSummary
        ? ':warning: **Warn**: The output was too long and trimmed from the front.'
        : ''
      }
      <pre>
      ${message}
      </pre>
      ${trimmed && !alwaysIncludeSummary
        ? ':warning: **Warn**: The output was too long and trimmed.'
        : ''
      }
      </details>
    `;
  }

  const { payload, repo } = context;
  // Assumes PR numbers are always positive.
  const nr = config.commentOnPrNumber || payload.pull_request?.number;
  invariant(nr, 'Missing pull request event data.');

  const octokit = getOctokit(githubToken);

  try {
    if (editCommentOnPr) {
      const { data: comments } = await octokit.rest.issues.listComments({
        ...repo,
        issue_number: nr,
      });
      const comment = comments.find((comment) =>
        comment.body.startsWith(heading) && comment.body.includes(summary),
      );

      // If comment exists, update it.
      if (comment) {
        await octokit.rest.issues.updateComment({
          ...repo,
          comment_id: comment.id,
          body,
        });
        return;
      }
    }
  } catch {
    core.warning(
      'Not able to edit comment, defaulting to creating a new comment.',
    );
  }

  await octokit.rest.issues.createComment({
    ...repo,
    issue_number: nr,
    body,
  });
}
