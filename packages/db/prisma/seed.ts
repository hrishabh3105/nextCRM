import "dotenv/config";
import { prisma } from "../src";

/**
 * Seed script for initial WhatsApp RateCard entries.
 *
 * NOTE: These are illustrative example rates matching what was discussed
 * early in this project, not necessarily Meta's current exact pricing.
 * These should be verified and updated against Meta's real current rate card
 * before any production use.
 */
async function main() {
  console.log("Seeding initial RateCard entries for country 'IN'...");

  const initialRates = [
    {
      country: "IN",
      category: "utility",
      rate: 0.115,
      currency: "USD",
      effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
    },
    {
      country: "IN",
      category: "marketing",
      rate: 0.86,
      currency: "USD",
      effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
    },
    {
      country: "IN",
      category: "authentication",
      rate: 0.115,
      currency: "USD",
      effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
    },
  ];

  for (const item of initialRates) {
    const existing = await prisma.rateCard.findFirst({
      where: {
        country: item.country,
        category: item.category,
        effectiveFrom: item.effectiveFrom,
      },
    });

    if (existing) {
      console.log(
        `Rate card already exists: id=${existing.id}, country=${existing.country}, category=${existing.category}, rate=${existing.rate}, currency=${existing.currency}, effectiveFrom=${existing.effectiveFrom.toISOString()}`
      );
    } else {
      const created = await prisma.rateCard.create({
        data: item,
      });
      console.log(
        `Inserted rate card: id=${created.id}, country=${created.country}, category=${created.category}, rate=${created.rate}, currency=${created.currency}, effectiveFrom=${created.effectiveFrom.toISOString()}`
      );
    }
  }

  const allRates = await prisma.rateCard.findMany({
    where: { country: "IN" },
    orderBy: { category: "asc" },
  });
  console.log(`Total RateCard rows for country 'IN': ${allRates.length}`);
}

main()
  .catch((e) => {
    console.error("Failed to seed RateCard:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
