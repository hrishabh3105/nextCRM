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
 */
function handleMetaError(data: any): never {
  const metaMessage =
    data?.error?.message ||
    (typeof data === "string" ? data : JSON.stringify(data)) ||
    "Meta API error";

  // Throw 502 with Meta's actual error message in details without swallowing context
  throw new ApiError(502, metaMessage, metaMessage);
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
}): Promise<{ providerTemplateId: string }> {
  const { accessToken, wabaId, name, language, category, body } = params;

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
      components: [
        {
          type: "BODY",
          text: body,
        },
      ],
    }),
  });

  const data = (await response.json().catch(() => ({}))) as any;

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
