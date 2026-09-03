import {
  spawn,
  type ChildProcessWithoutNullStreams,
} from 'node:child_process';
import { createInterface } from 'node:readline';

type MessageId = number | string;

export type CodexAppServerMessage = {
  id?: MessageId;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code?: number; message?: string };
};

export interface CodexAppServerConnection {
  request(method: string, params: unknown, timeoutMs?: number): Promise<unknown>;
  notify(method: string, params: unknown): void;
  subscribe(listener: (message: CodexAppServerMessage) => void): () => void;
  close(): Promise<void>;
}

export interface CodexAppServerConnectionFactory {
  open(input: { cwd: string }): Promise<CodexAppServerConnection>;
}

export class CodexAppServerProtocolError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = 'CodexAppServerProtocolError';
    this.code = code;
  }
}

const CHILD_ENV_ALLOWLIST = new Set([
  'APPDATA',
  'CODEX_HOME',
  'COMSPEC',
  'HOME',
  'LANG',
  'LOCALAPPDATA',
  'PATH',
  'PATHEXT',
  'SYSTEMDRIVE',
  'SYSTEMROOT',
  'TEMP',
  'TMP',
  'USERPROFILE',
  'WINDIR',
]);

export function buildCodexWorkerEnvironment(
  source: Readonly<Record<string, string | undefined>> = process.env,
): NodeJS.ProcessEnv {
  const sanitized = {} as NodeJS.ProcessEnv;
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined && CHILD_ENV_ALLOWLIST.has(key.toUpperCase())) {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

const DISABLED_CODEX_FEATURES = [
  'apps',
  'browser_use',
  'computer_use',
  'hooks',
  'image_generation',
  'in_app_browser',
  'multi_agent',
  'plugins',
  'shell_tool',
  'skill_search',
  'sleep_tool',
  'unified_exec',
  'view_image',
] as const;

export function buildCodexAppServerArguments(): string[] {
  return [
    'app-server',
    '--listen',
    'stdio://',
    ...DISABLED_CODEX_FEATURES.flatMap((feature) => ['--disable', feature]),
    '-c',
    'mcp_servers={}',
    '-c',
    'shell_environment_policy.inherit="core"',
  ];
}

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
};

class StdioConnection implements CodexAppServerConnection {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly listeners = new Set<(message: CodexAppServerMessage) => void>();
  private readonly pending = new Map<MessageId, PendingRequest>();
  private nextId = 1;
  private closed = false;

  constructor(child: ChildProcessWithoutNullStreams) {
    this.child = child;
    this.child.stderr.resume();
    const lines = createInterface({ input: child.stdout });

    lines.on('line', (line) => {
      let message: CodexAppServerMessage;
      try {
        const parsed: unknown = JSON.parse(line);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          this.failConnection('CODEX_APP_SERVER_INVALID_MESSAGE');
          return;
        }
        message = parsed as CodexAppServerMessage;
      } catch {
        this.failConnection('CODEX_APP_SERVER_INVALID_JSONL');
        return;
      }

      if (message.id !== undefined && (message.result !== undefined || message.error !== undefined)) {
        const pending = this.pending.get(message.id);
        if (pending) {
          clearTimeout(pending.timeout);
          this.pending.delete(message.id);
          if (message.error) pending.reject(new CodexAppServerProtocolError('CODEX_APP_SERVER_REQUEST_FAILED'));
          else pending.resolve(message.result);
        }
      } else if (message.id !== undefined && message.method) {
        this.write({
          id: message.id,
          error: { code: -32000, message: 'Denied by read-only runtime adapter' },
        });
      }

      for (const listener of this.listeners) listener(message);
    });

    child.once('error', () => this.failConnection('CODEX_APP_SERVER_PROCESS_ERROR'));
    child.once('exit', () => this.failConnection('CODEX_APP_SERVER_EXITED'));
  }

  request(method: string, params: unknown, timeoutMs = 30_000): Promise<unknown> {
    if (this.closed) return Promise.reject(new CodexAppServerProtocolError('CODEX_APP_SERVER_CLOSED'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new CodexAppServerProtocolError('CODEX_APP_SERVER_REQUEST_TIMEOUT'));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timeout });
      this.write({ id, method, params });
    });
  }

  notify(method: string, params: unknown): void {
    if (this.closed) throw new CodexAppServerProtocolError('CODEX_APP_SERVER_CLOSED');
    this.write({ method, params });
  }

  subscribe(listener: (message: CodexAppServerMessage) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    for (const request of this.pending.values()) {
      clearTimeout(request.timeout);
      request.reject(new CodexAppServerProtocolError('CODEX_APP_SERVER_CLOSED'));
    }
    this.pending.clear();
    this.listeners.clear();
    this.child.stdin.end();
    if (!this.child.killed) this.child.kill();
  }

  private write(message: CodexAppServerMessage): void {
    if (!this.closed) this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private failConnection(code: string): void {
    if (this.closed) return;
    this.closed = true;
    for (const request of this.pending.values()) {
      clearTimeout(request.timeout);
      request.reject(new CodexAppServerProtocolError(code));
    }
    this.pending.clear();
    this.listeners.clear();
    if (!this.child.killed) this.child.kill();
  }
}

export function createCodexAppServerStdioFactory(options?: {
  command?: string;
  sourceEnvironment?: NodeJS.ProcessEnv;
}): CodexAppServerConnectionFactory {
  const command = options?.command ?? 'codex';
  const env = buildCodexWorkerEnvironment(options?.sourceEnvironment);
  return Object.freeze({
    async open(input: { cwd: string }) {
      const child = spawn(command, buildCodexAppServerArguments(), {
        cwd: input.cwd,
        env,
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });
      return new StdioConnection(child);
    },
  });
}
