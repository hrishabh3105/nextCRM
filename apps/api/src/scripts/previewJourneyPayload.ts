import "dotenv/config";
import { prisma } from "@nextcrm/db";
import {
  buildTemplateMessagePayload,
  TemplateButtonComponent,
  getTemplateDynamicButton,
  resolveButtonVariable,
  resolveTemplateVariables,
} from "@nextcrm/core";

function printUsage() {
  console.log(`
Usage:
  npx tsx src/scripts/previewJourneyPayload.ts --runId <id>
  npx tsx src/scripts/previewJourneyPayload.ts --latestCart

Description:
  Builds the final WhatsApp request body (body parameters plus dynamic URL button component)
  exactly as the worker would for that run's cart, and prints it without calling Meta.
`);
}

async function main() {
  const args = process.argv.slice(2);
  let runId: string | null = null;
  let useLatestCart = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--runId" && args[i + 1]) {
      runId = args[i + 1];
      i++;
    } else if (args[i] === "--latestCart") {
      useLatestCart = true;
    }
  }

  if (!runId && !useLatestCart) {
    printUsage();
    process.exit(1);
  }

  try {
    if (runId) {
      const run = await prisma.journeyRun.findUnique({
        where: { id: runId },
        include: {
          journey: { include: { versions: true } },
          contact: true,
          cart: true,
        },
      });

      if (!run) {
        console.error(`JourneyRun '${runId}' not found.`);
        process.exit(1);
      }

      const version = run.journeyVersionId
        ? run.journey.versions.find((v) => v.id === run.journeyVersionId) ||
          run.journey.versions[0]
        : run.journey.versions[0];

      const steps = Array.isArray(version?.steps) ? (version.steps as any[]) : [];
      const step: any =
        steps[run.currentStepIndex]?.type === "send_message"
          ? steps[run.currentStepIndex]
          : steps.find((s: any) => s.type === "send_message");

      if (!step) {
        console.error("No send_message step found in this journey run.");
        process.exit(1);
      }

      const template = await prisma.template.findUnique({
        where: { id: step.templateId },
      });

      if (!template) {
        console.error(`Template '${step.templateId}' not found.`);
        process.exit(1);
      }

      const cart =
        run.cart ||
        (run.cartId
          ? await prisma.cart.findUnique({ where: { id: run.cartId } })
          : null) ||
        (run.triggerContextId
          ? await prisma.cart.findUnique({ where: { id: run.triggerContextId } })
          : null);

      const contactObj = run.contact || {
        id: "preview_contact",
        phone: "+1234567890",
        name: "Customer",
        email: null,
        attributes: {},
      };

      const rawPlaceholders = Array.isArray(template.positionalPlaceholders)
        ? (template.positionalPlaceholders as string[])
        : Array.isArray(template.placeholders)
        ? (template.placeholders as string[])
        : [];

      let variables: string[] = [];
      if (rawPlaceholders.length > 0) {
        const resolution = await resolveTemplateVariables({
          placeholders: rawPlaceholders,
          mapping: (step.variableMapping || {}) as any,
          contact: contactObj,
          triggerData: { cart },
        });

        if ("error" in resolution) {
          console.error(`Variable resolution failed: ${resolution.error}`);
          process.exit(1);
        }
        variables = resolution.resolved;
      }

      let buttonComponent: TemplateButtonComponent | undefined = undefined;
      const dynamicBtn = getTemplateDynamicButton(template);
      if (dynamicBtn) {
        const stepMapping = (step.variableMapping || {}) as Record<string, any>;
        const buttonEntry =
          stepMapping["button:url"] ||
          stepMapping[`button:${dynamicBtn.index}`] ||
          stepMapping["button_url"];

        const btnResolution = resolveButtonVariable({
          buttonUrl: dynamicBtn.url,
          buttonIndex: dynamicBtn.index,
          buttonText: dynamicBtn.text,
          mappingEntry: buttonEntry,
          cart,
          contact: contactObj,
        });

        if ("error" in btnResolution) {
          console.error(`Button resolution failed: ${btnResolution.error}`);
          process.exit(1);
        }

        buttonComponent = {
          type: "button",
          sub_type: "url",
          index: String(dynamicBtn.index),
          parameters: [{ type: "text", text: btnResolution.value }],
        };
      }

      const payload = buildTemplateMessagePayload({
        to: run.contact?.phone || "+1234567890",
        templateName: template.providerName,
        language: template.language,
        variables,
        buttonComponent,
      });

      console.log(`=== Preview WhatsApp Payload for Run: ${run.id} ===`);
      console.log(JSON.stringify(payload, null, 2));
    } else if (useLatestCart) {
      const cart = await prisma.cart.findFirst({
        orderBy: { createdAt: "desc" },
        include: { contact: true },
      });

      if (!cart) {
        console.error("No carts found in database.");
        process.exit(1);
      }

      const journey = await prisma.journey.findFirst({
        where: { triggerEvent: "cart_abandoned" },
        orderBy: { updatedAt: "desc" },
        include: { versions: true },
      });

      if (!journey || !journey.versions || journey.versions.length === 0) {
        console.error("No cart_abandoned journey found in database.");
        process.exit(1);
      }

      const version = journey.currentVersionId
        ? journey.versions.find((v) => v.id === journey.currentVersionId) ||
          journey.versions[0]
        : journey.versions[0];

      const steps = Array.isArray(version?.steps) ? (version.steps as any[]) : [];
      const step: any = steps.find((s: any) => s.type === "send_message");

      if (!step) {
        console.error("No send_message step found in journey.");
        process.exit(1);
      }

      const template = await prisma.template.findUnique({
        where: { id: step.templateId },
      });

      if (!template) {
        console.error(`Template '${step.templateId}' not found.`);
        process.exit(1);
      }

      let contactObj: {
        id: string;
        name: string | null;
        email: string | null;
        phone: string;
        attributes: any;
      };

      if (cart.contact) {
        contactObj = {
          id: cart.contact.id,
          name: cart.contact.name,
          email: cart.contact.email,
          phone: cart.contact.phone,
          attributes: cart.contact.attributes || {},
        };
      } else if (cart.contactId) {
        const found = await prisma.contact.findUnique({
          where: { id: cart.contactId },
        });
        contactObj = found
          ? {
              id: found.id,
              name: found.name,
              email: found.email,
              phone: found.phone,
              attributes: found.attributes || {},
            }
          : {
              id: "preview_contact",
              name: "Customer",
              email: null,
              phone: "+1234567890",
              attributes: {},
            };
      } else {
        contactObj = {
          id: "preview_contact",
          name: "Customer",
          email: null,
          phone: "+1234567890",
          attributes: {},
        };
      }

      const rawPlaceholders = Array.isArray(template.positionalPlaceholders)
        ? (template.positionalPlaceholders as string[])
        : Array.isArray(template.placeholders)
        ? (template.placeholders as string[])
        : [];

      let variables: string[] = [];
      if (rawPlaceholders.length > 0) {
        const resolution = await resolveTemplateVariables({
          placeholders: rawPlaceholders,
          mapping: (step.variableMapping || {}) as any,
          contact: contactObj,
          triggerData: { cart },
        });

        if ("error" in resolution) {
          console.error(`Variable resolution failed: ${resolution.error}`);
          process.exit(1);
        }
        variables = resolution.resolved;
      }

      let buttonComponent: TemplateButtonComponent | undefined = undefined;
      const dynamicBtn = getTemplateDynamicButton(template);
      if (dynamicBtn) {
        const stepMapping = (step.variableMapping || {}) as Record<string, any>;
        const buttonEntry =
          stepMapping["button:url"] ||
          stepMapping[`button:${dynamicBtn.index}`] ||
          stepMapping["button_url"];

        const btnResolution = resolveButtonVariable({
          buttonUrl: dynamicBtn.url,
          buttonIndex: dynamicBtn.index,
          buttonText: dynamicBtn.text,
          mappingEntry: buttonEntry,
          cart,
          contact: contactObj,
        });

        if ("error" in btnResolution) {
          console.error(`Button resolution failed: ${btnResolution.error}`);
          process.exit(1);
        }

        buttonComponent = {
          type: "button",
          sub_type: "url",
          index: String(dynamicBtn.index),
          parameters: [{ type: "text", text: btnResolution.value }],
        };
      }

      const payload = buildTemplateMessagePayload({
        to: contactObj.phone || "+1234567890",
        templateName: template.providerName,
        language: template.language,
        variables,
        buttonComponent,
      });

      console.log(`=== Preview WhatsApp Payload for Latest Cart: ${cart.id} ===`);
      console.log(JSON.stringify(payload, null, 2));
    }
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error("Preview script error:", err);
    process.exit(1);
  });
}
