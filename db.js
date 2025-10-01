
// db.js

import dotenv from "dotenv";
dotenv.config(); // load environment variables from .env

import sql from "mssql";
import { Pool as PgPool } from "pg";

// read which database to use: "postgres" or "mssql"
const dbType = process.env.DB_TYPE ;
console.log(dbType);

let mssqlPool = null;
let pgPool = null;

// open a connection to the selected database (once at app startup)
export const initDb = async () => {
  if (dbType === "mssql") {
    // create a global MSSQL connection pool
    mssqlPool = await sql.connect({
      user: process.env.MSSQL_USER,
      password: process.env.MSSQL_PASSWORD,
      server: process.env.MSSQL_SERVER,
      database: process.env.MSSQL_DATABASE,
      options: {
        encrypt: true,
        trustServerCertificate: true,
      },
    });
    console.log("✅ Connected to MSSQL");
  } else if (dbType === "postgres") {
    pgPool = new PgPool({
      user: process.env.PG_USER,
      host: process.env.PG_HOST,
      database: process.env.PG_DATABASE,
      password: process.env.PG_PASSWORD,
      port: Number(process.env.PG_PORT),
    });
    // simple ping to fail fast if creds/host are wrong
    await pgPool.query("SELECT 1"); // test
    console.log("✅ Connected to PostgreSQL");
  } else {
    // safety net if DB_TYPE is missing or unsupported
    throw new Error("Unsupported DB_TYPE in .env");
  }
};
// return the active pool (based on DB_TYPE)
export const getPool = () => {
  return dbType === "mssql" ? mssqlPool : pgPool;
};
// expose the selected DB type for callers that need branching logic
export const getDbType = () => dbType;
