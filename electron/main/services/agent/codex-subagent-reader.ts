import path from 'node:path';
import { CodexClient } from './codex-client';
import { getNetworkCodexRuntime } from './codex-runtime';

export interface CodexChildTurn {
  id: string;
  status: string;
  startedAt?: number | null;
  error?: { message?: string } | null;
  items: Record<string, unknown>[];
}

export interface CodexChildSnapshot {
  turns: CodexChildTurn[];
  nickname?: string;
  role?: string;
}

/** Observe only IDs reported by this SDK session. Never resume or run child threads. */
export class CodexSubagentReader {
  private client?: CodexClient;
  private connecting?: Promise<CodexClient>;
  private closed = false;
  private inheritedTurns = new Map<string, Set<string>>();

  constructor(private folderPath: string) {}

  private connect(): Promise<CodexClient> {
    if (this.closed) return Promise.reject(new Error('子会话读取已关闭'));
    if (!this.connecting) this.connecting = (async () => {
      const runtime = await getNetworkCodexRuntime();
      if (this.closed) throw new Error('子会话读取已关闭');
      const client = new CodexClient(this.folderPath, runtime);
      this.client = client;
      client.onClose = () => { this.client = undefined; this.connecting = undefined; };
      try { await client.initialize(3_000); return client; }
      catch (error) { client.close(); throw error; }
    })().catch(error => { this.connecting = undefined; throw error; });
    return this.connecting;
  }

  async read(threadId: string, parentThreadId: string, knownTurns: ReadonlySet<string>): Promise<CodexChildSnapshot> {
    const client = await this.connect();
    const { thread } = await client.request('thread/read', { threadId, includeTurns: false }, 3_000);
    const actualParent = thread?.parentThreadId ?? thread?.source?.subAgent?.thread_spawn?.parent_thread_id;
    if (thread?.id !== threadId || actualParent !== parentThreadId
      || typeof thread.cwd !== 'string' || path.resolve(thread.cwd) !== path.resolve(this.folderPath)) {
      throw new Error('子会话不属于当前项目的 Agent');
    }
    // Child forks can contain inherited parent turns. Exclude them even when
    // parent/child were created in the same second; metadata pages contain no bodies.
    const inherited = this.inheritedTurns.get(threadId) ?? new Set<string>();
    let cursor: string | undefined;
    if (!this.inheritedTurns.has(threadId)) {
      do {
        const page = await client.request('thread/turns/list', { threadId: parentThreadId, limit: 100, itemsView: 'notLoaded', sortDirection: 'desc', cursor }, 3_000);
        for (const turn of page.data as CodexChildTurn[]) inherited.add(turn.id);
        cursor = page.nextCursor ?? undefined;
      } while (cursor && !this.closed);
      this.inheritedTurns.set(threadId, inherited);
    }
    const turns: CodexChildTurn[] = [];
    cursor = undefined;
    do {
      const page = await client.request('thread/turns/list', { threadId, limit: 20, itemsView: 'full', sortDirection: 'desc', cursor }, 3_000);
      let reachedKnownTurn = false;
      for (const turn of page.data as CodexChildTurn[]) {
        if (inherited.has(turn.id)) { reachedKnownTurn = true; continue; }
        // A known active turn is fetched again so growing output is refreshed.
        turns.push(turn);
        if (knownTurns.has(turn.id)) reachedKnownTurn = true;
      }
      cursor = reachedKnownTurn ? undefined : page.nextCursor ?? undefined;
    } while (cursor && !this.closed);
    return { turns: turns.reverse(), nickname: thread.agentNickname ?? undefined, role: thread.agentRole ?? undefined };
  }

  close(): void { this.closed = true; this.client?.close(); }
}
