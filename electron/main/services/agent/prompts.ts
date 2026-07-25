import path from 'node:path';
import type { ChatMessage } from '../../../../src/shared/ipc.types';

/**
 * Build the user prompt for the current turn.
 * Attachments are listed as workspace-relative paths so the agent can
 * inspect them with Read/Bash; system instructions live in the system prompt.
 */
export function buildUserPrompt(userMessage: ChatMessage, folderPath: string): string {
  let prompt = userMessage.content;

  if (userMessage.attachments && userMessage.attachments.length > 0) {
    const attachmentLines = userMessage.attachments
      .map((a) => {
        // Prefer workspace-relative paths (staged under uploads/)
        const rel = a.path ? path.relative(folderPath, a.path) : '';
        const location =
          rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel : a.path;
        return `- ${a.name} (${a.type})${location ? ` at ${location}` : ''}`;
      })
      .join('\n');
    prompt = `User uploaded files (already inside the workspace, use Read/Bash to inspect them):\n${attachmentLines}\n\n${prompt}`;
  }

  return prompt;
}

/**
 * Appended to the claude_code preset system prompt: workspace location and
 * how/when to push artifacts to the canvas.
 */
export function buildSystemPromptAppend(folderPath: string): string {
  return `Your workspace is: ${folderPath}

When you complete a task that produces a meaningful result (like writing code, generating a report, creating a visualization, etc.), you should use the PushArtifact tool to display it on the user's canvas. First write the result to a file in the workspace, then call PushArtifact with the file path - the content is read from disk, so do NOT paste the content into the tool call. The PushArtifact tool takes these parameters:
- path: path to the file (relative to the workspace or absolute). The artifact type is inferred from the extension: .html/.htm renders as html, everything else renders as markdown
- title: a short title for the artifact

For example, after writing a report to report.md, call PushArtifact with path="report.md" and title="Report".`;
}
