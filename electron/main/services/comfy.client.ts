import path from 'node:path';
import fs from 'node:fs/promises';
import log from 'electron-log/main';

const NEGATIVE_PROMPT =
  'photorealistic, 3d render, smooth shading, color, text, watermark, signature';

interface QueuePromptResponse {
  prompt_id: string;
  number: number;
  node_errors?: Record<string, unknown>;
}

interface OutputImage {
  filename: string;
  subfolder: string;
  type: string;
}

interface OutputEntry {
  images?: OutputImage[];
}

interface HistoryEntry {
  outputs: Record<string, OutputEntry>;
}

export class ComfyClient {
  constructor(private baseUrl: string) {}

  async generateImage(
    workflowPath: string,
    positivePrompt: string,
    outputPath: string,
  ): Promise<void> {
    const workflow = await this.loadWorkflow(workflowPath);
    const promptId = await this.queuePrompt(workflow, positivePrompt);
    const filename = await this.waitForImage(promptId);
    await this.downloadImage(filename, outputPath);
  }

  private async loadWorkflow(filePath: string): Promise<Record<string, unknown>> {
    const data = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(data);
  }

  private async queuePrompt(
    workflow: Record<string, unknown>,
    positivePrompt: string,
  ): Promise<string> {
    const prompt = JSON.parse(JSON.stringify(workflow)) as Record<string, unknown>;

    const positiveNode = this.findNodeByClassType(prompt, 'CLIPTextEncode');
    const negativeNode = this.findNodeByClassType(
      prompt,
      'CLIPTextEncode',
      positiveNode,
    );

    if (positiveNode) {
      const node = prompt[positiveNode] as Record<string, unknown>;
      node.inputs = Object.assign({}, node.inputs, { text: positivePrompt });
    }
    if (negativeNode) {
      const node = prompt[negativeNode] as Record<string, unknown>;
      node.inputs = Object.assign({}, node.inputs, { text: NEGATIVE_PROMPT });
    }

    const response = await fetch(`${this.baseUrl}/prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, client_id: 'aigc-line' }),
    });

    if (!response.ok) {
      throw new Error(`ComfyUI queue failed: ${response.status} ${await response.text()}`);
    }

    const data = (await response.json()) as QueuePromptResponse;
    if (data.node_errors && Object.keys(data.node_errors).length > 0) {
      throw new Error(`ComfyUI node errors: ${JSON.stringify(data.node_errors)}`);
    }
    return data.prompt_id;
  }

  private findNodeByClassType(
    prompt: Record<string, unknown>,
    classType: string,
    exclude?: string,
  ): string | undefined {
    for (const [key, node] of Object.entries(prompt)) {
      if (key === exclude) continue;
      const typedNode = node as Record<string, unknown>;
      if (typedNode.class_type === classType) {
        return key;
      }
    }
    return undefined;
  }

  private async waitForImage(promptId: string): Promise<OutputImage> {
    await this.sleep(1000);
    const start = Date.now();
    const timeout = 10 * 60 * 1000;

    while (Date.now() - start < timeout) {
      const response = await fetch(`${this.baseUrl}/history/${promptId}`);
      if (!response.ok) {
        throw new Error(`ComfyUI history fetch failed: ${response.status}`);
      }
      const history = (await response.json()) as Record<string, HistoryEntry>;
      const entry = history[promptId];
      if (entry?.outputs) {
        for (const output of Object.values(entry.outputs)) {
          if (output.images?.length) {
            return output.images[0];
          }
        }
      }
      await this.sleep(2000);
    }

    throw new Error('ComfyUI image generation timed out');
  }

  private async downloadImage(
    image: OutputImage,
    outputPath: string,
  ): Promise<void> {
    const params = new URLSearchParams({
      filename: image.filename,
      subfolder: image.subfolder,
      type: image.type,
    });
    const response = await fetch(`${this.baseUrl}/view?${params.toString()}`);
    if (!response.ok) {
      throw new Error(`ComfyUI download failed: ${response.status}`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, buffer);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
