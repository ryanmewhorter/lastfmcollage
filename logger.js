import * as winston from "winston";
import dotenv from "dotenv";
dotenv.config();
import { getConfigValueString } from "./Utils.js";

let logLevel = getConfigValueString("LOG_LEVEL", "warn");
let logger = winston.createLogger({
  level: logLevel,
  transports: [new winston.transports.Console()],
  format: winston.format.simple(),
});

logger.info(`Winston logger initialized with level [${logLevel}]`);
export default logger;
