import { config } from "./config.js";
import { migrate } from "./migrate.js";
import { buildApp } from "./app.js";
import { startWorker } from "./jobs/worker.js";
import { pool } from "./db.js";

await migrate(m => console.log(m));
const app = await buildApp();
await app.listen({ port: config.port, host: config.host });
const stopWorker = startWorker(app.log);

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, async () => {
    app.log.info(`${sig} received, shutting down`);
    stopWorker();
    await app.close();
    await pool.end();
    process.exit(0);
  });
}
