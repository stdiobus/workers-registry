export interface HistoryEntry {
  role: 'user' | 'assistant';
  content: string;
}

export class Session {
  readonly id: string;
  readonly cwd: string;
  private _history: HistoryEntry[] = [];
  private _abortController: AbortController;
  private _cancelled = false;

  constructor(id: string, cwd: string) {
    this.id = id;
    this.cwd = cwd;
    this._abortController = new AbortController();
  }

  getAbortSignal(): AbortSignal {
    return this._abortController.signal;
  }

  cancel(): void {
    this._cancelled = true;
    this._abortController.abort();
  }

  isCancelled(): boolean {
    return this._cancelled;
  }

  resetCancellation(): void {
    this._cancelled = false;
    this._abortController = new AbortController();
  }

  addHistoryEntry(role: 'user' | 'assistant', content: string): void {
    this._history.push({ role, content });
  }

  getHistory(): HistoryEntry[] {
    return [...this._history];
  }
}
