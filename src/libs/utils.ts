export function parseSemicolorToArray(input: string[]): string[];
export function parseSemicolorToArray(input?: string[]): undefined | string[] {
  if (!input) {
    return undefined;
  }

  return input.reduce<string[]>(
    (acc, line) =>
      acc
        .concat(line.split(','))
        .filter((x) => x !== '')
        .map((x) => x.trim()),
    [],
  );
}

export function stripAnsiControlCodes(text: string): string {
  const regex_ansi = RegExp(`\x1B(?:[@-Z\\-_]|[[0-?]*[ -/]*[@-~])`, 'g');
  return text.replace(regex_ansi, '');
}

/**
 * Extracts the Pulumi Cloud permalink from command output.
 * Looks for "View Live: <url>" pattern in the output.
 * @param output - The Pulumi command output
 * @returns The permalink URL or empty string if not found
 */
export function extractViewLiveLink(output: string): string {
  const lines = output.split('\n');
  const linkLine = lines.find((line) => line.includes('View Live:'));
  if (!linkLine) {
    return '';
  }
  return linkLine.split('View Live: ')[1] || '';
}
