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

  // NOTE: This corrects a mislabeling bug from the original Week 4 seed data.
  // These rate values (utility: 0.115, marketing: 0.86, authentication: 0.115) were always
  // rupee-scale (INR), not dollar-scale (USD). True USD rates would be roughly 0.0014 and 0.0118.
  // The numeric rate values are kept as-is, only the currency label is corrected to 'INR'.
  const initialRates = [
    {
      country: "IN",
      category: "utility",
      rate: 0.115,
      currency: "INR",
      effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
    },
    {
      country: "IN",
      category: "marketing",
      rate: 0.86,
      currency: "INR",
      effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
    },
    {
      country: "IN",
      category: "authentication",
      rate: 0.115,
      currency: "INR",
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
      if (existing.currency !== item.currency || existing.rate !== item.rate) {
        const updated = await prisma.rateCard.update({
          where: { id: existing.id },
          data: {
            rate: item.rate,
            currency: item.currency,
          },
        });
        console.log(
          `Updated rate card: id=${updated.id}, country=${updated.country}, category=${updated.category}, rate=${updated.rate}, currency=${updated.currency}, effectiveFrom=${updated.effectiveFrom.toISOString()}`
        );
      } else {
        console.log(
          `Rate card already exists: id=${existing.id}, country=${existing.country}, category=${existing.category}, rate=${existing.rate}, currency=${existing.currency}, effectiveFrom=${existing.effectiveFrom.toISOString()}`
        );
      }
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
