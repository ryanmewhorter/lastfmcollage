import moment from "moment-timezone";
import { RecentTracks } from "scrobbles";
import Track from "./model/Track.js";
import CollageGeneratorService from "./service/CollageGeneratorService.js";
import MusicBrainzService from "./service/MusicBrainzService.js";
import express from "express";
import Album from "./model/Album.js";
import dotenv from "dotenv";
import SpotifyService from "./service/SpotifyService.js";
import BandcampService from "./service/BandcampService.js";
import {
  randomString,
  isBlank,
  millisecondsToTime,
  benchmarkPromise,
  isNotBlank,
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

dotenv.config();

const HOST = process.env.HOST || "localhost";
const APP_PORT = process.env.APP_PORT || 8080;
const SPOTIFY_AUTH_PATH = "/authorize-spotify";
const SPOTIFY_AUTH_CALLBACK_PATH = "/callback";
const SPOTIFY_AUTH_REDIRECT_URI =
  process.env.SPOTIFY_AUTH_REDIRECT_URI ||
  `http://${HOST}:${APP_PORT}${SPOTIFY_AUTH_CALLBACK_PATH}`;
const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
const COOKIE_SPOTIFY_STATE = "lastfmcollage_spotify_state";
const COOKIE_SPOTIFY_ACCESS_TOKEN = "lastfmcollage_spotify_auth_token";

const songLengthCache = new FileSystemCache("./song-length-cache.json", {
  keyTranslate: (track) =>
    `${track.artist}.${track.album.title}.${track.title}`.toLowerCase(),
});
const lastFmService = new LastFmService(process.env.LAST_FM_API_KEY, {
  maxRequestsPerSecond: process.env.LAST_FM_MAX_REQUESTS_PER_SECOND,
});
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

const WHITELISTED_USERS = (process.env.WHITELISTED_LAST_FM_USERS || "")
  .toLowerCase()
  .replace(/\s+/g, "")
  .split(",");

const __filename = fileURLToPath(import.meta.url); // for __dirname support
const __dirname = dirname(__filename);

function defaultErrorHandler(err) {
  if (err instanceof Error) {
    console.error(err, err.stack);
  } else {
    let msg = typeof err === "string" ? err : JSON.stringify(err);
    console.error(`Error: ${msg}`);
  }
}

function handleTrackError(track, err) {
  console.error(
    `Error occurred processing track '${track.title}' by ${track.artist}:`
  );
  defaultErrorHandler(err);
}

/**
 *
 * @param {*} user
 * @returns {Promise} promise
 */
async function loadRecentUserActivity(user, timeRangeOptions = {}) {
  let to = timeRangeOptions.to || moment();
  let from = timeRangeOptions.from || moment(to).subtract(7, "days");
  console.log(`Getting activity from ${from.toString()} to ${to.toString()}`);

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
    console.error(
      `Failure (${retryNum}) ${url}: ${message}. Retrying in ${retryAfterMs}`
    );
  });

  // reader.on("progress", console.log);

  let trackDurationPromises = [];

  for await (let trackPage of reader) {
    for (let track of trackPage) {
      trackDurationPromises.push(
        new Promise((resolve, reject) => {
          // check cache
          let cachedTrackLength = songLengthCache.get(track);
          // if (cachedTrackLength != null) {
          //   console.log(`Cache hit for '${track.title}' by '${track.artist}'!`);
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
                console.error(
                  `ERROR: No track duration found for track '${track.title}' by ${track.artist}`
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
 *
 * @param {Track[]} streamedTracks
 */
function buildActivity(streamedTracks) {
  let albums = {};
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
      if (
        !albumListening.variousArtists &&
        albumListening.album.artist !== track.artist
      ) {
        albumListening.variousArtists = true;
      }
      if (track.length == null || track.length <= 0) {
        albumListening.dirty = true;
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
  return results.slice(0, Math.min(25, results.length));
}

const app = express();

// Middleware
app.use(helmet());

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

app.post("/collage", function (req, res) {
  if (isBlank(req.cookies[COOKIE_SPOTIFY_ACCESS_TOKEN])) {
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
      generateAndEmailCollage(user, req.body.email, {
        from: from,
        to: to,
      }).then((imageFileName) => {
        console.log(`Successfully generated collage image [${imageFileName}]`);
      });
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

app.get(SPOTIFY_AUTH_PATH, function (req, res) {
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

app.get(SPOTIFY_AUTH_CALLBACK_PATH, function (req, res) {
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
        console.log(
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
    console.error(e);
  });

  req.write(formData);
  req.end();
}

app.listen(APP_PORT);
console.log(`App listening on port ${APP_PORT}`);

process.on("exit", () => {
  songLengthCache.save();
  musicBrainzService.mbAlbumCache.save();
});

/**
 *
 * @param {string} lastFmUser
 * @param {*} timeRangeOptions
 * @returns {Promise}
 */
function generateAndEmailCollage(lastFmUser, toEmail, timeRangeOptions) {
  // Generate collage
  let startTimestamp = moment().unix();
  // let daysAgo = req.params.days;
  let imageFileName = `${lastFmUser}-${startTimestamp}.jpg`;
  return benchmarkPromise(
    `generate collage for user [${lastFmUser}] for time range [${JSON.stringify(
      timeRangeOptions
    )}]`,
    loadRecentUserActivity(lastFmUser, timeRangeOptions)
      .then((streamedTracks) =>
        buildActivity(streamedTracks.filter((t) => t != null))
      )
      .then((activity) => {
        if (!fs.existsSync("public/img")) {
          fs.mkdirSync("public/img");
        }
        collageGeneratorService.generate(
          `public/img/${imageFileName}`,
          activity
        );
      })
      .then(() => {
        songLengthCache.save();
        musicBrainzService.mbAlbumCache.save();
      })
      .then(() => {
        if (isNotBlank(toEmail)) {
          return emailService.send({
            subject: `Your last.fm collage...`,
            to: toEmail,
            html: `Listening activity for ${lastFmUser} from ${timeRangeOptions.from.format()} to ${timeRangeOptions.to.format()}:<br/><img src="cid:${imageFileName}"/>`,
            attachments: [
              {
                filename: imageFileName,
                path: `./public/img/${imageFileName}`,
                cid: imageFileName, //same cid value as in the html img src
              },
            ],
          });
        } else {
          return Promise.resolve();
        }
      }, defaultErrorHandler)
      .then(() => imageFileName)
  );
}

function validateQueryParams(params) {
  let errors = [];
  for (let requiredParam of ["from", "user"]) {
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
