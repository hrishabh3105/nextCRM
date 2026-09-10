/**
 * Custom application error class for throwing predictable HTTP errors.
 *
 * Example usage:
 * throw new ApiError(404, "Contact not found");
 * throw new ApiError(400, "email is required");
 */
export class ApiError extends Error {
  public statusCode: number;
  public details?: any;

  constructor(statusCode: number, message: string, details?: any) {
    super(message);
    this.name = "ApiError";
    this.statusCode = statusCode;
    this.details = details;

    // Restore prototype chain when extending built-in Error in TypeScript
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
