/**
 * Turns a Pokémon's official artwork into something that sits next to the in-game sprites: shrunk
 * to sprite size, hard-edged, cut to a small palette and outlined in a darker shade, on the same
 * 96x96 frame as a PokéAPI sprite. Only used for the few forms that have no sprite of their own.
 */

/** PokéAPI sprites are 96x96 with the Pokémon standing near the bottom. */
export const FRAME = 96
/** The longest side of the shrunk Pokémon: about the size of the big legendaries in their own sprites. */
const MAX_SIZE = 84
/** Air under the feet, like the sprites. */
const BOTTOM_GAP = 6
const PALETTE_SIZE = 16

type RGB = [number, number, number]

/** Median cut: splits the colours along their widest channel until there are `size` boxes, then averages each. */
export function medianCut(colors: RGB[], size: number): RGB[] {
  if (colors.length === 0) return []
  let boxes: RGB[][] = [colors]
  while (boxes.length < size) {
    let best = -1
    let bestRange = 0
    let bestChannel = 0
    boxes.forEach((box, i) => {
      if (box.length < 2) return
      for (let c = 0; c < 3; c++) {
        let lo = 255
        let hi = 0
        for (const col of box) {
          if (col[c] < lo) lo = col[c]
          if (col[c] > hi) hi = col[c]
        }
        if (hi - lo > bestRange) {
          bestRange = hi - lo
          best = i
          bestChannel = c
        }
      }
    })
    if (best < 0) break
    const box = boxes[best].slice().sort((a, b) => a[bestChannel] - b[bestChannel])
    const mid = box.length >> 1
    boxes = [...boxes.slice(0, best), box.slice(0, mid), box.slice(mid), ...boxes.slice(best + 1)]
  }
  return boxes.map((box) => {
    const sum = box.reduce((s, c) => [s[0] + c[0], s[1] + c[1], s[2] + c[2]], [0, 0, 0])
    return sum.map((v) => Math.round(v / box.length)) as RGB
  })
}

function nearest(palette: RGB[], r: number, g: number, b: number): RGB {
  let best = palette[0]
  let bestD = Infinity
  for (const p of palette) {
    const d = (p[0] - r) ** 2 + (p[1] - g) ** 2 + (p[2] - b) ** 2
    if (d < bestD) {
      bestD = d
      best = p
    }
  }
  return best
}

/**
 * The pixel filter on raw RGBA pixels (width x height), in place: alpha becomes all or nothing,
 * colours snap to a 16-colour palette, and every pixel on the silhouette's edge is darkened into an
 * outline, as hand-made sprites have.
 */
export function pixelFilter(data: Uint8ClampedArray, width: number, height: number): void {
  const opaque = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < width && y < height && data[(y * width + x) * 4 + 3] >= 128
  const colors: RGB[] = []
  for (let i = 0; i < data.length; i += 4) if (data[i + 3] >= 128) colors.push([data[i], data[i + 1], data[i + 2]])
  const palette = medianCut(colors, PALETTE_SIZE)
  const edge: boolean[] = []
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      edge.push(opaque(x, y) && !(opaque(x - 1, y) && opaque(x + 1, y) && opaque(x, y - 1) && opaque(x, y + 1)))
    }
  }
  for (let p = 0; p < width * height; p++) {
    const i = p * 4
    if (data[i + 3] < 128) {
      data[i + 3] = 0
      continue
    }
    const [r, g, b] = nearest(palette, data[i], data[i + 1], data[i + 2])
    const k = edge[p] ? 0.35 : 1
    data[i] = Math.round(r * k)
    data[i + 1] = Math.round(g * k)
    data[i + 2] = Math.round(b * k)
    data[i + 3] = 255
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`could not load ${url}`))
    img.src = url
  })
}

function canvas(w: number, h: number) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return [c, c.getContext('2d', { willReadFrequently: true })!] as const
}

async function pixelate(url: string): Promise<string> {
  const img = await loadImage(url)
  // Crop to the Pokémon itself so its size, not the artwork's padding, decides the scale.
  const [full, fctx] = canvas(img.naturalWidth, img.naturalHeight)
  fctx.drawImage(img, 0, 0)
  const { data, width, height } = fctx.getImageData(0, 0, full.width, full.height)
  let x0 = width
  let y0 = height
  let x1 = -1
  let y1 = -1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] < 32) continue
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
    }
  }
  if (x1 < 0) throw new Error('empty artwork')
  const bw = x1 - x0 + 1
  const bh = y1 - y0 + 1
  const scale = MAX_SIZE / Math.max(bw, bh)
  const w = Math.max(1, Math.round(bw * scale))
  const h = Math.max(1, Math.round(bh * scale))

  // Shrink by halves first, so the last step averages neighbours instead of skipping them.
  let src: HTMLCanvasElement = full
  let sx = x0
  let sy = y0
  let sw = bw
  let sh = bh
  while (sw / 2 > w * 1.5) {
    const [half, hctx] = canvas(Math.ceil(sw / 2), Math.ceil(sh / 2))
    hctx.imageSmoothingQuality = 'high'
    hctx.drawImage(src, sx, sy, sw, sh, 0, 0, half.width, half.height)
    src = half
    sx = 0
    sy = 0
    sw = half.width
    sh = half.height
  }
  const [, sctx] = canvas(w, h)
  sctx.imageSmoothingQuality = 'high'
  sctx.drawImage(src, sx, sy, sw, sh, 0, 0, w, h)
  const pixels = sctx.getImageData(0, 0, w, h)
  pixelFilter(pixels.data, w, h)

  const [frame, ctx] = canvas(FRAME, FRAME)
  ctx.putImageData(pixels, Math.floor((FRAME - w) / 2), FRAME - BOTTOM_GAP - h)
  return frame.toDataURL('image/png')
}

const cache = new Map<string, Promise<string>>()

/** The pixel-filtered artwork as a PNG data URL, made once per URL. Rejects if the artwork can't be loaded. */
export function pixelArtwork(url: string): Promise<string> {
  let made = cache.get(url)
  if (!made) {
    made = pixelate(url)
    made.catch(() => cache.delete(url))
    cache.set(url, made)
  }
  return made
}
