import { createError } from "h3";
import {
  assertLocalSession,
  assertSameOrigin,
} from "../../utils/local-session";
import { selectLocalProjectDirectory } from "../../utils/directory-picker";

let pickerPending = false;

export default defineEventHandler(async (event) => {
  assertSameOrigin(event);
  assertLocalSession(event);
  if (pickerPending) {
    throw createError({
      statusCode: 409,
      statusMessage: "A folder picker is already open.",
    });
  }
  pickerPending = true;
  try {
    return await selectLocalProjectDirectory();
  } catch (error) {
    throw createError({
      statusCode: 501,
      statusMessage:
        error instanceof Error
          ? error.message
          : "The native folder picker is unavailable.",
    });
  } finally {
    pickerPending = false;
  }
});
