stack(
  s("bd ~ ~ bd ~ bd ~ ~").gain(0.3).distort(0.6).shape(0.8).sustain(0.9).compressor(0.9),
  s("~ ~ cp ~ ~ ~ cp ~").gain(0.6),
  s("hh*8?").gain(1).sometimesBy(0.1, x=>x.fast(2)).pan(sine.slow(4)),
  note("c1 ~ ~ c1 eb1 ~ c1 ~").s("sawtooth")
    .lpf(300).lpq(8).distort(0.5).shape(0.3).gain(0.6)
    .slide(0.3).release(0.13),
).swingBy(1/16, 8)