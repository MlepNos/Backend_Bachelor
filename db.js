
// db.js

import dotenv from "dotenv";
dotenv.config(); // ⬅️ This line loads environment variables from .env



import sql from "mssql";
import { Pool as PgPool } from "pg";

const dbType = process.env.DB_TYPE ;
console.log(dbType);

let mssqlPool = null;
let pgPool = null;

export const initDb = async () => {
  if (dbType === "mssql") {
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
    await pgPool.query("SELECT 1"); // test
    console.log("✅ Connected to PostgreSQL");
  } else {
    throw new Error("Unsupported DB_TYPE in .env");
  }
};

export const getPool = () => {
  return dbType === "mssql" ? mssqlPool : pgPool;
};

export const getDbType = () => dbType;
