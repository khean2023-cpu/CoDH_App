import { MongoClient, type Db } from "mongodb";
import type {
  ArchiveDocument,
  AttachmentDocument,
  NotificationDocument,
  ProfileMediaDocument,
  RequestDocument,
  SpaceInvadersScoreDocument,
  UserDocument,
} from "./schema.js";

let client: MongoClient | undefined;
let database: Db | undefined;
let connection: Promise<Db> | undefined;

const getMongoDb = async () => {
  const uri = process.env.MONGODB_URI;
  const databaseName = process.env.MONGODB_DATABASE || "codh_app";
  if (!uri) throw new Error("Set the MONGODB_URI environment variable in Netlify.");
  if (!/^[a-zA-Z0-9_-]+$/.test(databaseName)) {
    throw new Error("MONGODB_DATABASE must contain only letters, numbers, underscores, or hyphens.");
  }
  if (database) return database;
  if (!connection) {
    connection = (async () => {
      client = new MongoClient(uri);
      await client.connect();
      const db = client.db(databaseName);
      const collectionNames = [
        "users",
        "requests",
        "notifications",
        "archives",
        "attachments",
        "profileMedia",
        "spaceInvadersScores",
      ];
      await Promise.all(collectionNames.map(async (name) => {
        try {
          await db.createCollection(name);
        } catch (error) {
          if (!(error && typeof error === "object" && "code" in error && error.code === 48)) throw error;
        }
      }));
      await Promise.all([
        db.collection<UserDocument>("users").createIndex({ id: 1 }, { unique: true }),
        db.collection<UserDocument>("users").createIndex({ emailNormalized: 1 }, { unique: true }),
        db.collection<RequestDocument>("requests").createIndex({ id: 1 }, { unique: true }),
        db.collection<RequestDocument>("requests").createIndex({ applicantId: 1 }),
        db.collection<NotificationDocument>("notifications").createIndex({ id: 1 }, { unique: true }),
        db.collection<NotificationDocument>("notifications").createIndex({ userId: 1 }),
        db.collection<ArchiveDocument>("archives").createIndex({ id: 1 }, { unique: true }),
        db.collection<AttachmentDocument>("attachments").createIndex({ id: 1 }, { unique: true }),
        db.collection<AttachmentDocument>("attachments").createIndex({ requestId: 1 }),
        db.collection<ProfileMediaDocument>("profileMedia").createIndex({ id: 1 }, { unique: true }),
        db.collection<ProfileMediaDocument>("profileMedia").createIndex({ userId: 1, mediaType: 1 }),
        db.collection<SpaceInvadersScoreDocument>("spaceInvadersScores").createIndex({ userId: 1 }, { unique: true }),
      ]);
      database = db;
      return db;
    })().catch(async (error) => {
      const failedClient = client;
      connection = undefined;
      client = undefined;
      try {
        await failedClient?.close();
      } catch (closeError) {
        console.error("Could not close the failed MongoDB connection:", closeError);
      }
      throw error;
    });
  }
  return connection;
};

export const getDatabase = getMongoDb;
