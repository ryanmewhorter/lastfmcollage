export default class Album {
  /**
   * Create a new Album
   * @param {string} title
   * @param {string} artist
   * @param {string} cover
   * @param {string} mbId
   */
  constructor(title, artist, cover, mbId) {
    this.title = title;
    this.artist = artist;
    this.cover = cover;
    this.mbId = mbId;
  }
}
