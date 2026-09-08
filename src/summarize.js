// ======================================================
// Blackbox-Overlay — FLIGHT SUMMARY
// ======================================================
//
// Shared flight summaries for the CLI ("Flight N" blocks)
// and the GUI log panel: one object per decoded flight with
// the fields both surfaces print.
//
// ======================================================

/**
 * One flight's summary object. `mainFields` is only
 * attached when the flight actually decoded field names.
 */
export function summarizeFlight(flight) {
  const summary = {
    flight: flight.index + 1,
    craftName: flight.sysConfig.craftName ?? null,
    firmware: [flight.sysConfig.firmwareType, flight.sysConfig.firmwareRevision]
      .filter(Boolean)
      .join(" ") || null,
    firmwareDate: flight.sysConfig.firmwareDate ?? null,
    board: flight.sysConfig.boardInformation ?? null,
    logStart: flight.sysConfig.logStartDatetime ?? null,
    dataVersion: flight.sysConfig.dataVersion,
    durationSeconds: Number(flight.durationSeconds.toFixed(3)),
    mainFrameCount: flight.mainFrames.length,
    slowFrameCount: flight.slowFrames.length,
    gpsFrameCount: flight.gpsFrames.length,
    eventCount: flight.events.length,
    corruptFrames: flight.stats.corruptFrames,
    mainFieldCount: flight.mainFieldNames.length
  };

  // GPS readouts are offered only when the flight actually
  // carries GPS frames plus the fields the overlay needs.
  summary.gps =
    flight.gpsFrames?.length > 0 &&
    ["GPS_speed", "GPS_altitude", "GPS_numSat", "GPS_ground_course", "GPS_coord[0]", "GPS_coord[1]"]
      .every((name) => (flight.gpsFieldNames ?? []).includes(name));

  if (flight.mainFieldNames.length > 0) {
    summary.mainFields = [...flight.mainFieldNames];
  }

  return summary;
}