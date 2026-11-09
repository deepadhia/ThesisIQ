/** Select likely statement tables when the PDF's scanned pages have no usable text layer. */
import { createCanvas, loadImage } from '@napi-rs/canvas';

async function gridScore(bytes) {
  const image = await loadImage(bytes);
  const canvas = createCanvas(image.width, image.height);
  const context = canvas.getContext('2d');
  context.drawImage(image, 0, 0);
  const {data} = context.getImageData(0, 0, image.width, image.height);
  const width = image.width, height = image.height;
  const dark = (x, y) => {
    const i = (y * width + x) * 4;
    return data[i] + data[i + 1] + data[i + 2] < 690;
  };
  let longRows = 0, longColumns = 0;
  for (let y = Math.floor(height * .08); y < Math.floor(height * .88); y++) {
    let run = 0, longest = 0;
    for (let x = Math.floor(width * .05); x < Math.floor(width * .95); x++) {
      run = dark(x, y) ? run + 1 : 0;
      longest = Math.max(longest, run);
    }
    if (longest > width * .27) longRows++;
  }
  for (let x = Math.floor(width * .05); x < Math.floor(width * .95); x++) {
    let run = 0, longest = 0;
    for (let y = Math.floor(height * .08); y < Math.floor(height * .88); y++) {
      run = dark(x, y) ? run + 1 : 0;
      longest = Math.max(longest, run);
    }
    if (longest > height * .12) longColumns++;
  }
  // Long horizontal and vertical rules distinguish result grids from auditor prose.
  return longRows >= 8 && longColumns >= 5 ? longRows + longColumns : 0;
}

export async function rankScannedTablePages(candidates = [], max = 2) {
  const scores = await Promise.all(candidates.map(async ({num, image}) => ({num, score: await gridScore(image)})));
  return scores.filter(({score}) => score > 0)
    .sort((a, b) => b.score - a.score || b.num - a.num)
    .slice(0, max).map(({num}) => num);
}

/** Rotate scanned landscape pages embedded sideways in portrait PDF sheets for OCR. */
export async function rotateOcrImages(images = []) {
  return Promise.all(images.map(async bytes => {
    const source = await loadImage(bytes);
    const canvas = createCanvas(source.height, source.width);
    const context = canvas.getContext('2d');
    context.translate(source.height, 0);
    context.rotate(Math.PI / 2);
    context.drawImage(source, 0, 0);
    return canvas.toBuffer('image/png');
  }));
}
