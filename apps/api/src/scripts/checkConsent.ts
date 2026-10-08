import {
  setMarketingConsent,
  evaluateSendPermission,
  isStopKeyword,
  isStartKeyword,
  normalizeKeywordText,
} from "@nextcrm/core";
import { processShopifyConsent } from "../services/shopifyWebhookHandler";

function createMockDb(initialContact: any) {
  let contact = { ...initialContact };
  const consentEvents: any[] = [];

  const db: any = {
    contact: {
      findUnique: async ({ where }: any) => {
        if (where.id === contact.id) return { ...contact };
        return null;
      },
      findFirst: async ({ where }: any) => {
        if (where.id === contact.id) return { ...contact };
        return null;
      },
      update: async ({ where, data }: any) => {
        if (where.id === contact.id) {
          contact = { ...contact, ...data };
          return { ...contact };
        }
        throw new Error("Contact not found");
      },
    },
    consentEvent: {
      create: async ({ data }: any) => {
        consentEvents.push({ id: `event_${consentEvents.length + 1}`, ...data });
        return { id: `event_${consentEvents.length}`, ...data };
      },
    },
    $transaction: async (fn: any) => {
      return await fn(db);
    },
    _getContact: () => contact,
    _getEvents: () => consentEvents,
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
    assert(!isStopKeyword("stop please"), 'isStopKeyword("stop please") is false');
    assert(isStopKeyword("opt out"), 'isStopKeyword("opt out") is true');
    assert(isStopKeyword("optout"), 'isStopKeyword("optout") is true');
    assert(isStopKeyword("opt-out"), 'isStopKeyword("opt-out") is true');

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

  console.log(`\n=== Verification Complete: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error("Test execution error:", err);
  process.exit(1);
});
