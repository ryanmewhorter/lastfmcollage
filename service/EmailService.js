"use strict";
import nodemailer from "nodemailer";
import Mail from "nodemailer/lib/mailer/index.js";
import { requireNotBlank } from "../Utils.js";
// const nodemailer = require("nodemailer");

// let transporter = nodemailer.createTransport({
//   sendmail: true,
//   newline: "unix",
//   path: "/usr/sbin/sendmail",
// });
// transporter.sendMail(
//   {
//     from: "sender@example.com",
//     to: "recipient@example.com",
//     subject: "Message",
//     text: "I hope this message gets delivered!",
//   },
//   (err, info) => {
//     console.log(info.envelope);
//     console.log(info.messageId);
//   }
// );

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
    console.debug(`Sending mail: ${JSON.stringify(mailOptions)}`);
    return new Promise((resolve, reject) => {
      mailOptions.from = mailOptions.from || this.user;
      this.transporter.sendMail(mailOptions, (error, info) => {
        if (error) {
          console.error(`Error occurred sending email: `, error.message);
          reject(error);
        } else {
          resolve(info);
        }
      });
    });
  }
}
