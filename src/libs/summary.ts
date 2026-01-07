import * as core from '@actions/core';
import { Config } from '../config';
import { PulumiOutputJson } from './events';
import { formatAsMarkdown } from './formatter';
import { stripAnsiControlCodes } from './utils';

function trimOutputByBytes(
  message: string,
  maxSize: number,
  alwaysIncludeSummary: boolean,
): [string, boolean] {
  /**
   *  Trim message to maxSize in bytes
   *  message: string to trim
   *  maxSize: Maximum number of bytes of final message
   *  alwaysIncludeSummary: if true, trim message from front (if trimming is needed), otherwise from end
   *
   *  return message and information if message was trimmed
   */
  let trimmed = false;

  const messageSize = Buffer.byteLength(message, 'utf8');

  // Check if message exceeds max size
  if (messageSize > maxSize) {

    // Trim input message by number of exceeded bytes from front or back as configured
    const dif: number = messageSize - maxSize;

    if (alwaysIncludeSummary) {
      message = Buffer.from(message).subarray(dif, messageSize).toString()
    } else {
      message = Buffer.from(message).subarray(0, messageSize - dif).toString()
    }

    trimmed = true;
  }

  return [message, trimmed];
}

export async function handleSummaryMessage(
  config: Config,
  projectName: string,
  output: string,
  jsonOutput?: PulumiOutputJson,
): Promise<void> {
  const {
    command,
    stackName,
    alwaysIncludeSummary,
    pretty,
  } = config;

  // Remove ANSI symbols from output because they are not supported in GitHub step Summary
  output = stripAnsiControlCodes(output);

  // GitHub limits step Summary to 1 MiB (1_048_576 bytes), use lower max to keep buffer for variable values
  const MAX_SUMMARY_SIZE_BYTES = 1_000_000;

  // Use pretty formatting if enabled and jsonOutput is available
  if (pretty && jsonOutput) {
    const formatted = formatAsMarkdown(jsonOutput, command, stackName);

    // Replace the first leading space in each line with a non-breaking space character to preserve the formatting
    const regex_space = RegExp(`^[ ]`, 'gm');
    const rawOutput = output.replace(regex_space, '&nbsp;');

    // Calculate remaining space for raw output
    const formattedSize = Buffer.byteLength(formatted, 'utf8');
    const remainingSize = MAX_SUMMARY_SIZE_BYTES - formattedSize - 500; // Buffer for details wrapper

    const [trimmedRaw, wasTrimmed] = trimOutputByBytes(rawOutput, Math.max(remainingSize, 10000), alwaysIncludeSummary);

    await core.summary
      .addRaw(formatted)
      .addRaw('\n\n<details>\n<summary>Raw Output</summary>\n\n')
      .addRaw(wasTrimmed ? ':warning: Raw output was truncated.\n\n' : '')
      .addCodeBlock(trimmedRaw, "diff")
      .addRaw('\n</details>')
      .write();
  } else {
    // Existing behavior: raw output
    // Replace the first leading space in each line with a non-breaking space character to preserve the formatting
    const regex_space = RegExp(`^[ ]`, 'gm');
    output = output.replace(regex_space, '&nbsp;');

    const [message, trimmed]: [string, boolean] = trimOutputByBytes(output, MAX_SUMMARY_SIZE_BYTES, alwaysIncludeSummary);

    let heading = `Pulumi ${projectName}/${stackName} results`;

    if (trimmed && alwaysIncludeSummary) {
      heading += ' :warning: **Warn**: The output was too long and trimmed from the front.';
    } else if (trimmed && !alwaysIncludeSummary) {
      heading += ' :warning: **Warn**: The output was too long and trimmed.';
    }

    await core.summary
      .addHeading(heading)
      .addCodeBlock(message, "diff")
      .write();
  }
}
