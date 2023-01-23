import SpotifyWebApi from "spotify-web-api-node";
import Track from "../model/Track.js";
import { requireNotBlank } from "../Utils.js";
import throttledQueue from "throttled-queue";

export default class SpotifyService {
  constructor(clientId, clientSecret, options = {}) {
    requireNotBlank("clientId", clientId);
    requireNotBlank("clientSecret", clientSecret);
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.spotifyApi = new SpotifyWebApi({
      clientId: clientId,
      clientSecret: clientSecret,
      redirectUri: "http://www.example.com/callback",
    });
    this.throttleRequest = throttledQueue(
      options.maxRequestsPerSecond || 1,
      1000
    );
  }

  /**
   *
   * @param {Track} track
   * @returns {Promise<SpotifyApi.TrackObjectFull[]>}
   */
  searchTracks(track) {
    return new Promise((resolve, reject) => {
      this.throttleRequest(() => {
        let query = `track:'${track.title}' artist:'${track.artist}' album:'${track.album.title}'`;
        this.spotifyApi.searchTracks(query).then((searchResponse) => {
          let tracks = searchResponse.body.tracks;
          if (tracks != null) {
            console.log(
              `Spotify query [${query}] returned [${tracks.items.length}] results.`
            );
            resolve(tracks.items);
          } else {
            reject(
              `No tracks returned in response body: ${JSON.stringify(
                response.body
              )}`
            );
          }
        }, reject);
      });
    });
  }

  /**
   *
   * @param {Track} lastFmTrack
   * @returns {Promise<number>}
   */
  getTrackDuration(lastFmTrack) {
    return this.searchTracks(lastFmTrack).then((spotifyTracks) => {
      if (!spotifyTracks.length) {
        return Promise.resolve(null);
      } else if (spotifyTracks.length > 1) {
        console.warn(
          `WARNING: More than one result for track '${lastFmTrack.title}' by ${lastFmTrack.artist}. Using first track.`
        );
      }
      return Promise.resolve(spotifyTracks[0].duration_ms);
    });
  }
}
