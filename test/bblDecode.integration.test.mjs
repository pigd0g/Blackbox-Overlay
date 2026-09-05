// ======================================================
// Blackbox-Overlay — REAL-LOG INTEGRATION TEST
// ======================================================
//
// Decodes every .bbl fixture in test/fixtures/ and checks
// the invariants that matter for a reader: flights are
// found, the time column moves forward, and the summary
// data is sane. Skips cleanly when no fixture is present.
//
// ======================================================

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { decodeBblFile, looksLikeBinaryBbl } from "../src/bbl/bblDecoder.js";

const fixturesDirectory = join(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures"
);

const fixtures = existsSync(fixturesDirectory)
  ? readdirSync(fixturesDirectory).filter((name) =>
      /\.(bbl|bfl)$/i.test(name)
    )
  : [];

test("real log fixtures decode cleanly", { skip: fixtures.length === 0 }, () => {
  for (const name of fixtures) {
    const bytes = new Uint8Array(
      readFileSync(join(fixturesDirectory, name))
    );

    assert.ok(looksLikeBinaryBbl(bytes), `${name}: probe says not binary`);

    const { flightCount, flights } = decodeBblFile(bytes);
    assert.ok(flightCount >= 1, `${name}: no flights found`);

    for (const flight of flights) {
      if (flight.mainFrames.length === 0) {
        continue;
      }

      const timeIndex = flight.mainFieldNames.indexOf("time");
      assert.ok(timeIndex >= 0, `${name}: no time field`);

      for (let i = 1; i < flight.mainFrames.length; i += 1) {
        assert.ok(
          flight.mainFrames[i][timeIndex] >=
            flight.mainFrames[i - 1][timeIndex],
          `${name}: time went backwards at frame ${i}`
        );
      }

      assert.ok(
        flight.durationSeconds > 0,
        `${name}: duration not positive`
      );
    }
  }
});

test("Kraken fixture exposes expected summary shape", { skip: fixtures.length === 0 }, () => {
  const bytes = new Uint8Array(
    readFileSync(join(fixturesDirectory, "Kraken_20260522_025600.bbl"))
  );

  const { flights } = decodeBblFile(bytes);
  const flight = flights.find((entry) => entry.mainFrames.length > 0);

  assert.ok(flight, "no decodable flight in fixture");

  assert.ok(flight.sysConfig.craftName, "craft name missing");
  assert.ok(flight.mainFieldNames.includes("loopIteration"));
  assert.ok(flight.mainFieldNames.length > 5, "suspiciously few fields");
  assert.ok(flight.mainFrames.length > 1000, "suspiciously few frames");
});