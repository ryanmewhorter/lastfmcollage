import Track from "../model/Track.js";
import https from "https";
import querystring from "querystring";
import Fuse from "fuse.js";
import { requireNotBlank } from "../Utils.js";
import throttledQueue from "throttled-queue";
import FileSystemCache from "./CacheService.js";

const HOST_NAME = "musicbrainz.org";
const API_ROOT = "/ws/2";

function defaultErrorHandler(error) {
  throw new Error(error);
}

const Entity = {
  RELEASE: "release",
};

export default class MusicBrainzService {
  constructor(options = {}) {
    this.mbAlbumCache = new FileSystemCache("./musicbrainz-album-cache.json");
    this.throttleRequest = throttledQueue(
      options.maxRequestsPerSecond || 1,
      1000
    );
  }

  /**
   *
   * @param {string} entity
   * @param {string} mbId
   * @param {string[]} include
   * @param {Function} callback
   * @param {Function} errorHandler
   */
  lookup(
    entity,
    mbId,
    include = [],
    callback,
    errorHandler = defaultErrorHandler
  ) {
    requireNotBlank("entity", entity);
    requireNotBlank("mbId", mbId);
    const cachedMbEntityRaw = this.mbAlbumCache.get(`${entity}.${mbId}`);
    if (cachedMbEntityRaw != null) {
      const cachedMbEntity = JSON.parse(cachedMbEntityRaw)
      console.debug(
        `DEBUG: MusicBrainz cache hit for entity [${entity}] mbId [${mbId}]`
      );
      callback(cachedMbEntity);
    } else {
      this.throttleRequest(() => {
        let queryParameters = {
          fmt: "json",
        };
        if (include.length) {
          queryParameters.inc = include.join("+");
        }
        let options = {
          hostname: HOST_NAME,
          path: `${API_ROOT}/${entity}/${mbId}?${querystring.stringify(
            queryParameters
          )}`,
          method: "GET",
          headers: {
            "User-Agent": "TimeCollage/0.0.2 ( ryan.mewhorter@gmail.com )",
          },
        };
        let request = https.request(options, (response) => {
          let data = "";

          response.on("data", (chunk) => {
            data = data + chunk.toString();
          });

          response.on("end", () => {
            const responseBody = JSON.parse(data);
            if (response.statusCode < 200 || response.statusCode > 299) {
              let error = {
                response: responseBody,
                parameters: {
                  entity: entity,
                  mbId: mbId,
                  include: include,
                },
              };
              errorHandler(error);
            } else {
              this.mbAlbumCache.set(
                `${entity}.${mbId}`,
                JSON.stringify(responseBody)
              );
              callback(responseBody);
            }
          });
        });

        request.on("error", errorHandler);

        request.end();
      });
    }
  }

  /**
   *
   * @param {Track} track
   * @returns {Promise} promise
   */
  getTrackDuration(track) {
    requireNotBlank("track.album.mbId", track.album.mbId);
    return new Promise((resolve, reject) => {
      this.lookup(
        Entity.RELEASE,
        track.album.mbId,
        ["recordings"],
        (releaseInfo) => {
          if (releaseInfo.media == null || releaseInfo.media.length === 0) {
            reject("Release has no media");
          }
          let tracks = releaseInfo.media[0].tracks;
          // find by id
          let matchingTrack = tracks.find((t) => t.id === track.mbId);
          if (matchingTrack == null) {
            // find by title
            const fuse = new Fuse(tracks, {
              keys: ["title"],
            });
            let searchByTitleResults = fuse.search(track.title);
            console.log(
              `MusicBrainz query on mbId [${track.album.mbId}] for track with title [${track.title}] returned [${searchByTitleResults.length}] results.`
            );
            if (searchByTitleResults.length > 1) {
              console.warn(
                `WARNING: More than one result for track '${track.title}' by ${track.artist}. Using first track.`
              );
            }
            matchingTrack = searchByTitleResults.length
              ? searchByTitleResults[0].item
              : null;
          }
          if (matchingTrack != null) {
            resolve(matchingTrack.length);
          } else {
            resolve(null);
          }
        },
        reject
      );
    });
  }
}
