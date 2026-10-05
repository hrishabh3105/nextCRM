# Load Test V1 Review

## 1. The load-test branch in sendTemplateMessage and the production guard at module load in metaClient.ts

### Production Guard at Module Load
```typescript
import crypto from "crypto";
import { ApiError } from "../apiError";

/**
 * Safety Guard: Refuse to start if LOAD_TEST_MODE is enabled in production.
 *
 * Why this guard exists:
 * LOAD_TEST_MODE bypasses real network calls to Meta's Graph API in sendTemplateMessage,
 * simulating message sending with synthetic IDs and simulated latency. If this mode
 * were accidentally enabled in a production environment, real customer notifications
 * would silently never be dispatched to WhatsApp, causing severe data inconsistency
 * and customer communication loss while pretending the messages were successfully sent.
 * Failing fast at startup prevents this catastrophic misconfiguration.
 */
if (process.env.LOAD_TEST_MODE === "true") {
  if (process.env.NODE_ENV === "production") {
    throw new Error("LOAD_TEST_MODE cannot be enabled in production! Refusing to start.");
  }
  console.warn("LOAD_TEST_MODE is ON — Meta sends are stubbed");
}

const META_GRAPH_BASE_URL = "https://graph.facebook.com/v20.0";
```

### sendTemplateMessage with Load-Test Stub Branch
```typescript
export async function sendTemplateMessage(params: {
  accessToken: string;
  phoneNumberId: string;
  to: string;
  templateName: string;
  language: string;
  variables: string[];
}): Promise<{ providerMessageId: string }> {
  if (process.env.LOAD_TEST_MODE === "true") {
    const minLatency = process.env.LOAD_TEST_MIN_LATENCY_MS
      ? parseInt(process.env.LOAD_TEST_MIN_LATENCY_MS, 10) || 40
      : 40;
    const maxLatency = process.env.LOAD_TEST_MAX_LATENCY_MS
      ? parseInt(process.env.LOAD_TEST_MAX_LATENCY_MS, 10) || 120
      : 120;
    const low = Math.min(minLatency, maxLatency);
    const high = Math.max(minLatency, maxLatency);
    const latency = Math.floor(Math.random() * (high - low + 1)) + low;

    await new Promise((resolve) => setTimeout(resolve, latency));

    return {
      providerMessageId: `wamid.LOADTEST.${crypto.randomUUID()}`,
    };
  }

  const { accessToken, phoneNumberId, to, templateName, language, variables } = params;

  const components =
    variables.length > 0
      ? [
          {
            type: "body",
            parameters: variables.map((variable) => ({
              type: "text",
              variable: undefined,
              text: variable,
            })),
          },
        ]
      : [];

  const response = await fetch(`${META_GRAPH_BASE_URL}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "template",
      template: {
        name: templateName,
        language: {
          code: language,
        },
        components,
      },
    }),
  });

  const data = (await response.json().catch(() => ({}))) as any;

  if (!response.ok) {
    handleMetaError(data);
  }

  const providerMessageId = data?.messages?.[0]?.id || data?.id;

  if (!providerMessageId) {
    throw new ApiError(502, "Meta response missing message ID", data);
  }

  return {
    providerMessageId,
  };
}
```

---

## 2. The updated concurrency/limiter lines in sendMessageWorker.ts, plus the ORIGINAL hardcoded values you replaced

### Original Hardcoded Values Replaced
Prior to this change, concurrency was omitted from BullMQ's `WorkerOptions` (defaulting to BullMQ's default of `1`), and the limiter was hardcoded to `max: 20, duration: 1000`:
```typescript
// ORIGINAL code from apps/worker/src/queues/sendMessageWorker.ts
export const sendMessageWorker = new Worker<SendMessageJobData>(
  SEND_MESSAGE_QUEUE,
  async (job: Job<SendMessageJobData>) => {
    // ...
  },
  {
    connection: redisConnection,
    limiter: {
      max: 20,
      duration: 1000,
    },
  }
);
```

### Updated Configurable Implementation
```typescript
// Configurable constants with exact hardcoded fallback defaults
const DEFAULT_CONCURRENCY = 1;
const DEFAULT_RATE_LIMIT_PER_SEC = 20;

const parsedConcurrency = process.env.SEND_MESSAGE_CONCURRENCY
  ? parseInt(process.env.SEND_MESSAGE_CONCURRENCY, 10)
  : NaN;
const concurrency =
  !Number.isNaN(parsedConcurrency) && parsedConcurrency > 0
    ? parsedConcurrency
    : DEFAULT_CONCURRENCY;

const parsedRateLimit = process.env.SEND_RATE_LIMIT_PER_SEC
  ? parseInt(process.env.SEND_RATE_LIMIT_PER_SEC, 10)
  : NaN;
const rateLimitMax =
  !Number.isNaN(parsedRateLimit) && parsedRateLimit > 0
    ? parsedRateLimit
    : DEFAULT_RATE_LIMIT_PER_SEC;

console.log(
  `[send-message] Worker startup configuration: concurrency=${concurrency}, rateLimitMax=${rateLimitMax}/s`
);

export const sendMessageWorker = new Worker<SendMessageJobData>(
  SEND_MESSAGE_QUEUE,
  async (job: Job<SendMessageJobData>) => {
    // ...
  },
  {
    connection: redisConnection,
    concurrency,
    limiter: {
      max: rateLimitMax,
      duration: 1000,
    },
  }
);
```

---

## 3. seedLoadTest.ts in full, including the --reset deletion logic and the exact-name workspace check

```typescript
// NOTE: import "dotenv/config" MUST be the very first import before any modules that
// initialize database or network connections (such as @nextcrm/db), because @nextcrm/db
// reads process.env.DATABASE_URL immediately at module load time when instantiating PrismaPg.
import "dotenv/config";

import { prisma } from "@nextcrm/db";
import { encryptToken } from "@nextcrm/core";
import { hashPassword } from "../utils/password";

const TARGET_WORKSPACE_NAME = "Load Test Workspace";
const USER_EMAIL = "loadtest@example.com";
const USER_PASSWORD = "Password123!";

async function main() {
  // 1. Safety Guard: Refuse to run in production
  if (process.env.NODE_ENV === "production") {
    console.error("FATAL: Refusing to run seedLoadTest script in production (NODE_ENV=production).");
    process.exit(1);
  }

  // 2. Parse CLI arguments
  const args = process.argv.slice(2);
  const isReset = args.includes("--reset");

  let contactCount = 1000;
  const countFlagIndex = args.findIndex((arg) => arg === "--count" || arg === "-c");
  if (countFlagIndex !== -1 && args[countFlagIndex + 1]) {
    const parsed = parseInt(args[countFlagIndex + 1], 10);
    if (!Number.isNaN(parsed) && parsed > 0) {
      contactCount = parsed;
    }
  } else {
    const numericArg = args.find((arg) => !arg.startsWith("--") && /^\d+$/.test(arg));
    if (numericArg) {
      const parsed = parseInt(numericArg, 10);
      if (!Number.isNaN(parsed) && parsed > 0) {
        contactCount = parsed;
      }
    }
  }

  console.log(`[seed] Starting seedLoadTest with contactCount=${contactCount}, reset=${isReset}`);

  // 3. Handle --reset flag or existing workspace check
  const existingWorkspaces = await prisma.workspace.findMany({
    where: { name: TARGET_WORKSPACE_NAME },
  });

  if (isReset) {
    for (const ws of existingWorkspaces) {
      // Abort check: verify the workspace name matches exactly
      if (ws.name !== TARGET_WORKSPACE_NAME) {
        throw new Error(
          `Safety abort: Workspace name '${ws.name}' does not match expected target '${TARGET_WORKSPACE_NAME}'. Aborting immediately to prevent accidental data deletion.`
        );
      }

      console.log(`[reset] Purging all data for '${ws.name}' (${ws.id}) in dependency-safe order...`);

      // Deletion order respecting foreign key dependencies:
      // 1. Message costs (workspaceId)
      const deletedCosts = await prisma.messageCost.deleteMany({
        where: { workspaceId: ws.id },
      });
      console.log(`[reset] Deleted ${deletedCosts.count} message costs`);

      // 2. Messages (depend on conversations, contacts, workspace)
      const deletedMessages = await prisma.message.deleteMany({
        where: { workspaceId: ws.id },
      });
      console.log(`[reset] Deleted ${deletedMessages.count} messages`);

      // 3. Conversations (depend on contacts, channels, workspace)
      const deletedConversations = await prisma.conversation.deleteMany({
        where: { workspaceId: ws.id },
      });
      console.log(`[reset] Deleted ${deletedConversations.count} conversations`);

      // 4. Campaign Recipients (depend on campaigns and contacts)
      const wsCampaigns = await prisma.campaign.findMany({
        where: { workspaceId: ws.id },
        select: { id: true },
      });
      const wsCampaignIds = wsCampaigns.map((c) => c.id);
      if (wsCampaignIds.length > 0) {
        const deletedRecipients = await prisma.campaignRecipient.deleteMany({
          where: { campaignId: { in: wsCampaignIds } },
        });
        console.log(`[reset] Deleted ${deletedRecipients.count} campaign recipients`);
      }

      // 5. Campaigns (depend on templates, channels, workspace)
      const deletedCampaigns = await prisma.campaign.deleteMany({
        where: { workspaceId: ws.id },
      });
      console.log(`[reset] Deleted ${deletedCampaigns.count} campaigns`);

      // 6. Journey data: JourneyRun -> JourneyVersion -> Journey
      const deletedRuns = await prisma.journeyRun.deleteMany({
        where: { workspaceId: ws.id },
      });
      console.log(`[reset] Deleted ${deletedRuns.count} journey runs`);

      const wsJourneys = await prisma.journey.findMany({
        where: { workspaceId: ws.id },
        select: { id: true },
      });
      const wsJourneyIds = wsJourneys.map((j) => j.id);
      if (wsJourneyIds.length > 0) {
        const deletedVersions = await prisma.journeyVersion.deleteMany({
          where: { journeyId: { in: wsJourneyIds } },
        });
        console.log(`[reset] Deleted ${deletedVersions.count} journey versions`);
      }

      const deletedJourneys = await prisma.journey.deleteMany({
        where: { workspaceId: ws.id },
      });
      console.log(`[reset] Deleted ${deletedJourneys.count} journeys`);

      // 7. Store records (Orders, Carts, StoreConnections) if any exist
      const deletedOrders = await prisma.order.deleteMany({
        where: { workspaceId: ws.id },
      });
      if (deletedOrders.count > 0) {
        console.log(`[reset] Deleted ${deletedOrders.count} orders`);
      }

      const deletedCarts = await prisma.cart.deleteMany({
        where: { workspaceId: ws.id },
      });
      if (deletedCarts.count > 0) {
        console.log(`[reset] Deleted ${deletedCarts.count} carts`);
      }

      const deletedStores = await prisma.storeConnection.deleteMany({
        where: { workspaceId: ws.id },
      });
      if (deletedStores.count > 0) {
        console.log(`[reset] Deleted ${deletedStores.count} store connections`);
      }

      // 8. Templates (depend on channels and workspace)
      const deletedTemplates = await prisma.template.deleteMany({
        where: { workspaceId: ws.id },
      });
      console.log(`[reset] Deleted ${deletedTemplates.count} templates`);

      // 9. Channels (depend on workspace)
      const deletedChannels = await prisma.channel.deleteMany({
        where: { workspaceId: ws.id },
      });
      console.log(`[reset] Deleted ${deletedChannels.count} channels`);

      // 10. Contacts (depend on workspace)
      const deletedContacts = await prisma.contact.deleteMany({
        where: { workspaceId: ws.id },
      });
      console.log(`[reset] Deleted ${deletedContacts.count} contacts`);

      // 11. Memberships (depend on users and workspace)
      const deletedMemberships = await prisma.membership.deleteMany({
        where: { workspaceId: ws.id },
      });
      console.log(`[reset] Deleted ${deletedMemberships.count} memberships`);

      // 12. Workspace
      await prisma.workspace.delete({
        where: { id: ws.id },
      });
      console.log(`[reset] Deleted workspace '${ws.name}' (${ws.id})`);
    }
  } else if (existingWorkspaces.length > 0) {
    console.error(
      `Workspace '${TARGET_WORKSPACE_NAME}' already exists (${existingWorkspaces.length} found). Pass --reset to delete and re-seed.`
    );
    process.exit(1);
  }

  // 4. Create Workspace
  console.log(`[seed] Creating workspace '${TARGET_WORKSPACE_NAME}'...`);
  const workspace = await prisma.workspace.create({
    data: {
      name: TARGET_WORKSPACE_NAME,
    },
  });

  // 5. Create User & Owner Membership
  console.log(`[seed] Creating user '${USER_EMAIL}' with owner membership...`);
  const passwordHash = await hashPassword(USER_PASSWORD);

  const user = await prisma.user.upsert({
    where: { email: USER_EMAIL },
    update: { passwordHash },
    create: {
      email: USER_EMAIL,
      passwordHash,
    },
  });

  await prisma.membership.create({
    data: {
      userId: user.id,
      workspaceId: workspace.id,
      role: "owner",
    },
  });

  // 6. Create Channel
  console.log(`[seed] Creating WhatsApp Meta channel...`);
  const channel = await prisma.channel.create({
    data: {
      workspaceId: workspace.id,
      type: "whatsapp",
      provider: "meta",
      wabaId: "1234567890_fake_waba",
      phoneNumberId: "1234567890_fake_phone_number_id",
      phoneNumber: "+919900000000",
      status: "connected",
      accessTokenEnc: encryptToken("dummy-token"),
    },
  });

  // 7. Create Template
  console.log(`[seed] Creating approved utility template without placeholders...`);
  const template = await prisma.template.create({
    data: {
      workspaceId: workspace.id,
      channelId: channel.id,
      providerName: "load_test_notification",
      providerTemplateId: "1234567890_fake_template_id",
      language: "en_US",
      category: "utility",
      bodyPreview: "Hello! This is a load test utility message without placeholders.",
      status: "approved",
      variableCount: 0,
      placeholders: [],
      positionalPlaceholders: [],
    },
  });

  // 8. Create N Contacts
  console.log(`[seed] Seeding ${contactCount} contacts with unique phone numbers...`);
  const BATCH_SIZE = 500;
  const now = new Date();
  const padLength = Math.max(5, String(contactCount).length);

  for (let i = 0; i < contactCount; i += BATCH_SIZE) {
    const batch = [];
    const end = Math.min(i + BATCH_SIZE, contactCount);
    for (let j = i; j < end; j++) {
      const indexStr = String(j + 1).padStart(padLength, "0");
      const phone = `+9199000${indexStr}`;
      batch.push({
        workspaceId: workspace.id,
        phone,
        name: `Load Test Contact ${indexStr}`,
        optedInAt: now,
      });
    }
    await prisma.contact.createMany({
      data: batch,
    });
  }

  console.log(`[seed] Successfully created ${contactCount} contacts.`);

  // 9. Print required summary details
  console.log("\n========================================================");
  console.log("            LOAD TEST SEED COMPLETED");
  console.log("========================================================");
  console.log(`Workspace ID:    ${workspace.id}`);
  console.log(`Channel ID:      ${channel.id}`);
  console.log(`Template ID:     ${template.id}`);
  console.log(`Login Email:     ${USER_EMAIL}`);
  console.log(`Login Password:  ${USER_PASSWORD}`);
  console.log(`Contact Count:   ${contactCount}`);
  console.log("========================================================\n");
}

main()
  .catch((err) => {
    console.error("FATAL ERROR in seedLoadTest:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
```

---

## 4. The actual terminal output of the safety guard test, covering both LOAD_TEST_MODE=true with NODE_ENV=production and LOAD_TEST_MODE=true with NODE_ENV=development

### Test 1: `LOAD_TEST_MODE=true` with `NODE_ENV=production`
```bash
$ npx tsx -e "process.env.LOAD_TEST_MODE='true'; process.env.NODE_ENV='production'; try { require('./packages/core/src/services/metaClient.ts'); console.log('ERROR: should not reach here'); } catch (err) { console.log('Caught expected error:', err.message); process.exit(0); }"
```
**Terminal Output:**
```
Caught expected error: LOAD_TEST_MODE cannot be enabled in production! Refusing to start.
```

### Test 2: `LOAD_TEST_MODE=true` with `NODE_ENV=development`
```bash
$ npx tsx -e "process.env.LOAD_TEST_MODE='true'; process.env.NODE_ENV='development'; const { sendTemplateMessage } = require('./packages/core/src/services/metaClient.ts'); sendTemplateMessage({ accessToken: 'test', phoneNumberId: '123', to: '+1234567890', templateName: 't', language: 'en_US', variables: [] }).then(res => { console.log('sendTemplateMessage result:', res); process.exit(0); });"
```
**Terminal Output:**
```
LOAD_TEST_MODE is ON — Meta sends are stubbed
sendTemplateMessage result: {
  providerMessageId: 'wamid.LOADTEST.134826bd-9b71-4636-bcea-70547d6c8ec1'
}
```

---

## 5. The tsc --noEmit results for packages/core, apps/api and apps/worker

### 1. `packages/core`
```bash
$ cd packages/core
$ npx tsc --noEmit
```
**Exit Code:** `0`  
**Output:** (clean, no errors)

### 2. `apps/worker`
```bash
$ cd apps/worker
$ npx tsc --noEmit
```
**Exit Code:** `0`  
**Output:** (clean, no errors)

### 3. `apps/api`
```bash
$ cd apps/api
$ npx tsc --noEmit
```
**Exit Code:** `0`  
**Output:** (clean, no errors)
