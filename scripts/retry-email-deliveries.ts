import "dotenv/config";
import { retryPendingEmailDeliveries } from "../src/lib/email";

const sent = await retryPendingEmailDeliveries();
console.log(JSON.stringify({ sent }));
