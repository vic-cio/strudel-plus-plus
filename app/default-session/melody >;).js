stack(
  s("bd ~ ~ bd ~ bd ~ ~").gain(0.28).distort(0.6).shape(0.8).sustain(0.9).compressor(0.9),
  s("~ ~ cp ~ ~ ~ cp ~").gain(0.6),
  s("hh*8?").gain(0.85).sometimesBy(0.1, x=>x.fast(2)).pan(sine.slow(4)),
  note("c1 ~ ~ c1 eb1 ~ c1 ~").s("sawtooth")
    .lpf(300).lpq(8).distort(0.5).shape(0.3).gain(0.45)
    .slide(0.3).release(0.13),
  note("<c4 eb4 g4 bb4>*8")
    .struct("<x ~ x x ~ x ~ x x ~ - x x x ~ x>*4")
    .sometimesBy(0.4, x=>x.fast(2))
    .rarely(x=>x.ply(1))
    .s("gm_shamisen")
    .gain(1.8).shape(0.55).room(0.6).size(0.35).delay(0.15).delaytime(0.1)
    .attack(0.005).decay(0.2).sustain(0.1).release(0.1).pan(sine.slow(2).range(0.55, 0.75))
    .gain("0.8 1 1 0.8 1 0.8 1 1"),
).swingBy(1/8, 8)