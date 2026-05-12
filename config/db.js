import pkg from "pg";
import env from "./env.js";

const { Pool } = pkg;

const localDbConfig = {
    host: env.DB_HOST,
    port: env.DB_PORT,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    database: env.DB_NAME,
};

const remoteDbConfig = {
    connectionString: env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false,
    },
};

const shouldUseLocalDb = env.NODE_ENV !== "production" && env.DB_HOST && env.DB_USER && env.DB_NAME;

const db = new Pool(
    shouldUseLocalDb
        ? localDbConfig
        : env.DATABASE_URL
            ? remoteDbConfig
            : localDbConfig
);

export default db;