import LastFM from "last-fm";
import Track from "../model/Track.js";
import throttledQueue from "throttled-queue";
import { requireNotBlank } from "../Utils.js";
import logger from "../logger.js";

export default class LastFmService {
  constructor(lastFmApiKey, options = {}) {
    requireNotBlank("lastFmApiKey", lastFmApiKey);
    this.lastFmApiKey = lastFmApiKey;
    this.lastFm = new LastFM(process.env.LAST_FM_API_KEY);
    this.throttleRequest = throttledQueue(
      options.maxRequestsPerSecond || 1,
      1000
    );
  }

  /**
   *
   * @param {Track} track
   * @returns {Promise}
   */
  getTrackInfoFromLastFm(track) {
    return new Promise((resolve, reject) => {
      this.throttleRequest(() => {
        this.lastFm.trackInfo(
          { name: track.title, artistName: track.artist },
          (error, data) => {
            if (error) {
              logger.warn(
                `Could not get Last.FM track info for '${track.title}' by '${track.artist}': ${error.message}`
              );
              resolve(null);
            } else {
              resolve(data);
            }
          }
        );
      });
    });
  }

  /**
   *
   * @param {Track} track
   * @returns {Promise<number>}
   */
  getTrackDurationFromLastFm(track) {
    return this.getTrackInfoFromLastFm(track).then((lfmTrackInfo) => {
      if (
        lfmTrackInfo != null &&
        lfmTrackInfo.duration != null &&
        lfmTrackInfo.duration > 0
      ) {
        return Promise.resolve(lfmTrackInfo.duration * 1000);
      }
      return Promise.resolve(null);
    });
  }
}
