export class HttpError extends Error {
  constructor(statusCode, message, errors = undefined) {
    super(message);
    this.name = 'HttpError';
    this.statusCode = statusCode;

    if (errors !== undefined) {
      this.errors = errors;
    }
  }
}
