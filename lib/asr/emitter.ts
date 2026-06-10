import type { ASRError, ErrorSubscriber, ResultSubscriber, VoidSubscriber } from "./types";

/*
  Shared subscriber bookkeeping for ASR engines. Engines extend this and call
  the protected `emit*` helpers; the public `on*`/`cleanup` surface is identical
  across engines.
*/
export abstract class ASREmitter {
  private startSubscribers: VoidSubscriber[] = [];
  private resultSubscribers: ResultSubscriber[] = [];
  private errorSubscribers: ErrorSubscriber[] = [];
  private endSubscribers: VoidSubscriber[] = [];

  onstart(subscriber: VoidSubscriber): void {
    this.startSubscribers.push(subscriber);
  }

  onresult(subscriber: ResultSubscriber): void {
    this.resultSubscribers.push(subscriber);
  }

  onerror(subscriber: ErrorSubscriber): void {
    this.errorSubscribers.push(subscriber);
  }

  onend(subscriber: VoidSubscriber): void {
    this.endSubscribers.push(subscriber);
  }

  cleanup(): void {
    this.startSubscribers = [];
    this.resultSubscribers = [];
    this.errorSubscribers = [];
    this.endSubscribers = [];
  }

  protected emitStart(): void {
    for (const subscriber of this.startSubscribers) subscriber();
  }

  protected emitResult(finalTranscript: string, interimTranscript: string): void {
    for (const subscriber of this.resultSubscribers) subscriber(finalTranscript, interimTranscript);
  }

  protected emitError(error: ASRError): void {
    for (const subscriber of this.errorSubscribers) subscriber(error);
  }

  protected emitEnd(): void {
    for (const subscriber of this.endSubscribers) subscriber();
  }
}
