// Link measurement: fire probes at a fixed interval, match the replies, and
// turn the result into statistics you can act on.
//
// Kept free of browser APIs so the maths is unit-testable. The app owns the
// timers and the radio; this owns the bookkeeping.

// SNR below which each spreading factor stops demodulating (Semtech figures).
// LoRa works under the noise floor, which is why these are negative.
export const SNR_FLOOR = {
  7: -7.5,
  8: -10.0,
  9: -12.5,
  10: -15.0,
  11: -17.5,
  12: -20.0,
};

// Headroom to leave for fading. A link tuned to exactly break even drops out
// the moment someone walks between the boards.
export const TARGET_MARGIN_DB = 10;

export function linkMargin(snr, sf) {
  const floor = SNR_FLOOR[sf];
  if (floor === undefined || !Number.isFinite(snr)) return null;
  return snr - floor;
}

// How much further you could go with the margin in hand, for a given path-loss
// exponent (2 free space, ~3 suburban, 4+ dense urban).
export function rangeFactor(marginDb, pathLossExponent = 3) {
  if (!Number.isFinite(marginDb)) return null;
  return 10 ** (marginDb / (10 * pathLossExponent));
}

export function createSurvey({ sf = 9, intervalMs = 5000, timeoutMs = 15000 } = {}) {
  return { sf, intervalMs, timeoutMs, startedAt: null, stoppedAt: null, probes: [] };
}

export function recordSent(survey, seq, at) {
  survey.probes.push({ seq, sentAt: at, reply: null });
  if (survey.startedAt === null) survey.startedAt = at;
  return survey;
}

export function recordReply(survey, seq, { rssi, snr, at }) {
  // Search backwards: the match is almost always the most recent probe.
  for (let i = survey.probes.length - 1; i >= 0; i--) {
    const p = survey.probes[i];
    if (p.seq === seq && p.reply === null) {
      p.reply = { rssi, snr, at, rttMs: at - p.sentAt };
      return true;
    }
  }
  return false;  // a duplicate or a reply to something we never sent
}

// A probe still inside its timeout is in flight, not lost - counting it as lost
// would make the delivery ratio dip after every single send.
export function summarise(survey, now = Date.now()) {
  let received = 0;
  let lost = 0;
  let pending = 0;
  const rtts = [];
  const rssis = [];
  const snrs = [];

  for (const p of survey.probes) {
    if (p.reply) {
      received++;
      rtts.push(p.reply.rttMs);
      if (Number.isFinite(p.reply.rssi)) rssis.push(p.reply.rssi);
      if (Number.isFinite(p.reply.snr)) snrs.push(p.reply.snr);
    } else if (now - p.sentAt >= survey.timeoutMs) {
      lost++;
    } else {
      pending++;
    }
  }

  const answered = received + lost;
  const snrStats = spread(snrs);
  const margin = snrStats ? linkMargin(snrStats.avg, survey.sf) : null;

  return {
    sf: survey.sf,
    sent: survey.probes.length,
    received,
    lost,
    pending,
    pdr: answered ? received / answered : null,
    rtt: spread(rtts),
    rssi: spread(rssis),
    snr: snrStats,
    margin,
    rangeFactor: margin === null ? null : rangeFactor(margin),
    elapsedMs: survey.startedAt === null ? 0 : now - survey.startedAt,
  };
}

export function spread(values) {
  if (!values.length) return null;
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
    sum += v;
  }
  return { min, max, avg: sum / values.length, n: values.length };
}

export function formatPercent(ratio) {
  return ratio === null ? '-' : `${(ratio * 100).toFixed(0)}%`;
}

export function toCsv(survey) {
  const rows = ['seq,sent_at_ms,delivered,rtt_ms,rssi_dbm,snr_db,sf'];
  for (const p of survey.probes) {
    rows.push(
      [
        p.seq,
        p.sentAt,
        p.reply ? 1 : 0,
        p.reply ? p.reply.rttMs : '',
        p.reply ? p.reply.rssi : '',
        p.reply ? p.reply.snr : '',
        survey.sf,
      ].join(',')
    );
  }
  return rows.join('\n');
}
