import "dotenv/config";
import "./queues/campaignDispatchWorker";
import "./queues/sendMessageWorker";

console.log("[worker] listening on campaign-dispatch and send-message queues");
