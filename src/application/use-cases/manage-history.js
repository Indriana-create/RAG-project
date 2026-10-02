export class GetHistory {
  constructor({ history }) { this.history = history; }
  execute({ sessionId }) { return this.history.list(sessionId); }
}

export class ClearHistory {
  constructor({ history }) { this.history = history; }
  execute({ sessionId }) { return this.history.clear(sessionId); }
}
