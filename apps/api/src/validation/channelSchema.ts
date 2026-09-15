import { z } from "zod";

/**
 * Validation schema for creating a new Channel.
 * Note: accessToken is received as the raw plaintext token from the client.
 * Encryption happens in the route handler prior to saving in the database.
 */
export const createChannelSchema = z.object({
  type: z.enum(["whatsapp", "sms"]),
  provider: z.enum(["meta", "msg91"]),
  wabaId: z.string().optional(),
  phoneNumberId: z.string().optional(),
  phoneNumber: z.string().optional(),
  accessToken: z.string().min(1, "accessToken is required"),
});

export type CreateChannelInput = z.infer<typeof createChannelSchema>;
