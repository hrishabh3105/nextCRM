import "dotenv/config";
import "./queues/campaignDispatchWorker";
import "./queues/sendMessageWorker";
import "./queues/journeyTickWorker";

console.log("[worker] listening on campaign-dispatch, send-message, and journey-tick queues");
