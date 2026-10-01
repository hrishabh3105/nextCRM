import "dotenv/config";
import { journeyTickQueue } from "@nextcrm/core";

async function main() {
  try {
    await journeyTickQueue.add("journey-tick", {
      runId: "cmucdjgl0000bnchhugkcvh9h",
      workspaceId: "cmu2f38do0000vwhhhawmzbtp",
    });
    console.log("Duplicate tick enqueued");
  } catch (error) {
    console.error("Error enqueuing duplicate tick:", error);
  } finally {
    await journeyTickQueue.close();
  }
}

main();
