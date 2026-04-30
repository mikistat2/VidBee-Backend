import pkg from "pg";
import env from "./env.js";

const { Pool } = pkg;

const db = new Pool({
    host: env.DB_HOST,
    port: env.DB_PORT,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    database: env.DB_NAME,
});

export default db;