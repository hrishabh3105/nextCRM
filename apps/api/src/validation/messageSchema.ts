import { z } from "zod";

export const sendMessageSchema = z.object({
  body: z.string().min(1).max(4096, "message body cannot exceed 4096 characters"),
});

export type SendMessageInput = z.infer<typeof sendMessageSchema>;
