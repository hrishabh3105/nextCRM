import "dotenv/config";
import { prisma } from "@nextcrm/db";
import {
  decryptToken,
  buildInteractiveCtaPayload,
  sendInteractiveCtaMessage,
} from "@nextcrm/core";

function printUsage() {
  console.log(`
Usage:
  npx tsx src/scripts/sendTestCtaMessage.ts --contactId <id> --cartId <id> [--confirm]

Description:
  Sends a free-form interactive cta_url WhatsApp message with the cart's recovery link,
  only if the contact's 24-hour window is currently open.
  Without --confirm, it only prints what it would send (dry run).
`);
}

async function main() {
  const args = process.argv.slice(2);
  let contactId: string | null = null;
  let cartId: string | null = null;
  let confirm = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--contactId" && args[i + 1]) {
      contactId = args[i + 1];
      i++;
    } else if (args[i] === "--cartId" && args[i + 1]) {
      cartId = args[i + 1];
      i++;
    } else if (args[i] === "--confirm") {
      confirm = true;
    }
  }

  if (!contactId || !cartId) {
    printUsage();
    process.exit(1);
  }

  try {
    const contact = await prisma.contact.findUnique({
      where: { id: contactId },
    });

    if (!contact) {
      console.error(`Contact with id '${contactId}' not found.`);
      process.exit(1);
    }

    const cart = await prisma.cart.findUnique({
      where: { id: cartId },
    });

    if (!cart) {
      console.error(`Cart with id '${cartId}' not found.`);
      process.exit(1);
    }

    if (!cart.recoveryUrl) {
      console.error(`Cart with id '${cartId}' does not have a recovery URL.`);
      process.exit(1);
    }

    const conversation = await prisma.conversation.findFirst({
      where: { contactId },
      orderBy: { updatedAt: "desc" },
      include: { channel: true },
    });

    const isWindowOpen =
      conversation &&
      conversation.windowExpiresAt &&
      new Date(conversation.windowExpiresAt).getTime() > Date.now();

    if (!isWindowOpen) {
      const expiry = conversation?.windowExpiresAt
        ? conversation.windowExpiresAt.toISOString()
        : "never opened";
      console.error(
        `Cannot send free-form CTA message: the 24-hour conversation window is CLOSED for contact ${contactId} (${contact.phone}). Window expired at: ${expiry}.`
      );
      process.exit(1);
    }

    const payload = buildInteractiveCtaPayload({
      to: contact.phone,
      bodyText: "You left items in your cart. Complete your purchase now:",
      buttonText: "Checkout Now",
      url: cart.recoveryUrl,
    });

    if (!confirm) {
      console.log(
        "=== DRY RUN: Interactive CTA URL message that would be sent (pass --confirm to execute) ==="
      );
      console.log(JSON.stringify(payload, null, 2));
      process.exit(0);
    }

    if (
      !conversation ||
      !conversation.channel ||
      !conversation.channel.accessTokenEnc ||
      !conversation.channel.phoneNumberId
    ) {
      console.error(
        "Conversation channel is missing required Meta credentials (accessTokenEnc or phoneNumberId)."
      );
      process.exit(1);
    }

    const accessToken = decryptToken(conversation.channel.accessTokenEnc);
    const result = await sendInteractiveCtaMessage({
      accessToken,
      phoneNumberId: conversation.channel.phoneNumberId,
      to: contact.phone,
      bodyText: "You left items in your cart. Complete your purchase now:",
      buttonText: "Checkout Now",
      url: cart.recoveryUrl,
    });

    console.log(
      `Successfully sent interactive CTA message! Meta Provider Message ID: ${result.providerMessageId}`
    );
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error("sendTestCtaMessage error:", err);
    process.exit(1);
  });
}
