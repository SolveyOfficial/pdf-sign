/** An error with a message meant for the user, not a bug. */
export class UserError extends Error {
  override name = "UserError";
}
