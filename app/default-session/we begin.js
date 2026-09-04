stack(
  s("bd ~ ~ bd ~ bd ~ ~").gain(0.07).distort(0.45).shape(0.98).sustain(0.65).compressor(1),
  s("~ ~ cp ~ ~ ~ cp ~").gain(0.6),
  s("hh*8?").gain(1).sometimesBy(0.1, x=>x.fast(2)).pan(sine.slow(4))
).swingBy(1/16, 8)