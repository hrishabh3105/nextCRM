import {
  setMarketingConsent,
  evaluateSendPermission,
  isStopKeyword,
  isStartKeyword,
  normalizeKeywordText,
  getCustomerWhatsAppConsent,
  clearCustomerWhatsAppConsentCache,
  encryptToken,
} from "@nextcrm/core";
import { processShopifyConsent } from "../services/shopifyWebhookHandler";
import { handleInboundWebhookPayload } from "../services/inboundMessageHandler";

process.env.TOKEN_ENCRYPTION_KEY =
  process.env.TOKEN_ENCRYPTION_KEY ||
  "d745749bfe675659e856a67759176083b1eaffa7751d2b547b7fd22ac650ccd4";

function createMockDb(initialContact: any) {
  let contact = { ...initialContact };
  const consentEvents: any[] = [];
  const messages: any[] = [];
  let conversation: any = {
    id: "conv1",
    contactId: contact.id,
    channelId: "ch1",
    status: "open",
    lastInboundAt: null,
    windowExpiresAt: null,
  };
  const savedProviderMessageIds = new Set<string>();

  const db: any = {
    contact: {
      findUnique: async ({ where }: any) => {
        if (where.id === contact.id) return { ...contact };
        return null;
      },
      findFirst: async ({ where }: any) => {
        if (where.id === contact.id || where.phone === contact.phone) return { ...contact };
        return null;
      },
      create: async ({ data }: any) => {
        contact = { id: data.id || "c1", ...data };
        return { ...contact };
      },
      update: async ({ where, data }: any) => {
        if (where.id === contact.id) {
          contact = { ...contact, ...data };
          return { ...contact };
        }
        throw new Error("Contact not found");
      },
    },
    conversation: {
      findFirst: async () => (conversation ? { ...conversation } : null),
      create: async ({ data }: any) => {
        conversation = { id: "conv1", ...data };
        return { ...conversation };
      },
      update: async ({ data }: any) => {
        conversation = { ...conversation, ...data };
        return { ...conversation };
      },
    },
    message: {
      create: async ({ data }: any) => {
        if (savedProviderMessageIds.has(data.providerMessageId)) {
          const err: any = new Error("Unique constraint failed on the fields: (`workspaceId`,`providerMessageId`)");
          err.code = "P2002";
          throw err;
        }
        const row = { id: `msg_${messages.length + 1}`, ...data };
        messages.push(row);
        savedProviderMessageIds.add(data.providerMessageId);
        return { ...row };
      },
      findMany: async () => [...messages],
    },
    workspace: {
      findUnique: async () => ({ id: "w1", name: "Mock Store" }),
    },
    consentEvent: {
      create: async ({ data }: any) => {
        const row = {
          id: `event_${consentEvents.length + 1}`,
          createdAt: data.createdAt ?? new Date(),
          occurredAt: data.occurredAt ?? null,
          ...data,
        };
        consentEvents.push(row);
        return { ...row };
      },
    },
    $transaction: async (fn: any) => {
      return await fn(db);
    },
    _getContact: () => contact,
    _getEvents: () => consentEvents,
    _getMessages: () => messages,
    _getConversation: () => conversation,
    _addExistingMessageId: (id: string) => savedProviderMessageIds.add(id),
  };

  return db;
}

async function runTests() {
  console.log("=== Running Marketing Consent Verification Tests ===\n");
  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, details?: string) {
    if (condition) {
      console.log(`[PASS] ${testName}`);
      passed++;
    } else {
      console.error(`[FAIL] ${testName} ${details ? "- " + details : ""}`);
      failed++;
    }
  }

  // 1. Shopify order subscribed + setting true -> OPTED_IN
  {
    const db = createMockDb({
      id: "c1",
      workspaceId: "w1",
      phone: "+15551234567",
      marketingConsentStatus: "UNKNOWN",
    });

    await processShopifyConsent({
      db,
      contactId: "c1",
      contactPhone: "+15551234567",
      payload: {
        customer: {
          sms_marketing_consent: {
            state: "subscribed",
            opt_in_level: "single_opt_in",
            consent_updated_at: "2026-10-06T12:00:00Z",
          },
        },
      },
      storeConnection: {
        treatShopifySmsAsWhatsappConsent: true,
        shopDomain: "test-shop.myshopify.com",
      },
    });

    const c = db._getContact();
    const events = db._getEvents();
    assert(
      c.marketingConsentStatus === "OPTED_IN" &&
        c.marketingConsentSource === "SHOPIFY_SMS" &&
        events.length === 1 &&
        events[0].status === "OPTED_IN",
      "Shopify order subscribed + setting true -> OPTED_IN",
      `Actual status: ${c.marketingConsentStatus}, events: ${events.length}`
    );
  }

  // 2. Shopify order subscribed + setting false -> no change
  {
    const db = createMockDb({
      id: "c2",
      workspaceId: "w1",
      phone: "+15551234567",
      marketingConsentStatus: "UNKNOWN",
    });

    await processShopifyConsent({
      db,
      contactId: "c2",
      contactPhone: "+15551234567",
      payload: {
        customer: {
          sms_marketing_consent: {
            state: "subscribed",
            opt_in_level: "single_opt_in",
          },
        },
      },
      storeConnection: {
        treatShopifySmsAsWhatsappConsent: false,
        shopDomain: "test-shop.myshopify.com",
      },
    });

    const c = db._getContact();
    const events = db._getEvents();
    assert(
      c.marketingConsentStatus === "UNKNOWN" &&
        events.length === 1 &&
        events[0].evidence?.ignoredDueToSetting === true,
      "Shopify order subscribed + setting false -> no change",
      `Actual status: ${c.marketingConsentStatus}, events: ${events.length}`
    );
  }

  // 3. not_subscribed on an OPTED_IN contact -> stays OPTED_IN
  {
    const db = createMockDb({
      id: "c3",
      workspaceId: "w1",
      phone: "+15551234567",
      marketingConsentStatus: "OPTED_IN",
      marketingConsentSource: "MANUAL",
    });

    await processShopifyConsent({
      db,
      contactId: "c3",
      contactPhone: "+15551234567",
      payload: {
        customer: {
          sms_marketing_consent: {
            state: "not_subscribed",
          },
        },
      },
      storeConnection: {
        treatShopifySmsAsWhatsappConsent: true,
      },
    });

    const c = db._getContact();
    const events = db._getEvents();
    assert(
      c.marketingConsentStatus === "OPTED_IN" && events.length === 0,
      "not_subscribed on an OPTED_IN contact -> stays OPTED_IN",
      `Actual status: ${c.marketingConsentStatus}, events: ${events.length}`
    );
  }

  // 4. unsubscribed -> OPTED_OUT even with setting false
  {
    const db = createMockDb({
      id: "c4",
      workspaceId: "w1",
      phone: "+15551234567",
      marketingConsentStatus: "OPTED_IN",
      marketingConsentSource: "MANUAL",
    });

    await processShopifyConsent({
      db,
      contactId: "c4",
      contactPhone: "+15551234567",
      payload: {
        customer: {
          sms_marketing_consent: {
            state: "unsubscribed",
          },
        },
      },
      storeConnection: {
        treatShopifySmsAsWhatsappConsent: false,
      },
    });

    const c = db._getContact();
    const events = db._getEvents();
    assert(
      c.marketingConsentStatus === "OPTED_OUT" &&
        c.marketingConsentSource === "SHOPIFY_SMS" &&
        events.length === 1 &&
        events[0].status === "OPTED_OUT",
      "unsubscribed -> OPTED_OUT even with setting false",
      `Actual status: ${c.marketingConsentStatus}, events: ${events.length}`
    );
  }

  // 5. Shopify subscribed after OPTED_OUT -> stays OPTED_OUT
  {
    const db = createMockDb({
      id: "c5",
      workspaceId: "w1",
      phone: "+15551234567",
      marketingConsentStatus: "OPTED_OUT",
      marketingConsentSource: "INBOUND_STOP",
    });

    await processShopifyConsent({
      db,
      contactId: "c5",
      contactPhone: "+15551234567",
      payload: {
        customer: {
          sms_marketing_consent: {
            state: "subscribed",
          },
        },
      },
      storeConnection: {
        treatShopifySmsAsWhatsappConsent: true,
      },
    });

    const c = db._getContact();
    const events = db._getEvents();
    assert(
      c.marketingConsentStatus === "OPTED_OUT" && events.length === 0,
      "Shopify subscribed after OPTED_OUT -> stays OPTED_OUT",
      `Actual status: ${c.marketingConsentStatus}, events: ${events.length}`
    );
  }

  // 6. consent phone differs from resolved phone -> no grant
  {
    const db = createMockDb({
      id: "c6",
      workspaceId: "w1",
      phone: "+15551234567",
      marketingConsentStatus: "UNKNOWN",
    });

    await processShopifyConsent({
      db,
      contactId: "c6",
      contactPhone: "+15551234567",
      payload: {
        customer: {
          sms_marketing_phone: "+15559998888",
          sms_marketing_consent: {
            state: "subscribed",
          },
        },
      },
      storeConnection: {
        treatShopifySmsAsWhatsappConsent: true,
      },
    });

    const c = db._getContact();
    const events = db._getEvents();
    assert(
      c.marketingConsentStatus === "UNKNOWN" &&
        events.length === 1 &&
        events[0].evidence?.phoneMismatch === true,
      "consent phone differs from resolved phone -> no grant",
      `Actual status: ${c.marketingConsentStatus}, events: ${events.length}`
    );
  }

  // 7. evaluateSendPermission matrix
  {
    // MARKETING + campaign + UNKNOWN -> blocked
    const r1 = evaluateSendPermission({
      contact: { marketingConsentStatus: "UNKNOWN" },
      template: { category: "marketing" },
      context: "campaign",
    });
    assert(
      !r1.allowed && r1.reason === "NO_MARKETING_CONSENT",
      "evaluateSendPermission: MARKETING + campaign + UNKNOWN blocked"
    );

    // MARKETING + campaign + OPTED_IN -> allowed
    const r2 = evaluateSendPermission({
      contact: { marketingConsentStatus: "OPTED_IN" },
      template: { category: "marketing" },
      context: "campaign",
    });
    assert(
      r2.allowed && !r2.reason,
      "evaluateSendPermission: MARKETING + campaign + OPTED_IN allowed"
    );

    // MARKETING + abandoned_cart + UNKNOWN -> allowed
    const r3 = evaluateSendPermission({
      contact: { marketingConsentStatus: "UNKNOWN" },
      template: { category: "marketing" },
      context: "journey_abandoned_cart",
    });
    assert(
      r3.allowed,
      "evaluateSendPermission: MARKETING + abandoned_cart + UNKNOWN allowed"
    );

    // MARKETING + abandoned_cart + OPTED_OUT -> blocked
    const r4 = evaluateSendPermission({
      contact: { marketingConsentStatus: "OPTED_OUT" },
      template: { category: "marketing" },
      context: "journey_abandoned_cart",
    });
    assert(
      !r4.allowed && r4.reason === "OPTED_OUT",
      "evaluateSendPermission: MARKETING + abandoned_cart + OPTED_OUT blocked"
    );

    // UTILITY + OPTED_OUT -> allowed
    const r5 = evaluateSendPermission({
      contact: { marketingConsentStatus: "OPTED_OUT" },
      template: { category: "utility" },
      context: "campaign",
    });
    assert(
      r5.allowed,
      "evaluateSendPermission: UTILITY + OPTED_OUT allowed"
    );

    // AUTHENTICATION + OPTED_OUT -> allowed
    const r6 = evaluateSendPermission({
      contact: { marketingConsentStatus: "OPTED_OUT" },
      template: { category: "authentication" },
      context: "campaign",
    });
    assert(
      r6.allowed,
      "evaluateSendPermission: AUTHENTICATION + OPTED_OUT allowed"
    );
  }

  // 8. STOP / START keyword normalization
  {
    assert(isStopKeyword("Stop."), 'isStopKeyword("Stop.") is true');
    assert(isStopKeyword(" STOP "), 'isStopKeyword(" STOP ") is true');
    assert(isStopKeyword("unsubscribe"), 'isStopKeyword("unsubscribe") is true');
    assert(isStopKeyword("stop please"), 'isStopKeyword("stop please") is true (fuzzy <= 4 words)');
    assert(isStopKeyword("stop messaging"), 'isStopKeyword("stop messaging") is true');
    assert(isStopKeyword("opt out"), 'isStopKeyword("opt out") is true');
    assert(isStopKeyword("optout"), 'isStopKeyword("optout") is true');
    assert(isStopKeyword("opt-out"), 'isStopKeyword("opt-out") is true');
    assert(isStopKeyword("cancel"), 'isStopKeyword("cancel") is true (exact match)');
    assert(isStopKeyword("end"), 'isStopKeyword("end") is true (exact match)');

    // Negative STOP cases
    assert(!isStopKeyword("please stop messaging me"), 'isStopKeyword("please stop messaging me") (5 words) is false');
    assert(!isStopKeyword("don't stop"), 'isStopKeyword("don\'t stop") is false (negated)');
    assert(!isStopKeyword("do not stop"), 'isStopKeyword("do not stop") is false (negated)');
    assert(!isStopKeyword("cancel my order"), 'isStopKeyword("cancel my order") is false (cancel not fuzzy)');

    // START cases (strict exact match)
    assert(isStartKeyword("start"), 'isStartKeyword("start") is true');
    assert(isStartKeyword(" START! "), 'isStartKeyword(" START! ") is true');
    assert(isStartKeyword("subscribe"), 'isStartKeyword("subscribe") is true');
    assert(isStartKeyword("opt in"), 'isStartKeyword("opt in") is true');
    assert(isStartKeyword("optin"), 'isStartKeyword("optin") is true');
    assert(isStartKeyword("opt-in"), 'isStartKeyword("opt-in") is true');
    assert(!isStartKeyword("yes"), 'isStartKeyword("yes") is false (not included)');
    assert(!isStartKeyword("start now please"), 'isStartKeyword("start now please") is false');
  }

  // 9. repeated identical setMarketingConsent call creates no second ConsentEvent
  {
    const db = createMockDb({
      id: "c9",
      workspaceId: "w1",
      marketingConsentStatus: "UNKNOWN",
      marketingConsentSource: null,
    });

    const res1 = await setMarketingConsent(db, {
      contactId: "c9",
      status: "OPTED_IN",
      source: "MANUAL",
    });

    const eventsAfter1 = db._getEvents().length;

    const res2 = await setMarketingConsent(db, {
      contactId: "c9",
      status: "OPTED_IN",
      source: "MANUAL",
    });

    const eventsAfter2 = db._getEvents().length;

    assert(
      res1.updated === true && res2.updated === false && eventsAfter1 === 1 && eventsAfter2 === 1,
      "repeated identical setMarketingConsent call creates no second ConsentEvent",
      `res1: ${res1.updated}, res2: ${res2.updated}, events1: ${eventsAfter1}, events2: ${eventsAfter2}`
    );
  }

  // 10. FIX 1: Shopify-sourced consent change creates an event whose created_at is ~now and occurred_at is the supplied consent time
  {
    const db = createMockDb({
      id: "c_shopify_time",
      workspaceId: "w1",
      phone: "+15551234567",
      marketingConsentStatus: "UNKNOWN",
    });

    const historicalConsentTime = "2026-09-21T12:00:00.000Z";
    const beforeCall = Date.now();

    await processShopifyConsent({
      db,
      contactId: "c_shopify_time",
      contactPhone: "+15551234567",
      payload: {
        customer: {
          sms_marketing_consent: {
            state: "subscribed",
            opt_in_level: "single_opt_in",
            consent_updated_at: historicalConsentTime,
          },
        },
      },
      storeConnection: {
        treatShopifySmsAsWhatsappConsent: true,
        shopDomain: "test-shop.myshopify.com",
      },
    });

    const afterCall = Date.now();
    const events = db._getEvents();

    assert(events.length === 1, "Shopify consent creates 1 event");
    const event = events[0];
    const eventCreatedMs =
      event.createdAt instanceof Date ? event.createdAt.getTime() : new Date(event.createdAt).getTime();
    const eventOccurredIso =
      event.occurredAt instanceof Date ? event.occurredAt.toISOString() : new Date(event.occurredAt).toISOString();

    const isCreatedNow = eventCreatedMs >= beforeCall - 1000 && eventCreatedMs <= afterCall + 1000;
    const isOccurredHistorical = eventOccurredIso === new Date(historicalConsentTime).toISOString();

    assert(
      isCreatedNow && isOccurredHistorical,
      "Shopify consent event created_at is ~now and occurred_at is supplied consent time",
      `created_at: ${event.createdAt}, occurred_at: ${event.occurredAt}`
    );
  }

  // 11. WhatsApp SUBSCRIBED + phone match + setting FALSE -> OPTED_IN, source SHOPIFY_WHATSAPP
  {
    const db = createMockDb({
      id: "wa1",
      workspaceId: "w1",
      phone: "+15551234567",
      marketingConsentStatus: "UNKNOWN",
    });

    await processShopifyConsent({
      db,
      contactId: "wa1",
      contactPhone: "+15551234567",
      payload: {
        customer: {
          id: 1001,
        },
      },
      storeConnection: {
        treatShopifySmsAsWhatsappConsent: false,
        shopDomain: "test-shop.myshopify.com",
      },
      getWhatsAppConsent: async () => ({
        customerGid: "gid://shopify/Customer/1001",
        phoneNumber: "+15551234567",
        consent: {
          state: "SUBSCRIBED",
          optInLevel: "SINGLE_OPT_IN",
          updatedAt: "2026-10-08T10:00:00Z",
          collectedFrom: "SHOPIFY",
        },
        state: "SUBSCRIBED",
        optInLevel: "SINGLE_OPT_IN",
        updatedAt: "2026-10-08T10:00:00Z",
        collectedFrom: "SHOPIFY",
      }),
    });

    const c = db._getContact();
    const events = db._getEvents();
    assert(
      c.marketingConsentStatus === "OPTED_IN" &&
        c.marketingConsentSource === "SHOPIFY_WHATSAPP" &&
        events.length === 1 &&
        events[0].source === "SHOPIFY_WHATSAPP" &&
        events[0].status === "OPTED_IN",
      "WhatsApp SUBSCRIBED + phone match + setting FALSE -> OPTED_IN, source SHOPIFY_WHATSAPP",
      `Actual status: ${c.marketingConsentStatus}, source: ${c.marketingConsentSource}`
    );
  }

  // 12. WhatsApp SUBSCRIBED + phone mismatch -> no grant
  {
    const db = createMockDb({
      id: "wa2",
      workspaceId: "w1",
      phone: "+15551234567",
      marketingConsentStatus: "UNKNOWN",
    });

    await processShopifyConsent({
      db,
      contactId: "wa2",
      contactPhone: "+15551234567",
      payload: {
        customer: {
          id: 1002,
        },
      },
      storeConnection: {
        treatShopifySmsAsWhatsappConsent: false,
        shopDomain: "test-shop.myshopify.com",
      },
      getWhatsAppConsent: async () => ({
        customerGid: "gid://shopify/Customer/1002",
        phoneNumber: "+15559998888",
        consent: {
          state: "SUBSCRIBED",
          optInLevel: "SINGLE_OPT_IN",
          updatedAt: "2026-10-08T10:00:00Z",
          collectedFrom: "SHOPIFY",
        },
        state: "SUBSCRIBED",
        optInLevel: "SINGLE_OPT_IN",
        updatedAt: "2026-10-08T10:00:00Z",
        collectedFrom: "SHOPIFY",
      }),
    });

    const c = db._getContact();
    const events = db._getEvents();
    assert(
      c.marketingConsentStatus === "UNKNOWN" && events.length === 0,
      "WhatsApp SUBSCRIBED + phone mismatch -> no grant",
      `Actual status: ${c.marketingConsentStatus}, events: ${events.length}`
    );
  }

  // 13. WhatsApp UNSUBSCRIBED + phone match -> OPTED_OUT
  {
    const db = createMockDb({
      id: "wa3",
      workspaceId: "w1",
      phone: "+15551234567",
      marketingConsentStatus: "OPTED_IN",
      marketingConsentSource: "MANUAL",
    });

    await processShopifyConsent({
      db,
      contactId: "wa3",
      contactPhone: "+15551234567",
      payload: {
        customer: {
          id: 1003,
        },
      },
      storeConnection: {
        treatShopifySmsAsWhatsappConsent: true,
        shopDomain: "test-shop.myshopify.com",
      },
      getWhatsAppConsent: async () => ({
        customerGid: "gid://shopify/Customer/1003",
        phoneNumber: "+15551234567",
        consent: {
          state: "UNSUBSCRIBED",
          optInLevel: "SINGLE_OPT_IN",
          updatedAt: "2026-10-08T10:00:00Z",
          collectedFrom: "SHOPIFY",
        },
        state: "UNSUBSCRIBED",
        optInLevel: "SINGLE_OPT_IN",
        updatedAt: "2026-10-08T10:00:00Z",
        collectedFrom: "SHOPIFY",
      }),
    });

    const c = db._getContact();
    const events = db._getEvents();
    assert(
      c.marketingConsentStatus === "OPTED_OUT" &&
        c.marketingConsentSource === "SHOPIFY_WHATSAPP" &&
        events.length === 1 &&
        events[0].source === "SHOPIFY_WHATSAPP" &&
        events[0].status === "OPTED_OUT",
      "WhatsApp UNSUBSCRIBED + phone match -> OPTED_OUT",
      `Actual status: ${c.marketingConsentStatus}, source: ${c.marketingConsentSource}`
    );
  }

  // 14. WhatsApp NOT_SUBSCRIBED + SMS subscribed + setting TRUE -> falls back, OPTED_IN source SHOPIFY_SMS
  {
    const db = createMockDb({
      id: "wa4",
      workspaceId: "w1",
      phone: "+15551234567",
      marketingConsentStatus: "UNKNOWN",
    });

    await processShopifyConsent({
      db,
      contactId: "wa4",
      contactPhone: "+15551234567",
      payload: {
        customer: {
          id: 1004,
          sms_marketing_consent: {
            state: "subscribed",
            opt_in_level: "single_opt_in",
            consent_updated_at: "2026-10-06T12:00:00Z",
          },
        },
      },
      storeConnection: {
        treatShopifySmsAsWhatsappConsent: true,
        shopDomain: "test-shop.myshopify.com",
      },
      getWhatsAppConsent: async () => ({
        customerGid: "gid://shopify/Customer/1004",
        phoneNumber: "+15551234567",
        consent: {
          state: "NOT_SUBSCRIBED",
        },
        state: "NOT_SUBSCRIBED",
      }),
    });

    const c = db._getContact();
    const events = db._getEvents();
    assert(
      c.marketingConsentStatus === "OPTED_IN" &&
        c.marketingConsentSource === "SHOPIFY_SMS" &&
        events.length === 1 &&
        events[0].source === "SHOPIFY_SMS" &&
        events[0].status === "OPTED_IN",
      "WhatsApp NOT_SUBSCRIBED + SMS subscribed + setting TRUE -> falls back, OPTED_IN source SHOPIFY_SMS",
      `Actual status: ${c.marketingConsentStatus}, source: ${c.marketingConsentSource}`
    );
  }

  // 15. defaultPhoneNumber null -> falls back to SMS logic
  {
    const db = createMockDb({
      id: "wa5",
      workspaceId: "w1",
      phone: "+15551234567",
      marketingConsentStatus: "UNKNOWN",
    });

    await processShopifyConsent({
      db,
      contactId: "wa5",
      contactPhone: "+15551234567",
      payload: {
        customer: {
          id: 1005,
          sms_marketing_consent: {
            state: "subscribed",
            opt_in_level: "single_opt_in",
            consent_updated_at: "2026-10-06T12:00:00Z",
          },
        },
      },
      storeConnection: {
        treatShopifySmsAsWhatsappConsent: true,
        shopDomain: "test-shop.myshopify.com",
      },
      getWhatsAppConsent: async () => null,
    });

    const c = db._getContact();
    const events = db._getEvents();
    assert(
      c.marketingConsentStatus === "OPTED_IN" &&
        c.marketingConsentSource === "SHOPIFY_SMS" &&
        events.length === 1 &&
        events[0].source === "SHOPIFY_SMS",
      "defaultPhoneNumber null -> falls back to SMS logic",
      `Actual status: ${c.marketingConsentStatus}, source: ${c.marketingConsentSource}`
    );
  }

  // 16. lookup throws/returns null -> falls back, webhook path does not throw
  {
    const db = createMockDb({
      id: "wa6",
      workspaceId: "w1",
      phone: "+15551234567",
      marketingConsentStatus: "UNKNOWN",
    });

    let didThrow = false;
    try {
      await processShopifyConsent({
        db,
        contactId: "wa6",
        contactPhone: "+15551234567",
        payload: {
          customer: {
            id: 1006,
            sms_marketing_consent: {
              state: "subscribed",
              opt_in_level: "single_opt_in",
              consent_updated_at: "2026-10-06T12:00:00Z",
            },
          },
        },
        storeConnection: {
          treatShopifySmsAsWhatsappConsent: true,
          shopDomain: "test-shop.myshopify.com",
        },
        getWhatsAppConsent: async () => {
          throw new Error("Network timeout or GraphQL error");
        },
      });
    } catch {
      didThrow = true;
    }

    const c = db._getContact();
    const events = db._getEvents();
    assert(
      !didThrow &&
        c.marketingConsentStatus === "OPTED_IN" &&
        c.marketingConsentSource === "SHOPIFY_SMS" &&
        events.length === 1,
      "lookup throws/returns null -> falls back, webhook path does not throw",
      `didThrow: ${didThrow}, status: ${c.marketingConsentStatus}`
    );
  }

  // 17. contact OPTED_OUT via INBOUND_STOP + WhatsApp SUBSCRIBED -> stays OPTED_OUT and the lookup is NOT called
  {
    const db = createMockDb({
      id: "wa7",
      workspaceId: "w1",
      phone: "+15551234567",
      marketingConsentStatus: "OPTED_OUT",
      marketingConsentSource: "INBOUND_STOP",
    });

    let lookupCalled = false;
    await processShopifyConsent({
      db,
      contactId: "wa7",
      contactPhone: "+15551234567",
      payload: {
        customer: {
          id: 1007,
        },
      },
      storeConnection: {
        treatShopifySmsAsWhatsappConsent: true,
        shopDomain: "test-shop.myshopify.com",
      },
      getWhatsAppConsent: async () => {
        lookupCalled = true;
        return {
          customerGid: "gid://shopify/Customer/1007",
          phoneNumber: "+15551234567",
          consent: { state: "SUBSCRIBED" },
          state: "SUBSCRIBED",
        };
      },
    });

    const c = db._getContact();
    const events = db._getEvents();
    assert(
      !lookupCalled &&
        c.marketingConsentStatus === "OPTED_OUT" &&
        c.marketingConsentSource === "INBOUND_STOP" &&
        events.length === 0,
      "contact OPTED_OUT via INBOUND_STOP + WhatsApp SUBSCRIBED -> stays OPTED_OUT and the lookup is NOT called",
      `lookupCalled: ${lookupCalled}, status: ${c.marketingConsentStatus}`
    );
  }

  // 18. repeated identical lookups within TTL hit the cache
  {
    const originalFetch = globalThis.fetch;
    let fetchCalls = 0;
    globalThis.fetch = (async (url: any) => {
      fetchCalls++;
      const urlStr = String(url);
      if (urlStr.includes("/oauth/access_token")) {
        return new Response(
          JSON.stringify({
            access_token: "test_token",
            scope: "read_customers",
            expires_in: 86400,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      return new Response(
        JSON.stringify({
          data: {
            customer: {
              id: "gid://shopify/Customer/9999",
              defaultPhoneNumber: {
                phoneNumber: "+15551234567",
                whatsAppMarketingConsent: {
                  state: "SUBSCRIBED",
                  optInLevel: "SINGLE_OPT_IN",
                  updatedAt: "2026-10-08T10:00:00Z",
                  collectedFrom: "SHOPIFY",
                },
              },
            },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as any;

    const oldClientId = process.env.SHOPIFY_CLIENT_ID;
    const oldClientSecret = process.env.SHOPIFY_CLIENT_SECRET;
    process.env.SHOPIFY_CLIENT_ID = "mock_client_id";
    process.env.SHOPIFY_CLIENT_SECRET = "mock_client_secret";

    clearCustomerWhatsAppConsentCache();

    // Call 1: makes fetch calls
    const res1 = await getCustomerWhatsAppConsent("cache-test.myshopify.com", 9999);
    const callsAfterFirst = fetchCalls;

    // Call 2: repeated identical lookup within TTL hits cache (0 additional fetch calls)
    const res2 = await getCustomerWhatsAppConsent("cache-test.myshopify.com", 9999);
    const callsAfterSecond = fetchCalls;

    // Restore environment & fetch
    globalThis.fetch = originalFetch;
    process.env.SHOPIFY_CLIENT_ID = oldClientId;
    process.env.SHOPIFY_CLIENT_SECRET = oldClientSecret;

    assert(
      res1 !== null &&
        res2 !== null &&
        res1.state === "SUBSCRIBED" &&
        res2.state === "SUBSCRIBED" &&
        callsAfterSecond === callsAfterFirst &&
        callsAfterFirst > 0,
      "repeated identical lookups within TTL hit the cache",
      `Call 1 fetches: ${callsAfterFirst}, Call 2 fetches: ${callsAfterSecond}`
    );
  }

  // --- Helpers for inbound webhook deduplication tests ---
  function makeInboundPayload(providerMessageId: string, fromPhone: string, bodyText: string) {
    return {
      entry: [
        {
          id: "waba_123",
          changes: [
            {
              field: "messages",
              value: {
                messages: [
                  {
                    from: fromPhone,
                    id: providerMessageId,
                    text: { body: bodyText },
                  },
                ],
              },
            },
          ],
        },
      ],
    };
  }

  const mockChannel = {
    id: "ch1",
    workspaceId: "w1",
    wabaId: "waba_123",
    phoneNumberId: "phone_123",
    accessTokenEnc: encryptToken("mock_access_token"),
  };

  // 19. Duplicate STOP after a simulated crash (message saved, consent not applied) results in OPTED_OUT
  {
    const db = createMockDb({
      id: "c1",
      workspaceId: "w1",
      phone: "+15551234567",
      marketingConsentStatus: "OPTED_IN",
      marketingConsentSource: "MANUAL",
    });

    // Simulate crash: message was already inserted into db before crash, but consent was NOT yet applied
    db._addExistingMessageId("wamid.crash_stop_1");

    const repliesSent: any[] = [];
    const mockSend = async (params: any) => {
      repliesSent.push(params);
      return { providerMessageId: "outbound_confirm_1" };
    };

    const payload = makeInboundPayload("wamid.crash_stop_1", "15551234567", "STOP");

    await handleInboundWebhookPayload(payload, db, mockChannel, mockSend);

    const contact = db._getContact();
    const events = db._getEvents();

    assert(
      contact.marketingConsentStatus === "OPTED_OUT" &&
        contact.marketingConsentSource === "INBOUND_STOP" &&
        events.length === 1 &&
        events[0].status === "OPTED_OUT" &&
        events[0].source === "INBOUND_STOP" &&
        repliesSent.length === 1 &&
        repliesSent[0].body.includes("unsubscribed"),
      "Duplicate STOP after a simulated crash (message saved, consent not applied) results in OPTED_OUT",
      `Status: ${contact.marketingConsentStatus}, events: ${events.length}, replies: ${repliesSent.length}`
    );
  }

  // 20. Duplicate STOP when the contact is already OPTED_OUT leaves one audit row and sends no second reply
  {
    const db = createMockDb({
      id: "c1",
      workspaceId: "w1",
      phone: "+15551234567",
      marketingConsentStatus: "OPTED_OUT",
      marketingConsentSource: "INBOUND_STOP",
    });

    // Already 1 audit row from previous STOP application
    await db.consentEvent.create({
      data: {
        contactId: "c1",
        status: "OPTED_OUT",
        source: "INBOUND_STOP",
        createdAt: new Date(),
      },
    });

    db._addExistingMessageId("wamid.stop_2");

    const repliesSent: any[] = [];
    const mockSend = async (params: any) => {
      repliesSent.push(params);
      return { providerMessageId: "outbound_confirm_2" };
    };

    const payload = makeInboundPayload("wamid.stop_2", "15551234567", "STOP");

    await handleInboundWebhookPayload(payload, db, mockChannel, mockSend);

    const contact = db._getContact();
    const events = db._getEvents();

    assert(
      contact.marketingConsentStatus === "OPTED_OUT" &&
        events.length === 1 &&
        repliesSent.length === 0,
      "Duplicate STOP when the contact is already OPTED_OUT leaves one audit row and sends no second reply",
      `Status: ${contact.marketingConsentStatus}, events: ${events.length}, replies: ${repliesSent.length}`
    );
  }

  // 21. Duplicate START behaves the same way
  {
    const db = createMockDb({
      id: "c1",
      workspaceId: "w1",
      phone: "+15551234567",
      marketingConsentStatus: "OPTED_OUT",
      marketingConsentSource: "INBOUND_STOP",
    });

    db._addExistingMessageId("wamid.crash_start_1");

    const repliesSent: any[] = [];
    const mockSend = async (params: any) => {
      repliesSent.push(params);
      return { providerMessageId: `outbound_start_${repliesSent.length + 1}` };
    };

    const payload = makeInboundPayload("wamid.crash_start_1", "15551234567", "START");

    // First retry after crash (message saved, consent not yet applied): applies consent and sends confirmation
    await handleInboundWebhookPayload(payload, db, mockChannel, mockSend);

    const contactAfterFirst = db._getContact();
    const eventsAfterFirst = db._getEvents();

    const firstOk =
      contactAfterFirst.marketingConsentStatus === "OPTED_IN" &&
      contactAfterFirst.marketingConsentSource === "INBOUND_START" &&
      eventsAfterFirst.length === 1 &&
      repliesSent.length === 1;

    // Subsequent duplicate retry when already OPTED_IN: leaves 1 audit row and sends no second reply
    await handleInboundWebhookPayload(payload, db, mockChannel, mockSend);

    const contactAfterSecond = db._getContact();
    const eventsAfterSecond = db._getEvents();

    const secondOk =
      contactAfterSecond.marketingConsentStatus === "OPTED_IN" &&
      eventsAfterSecond.length === 1 &&
      repliesSent.length === 1;

    assert(
      firstOk && secondOk,
      "Duplicate START behaves the same way",
      `firstOk: ${firstOk}, secondOk: ${secondOk}, events: ${eventsAfterSecond.length}, replies: ${repliesSent.length}`
    );
  }

  // 22. Duplicate non-keyword message still does nothing
  {
    const db = createMockDb({
      id: "c1",
      workspaceId: "w1",
      phone: "+15551234567",
      marketingConsentStatus: "OPTED_IN",
      marketingConsentSource: "SHOPIFY_WHATSAPP",
    });

    db._addExistingMessageId("wamid.non_keyword_1");

    const repliesSent: any[] = [];
    const mockSend = async (params: any) => {
      repliesSent.push(params);
      return { providerMessageId: "outbound_hello_1" };
    };

    const initialConv = { ...db._getConversation() };
    const payload = makeInboundPayload("wamid.non_keyword_1", "15551234567", "Hello, where is my order?");

    await handleInboundWebhookPayload(payload, db, mockChannel, mockSend);

    const contact = db._getContact();
    const events = db._getEvents();
    const conv = db._getConversation();

    assert(
      contact.marketingConsentStatus === "OPTED_IN" &&
        contact.marketingConsentSource === "SHOPIFY_WHATSAPP" &&
        events.length === 0 &&
        repliesSent.length === 0 &&
        conv.lastInboundAt === initialConv.lastInboundAt,
      "Duplicate non-keyword message still does nothing",
      `Status: ${contact.marketingConsentStatus}, events: ${events.length}, replies: ${repliesSent.length}`
    );
  }

  console.log(`\n=== Verification Complete: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests().catch((err) => {
  console.error("Test execution error:", err);
  process.exit(1);
});
