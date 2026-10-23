// Unit checks for tree/daylight.ts (sun, moon, sky, lights over a day and a year) and tree/clock.ts. Run by tools/unit-test.mjs.
export default async ({ bundle, assert }) => {
  const D = await bundle("src/tree/daylight.ts", "daylight-unit.mjs");
  const K = await bundle("src/tree/clock.ts", "clock-unit.mjs");
  const DEG = Math.PI / 180;
  const len = (v) => Math.hypot(v.x, v.y, v.z);
  const nums = (d) => {
    const out = [];
    for (const [k, v] of Object.entries(d)) {
      if (typeof v === "number") out.push([k, v]);
      else if (Array.isArray(v)) v.forEach((x, i) => out.push([`${k}[${i}]`, x]));
      else if (v && typeof v === "object") for (const [kk, x] of Object.entries(v)) out.push([`${k}.${kk}`, x]);
    }
    return out;
  };

  // 1. ranges, no NaN, unit vectors over the whole year
  for (const doy of [0, 80, 172, 266, 355]) {
    for (let m = 0; m < 24 * 60; m += 7) {
      const d = D.daylight(m / 60, doy);
      for (const [k, v] of nums(d)) assert.ok(Number.isFinite(v), `doy ${doy} ${m / 60}h: ${k} finite`);
      assert.ok(Math.abs(len(d.sunDir) - 1) < 1e-9 && Math.abs(len(d.moonDir) - 1) < 1e-9 && Math.abs(len(d.lightDir) - 1) < 1e-9 && Math.abs(len(d.rimDir) - 1) < 1e-9, "unit directions");
      for (const k of ["dayK", "stars", "moon", "sunDisc", "shadowStrength", "wispLight", "glowStrength"]) assert.ok(d[k] >= 0 && d[k] <= 1, `${k} in 0..1 (${d[k]})`);
      for (const k of ["lightColor", "hemiSky", "hemiGround", "fillColor", "rimColor", "skyZenith", "skyHorizon", "glowColor", "fogColor", "cloudTint"]) for (const c of d[k]) assert.ok(c >= 0 && c <= 1.0001, `${k} component ${c}`);
      assert.ok(d.lightIntensity >= 0 && d.lightIntensity <= 3.1 + 1e-9 && d.hemiIntensity > 0.1 && d.fogFar > d.fogNear);
    }
  }
  // garbage in, a sane day out
  for (const bad of [NaN, Infinity, -5, 99, undefined]) {
    const d = D.daylight(bad, bad, bad);
    assert.ok(nums(d).every(([, v]) => Number.isFinite(v)), `repairs ${bad}`);
  }
  assert.equal(D.daylight(25, 172).hours, 1, "hours wrap");

  // 2. the sun: south at noon, east in the morning, west in the evening; summer higher than winter
  {
    const noon = D.daylight(12, 172);
    assert.ok(noon.sunDir.z > 0.3 && Math.abs(noon.sunDir.x) < 0.02, "noon: due south (+z)");
    const am = D.daylight(8, 172), pm = D.daylight(16, 172);
    assert.ok(am.sunDir.x > 0.2 && pm.sunDir.x < -0.2, "morning east (+x), evening west (-x)");
    const winter = D.daylight(12, 355);
    assert.ok(noon.sunElev > winter.sunElev + 30 * DEG, `summer noon sun is much higher (${(noon.sunElev / DEG).toFixed(0)} vs ${(winter.sunElev / DEG).toFixed(0)} deg)`);
    assert.ok(Math.abs(noon.sunElev / DEG - (90 - 50 + 23.44)) < 1.5, "noon elevation at the solstice = 90 - lat + declination");
    const sm = D.sunTimes(172), wn = D.sunTimes(355);
    assert.ok(sm.rise < 5 && sm.set > 19 && wn.rise > 7.5 && wn.set < 16.5, `day length by season (summer ${sm.rise.toFixed(1)}-${sm.set.toFixed(1)}, winter ${wn.rise.toFixed(1)}-${wn.set.toFixed(1)})`);
    assert.ok(Math.abs(D.daylight(sm.rise, 172).sunElev) < 0.01 && Math.abs(D.daylight(wn.set, 355).sunElev) < 0.01, "elevation is 0 at the computed rise / set");
  }

  // 3. the day: noon bright and warm-white, dusk warm and dim, midnight dark with stars and moon light
  {
    const noon = D.daylight(12, 172), dusk = D.daylight(D.sunTimes(172).set, 172), mid = D.daylight(0.5, 172);
    assert.ok(noon.lightIntensity > 2.8 && noon.dayK > 0.99 && noon.shadowStrength > 0.99 && noon.stars === 0 && noon.moon === 0 && noon.wispLight < 0.01);
    assert.ok(dusk.lightIntensity < noon.lightIntensity * 0.5, "dusk is dimmer than noon");
    assert.ok(dusk.lightColor[0] > dusk.lightColor[2] + 0.3, "dusk light is warm (red > blue)");
    assert.ok(noon.hemiIntensity > dusk.hemiIntensity - 1e-9 && dusk.hemiIntensity > mid.hemiIntensity - 1e-9, "ambient falls through the evening");
    assert.ok(mid.stars > 0.95 && mid.shadowStrength === 0 && mid.wispLight > 0.95 && mid.dayK < 0.01, "midnight: stars, no shadows, the wisp lights up");
    assert.ok(mid.lightIntensity === 0 && mid.rimColor[2] > mid.rimColor[0] && mid.rimIntensity > 0.4 && mid.rimIntensity < 0.8, "night: the sun's light is out, the cool moon (rim) light is on and weak");
    assert.ok(Math.abs(mid.rimDir.x - mid.moonDir.x) < 0.01 && Math.abs(mid.rimDir.z - mid.moonDir.z) < 0.01 && Math.abs(len(mid.rimDir) - 1) < 1e-9, "the rim light comes from the moon at night");
    assert.ok(noon.rimDir.y > 0.2 && noon.rimDir.z < 0, "by day it is low, opposite the sun");
    assert.ok(mid.skyZenith[2] < 0.12 && noon.skyZenith[2] > 0.6, "dark vs blue zenith");
    assert.ok(noon.sunDisc === 1 && mid.sunDisc === 0, "the sun disc is gone at night");
    // dawn mirrors dusk
    const dawn = D.daylight(D.sunTimes(172).rise, 172);
    assert.ok(Math.abs(dawn.lightIntensity - dusk.lightIntensity) < 0.2 && dawn.lightColor[0] > dawn.lightColor[2], "dawn is warm too");
  }

  // 4. night brightness: the floor lifts the ambient light at night only
  {
    const dark = D.daylight(0, 172, 0), bright = D.daylight(0, 172, 1), noonA = D.daylight(12, 172, 0), noonB = D.daylight(12, 172, 1);
    assert.ok(bright.hemiIntensity > dark.hemiIntensity + 0.8 && bright.fillIntensity > dark.fillIntensity, "night brightness lifts the ambient light");
    assert.ok(Math.abs(noonA.hemiIntensity - noonB.hemiIntensity) < 1e-9, "and does nothing at noon");
    assert.ok(dark.hemiIntensity > 0.3, "never pitch black");
  }

  // 5. continuity: a minute of the clock never changes anything by much (a day is a film, not a slide show); also across midnight and for fast time
  {
    for (const doy of [20, 172, 300]) {
      let prev = D.daylight(0, doy);
      for (let m = 1; m <= 24 * 60; m++) {
        const cur = D.daylight((m % 1440) / 60, doy);
        const a = nums(prev), b = nums(cur);
        for (let i = 0; i < a.length; i++) {
          const k = a[i][0];
          if (k === "hours") continue;
          const lim = k.startsWith("fog") ? 150 : k === "lightIntensity" ? 0.1 : 0.04;
          assert.ok(Math.abs(a[i][1] - b[i][1]) <= lim, `doy ${doy} minute ${m}: ${k} jumps ${a[i][1]} -> ${b[i][1]}`);
        }
        prev = cur;
      }
    }
  }
  // the monotone parts: after sunrise the sun climbs to noon and the light grows
  {
    let prev = -1;
    for (let m = 5 * 60; m <= 12 * 60; m += 5) { const e = D.daylight(m / 60, 172).sunElev; assert.ok(e >= prev - 1e-9, "the sun climbs until noon"); prev = e; }
    let prevI = -1;
    for (let m = 4 * 60; m <= 12 * 60; m += 5) { const i = D.daylight(m / 60, 172).lightIntensity; assert.ok(i >= prevI - 0.02, `the light grows towards noon (${m})`); prevI = i; }
  }

  // 6. the clock
  {
    assert.deepEqual(K.parseClock(null), K.DEFAULT_CLOCK);
    assert.deepEqual(K.parseClock("garbage"), K.DEFAULT_CLOCK);
    assert.deepEqual(K.parseClock(JSON.stringify({ mode: "fixed", hour: 99, fastMinutes: 5, night: -3 })), { mode: "fixed", hour: 24, fastMinutes: 6, night: 0 });
    assert.equal(K.parseClock('{"mode":"nope"}').mode, "real");
    assert.deepEqual(K.parseClock(K.serializeClock({ mode: "fast", hour: 3, fastMinutes: 2, night: 0.9 })), { mode: "fast", hour: 3, fastMinutes: 2, night: 0.9 });
    assert.equal(K.hhmm(14.5), "14:30");
    assert.equal(K.hhmm(0), "00:00");
    assert.equal(K.hhmm(23.999), "23:59");
    assert.equal(K.hhmm(-1), "23:00");
    const t0 = new Date(2026, 9, 23, 9, 30, 0);
    assert.ok(Math.abs(K.localHour(t0) - 9.5) < 1e-9);
    assert.equal(K.dayOfYear(new Date(2026, 0, 1)), 0);
    assert.equal(K.dayOfYear(new Date(2026, 11, 31)), 364);
    const c = new K.WorldClock({ mode: "real", hour: 12, fastMinutes: 6, night: 0.5 }, t0);
    assert.ok(Math.abs(c.hours(new Date(2026, 9, 23, 18, 0, 0)) - 18) < 1e-9, "real = the local clock");
    c.set({ mode: "fixed", hour: 3.25, fastMinutes: 6, night: 0.5 }, t0);
    assert.equal(c.hours(new Date(2030, 1, 1, 12)), 3.25, "fixed = the chosen hour");
    c.set({ mode: "fast", hour: 3.25, fastMinutes: 6, night: 0.5 }, t0);
    assert.ok(Math.abs(c.hours(t0) - 3.25) < 1e-9, "fast continues from the hour it was at (no jump)");
    assert.ok(Math.abs(c.hours(new Date(t0.getTime() + 3 * 60000)) - (3.25 + 12)) < 1e-6, "6 minutes a day: 3 real minutes = 12 hours");
    assert.ok(c.hours(new Date(t0.getTime() + 7 * 60000)) < 24 && c.hours(new Date(t0.getTime() + 7 * 60000)) >= 0, "wraps");
    c.set({ mode: "fast", hour: 3.25, fastMinutes: 2, night: 0.5 }, new Date(t0.getTime() + 60000));
    const h1 = c.hours(new Date(t0.getTime() + 60000));
    assert.ok(Math.abs(h1 - c.hours(new Date(t0.getTime() + 60000))) < 1e-9 && Math.abs(c.hours(new Date(t0.getTime() + 120000)) - ((h1 + 12) % 24)) < 1e-6, "changing the speed keeps the hour and runs 2 min / day");
  }
};
