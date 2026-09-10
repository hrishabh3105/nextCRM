export interface AuthTokenPayload {
  userId: string;
  workspaceId: string;
  role: "owner" | "agent";
}
