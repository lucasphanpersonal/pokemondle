import { describe, expect, it } from 'vitest'
import { medianCut, pixelFilter } from './pixelate'

describe('medianCut', () => {
  it('keeps distinct colours apart and never returns more than asked', () => {
    const reds = Array.from({ length: 10 }, () => [250, 10, 10] as [number, number, number])
    const blues = Array.from({ length: 10 }, () => [10, 10, 250] as [number, number, number])
    const palette = medianCut([...reds, ...blues], 2)
    expect(palette).toHaveLength(2)
    expect(palette).toContainEqual([250, 10, 10])
    expect(palette).toContainEqual([10, 10, 250])
  })
  it('handles no colours', () => {
    expect(medianCut([], 16)).toEqual([])
  })
})

describe('pixelFilter', () => {
  it('makes alpha all or nothing and darkens the edge into an outline', () => {
    // 3x3 opaque grey square with a faint pixel in a 5x5 image.
    const w = 5
    const data = new Uint8ClampedArray(w * w * 4)
    const set = (x: number, y: number, a: number) => data.set([200, 200, 200, a], (y * w + x) * 4)
    for (let y = 1; y <= 3; y++) for (let x = 1; x <= 3; x++) set(x, y, 255)
    set(0, 0, 60)
    pixelFilter(data, w, w)
    const at = (x: number, y: number) => Array.from(data.slice((y * w + x) * 4, (y * w + x) * 4 + 4))
    expect(at(0, 0)[3]).toBe(0)
    expect(at(2, 2)).toEqual([200, 200, 200, 255])
    expect(at(1, 1)).toEqual([70, 70, 70, 255])
  })
})
