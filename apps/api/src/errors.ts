/**
 * An error whose `message` is safe to show to the client.
 * Anything sensitive (upstream response bodies, stack traces) belongs in
 * `cause`, which is only ever written to the server log.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "ApiError";
  }
}
