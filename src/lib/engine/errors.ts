/** Thrown by an engine function that has not been built yet. Actions catch it and show the message. */
export class EngineNotReadyError extends Error {
  constructor(feature: string) {
    super(`${feature} is not available yet.`);
    this.name = "EngineNotReadyError";
  }
}

/** A problem the person can act on, with a message written for them. */
export class EngineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EngineError";
  }
}
