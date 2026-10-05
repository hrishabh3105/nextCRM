import { ApiError } from "../apiError";

const META_GRAPH_BASE_URL = "https://graph.facebook.com/v20.0";

interface MetaErrorResponse {
  error?: {
    message?: string;
    type?: string;
    code?: number;
    error_subcode?: number;
    error_user_title?: string;
    error_user_msg?: string;
    fbtrace_id?: string;
  };
}

/**
 * Extracts and throws an ApiError(502, ...) with Meta's exact error message.
 * When Meta's response includes error_user_msg (such as for error_subcode 2388293
 * "Parameters words ratio exceeds limit"), prefer that over generic error.message
 * to provide a human-readable, actionable explanation.
 */
function handleMetaError(data: any): never {
  const errorObj = data?.error;
  const userMsg = errorObj?.error_user_msg;
  const genericMsg = errorObj?.message;

  const metaMessage =
    userMsg ||
    genericMsg ||
    (typeof data === "string" ? data : JSON.stringify(data)) ||
    "Meta API error";

  // Throw 502 with Meta's actual error message in details without swallowing context
  throw new ApiError(502, metaMessage, metaMessage);
}

export type MetaTemplateButtonParam =
  | { type: "QUICK_REPLY"; text: string }
  | { type: "URL"; text: string; url: string }
  | { type: "PHONE_NUMBER"; text: string; phoneNumber: string };

/**
 * Uploads an image file to Meta's Resumable Upload API to obtain a short-lived
 * media handle for template creation with media headers.
 *
 * NOTE ON HANDLE LIFETIME:
 * The returned handle is short-lived (~24 hours). The template must be submitted
 * to Meta soon after upload, as the handle is only valid during the creation session.
 *
 * Step 1: POST https://graph.facebook.com/v20.0/{appId}/uploads?file_length={fileLength}&file_type={fileType}
 *         Header: Authorization: Bearer {accessToken}
 *         Returns upload session id like "upload:XYZ" in the "id" field.
 *
 * Step 2: POST https://graph.facebook.com/v20.0/{uploadSessionId}
 *         Header: Authorization: OAuth {accessToken} (note: "OAuth" not "Bearer" per Meta's resumable upload spec)
 *         Header: file_offset: 0
 *         Body: raw fileBuffer bytes
 *         Returns { h: "<handle>" }
 */
export async function uploadMediaForTemplate(params: {
  accessToken: string;
  appId: string;
  fileBuffer: Buffer;
  fileType: string;
  fileLength: number;
}): Promise<{ handle: string }> {
  const { accessToken, appId, fileBuffer, fileType, fileLength } = params;

  // Step 1: Create upload session
  const step1Url = `${META_GRAPH_BASE_URL}/${appId}/uploads?file_length=${fileLength}&file_type=${encodeURIComponent(
    fileType
  )}`;

  const step1Response = await fetch(step1Url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  const step1Data = (await step1Response.json().catch(() => ({}))) as any;

  if (!step1Response.ok || !step1Data?.id) {
    handleMetaError(step1Data);
  }

  const uploadSessionId = step1Data.id;

  // Step 2: Upload raw file buffer to the upload session
  const step2Url = `${META_GRAPH_BASE_URL}/${uploadSessionId}`;

  const step2Response = await fetch(step2Url, {
    method: "POST",
    headers: {
      Authorization: `OAuth ${accessToken}`,
      file_offset: "0",
      "Content-Type": "application/octet-stream",
    },
    body: new Uint8Array(fileBuffer),
  });

  const step2Data = (await step2Response.json().catch(() => ({}))) as any;

  if (!step2Response.ok || !step2Data?.h) {
    handleMetaError(step2Data);
  }

  return { handle: step2Data.h };
}

/**
 * Submits a new message template to Meta for WhatsApp Business.
 * POST https://graph.facebook.com/v20.0/{wabaId}/message_templates
 */
export async function submitTemplate(params: {
  accessToken: string;
  wabaId: string;
  name: string;
  language: string;
  category: string;
  body: string;
  positionalPlaceholders: string[];
  headerType?: "TEXT" | "IMAGE" | string;
  headerText?: string;
  headerMediaHandle?: string;
  footerText?: string;
  buttons?: MetaTemplateButtonParam[];
  examples?: Record<string, string>;
}): Promise<{ providerTemplateId: string }> {
  const {
    accessToken,
    wabaId,
    name,
    language,
    category,
    body,
    positionalPlaceholders,
    headerType,
    headerText,
    headerMediaHandle,
    footerText,
    buttons,
    examples = {},
  } = params;

  // Convert named placeholders to Meta's positional format.
  // Meta requires each numbered placeholder ({{1}}, {{2}}, etc.) to appear EXACTLY ONCE
  // in the body, even when the same named placeholder repeats.
  // Driven by positionalPlaceholders (occurrence-order, with repeats) as the single source of truth.
  let convertedBody = body;
  const exampleValues: string[] = [];
  let counter = 1;

  for (const placeholderName of positionalPlaceholders) {
    convertedBody = convertedBody.replace(`{{${placeholderName}}}`, `{{${counter}}}`);
    exampleValues.push(examples[placeholderName] ?? "");
    counter++;
  }

  // Build the BODY component for Meta.
  // If placeholders exist, Meta requires an example object with body_text containing
  // an array of example sets (wrapped in an outer array: string[][], one inner array per example set).
  const bodyComponent: Record<string, any> = {
    type: "BODY",
    text: convertedBody,
  };

  if (exampleValues.length > 0) {
    bodyComponent.example = {
      body_text: [exampleValues],
    };
  }

  // Build the components array conditionally.
  // Only include components that are actually present — a template with just body + buttons,
  // no header/footer, should only send those two components, not empty placeholders.
  const components: any[] = [];

  if (headerType === "IMAGE" && headerMediaHandle) {
    components.push({
      type: "HEADER",
      format: "IMAGE",
      example: {
        header_handle: [headerMediaHandle],
      },
    });
  } else if (headerText) {
    components.push({
      type: "HEADER",
      format: "TEXT",
      text: headerText,
    });
  }

  components.push(bodyComponent);

  if (footerText) {
    components.push({
      type: "FOOTER",
      text: footerText,
    });
  }

  if (buttons && buttons.length > 0) {
    components.push({
      type: "BUTTONS",
      buttons: buttons.map((b) => {
        if (b.type === "QUICK_REPLY") {
          return { type: "QUICK_REPLY", text: b.text };
        }
        if (b.type === "URL") {
          return { type: "URL", text: b.text, url: b.url };
        }
        if (b.type === "PHONE_NUMBER") {
          return { type: "PHONE_NUMBER", text: b.text, phone_number: b.phoneNumber };
        }
        throw new Error(`Unsupported button type: ${(b as any).type}`);
      }),
    });
  }

  console.log(
    "[DEBUG] Meta submitTemplate payload:",
    JSON.stringify(
      {
        name,
        language,
        category: category.toUpperCase(),
        parameter_format: "POSITIONAL",
        components,
      },
      null,
      2
    )
  );

  const response = await fetch(`${META_GRAPH_BASE_URL}/${wabaId}/message_templates`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name,
      language,
      category: category.toUpperCase(),
      parameter_format: "POSITIONAL",
      components,
    }),
  });

  const data = (await response.json().catch(() => ({}))) as any;

  console.log("[DEBUG] Meta raw error response:", JSON.stringify(data, null, 2));

  if (!response.ok) {
    handleMetaError(data);
  }

  if (!data?.id) {
    throw new ApiError(502, "Meta response missing template ID", data);
  }

  return {
    providerTemplateId: data.id,
  };
}

/**
 * Fetches the current status of a template from Meta.
 * GET https://graph.facebook.com/v20.0/{providerTemplateId}
 */
export async function getTemplateStatus(params: {
  accessToken: string;
  providerTemplateId: string;
}): Promise<{ status: string; rejectionReason: string | null }> {
  const { accessToken, providerTemplateId } = params;

  const response = await fetch(`${META_GRAPH_BASE_URL}/${providerTemplateId}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  const data = (await response.json().catch(() => ({}))) as any;

  if (!response.ok) {
    handleMetaError(data);
  }

  const rawStatus = String(data?.status || "").toUpperCase();
  let status = "submitted";

  if (rawStatus === "APPROVED") {
    status = "approved";
  } else if (rawStatus === "REJECTED") {
    status = "rejected";
  } else if (rawStatus === "PENDING") {
    status = "submitted";
  } else if (rawStatus) {
    status = rawStatus.toLowerCase();
  }

  const rejectionReason =
    status === "rejected"
      ? data?.rejected_reason || data?.rejection_reason || data?.reason || null
      : null;

  return {
    status,
    rejectionReason: rejectionReason ? String(rejectionReason) : null,
  };
}

/**
 * Sends a WhatsApp template message to a recipient.
 * POST https://graph.facebook.com/v20.0/{phoneNumberId}/messages
 */
export async function sendTemplateMessage(params: {
  accessToken: string;
  phoneNumberId: string;
  to: string;
  templateName: string;
  language: string;
  variables: string[];
}): Promise<{ providerMessageId: string }> {
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

/**
 * Sends a free-form WhatsApp message to a recipient within an open 24-hour window.
 * POST https://graph.facebook.com/v20.0/{phoneNumberId}/messages
 */
export async function sendFreeformMessage(params: {
  accessToken: string;
  phoneNumberId: string;
  to: string;
  body: string;
}): Promise<{ providerMessageId: string }> {
  const { accessToken, phoneNumberId, to, body } = params;

  const response = await fetch(`${META_GRAPH_BASE_URL}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: {
        body,
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

/**
 * Verifies a WhatsApp Phone Number ID with Meta Graph API.
 * Soft check — returns true if valid, false on any failure (never throws).
 * GET https://graph.facebook.com/v20.0/{phoneNumberId}
 */
export async function verifyPhoneNumber(params: {
  accessToken: string;
  phoneNumberId: string;
}): Promise<boolean> {
  const { accessToken, phoneNumberId } = params;

  try {
    const response = await fetch(`${META_GRAPH_BASE_URL}/${phoneNumberId}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    return response.ok;
  } catch {
    return false;
  }
}

