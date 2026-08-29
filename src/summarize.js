// ======================================================
// RotorFlight-Blackbox-Video-Overlay — FLIGHT SUMMARY
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

  if (flight.mainFieldNames.length > 0) {
    summary.mainFields = [...flight.mainFieldNames];
  }

  return summary;
}