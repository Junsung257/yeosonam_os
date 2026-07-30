import type { V3Evidence, V3SourceLine } from './types';
import { evidenceFromLines } from './source-line-index';

export type SourceBackedFlightScheduleOption = {
  leg: 'outbound' | 'inbound';
  carrier_name: string;
  dep_time: string;
  arr_time: string;
  dep_location: string;
  arr_location: string;
  evidence: V3Evidence;
};

const TIME_RANGE_RE = /([가-힣A-Za-z][가-힣A-Za-z\s]{1,18}?)\s*(\d{1,2}:\d{2})\s*[-–—~]\s*(\d{1,2}:\d{2})/u;
const ROUTE_PREFIX_RE = /^\s*([가-힣A-Za-z]{2,15})\s*[-–—→]\s*([가-힣A-Za-z]{2,15})\s*[-–—:]?\s*/u;
const HEADING_RE = /^\s*항공\s*시간\s*$/u;

function normalizedTime(value: string): string | null {
  const match = value.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function normalizedCarrierName(value: string): string {
  return value
    .replace(/^[\s,.;:/|]+|[\s,.;:/|]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeRouteLocation(value: string): string {
  return value.replace(/\s+/g, '').trim();
}

function isPlausibleCarrierName(value: string): boolean {
  if (value.length < 2 || value.length > 18) return false;
  if (/^(?:출발|도착|항공|항공시간|왕복|편명|시간)$/u.test(value)) return false;
  return /[가-힣A-Za-z]/u.test(value);
}

function candidateLines(lines: V3SourceLine[]): V3SourceLine[] {
  const candidates: V3SourceLine[] = [];
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const quote = line.quote.trim();
    if (HEADING_RE.test(quote)) {
      for (const next of lines.slice(index + 1, index + 4)) {
        if (TIME_RANGE_RE.test(next.quote)) candidates.push(next);
        if (candidates.length > 0) break;
      }
      continue;
    }
    if (ROUTE_PREFIX_RE.test(quote) && TIME_RANGE_RE.test(quote)) candidates.push(line);
  }
  return candidates.filter((line, index, all) => (
    all.findIndex(other => other.lineNumber === line.lineNumber) === index
  ));
}

export function extractSourceBackedRoundTripFlightOptions(
  lines: V3SourceLine[],
): SourceBackedFlightScheduleOption[] {
  const options: SourceBackedFlightScheduleOption[] = [];

  for (const line of candidateLines(lines)) {
    const pieces = line.quote
      .split(/\s*[,，]\s*/u)
      .map(piece => piece.trim())
      .filter(Boolean);
    let outboundRoute: { dep: string; arr: string } | null = null;
    let currentRoute: { dep: string; arr: string } | null = null;
    let currentLeg: 'outbound' | 'inbound' | null = null;

    for (const piece of pieces) {
      let optionText = piece;
      const route = optionText.match(ROUTE_PREFIX_RE);
      if (route) {
        currentRoute = {
          dep: normalizeRouteLocation(route[1]),
          arr: normalizeRouteLocation(route[2]),
        };
        optionText = optionText.slice(route[0].length);
        if (!outboundRoute) {
          outboundRoute = currentRoute;
          currentLeg = 'outbound';
        } else if (
          currentRoute.dep === outboundRoute.arr
          && currentRoute.arr === outboundRoute.dep
        ) {
          currentLeg = 'inbound';
        } else {
          currentLeg = null;
        }
      }

      if (!currentRoute || !currentLeg) continue;
      const timeRange = optionText.match(TIME_RANGE_RE);
      if (!timeRange) continue;
      const carrierName = normalizedCarrierName(timeRange[1]);
      const depTime = normalizedTime(timeRange[2]);
      const arrTime = normalizedTime(timeRange[3]);
      if (!isPlausibleCarrierName(carrierName) || !depTime || !arrTime) continue;

      options.push({
        leg: currentLeg,
        carrier_name: carrierName,
        dep_time: depTime,
        arr_time: arrTime,
        dep_location: currentRoute.dep,
        arr_location: currentRoute.arr,
        evidence: evidenceFromLines(lines, line.lineNumber),
      });
    }
  }

  const hasOutbound = options.some(option => option.leg === 'outbound');
  const hasInbound = options.some(option => option.leg === 'inbound');
  if (!hasOutbound || !hasInbound) return [];

  return options.filter((option, index, all) => (
    all.findIndex(other => (
      other.leg === option.leg
      && other.carrier_name === option.carrier_name
      && other.dep_time === option.dep_time
      && other.arr_time === option.arr_time
      && other.dep_location === option.dep_location
      && other.arr_location === option.arr_location
    )) === index
  ));
}

function routeLabel(option: SourceBackedFlightScheduleOption): string {
  return `${option.dep_location}→${option.arr_location}`;
}

function timeLabel(option: SourceBackedFlightScheduleOption): string {
  return `${option.dep_time}~${option.arr_time}`;
}

export function buildFlightOptionCustomerNotice(
  options: SourceBackedFlightScheduleOption[],
): string | null {
  const outbound = options.filter(option => option.leg === 'outbound');
  const inbound = options.filter(option => option.leg === 'inbound');
  if (outbound.length === 0 || inbound.length === 0) return null;

  const outboundTimes = [...new Set(outbound.map(timeLabel))].join(' 또는 ');
  const inboundTimes = [...new Set(inbound.map(timeLabel))].join(' 또는 ');
  return [
    '항공사와 편명은 예약 시 최종 확정됩니다.',
    `원문 안내 시간대는 ${routeLabel(outbound[0])} ${outboundTimes},`,
    `${routeLabel(inbound[0])} ${inboundTimes}입니다.`,
  ].join(' ');
}
