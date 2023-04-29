// const createCollage = require("photo-collage");
import https from "https";

import * as PImage from "pureimage";
import * as fs from "fs";
import { trimText } from "../Utils.js";
import ActivitySummary from "../model/ActivitySummary.js";
import logger from "../logger.js";

const ALBUM_ART_SIZE = 300;

const FONTS_DIR = "resources/fonts";

const FONTS = [{ name: "Open Sans Regular", file: "OpenSans-Regular.ttf" }];

const LABEL_FONT = "Open Sans Regular";

const isJpegFileExt = (fileName) =>
  fileName.endsWith(".jpg") || fileName.endsWith(".jpeg");
const isPngFileExt = (fileName) => fileName.endsWith(".png");

function getEncodeFunction(fileName) {
  if (isJpegFileExt(fileName)) {
    return PImage.encodeJPEGToStream;
  } else if (isPngFileExt(fileName)) {
    return PImage.encodePNGToStream;
  } else {
    throw new Error(
      `Unrecognized file extension for file [${fileName}], cannot determine encode function.`
    );
  }
}

function getDecodeFunction(fileName) {
  if (isJpegFileExt(fileName)) {
    return PImage.decodeJPEGFromStream;
  } else if (isPngFileExt(fileName)) {
    return PImage.decodePNGFromStream;
  } else {
    throw new Error(
      `Unrecognized file extension for file [${fileName}], cannot determine decode function.`
    );
  }
}

function getImage(url) {
  return new Promise((resolve, reject) =>
    https.get(url, resolve).on("error", reject)
  ).then((imageStream) => getDecodeFunction(url)(imageStream));
}

/**
 *
 * @param {Bitmap} image
 * @param {string} fileName
 * @returns {Promise<void>}
 */
function save(image, fileName) {
  return getEncodeFunction(fileName)(image, fs.createWriteStream(fileName));
}

export default class CollageGeneratorService {
  constructor(options = {}) {
    this.showListeningTime = options.showListeningTime || true;
    for (let font of FONTS) {
      PImage.registerFont(`${FONTS_DIR}/${font.file}`, font.name).loadSync();
    }
  }

  /**
   *
   * @param {string} path
   * @param {ActivitySummary} activitySummary
   * @returns {Promise<ActivitySummary>}
   */
  generate(path, activitySummary) {
    if (fs.existsSync(path)) {
      fs.unlinkSync(path);
    }
    const gridSize = Math.min(
      5,
      Math.ceil(Math.sqrt(activitySummary.results.length))
    );
    const labelLineHeightPx = 16;
    const labelLines = 3;
    const labelHeight = labelLines * labelLineHeightPx;
    const [cellWidth, cellHeight] = [
      ALBUM_ART_SIZE,
      ALBUM_ART_SIZE + labelHeight,
    ];
    const [canvasWidth, canvasHeight] = [
      cellWidth * gridSize,
      cellHeight * gridSize,
    ];
    const canvas = PImage.make(canvasWidth, canvasHeight);
    const canvasCtx = canvas.getContext("2d");
    // canvasCtx.strokeStyle = "black";
    // canvasCtx.lineWidth = 2;
    canvasCtx.fillStyle = "white";
    canvasCtx.font = `${labelLineHeightPx}px '${LABEL_FONT}'`;

    // canvasCtx.fillRect(0, 0, canvasWidth, canvasHeight);

    let drawPromises = [];

    for (let i = 0; i < activitySummary.results.length; i++) {
      let albumListening = activitySummary.results[i];
      let col = i % gridSize;
      let row = Math.floor(i / gridSize);
      let [posX, posY] = [col * cellWidth, row * cellHeight];

      drawPromises.push(
        getImage(albumListening.album.cover)
          .then(
            (albumCover) => {
              logger.info(
                `Rendering album art for album #${i + 1} ['${
                  albumListening.album.title
                }' by ${
                  albumListening.album.artist
                }] at [x=${posX} y=${posY}] with listening time [${
                  albumListening.length
                }]`
              );
              canvasCtx.drawImage(
                albumCover,
                posX,
                posY + labelHeight,
                ALBUM_ART_SIZE,
                ALBUM_ART_SIZE
              );
            },
            (error) => {
              logger.warn(
                `Could not get album art for album [${albumListening.album.title}] with cover [${albumListening.album.cover}]: ${error.message}`
              );
            }
          )
          .then(() => {
            if (this.showListeningTime) {
              logger.info(
                `Rendering listening time [${
                  albumListening.length
                }] for album #${i + 1} [${
                  albumListening.album.title
                }] at [x=${posX} y=${posY}]`
              );

              let artistLabel = albumListening.variousArtists
                ? "Various Artists"
                : albumListening.album.artist;
              let albumListeningTimeLabel = albumListening.dirty
                ? `*${albumListening.length}`
                : albumListening.length;
              canvasCtx.fillText(
                trimText(artistLabel, 32),
                posX,
                posY + labelLineHeightPx - 2,
                cellWidth
              );
              canvasCtx.fillText(
                trimText(albumListening.album.title, 32),
                posX,
                posY + 2 * labelLineHeightPx - 2,
                cellWidth
              );
              canvasCtx.fillText(
                albumListeningTimeLabel,
                posX,
                posY + 3 * labelLineHeightPx - 2,
                cellWidth
              );
            }
            return Promise.resolve();
          })
      );
    }

    return Promise.all(drawPromises)
      .then(
        () => save(canvas, path),
        (reason) => {
          logger.error(`Error occurred drawing collage: ${reason}`);
          throw new Error(reason);
        }
      )
      .then(
        () => activitySummary,
        (reason) => {
          logger.error(`Error occurred saving collage to file: ${reason}`);
          throw new Error(reason);
        }
      );
  }
}
