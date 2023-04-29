export default class ActivitySummary {
  /**
   * Create a new ActivitySummary
   * @param {string} user
   * @param {moment.Moment} timeFrom
   * @param {moment.Moment} timeTo
   * @param {any[]} results
   * @param {string[]} messages
   */
  constructor(user, timeFrom, timeTo, results, messages) {
    this.user = user;
    this.timeFrom = timeFrom;
    this.timeTo = timeTo;
    this.results = results;
    this.messages = messages;
  }
}
