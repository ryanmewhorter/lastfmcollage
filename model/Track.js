import Album from "./Album.js";

export default class Track {
  /**
   * Create a new Track
   * @param {string} title
   * @param {string} artist
   * @param {Album} album
   * @param {string} length
   * @param {string} mbId
   */
  constructor(title, artist, album, length, mbId) {
    this.title = title;
    this.artist = artist;
    this.album = album;
    this.length = length;
    this.mbId = mbId;
  }

}
