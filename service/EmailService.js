"use strict";
import nodemailer from "nodemailer";
import Mail from "nodemailer/lib/mailer/index.js";
import { requireNotBlank } from "../Utils.js";
import logger from "../logger.js";

export default class EmailService {
  constructor(options = {}) {
    requireNotBlank("options.user", options.user);
    requireNotBlank("options.generatedPassword", options.generatedPassword);
    this.user = options.user;
    this.generatedPassword = options.generatedPassword;
    this.transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: this.user,
        pass: this.generatedPassword,
      },
    });
  }

  /**
   *
   * @param {Mail.Options} mailOptions
   * @returns {Promise<SMTPTransport.SentMessageInfo>}
   */
  send(mailOptions) {
    logger.debug(`Sending mail: ${JSON.stringify(mailOptions)}`);
    return new Promise((resolve, reject) => {
      mailOptions.from = mailOptions.from || this.user;
      this.transporter.sendMail(mailOptions, (error, info) => {
        if (error) {
          logger.error(`Error occurred sending email: `, error.message);
          reject(error);
        } else {
          resolve(info);
        }
      });
    });
  }
}
