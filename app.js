import dotenv from "dotenv";
dotenv.config();
import logger from "./logger.js";
import moment from "moment-timezone";
import { RecentTracks } from "scrobbles";
import Track from "./model/Track.js";
import CollageGeneratorService from "./service/CollageGeneratorService.js";
import MusicBrainzService from "./service/MusicBrainzService.js";
import express from "express";
import Album from "./model/Album.js";
import SpotifyService from "./service/SpotifyService.js";
import BandcampService from "./service/BandcampService.js";
import {
  randomString,
  isBlank,
  millisecondsToTime,
  benchmarkPromise,
  isNotBlank,
  requireNotBlank,
  getConfigValueString,
  getConfigValueNumber,
} from "./Utils.js";
import querystring from "querystring";
import https from "https";
import cookieParser from "cookie-parser";
import { fileURLToPath } from "url"; // for __dirname support
import { dirname } from "path"; // for __dirname support
import FileSystemCache from "./service/CacheService.js";
import LastFmService from "./service/LastFmService.js";
import EmailService from "./service/EmailService.js";
import fs from "fs";
import helmet from "helmet";
import stringSimilarity from "string-similarity";
import PromiseQueue from "promise-queue";
import ActivitySummary from "./model/ActivitySummary.js";

const HOST = getConfigValueString("HOST", "localhost");
const APP_PORT = getConfigValueNumber("APP_PORT", "8080");
const SPOTIFY_AUTH_PATH = "/authorize-spotify";
const SPOTIFY_AUTH_CALLBACK_PATH = "/callback";
const SPOTIFY_AUTH_REDIRECT_URI = getConfigValueString(
  "SPOTIFY_AUTH_REDIRECT_URI",
  `http://${HOST}:${APP_PORT}${SPOTIFY_AUTH_CALLBACK_PATH}`
);
const SPOTIFY_CLIENT_ID = getConfigValueString("SPOTIFY_CLIENT_ID");
const SPOTIFY_CLIENT_SECRET = getConfigValueString("SPOTIFY_CLIENT_SECRET");
const COOKIE_SPOTIFY_STATE = "lastfmcollage_spotify_state";
const COOKIE_SPOTIFY_ACCESS_TOKEN = "lastfmcollage_spotify_auth_token";

const songLengthCache = new FileSystemCache("./song-length-cache.json", {
  keyTranslate: (track) =>
    `${track.artist}.${track.album.title}.${track.title}`.toLowerCase(),
});
const lastFmService = new LastFmService(
  getConfigValueString("LAST_FM_API_KEY"),
  {
    maxRequestsPerSecond: process.env.LAST_FM_MAX_REQUESTS_PER_SECOND,
  }
);
const collageGeneratorService = new CollageGeneratorService({
  showListeningTime: process.env.SHOW_LISTENING_TIME === "true",
});
const musicBrainzService = new MusicBrainzService({
  maxRequestsPerSecond: process.env.MUSICBRAINZ_MAX_REQUESTS_PER_SECOND,
});
const spotifyService = new SpotifyService(
  SPOTIFY_CLIENT_ID,
  SPOTIFY_CLIENT_SECRET,
  { maxRequestsPerSecond: process.env.SPOTIFY_MAX_REQUESTS_PER_SECOND }
);
const bandcampService = new BandcampService({
  maxRequestsPerSecond: process.env.BANDCAMP_MAX_REQUESTS_PER_SECOND,
});
const emailService = new EmailService({
  user: process.env.GMAIL_USER,
  generatedPassword: process.env.GMAIL_GENERATED_PASSWORD,
});

const collageGenerationQueue = new PromiseQueue(
  getConfigValueNumber("GENERATE_COLLAGE_QUEUE_ACTIVE_LIMIT", 1),
  getConfigValueNumber("GENERATE_COLLAGE_QUEUE_LIMIT", 5)
);

const WHITELISTED_USERS = (process.env.WHITELISTED_LAST_FM_USERS || "")
  .toLowerCase()
  .replace(/\s+/g, "")
  .split(",");

const __filename = fileURLToPath(import.meta.url); // for __dirname support
const __dirname = dirname(__filename);
const PUBLIC_IMG_DIR = `${__dirname}/public/img`;

if (!fs.existsSync(PUBLIC_IMG_DIR)) {
  fs.mkdirSync(PUBLIC_IMG_DIR);
}

function defaultErrorHandler(err) {
  if (err instanceof Error) {
    logger.error(err, err.stack);
  } else {
    let msg = typeof err === "string" ? err : JSON.stringify(err);
    logger.error(`${msg}`);
  }
}

function handleTrackError(track, err) {
  logger.error(
    `Error occurred processing track '${track.title}' by ${track.artist}:`
  );
  defaultErrorHandler(err);
}

function sendGenericFailureMessage(toEmail) {
  requireNotBlank(toEmail);
  emailService.send({
    subject: `Your last.fm collage...`,
    to: toEmail,
    text: "An error occurred and your collage could not be generated.",
  });
}

/**
 *
 * @param {*} user
 * @param {moment.Moment} from
 * @param {moment.Moment} to
 * @returns {Promise} promise
 */
async function loadRecentUserActivity(user, from, to) {
  to = to || moment();
  from = from || moment(to).subtract(7, "days");
  logger.info(`Getting activity from ${from.format()} to ${to.format()}`);

  const reader = new RecentTracks({
    apikey: process.env.LAST_FM_API_KEY,
    user: user,
    from: from.unix(),
    to: to.unix(),
    mapTrack: (rawTrack) => {
      let artist = rawTrack.artist.name || "Unknown Artist";
      return new Track(
        rawTrack.name,
        artist,
        new Album(
          rawTrack.album["#text"] || "Unknown Album",
          artist,
          rawTrack.image[rawTrack.image.length - 1]["#text"],
          rawTrack.album.mbid
        ),
        undefined,
        rawTrack.mbid
      );
    },
    extended: true,
  });

  reader.on("retry", ({ error, message, retryNum, retryAfterMs, url }) => {
    logger.error(
      `Failure (${retryNum}) ${url}: ${message}. Retrying in ${retryAfterMs}`
    );
  });

  // reader.on("progress", logger.info);

  let trackDurationPromises = [];

  for await (let trackPage of reader) {
    for (let track of trackPage) {
      trackDurationPromises.push(
        new Promise((resolve, reject) => {
          // check cache
          let cachedTrackLength = songLengthCache.get(track);
          // if (cachedTrackLength != null) {
          //   logger.info(`Cache hit for '${track.title}' by '${track.artist}'!`);
          // }
          resolve(cachedTrackLength);
        })
          .then(
            (trackLength) => {
              // check MusicBrainz
              if (
                isBlank(track.album.mbId) ||
                (trackLength != null && trackLength > 0)
              ) {
                return Promise.resolve(trackLength);
              } else {
                return musicBrainzService.getTrackDuration(track);
              }
            },
            (err) => handleTrackError(track, err)
          )
          .then(
            (trackLength) => {
              if (trackLength != null && trackLength > 0) {
                return Promise.resolve(trackLength);
              } else {
                // check Last.FM
                return lastFmService.getTrackDurationFromLastFm(track);
              }
            },
            (err) => handleTrackError(track, err)
          )
          .then(
            (trackLength) => {
              // check Spotify
              if (trackLength != null && trackLength > 0) {
                return Promise.resolve(trackLength);
              } else {
                return spotifyService.getTrackDuration(track);
              }
            },
            (err) => handleTrackError(track, err)
          )

          .then(
            (trackLength) => {
              // check Bandcamp
              if (trackLength != null && trackLength > 0) {
                return Promise.resolve(trackLength);
              } else {
                return bandcampService.getTrackDuration(track);
              }
            },
            (err) => handleTrackError(track, err)
          )
          .then(
            (trackLength) => {
              if (trackLength == null || trackLength <= 0) {
                logger.error(
                  `No track duration found for track '${track.title}' by ${track.artist}`
                );
              } else {
                track.length = trackLength;
                songLengthCache.set(track, trackLength);
              }
              return track;
            },
            (err) => handleTrackError(track, err)
          )
      );
    }
  }

  return Promise.all(trackDurationPromises);
}

/**
 * Build activity summary
 * @param {Track[]} streamedTracks
 * @returns {ActivitySummary}
 */
function buildActivity(user, timeFrom, timeTo, streamedTracks) {
  let albums = {};
  let messages = [];
  for (let track of streamedTracks) {
    let key = track.album.title;
    if (albums[key] == null) {
      albums[key] = {
        album: track.album,
        length: track.length || 0,
        dirty: track.length == null || track.length <= 0,
        variousArtists: false,
      };
    } else {
      let albumListening = albums[key];
      // Using string similarity because Last.fm data is not normalized
      let artistNameSimilarity = stringSimilarity.compareTwoStrings(
        albumListening.album.artist,
        track.artist
      );
      if (!albumListening.variousArtists && artistNameSimilarity < 0.8) {
        logger.warn(
          `Track [${track.title}] artist [${track.artist}] is different than album artist [${albumListening.album.artist}], similarity = [${artistNameSimilarity}] - marking album as various artists`
        );
        albumListening.variousArtists = true;
      }
      if (track.length == null || track.length <= 0) {
        albumListening.dirty = true;
        messages.push(
          `${track.artist} - ${track.title} song length not found.`
        );
      } else {
        albumListening.length += track.length;
      }
    }
  }
  for (let album of Object.values(albums)) {
    if (isNaN(album.length) || album.length == null) {
      album.length = -1;
    }
  }
  let results = Object.values(albums).sort((a, b) => b.length - a.length);
  for (let albumEntry of results) {
    albumEntry.length =
      albumEntry.length > 0 ? millisecondsToTime(albumEntry.length) : null;
  }
  results = results.slice(0, Math.min(25, results.length));
  return new ActivitySummary(user, timeFrom, timeTo, results, messages);
}

const app = express();

// Middleware
if (
  getConfigValueString("USE_EXPRESS_HELMET", "false").toLowerCase() === "true"
) {
  app.use(helmet());
}

app.use(express.json());

app.use(express.urlencoded({ extended: true }));

app.use(cookieParser());

app.use((req, res, next) => {
  // check if client sent cookie
  const spotifyAccessToken = req.cookies[COOKIE_SPOTIFY_ACCESS_TOKEN];
  if (isNotBlank(spotifyAccessToken)) {
    spotifyService.spotifyApi.setAccessToken(spotifyAccessToken);
  }
  next(); // <-- important!
});

app.use(express.static(`${__dirname}/public`));

app.get("/", (req, res) => {
  if (isHealthCheck(req)) {
    res.status(200).send("Ok");
  } else if (isBlank(req.cookies[COOKIE_SPOTIFY_ACCESS_TOKEN])) {
    res.redirect(
      SPOTIFY_AUTH_PATH +
        "?" +
        querystring.stringify({ redirect: req.originalUrl })
    );
  } else {
    res.status(200).sendFile(`${__dirname}/index.html`);
  }
});

app.post("/collage", (req, res) => {
  if (isBlank(req.cookies[COOKIE_SPOTIFY_ACCESS_TOKEN])) {
    logger.info(`No spotify access token, redirection to ${SPOTIFY_AUTH_PATH}`);
    res.redirect(
      SPOTIFY_AUTH_PATH +
        "?" +
        querystring.stringify({ redirect: req.originalUrl })
    );
  } else {
    let errors = validateQueryParams(req.body);
    if (errors.length) {
      res.status(400);
      res.json(errors);
    }
    const user = req.body.user;
    if (!WHITELISTED_USERS.includes(user.toLowerCase())) {
      res.status(403);
      res.send("Nah bruh");
    } else {
      let from = moment(req.body.from).tz(req.body.timezone);
      let to = isNotBlank(req.body.to)
        ? moment(req.body.to).tz(req.body.timezone)
        : moment().tz(req.body.timezone);
      generateAndEmailCollage(user, req.body.email, from, to).then(
        (imageFileName) => {
          logger.info(
            `Successfully generated collage image [${imageFileName}]`
          );
        }
      );
      res
        .status(200)
        .send(
          `Generating lastfm collage for [${user}] from [${from.format()}] to [${to.format()}] and emailing to [${
            req.body.email || ""
          }]`
        );
    }
  }
});

app.get(SPOTIFY_AUTH_PATH, (req, res) => {
  const state = randomString();

  res.cookie(COOKIE_SPOTIFY_STATE, state);

  res.redirect(
    "https://accounts.spotify.com/authorize?" +
      querystring.stringify({
        response_type: "code",
        client_id: SPOTIFY_CLIENT_ID,
        scope: "",
        redirect_uri: SPOTIFY_AUTH_REDIRECT_URI,
        state: state,
      })
  );
});

app.get(SPOTIFY_AUTH_CALLBACK_PATH, (req, res) => {
  const code = req.query.code || null;
  const returnedState = req.query.state || null;
  const actualState = req.cookies[COOKIE_SPOTIFY_STATE];

  if (returnedState === null || returnedState !== actualState) {
    res.redirect(
      "/#" +
        querystring.stringify({
          error: "state_mismatch",
        })
    );
  } else {
    requestSpotifyAccessToken(
      {
        code: code,
        redirect_uri: SPOTIFY_AUTH_REDIRECT_URI,
        grant_type: "authorization_code",
      },
      (response) => {
        res.cookie(COOKIE_SPOTIFY_ACCESS_TOKEN, response.access_token, {
          maxAge: response.expires_in * 1000,
          httpOnly: true, // http only, prevents JavaScript cookie access
          // secure: true, // cookie must be sent over https / ssl
        });
        logger.info(
          `Saved cookie ${COOKIE_SPOTIFY_ACCESS_TOKEN}="${response.access_token}"`
        );
        res.redirect("/");
      }
    );
  }
});

function requestSpotifyAccessToken(formData, callback) {
  formData =
    typeof formData === "string" ? formData : querystring.stringify(formData);
  let options = {
    hostname: "accounts.spotify.com",
    path: "/api/token",
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Content-Length": formData.length,
      Authorization:
        "Basic " +
        new Buffer(SPOTIFY_CLIENT_ID + ":" + SPOTIFY_CLIENT_SECRET).toString(
          "base64"
        ),
    },
  };
  const req = https.request(options, (res) => {
    let responseText = "";
    res.on("data", (data) => {
      responseText += new TextDecoder().decode(data);
    });
    res.on("end", () => callback(JSON.parse(responseText)));
  });
  req.on("error", (e) => {
    logger.error(e);
  });

  req.write(formData);
  req.end();
}

const server = app.listen(APP_PORT, (err) => {
  if (err) defaultErrorHandler(err);
  logger.info(`App listening on port ${APP_PORT}`);
});

server.keepAliveTimeout = getConfigValueNumber(
  "SERVER_KEEP_ALIVE_TIMEOUT_MS",
  "60000"
);
server.headersTimeout = getConfigValueNumber(
  "SERVER_HEADERS_TIMEOUT_MS",
  "60000"
);

logger.info(
  `App keepAliveTimeout [${server.keepAliveTimeout}] headersTimeout [${server.headersTimeout}]`
);

process.on("exit", () => {
  songLengthCache.save();
  musicBrainzService.mbAlbumCache.save();
});

/**
 *
 * @param {string} lastFmUser
 * @param {string} toEmail
 * @param {moment.Moment} from
 * @param {moment.Moment} to
 * @returns {Promise}
 */
function generateAndEmailCollage(lastFmUser, toEmail, from, to) {
  return collageGenerationQueue.add(() => {
    // Generate collage
    let startTimestamp = moment().unix();
    let collageImageFileName = `${lastFmUser}-${startTimestamp}.jpg`;
    logger.info(
      `Generating collage for user [${lastFmUser}] from [${from.format()}] to [${to.format()}]`
    );
    let collageImageFilePath = `${PUBLIC_IMG_DIR}/${collageImageFileName}`;
    return benchmarkPromise(
      `generate collage for user [${lastFmUser}] from [${from.format()}] to [${to.format()}]`,
      loadRecentUserActivity(lastFmUser, from, to)
        .then((streamedTracks) =>
          buildActivity(
            lastFmUser,
            from,
            to,
            streamedTracks.filter((t) => t != null)
          )
        )
        .then(
          (activity) =>
            collageGeneratorService.generate(collageImageFilePath, activity),
          defaultErrorHandler
        )
        .then(
          (activitySummary) => {
            // TODO: Add elapsed time message to activity summary
            songLengthCache.save();
            musicBrainzService.mbAlbumCache.save();
            return activitySummary;
          },
          (reason) => {
            if (isNotBlank(toEmail)) {
              sendGenericFailureMessage(toEmail);
            }
            defaultErrorHandler(reason);
          }
        )
        .then((activitySummary) => {
          if (isNotBlank(toEmail)) {
            let htmlBody = `Listening activity for ${lastFmUser} from ${from.format()} to ${to.format()}:<br/><img src="cid:${collageImageFileName}"/>`;
            if (activitySummary.messages.length) {
              htmlBody += `<br>${activitySummary.messages.join("<br>")}`;
            }
            return emailService
              .send({
                subject: `Your last.fm collage...`,
                to: toEmail,
                html: htmlBody,
                attachments: [
                  {
                    filename: collageImageFileName,
                    path: collageImageFilePath,
                    cid: collageImageFileName, //same cid value as in the html img src
                  },
                ],
              })
              .then((info) => {
                if (fs.existsSync(collageImageFilePath)) {
                  logger.debug(
                    `Email was sent successfully - deleting collage file [${collageImageFilePath}]`
                  );
                  fs.unlinkSync(collageImageFilePath);
                }
                return info;
              }, defaultErrorHandler);
          } else {
            return Promise.resolve();
          }
        }, defaultErrorHandler)
        .then(
          () => collageImageFileName,
          (reason) => {
            if (isNotBlank(toEmail)) {
              sendGenericFailureMessage(toEmail);
            }
            defaultErrorHandler(reason);
          }
        )
    );
  });
}

function validateQueryParams(params) {
  let errors = [];
  for (let requiredParam of ["email", "from", "user"]) {
    if (isBlank(params[requiredParam])) {
      errors.push(`Missing required query paramater [${requiredParam}]`);
    }
  }
  for (let dateParam of ["from", "to"]) {
    let value = params[dateParam];
    if (isNotBlank(value) && !moment(value).isValid()) {
      errors.push(
        `Query paramater [${dateParam}] with value [${value}] is not a valid date.`
      );
    }
  }
  return errors;
}

/**
 * Checks if request is from ELB HealthChecker
 * @param {express.Request} req
 */
function isHealthCheck(req) {
  let userAgent = req.get("user-agent");
  return isNotBlank(userAgent) && userAgent.includes("ELB-HealthChecker");
}
