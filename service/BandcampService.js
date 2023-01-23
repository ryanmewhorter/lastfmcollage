import bandcamp from "bandcamp-scraper";
import throttledQueue from "throttled-queue";

export default class BandcampService {
  constructor(options = {}) {
    this.throttleRequest = throttledQueue(
      options.maxRequestsPerSecond || 1,
      1000
    );
  }

  /**
   *
   * @param {Track} track
   * @returns {Promise} promise
   */
  getTrackDuration(track) {
    return new Promise((resolve, reject) => {
      this.throttleRequest(() => {
        let query = `${track.artist} ${track.title}`;
        bandcamp.search({ query: query, page: 1 }, (error, results) => {
          if (error) {
            reject(error);
          } else {
            console.log(
              `Bandcamp query [${query}] returned [${results.length}] results`
            );
            if (results == null || results.length === 0) {
              // return Promise.resolve();
              resolve(null);
            } else {
              let url = results[0].url;
              if (results.length > 1) {
                console.warn(
                  `WARNING: More than one result for track '${track.title}' by ${track.artist}. Using first track at url [${url}]`
                );
              }
              bandcamp.getTrackInfo(url, (error, bcTrackInfo) => {
                if (error) {
                  reject(error);
                } else {
                  let durationInSeconds = bcTrackInfo.raw.trackinfo[0].duration;
                  resolve(durationInSeconds * 1000);
                }
              });
            }
          }
        });
      });
    });
  }
}
