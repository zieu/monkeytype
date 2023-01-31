import "dotenv/config";
import admin, { ServiceAccount } from "firebase-admin";
// @ts-ignore
import serviceAccount from "./credentials/serviceAccountKey.json"; // eslint-disable-line require-path-exists/exists
import * as db from "./init/db";
import jobs from "./jobs";
import { getLiveConfiguration } from "./init/configuration";
import { initializeDailyLeaderboardsCache } from "./utils/daily-leaderboards";
import app from "./app";
import { Server } from "http";
import { version } from "./version";
import { recordServerVersion } from "./utils/prometheus";
import * as RedisClient from "./init/redis";
import queues from "./queues";
import workers from "./workers";
import Logger from "./utils/logger";
import * as EmailClient from "./init/email-client";
import emailQueue from "./queues/email-queue";

async function bootServer(port: number): Promise<Server> {
  try {
    Logger.info(`Starting server version ${version}`);
    Logger.info(`Starting server in ${process.env.MODE} mode`);
    Logger.info(`Connecting to database ${process.env.DB_NAME}...`);
    await db.connect();
    Logger.success("Connected to database");

    Logger.info("Initializing Firebase app instance...");
    admin.initializeApp({
      credential: admin.credential.cert(
        serviceAccount as unknown as ServiceAccount
      ),
    });
    Logger.success("Firebase app initialized");

    Logger.info("Fetching live configuration...");
    const liveConfiguration = await getLiveConfiguration();
    Logger.success("Live configuration fetched");

    Logger.info("Initializing email client...");
    await EmailClient.init();

    Logger.info("Connecting to redis...");
    await RedisClient.connect();

    if (RedisClient.isConnected()) {
      Logger.success("Connected to redis");
      const connection = RedisClient.getConnection();

      Logger.info("Initializing queues...");
      queues.forEach((queue) => {
        queue.init(connection);
      });
      Logger.success(
        "Queues initialized: " +
          queues.map((queue) => queue.queueName).join(", ")
      );

      Logger.info("Initializing workers...");
      workers.forEach((worker) => {
        worker(connection).run();
      });
      Logger.success(
        "Workers initialized: " +
          workers.map((worker) => worker.name).join(", ")
      );
    }

    initializeDailyLeaderboardsCache(liveConfiguration.dailyLeaderboards);

    Logger.info("Starting cron jobs...");
    jobs.forEach((job) => job.start());
    Logger.success("Cron jobs started");

    recordServerVersion(version);
    //testing email queue
    if (process.env.EMAIL_USER) {
      emailQueue.sendVerificationEmail(
        process.env.EMAIL_USER,
        "Miodec",
        "https://monkeytype.com"
      );
    }
  } catch (error) {
    Logger.error("Failed to boot server");
    Logger.error(error);
    return process.exit(1);
  }

  return app.listen(PORT, () => {
    Logger.success(`API server listening on port ${port}`);
  });
}

const PORT = parseInt(process.env.PORT ?? "5005", 10);

bootServer(PORT);
