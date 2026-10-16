export const CART_CONVERTED_EXIT_REASON = "CART_CONVERTED";

export interface ConvertCartsForOrderParams {
  db: any;
  workspaceId: string;
  checkoutToken?: string | null;
  cartToken?: string | null;
  orderId?: string | null;
  convertedAt?: Date | null;
}

export interface ConvertCartsResult {
  convertedCartCount: number;
  exitedRunCount: number;
  cartIds: string[];
}

/**
 * Finds all carts in the workspace matching checkoutToken OR cartToken
 * (exact match only; no fuzzy matching) and idempotently marks them converted.
 *
 * Atomically moves any non-terminal JourneyRuns triggered by those carts
 * to the terminal 'exited' status with exitReason 'CART_CONVERTED'.
 */
export async function convertCartsForOrder(
  params: ConvertCartsForOrderParams
): Promise<ConvertCartsResult> {
  const { db, workspaceId, checkoutToken, cartToken, orderId, convertedAt } = params;

  const tokenFilters: Array<{ checkoutToken?: string; shopifyCartId?: string; cartToken?: string }> = [];
  if (checkoutToken && typeof checkoutToken === "string" && checkoutToken.trim()) {
    const cleanCheckout = checkoutToken.trim();
    tokenFilters.push({ checkoutToken: cleanCheckout });
    tokenFilters.push({ shopifyCartId: cleanCheckout });
  }
  if (cartToken && typeof cartToken === "string" && cartToken.trim()) {
    const cleanCart = cartToken.trim();
    tokenFilters.push({ cartToken: cleanCart });
  }

  if (tokenFilters.length === 0) {
    return { convertedCartCount: 0, exitedRunCount: 0, cartIds: [] };
  }

  // 1. Find all matching carts in this workspace
  const matchingCarts = await db.cart.findMany({
    where: {
      OR: tokenFilters,
    },
    select: {
      id: true,
      status: true,
    },
  });

  if (matchingCarts.length === 0) {
    return { convertedCartCount: 0, exitedRunCount: 0, cartIds: [] };
  }

  const cartIds = matchingCarts.map((c: { id: string }) => c.id);
  const timestamp = convertedAt ?? new Date();

  // 2. Mark them converted idempotently: conditional updateMany ensures
  // already-converted carts are not modified again on webhook retries.
  const cartUpdateResult = await db.cart.updateMany({
    where: {
      OR: tokenFilters,
      status: { not: "converted" },
    },
    data: {
      status: "converted",
      convertedAt: timestamp,
      orderId: orderId ?? undefined,
    },
  });

  // 3. Atomically move every NON-TERMINAL JourneyRun triggered by these carts
  // to terminal 'exited' state with exitReason 'CART_CONVERTED'.
  // Using updateMany (non-terminal -> terminal) prevents races with the worker.
  const runUpdateResult = await db.journeyRun.updateMany({
    where: {
      triggerContextId: { in: cartIds },
      status: { notIn: ["completed", "exited", "failed"] },
    },
    data: {
      status: "exited",
      exitReason: CART_CONVERTED_EXIT_REASON,
      nextStepAt: null,
    },
  });

  return {
    convertedCartCount: cartUpdateResult.count,
    exitedRunCount: runUpdateResult.count,
    cartIds,
  };
}
