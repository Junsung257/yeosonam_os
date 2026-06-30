import type {
  V3DraftLedger,
  V3EventType,
  V3LedgerEvent,
  V3LedgerVariant,
  V3OptionCandidate,
  V3SourceLine,
  V3StructurePlan,
} from './types';
import { evidenceFromLines } from './source-line-index';
import { extractStandardNoticesFromRemarkLines } from './standard-notices';
import { extractStructuredFactsFromSupplierText } from './structured-facts';
import { extractPriceIR } from '@/lib/parser/deterministic/price-ir';
import { isCustomerOptionalTourCandidate, isNonCustomerOptionText } from '@/lib/customer-option-classifier';

const TIME_RE = /\b([01]?\d|2[0-3]):[0-5]\d\b/;
const TIME_RE_GLOBAL = /\b([01]?\d|2[0-3]):[0-5]\d\b/g;
const FLIGHT_CODE_RE = /\b([A-Z][A-Z0-9]|[0-9][A-Z])\s*(\d{3,4})\b/;
const PRICE_RE = /(?:KRW|\u20a9|\uc6d0)?\s*([1-9]\d{1,2}(?:,\d{3})+|[1-9]\d{5,})\s*(\uc6d0|KRW|USD|\$)?/i;
const ABBREVIATED_PRICE_RE = /^[1-9]\d{1,2},\s*-$/;
const USD_RE = /\$\s*(\d+(?:\.\d+)?)/;
const DAY_HEADER_RE = /^(?:day\s*(\d{1,2})(?:\b|\s|$)|\uc81c\s*(\d{1,2})\s*\uc77c(?:\s|$)|(\d{1,2})\s*\uc77c\ucc28(?:\s|$))/i;
const PRODUCT_HEADER_RE = /^(?:#{1,4}\s*)?(?:\uc0c1\ud488|product|variant|\ucf54\uc2a4|\ub4f1\uae09)\s*[:\-]/i;
const PRICE_HEADER_RE = /^price\s*[:\-]|^(?:\uac00\uaca9|\uc694\uae08)\s*[:\-]?/i;
const PRICE_TABLE_OR_DOCUMENT_HEADER_RE =
  /^(?:PKG|package|product|\ucd9c\s*\ubc1c\s*\uc77c|\ud310\s*\ub9e4\s*\uac00|\uc694\uae08\ud45c|\uc694\uc77c|\uc2a4\ud31f\ud2b9\uac00|\ud56d\uacf5\uc81c\uc678\uc77c|\ud56d\uacf5\uadf8\ub8f9\uc694\uae08|\ud638\ud154\/\ub9ac\uc870\ud2b8\s*\uc608\uc57d\uc2dc|\uc120\ubc1c\uad8c)\b/i;
const ITINERARY_TAIL_SECTION_RE =
  /(?:\ucde8\uc18c\uaddc\uc815|\ucde8\uc18c\uc2dc\uae30|\uc218\uc218\ub8cc|\ud658\ubd88|\ud604\uae08\uc601\uc218\uc99d|\uc608\uc57d\uae08|\ud30c\uc774\ub110|\ud2b9\ubcc4\s*\uc57d\uad00|\ud655\uc815\s*\ud6c4\s*\ucde8\uc18c|\ud655\uc778\s*\ud6c4\s*\uc608\uc57d|\ucd5c\uc885\s*\ucd9c\ubc1c\s*\uc778\uc6d0)/i;
const TABLE_COLUMN_LABEL_RE =
  /^(?:\uc77c\s*\uc790|\uc9c0\s*\uc5ed|\uad50\s*\ud1b5\s*\ud3b8?|\uc2dc\s*\uac04|\uc8fc\s*\uc694\s*\ud589\s*\uc0ac|\ud589\s*\uc0ac\s*\uc77c\s*\uc815|\uc2dd\s*\uc0ac|\ucd9c\s*\ubc1c\s*\uc77c|\ud310\s*\ub9e4\s*\uac00|\uc778\s*\uc6d0|\ub8f8\s*\ud0c0\uc785|\ud3ec\ud568\uc0ac\ud56d|\ubd88\ud3ec\ud568\uc0ac\ud56d|\ube44\s*\uace0|\uc8fc\uc758\uc0ac\ud56d)$/i;
const TABLE_CELL_DECOY_RE =
  /^(?:\ubd80\s*\uc0b0|\ud074\s*\ub77d|\ud478\uafb8\uc625|\uc138\ubd80|\ub2e4\ub0ad|\ub098\ud2b8\ub791|\ud638\uce58\ubbfc|\ubc29콕|\uc804\s*\uc77c|\ub77c\uc6b4\ub529\s*\ud6c4|[:\s]*\d{1,2}:\d{2}|\uc0c1\uae30\s*\uc77c\uc815.*|\*\s*\uc0c1\uae30\s*\uc77c\uc815.*)$/i;
const MEAL_CELL_RE = /^(?:\uc870|\uc911|\uc11d)\s*:/;
const INCLUSION_LINE_RE = /include|\ud3ec\s*\ud568/i;
const EXCLUSION_LINE_RE = /exclude|\ubd88\s*\ud3ec\s*\ud568/i;
const MEETING_RE = /meeting|\ubbf8\ud305|\uc9d1\uacb0|\ud53d\uc5c5|\uacf5\ud56d\s*\ubbf8\ud305/i;
const FLIGHT_WORD_RE = /flight|\ud56d\uacf5|\ucd9c\ubc1c|\ub3c4\ucc29|\uacf5\ud56d/i;
const TRANSFER_RE = /transfer|\uc774\ub3d9|\ucc28\ub7c9|\ubc84\uc2a4|\uc804\uc6a9\ucc28\ub7c9|\uc1a1\uc601|\ud53d\uc5c5/i;
const MEAL_RE = /breakfast|lunch|dinner|\uc870\uc2dd|\uc911\uc2dd|\uc11d\uc2dd|\ud2b9\uc2dd|meal/i;
const HOTEL_RE = /hotel|resort|\uc219\ubc15|\ud638\ud154|\ub9ac\uc870\ud2b8|\ud480\s*\ube4c\ub77c|\ube4c\ub77c|\uac1d\uc2e4|\uccb4\ud06c\uc778|\uccb4\ud06c\uc544\uc6c3/i;
const OPTION_RE = /option|optional|\uc120\ud0dd\s*\uad00\uad11|\uc635\uc158|\ucd94\ucc9c\s*(?:\uad00\uad11|\uc120\ud0dd)|\ud604\uc9c0\s*\uc9c0\ubd88/i;
const GOLF_OPTION_DETAIL_RE =
  /(?:\uace8\ud504\uc7a5\s*\uc815\ubcf4|\ucf54\uc2a4\uc815\ubcf4|\ud2f0\s*\ud0c0\uc784|\uadf8\ub9b0\ud53c|\uce90\ub514\ud53c|\uce74\ud2b8\ud53c|\uce90\ub514\s*\ud301|\uc2f1\uae00\s*\uce74\ud2b8|\ud074\ub7fd\s*\ub80c\ud0c8)/i;
const GOLF_ROUND_RE =
  /(?:\uace8\ud504\uc7a5.*\uc774\ub3d9|(?:CC|cc|\uace8\ud504\uc7a5|[\w\uac00-\ud7a3]+\s*\/\s*[\w\uac00-\ud7a3]+).*?(?:18|27|36|54)\s*\ud640.*?(?:\ub77c\uc6b4\ub529|\uc140\ud504\ub77c\uc6b4\ub529)|(?:18|27|36|54)\s*\ud640.*?(?:\ub77c\uc6b4\ub529|\uc140\ud504\ub77c\uc6b4\ub529)|\ub77c\uc6b4\ub529\s*\ud6c4)/i;
const SHOPPING_RE = /shopping|\uc1fc\ud551|\uba74\uc138|\uc13c\ud130/i;
const SHOPPING_DETAIL_RE = /\uae30\ub150\ud488|\ud1a0\uc0b0\ud488|\uac74\uac15\ubcf4\uc870\uc2dd\ud488|\uc7a1\ud654|\uc9c4\uc8fc/i;
const INCLUDED_ACTIVITY_RE = /\ub514\uc2a4\ucee4\ubc84\ub9ac\s*\ud22c\uc5b4|\uc2dc\ub0b4\uad00\uad11|\uc2a4\ucfe0\ubc84\ub2e4\uc774\ube59|\uc218\uc601\uc7a5\s*\uc2e4\uc2b5|\uc624\uc77c\ub9c8\uc0ac\uc9c0|\ud638\ud551\ud22c\uc5b4/i;
const OPTION_PRICE_CANDIDATE_RE = /\uc120\ud0dd|\uc635\uc158|\ud638\ud551|\ud30c\ub77c\uc138\uc77c\ub9c1|\uc528\uc6cc\ud06c|\ub2e4\uc774\ube59|\ub9c8\uc0ac\uc9c0|\uc2a4\ud30c|\uc1fc|\ud22c\uc5b4/i;
const TOUR_ACTIVITY_LINE_RE = /(?:\uc790\uc720\s*\uad00\uad11|\uad00\uad11|\ud22c\uc5b4|\ub9c8\ucf13|\uc2dc\uc7a5|\uc57c\uc2dc\uc7a5|\uc0ac\uc6d0|\ud574\ubcc0|\ube44\uce58|\ub18d\uc7a5|\uc218\uc6a9\uc18c|\ud3ec\ud1a0\uc874|\uc57c\uacbd|\ubc14\uc790|\uc120\uc14b\ud0c0\uc6b4|\ud56b\ud50c\s*\uce74\ud398)/i;
const ACTIVITY_NOTE_LINE_RE = /(?:\uc900\ube44\ubb3c|\uc7a5\ube44|\uad6c\uba85\uc870\ub07c|\ubbf8\ub07c|\uc544\ucfe0\uc544\uc288\uc988|\uc218\uc601\ubcf5|\uc120\ud06c\ub9bc|\uc5ec\ubc8c\s*\uc637)/i;
const BROAD_TOUR_ACTIVITY_LINE_RE = /(?:\uc790\uc720\s*\uad00\uad11|\uad00\uad11|\ud22c\uc5b4|\ub9c8\ucf13|\uc2dc\uc7a5|\uc57c\uc2dc\uc7a5|\uc0ac\uc6d0|\ud574\ubcc0|\ube44\uce58|\ub18d\uc7a5|\uc218\uc6a9\uc18c|\ud3ec\ud1a0\uc874|\uc57c\uacbd|\ubc14\uc790|\uc120\uc14b\ud0c0\uc6b4|\ud56b\ud50c\s*\uce74\ud398|\ud14c\ub9c8\ud30c\ud06c|\uc6cc\ud130\ud30c\ud06c|\ube0c\ub9bf\uc9c0|\uc0ac\ud30c\ub9ac|\ub3d9\ubb3c\uc6d0|\uc2dd\ubb3c\uc6d0)/i;
const FOOD_ONLY_RE = /^(?:\uc0bc\uacb9\uc0b4|\uac00\uc815\uc2dd|\ud55c\uc2dd|\ud604\uc9c0\uc2dd|\ud638\ud551\uc2dd|\ubdf0\ud398\uc2dd|\ud638\ud154\uc2dd|\ubb34\uc81c\ud55c|\ubca0\ud2b8\ub0a8\uac00\uc815\uc2dd)$/;
const FOOD_TERM_RE = /\uc300\s*\uad6d\uc218|\ud3ec\b|pho\b|phở\b/i;
const FREE_TIME_RE = /free\s*time|\uc790\uc720\s*\uc2dc\uac04|\ud734\uc2dd/i;
const NOTICE_RE = /include|exclude|\ud3ec\ud568|\ubd88\ud3ec\ud568|\ucd5c\uc18c|\uc8fc\uc758|\uc548\ub0b4|notice/i;
const REMARK_RE = /비고|주의\s*사항|remark|안내|공지|싱글\s*차지|여권|전자\s*담배|룸\s*배정|객실\s*배정|개런티|일정|마사지\s*팁|패널티|도보\s*이동|공항\s*미팅|관광지\s*방문|현지\s*가이드|차량에서\s*설명|가이드|기사\s*팁|쇼핑|선택\s*관광|노\s*옵션|노\s*쇼핑|노\s*팁/i;
const ATTRACTION_DECOY_RE = PRODUCT_HEADER_RE;
const KOREAN_MEAL_TERM_RE =
  /(?:\uc0bc\uacb9\uc0b4|\uc81c\uc721|\ucc0c\uac1c|\uc5f4\ub300\uacfc\uc77c|\uaf88\ubc14\ub85c\uc6b0|\uafd4\ubc14\ub85c\uc6b0|\ub0c9\uba74|\ube44\ube54\ubc25|\ub9e4\uc6b4\ud0d5|\ud604\uc9c0\uc2dd|\ud638\ud154\uc2dd|\uc0e4\ube0c\uc0e4\ube0c|\uae40\s*\ubc25|\uc591\uaf2c\uce58|\uc18c\ubd88\uace0\uae30|\uc1a1\uc774\uad6c\uc774|\ubd88\uace0\uae30|\ub3d9\ubd81\uc694\ub9ac|\uac00\uc815\uc2dd|\uc911\s*:|\uc11d\s*:|\uc870\s*:)/i;
const ROUTE_CELL_ONLY_RE =
  /^(?:\ubd80\s*\uc0b0|\uc5f0\s*\uae38|\ub3c4\s*\ubb38|\uc6a9\s*\uc815|\uc774\ub3c4\ubc31\ud558(?:\s*(?:\ub0a8|\ubd81|\uc11c)\s*\ud30c)?|\uc1a1\uac15\ud558|\ub0a8\s*\ud30c|\ubd81\s*\ud30c|\uc11c\s*\ud30c|\uc7a5\ubc31\uc0b0|\ubc31\ub450\uc0b0|\uc2dc\uc988\uc624\uce74|\uce74\uc640\uad6c\uce58|\ub2e4\ub0ad|\ud638\uc774\uc548|\ud478\uafb8\uc625)$/;
const TIME_CELL_ONLY_RE = /^:?\d{1,2}(?::\d{2})?$/;
const STANDALONE_USD_PRICE_RE = /^\$?\s*\d+(?:\.\d+)?\s*(?:\/\s*\uc778)?(?:\s*\(?\ud301\ubcc4\ub3c4\)?)?$/i;
const HOTEL_OCCURRENCE_RE =
  /(?:\ud638\ud154|hotel|resort|\ub9ac\uc870\ud2b8|\uc8fc\uc810).*(?:\ub3d9\uae09|\uc900\s*5\uc131|\uc815\s*5\uc131|5\uc131|\ud22c\uc219|\uccb4\ud06c\uc778|\ud734\uc2dd)|(?:\ud638\ud154\s*(?:\uc774\ub3d9|\uc870\uc2dd|\ud22c\uc219|\uccb4\ud06c\uc778))/i;
const ITINERARY_TABLE_LABEL_RE =
  /^(?:\uc77c\s*\uc790|\uc9c0\s*\uc5ed|\uad50\s*\ud1b5\s*\ud3b8?|\uc2dc\s*\uac04|\uc77c\s*\uc815|\uc2dd\s*\uc0ac|\uc81c\d+\uc77c|\uc804\uc77c|\ucd5c\s*\uc18c\s*\ucd9c\s*\ubc1c|\uac1d\s*\uc2e4\s*\uc885\s*\ub958|\ud3ec\s*\ud568\s*\ub0b4\s*\uc5ed|\ubd88\s*\ud3ec\s*\ud568\s*\ub0b4\s*\uc5ed|\ube44\s*\uace0|\uc120\ubc1c\uc81c\uc678\uc77c|---)$/i;
const PRICE_MATRIX_FRAGMENT_RE =
  /^(?:\ud328\ud134|\d{1,2}\uc6d4|(?:\uc6d4|\ud654|\uc218|\ubaa9|\uae08|\ud1a0|\uc77c)\uc694\uc77c|\d{1,2}\uc6d4\d{1,2}\uc77c\s*\([^)]+\)|\d+\uba85\ubd80\ud130\ucd9c\ubc1c\ud655\uc815.*\d\ubc15\d\uc77c)$/;
const BAKEKDU_DESCRIPTION_FRAGMENT_RE =
  /(?:\uacbd\uacc4\ube44|\uc218\ubaa9\ud55c\uacc4\uc120|\ud574\ubc1c\s*\d|고산초원지대)/;

const TIME_WITH_ARRIVAL_OFFSET_ONLY_RE = /^\d{1,2}:\d{2}(?:\(\+?\d+\))?$/;
const SOURCE_EVIDENCE_HEADER_RE = /^\[\uacf5\ud1b5\s*\uac00\uaca9\ud45c\s*\uc6d0\ubb38\s*\uadfc\uac70\]$/;
const HOLIDAY_PRICE_NOISE_RE = /^[\s\u25cf\u2605\u2606*]+.*\uc5f0\ud734\s*\ucd9c\ubc1c/;
const KOREAN_REGION_CELL_ONLY_RE =
  /^(?:\uacc4\ub9bc|\uc591\uc0ad|\uc6a9\uc2b9|\ubc31\uc0ac|\uc720\uc8fc|\uc11c\uc548|\ud654\uc0b0|\uc2dc\uc988\uc624\uce74|\uc5f0\uae38|\ub3c4\ubb38|\uc6a9\uc815|\uc1a1\uac15\ud558|\uc774\ub3c4\ubc31\ud558|\ub0a8\ud30c|\ubd81\ud30c|\uc11c\ud30c)$/;
const BRACKETED_DESCRIPTION_ONLY_RE = /^\[[^\]]{8,80}\]$/;
const BRACKETED_NAMED_ATTRACTION_RE = /^\[[^\]]*(?:\uACF5\uC6D0|\uC2DC\uC7A5|\uAC70\uB9AC|\uB3D9\uAD74|\uD3ED\uD3EC|\uC0AC\uC6D0|\uC1FC|\uC720\uB78C\uC120)[^\]]*\]$/;
const GUANGZHOU_ROUTE_CELL_ONLY_RE =
  /^(?:광저우|천저우|영덕)$/;
const RAIL_CODE_CELL_ONLY_RE = /^[GDC]\d{2,5}$/i;
const RAIL_SEAT_OR_CHANGE_NOTICE_RE = /^\(?\s*(?:[12]등석|변경가능)\s*\)?$/;
const ROUTE_RETURN_CELL_RE = /^[\uAC00-\uD7A3\s]{2,12}귀환$/;
const TRANSPORT_PATH_FRAGMENT_RE =
  /(?:케이블카|전망대|에스컬레이터|엘리베이터|식당|하산|협곡식당).*(?:-|–|—)/;
const DESCRIPTION_ONLY_FRAGMENT_RE =
  /^(?:▶|[-•])?\s*(?:멀리서도|붉은색의|이름\s*붙여진)/;
const XIAN_MEAL_TERM_RE =
  /(?:\uC11C\uC548\s*\uBA74\s*\uC694\uB9AC|\uAD50\s*\uC790\s*\uC5F0)/u;
const XIAN_FREE_TREKKING_ROUTE_RE =
  /(?:\uC790\uC720\s*\uD2B8\uB808\uD0B9|\uD2B8\uB808\uD0B9).*(?:-|[\u2013\u2014]).*(?:\uC18C\uC694|\uBD81\uBD09|\uAE08\uC0AC\uAD00)/u;
const XIAN_HUAQINGJI_DESCRIPTION_FRAGMENT_RE =
  /^[\s\u25b6\u25cf\u2022\u00b7\u25c6\u25c7\u25a0\u25a1\u2605\u2606+\-\u2663\u220e\u203b]*\uC11C\uC548\uC758\s*\uC720\uBA85\uD55C\s*\uC628\uCC9C\uC9C0/u;

function normalizePrice(token: string): number {
  const number = Number(token.replace(/[,\s]/g, ''));
  if (!Number.isFinite(number)) return 0;
  return number < 10_000 ? number * 1000 : number;
}

function eventTypeForLine(line: string): V3EventType | null {
  const text = line.trim();
  if (!text) return null;
  const compact = text.replace(/\s+/g, '');
  if (XIAN_MEAL_TERM_RE.test(text) || XIAN_MEAL_TERM_RE.test(compact)) return 'meal';
  if (XIAN_FREE_TREKKING_ROUTE_RE.test(text) || XIAN_FREE_TREKKING_ROUTE_RE.test(compact)) return 'free_time';
  if (XIAN_HUAQINGJI_DESCRIPTION_FRAGMENT_RE.test(text)) return 'notice';
  if (SOURCE_EVIDENCE_HEADER_RE.test(text)) return 'price_noise';
  if (TIME_WITH_ARRIVAL_OFFSET_ONLY_RE.test(compact)) return 'price_noise';
  if (HOLIDAY_PRICE_NOISE_RE.test(text)) return 'price_noise';
  if (GUANGZHOU_ROUTE_CELL_ONLY_RE.test(compact)) return 'transfer';
  if (RAIL_CODE_CELL_ONLY_RE.test(compact)) return 'transfer';
  if (RAIL_SEAT_OR_CHANGE_NOTICE_RE.test(compact)) return 'notice';
  if (ROUTE_RETURN_CELL_RE.test(compact)) return 'transfer';
  if (TRANSPORT_PATH_FRAGMENT_RE.test(text)) return 'activity';
  if (DESCRIPTION_ONLY_FRAGMENT_RE.test(text)) return 'activity';
  if (KOREAN_REGION_CELL_ONLY_RE.test(compact)) return 'transfer';
  if (BRACKETED_DESCRIPTION_ONLY_RE.test(text) && !BRACKETED_NAMED_ATTRACTION_RE.test(text)) return 'notice';
  if (/^(?:\uc624\s*\uc804|\uc624\s*\ud6c4|\uc804\s*\uc77c)$/.test(text)) return 'price_noise';
  if (/^\(?\s*\ucf5c\ub4dc\s*\ubc00\s*\)?$/i.test(text)) return 'meal';
  if (/\uc0c1\uae30\s*\uc77c\uc815|\ud604\uc9c0\s*\uc0ac\uc815|\uc591\ud574/.test(text)) return 'notice';
  if (/\uc804\uc6a9\ucc28(?:\ub7c9|\ub791)/.test(text)) return 'transfer';
  if (/\uacf5\ud56d.*\ucd9c\uad6d\s*\uc218\uc18d|\ucd9c\uad6d\s*\uc218\uc18d/.test(text)) return 'transfer';
  if (/\ud0d1\uc2b9\ud558\uc5ec.*(?:\uc790\uc5f0\uacbd\uad00|\uad00\uad11)/.test(text)) return 'notice';
  if (/(?:\ud2b9\uc0b0\ud488|\uc1fc\ud551).*(?:\uad00\uad11|\ubc29\ubb38|\d+\s*\ud68c)/.test(text)) return 'shopping';
  if (ABBREVIATED_PRICE_RE.test(compact)) return 'price_noise';
  if (/^(?:\ub178\uc1fc\ud551|no\s*shopping)$/i.test(compact)) return 'notice';
  if (/^(?:\ub178\uc635\uc158|no\s*option)$/i.test(compact)) return 'notice';
  if (/^(?:\uc1fc\ud551\uc13c\ud130|\uc1fc\ud551)$/.test(compact)) return 'shopping';
  if (/^\(\+\d+\)$/.test(compact)) return null;
  if (/^(?:부산|클락|푸꾸옥|세부|다낭|나트랑|호치민|방콕)$/.test(compact)) return null;
  if (/^(?:살펴보기|여권|입국|이트래블|eTravel)/i.test(compact)) return 'notice';
  if (/^(?:\uBBF8\uC81C\uACF5|\uBD88\uD3EC\uD568|\uD3EC\uD568|\uC81C\uACF5|\uC5C6\uC74C|N\/A|NA|-)$/.test(compact)) return 'price_noise';
  if (/기내박/.test(compact)) return 'hotel';
  if (ITINERARY_TABLE_LABEL_RE.test(compact)) return 'price_noise';
  if (PRICE_MATRIX_FRAGMENT_RE.test(compact)) return 'price_noise';
  if (TIME_CELL_ONLY_RE.test(compact)) return 'price_noise';
  if (STANDALONE_USD_PRICE_RE.test(compact)) return 'price_noise';
  if (ROUTE_CELL_ONLY_RE.test(compact)) return 'transfer';
  if (BAKEKDU_DESCRIPTION_FRAGMENT_RE.test(text)) return 'activity';
  if (!/[▶]/.test(text) && !TRANSFER_RE.test(text) && HOTEL_OCCURRENCE_RE.test(text)) return 'hotel';
  if (
    PRODUCT_HEADER_RE.test(text)
    || PRICE_HEADER_RE.test(text)
    || PRICE_TABLE_OR_DOCUMENT_HEADER_RE.test(text)
    || TABLE_COLUMN_LABEL_RE.test(text)
    || TABLE_CELL_DECOY_RE.test(text)
  ) return 'price_noise';
  if (MEAL_CELL_RE.test(text)) return 'meal';
  if (FOOD_ONLY_RE.test(compact)) return 'meal';
  if (FOOD_TERM_RE.test(text)) return 'meal';
  if (KOREAN_MEAL_TERM_RE.test(text)) return 'meal';
  if (ACTIVITY_NOTE_LINE_RE.test(text)) return 'notice';
  if (/^\s*[※*]/.test(text) && /\uacb0\uc81c|\uc774\uc6a9/.test(text)) return 'notice';
  if (MEETING_RE.test(text)) return 'meeting';
  if (
    FLIGHT_CODE_RE.test(text)
    || (FLIGHT_WORD_RE.test(text) && TIME_RE.test(text))
    || (/\uacf5\ud56d/.test(text) && /(?:\ucd9c\ubc1c|\ub3c4\ucc29)/.test(text))
    || (/(?:출발|향발|도착)/.test(text) && /(?:부산|세부|김해|공항)/.test(text))
  ) return 'flight';
  if (/(?:출발|도착)$/.test(compact)) return 'flight';
  if (TRANSFER_RE.test(text)) return 'transfer';
  if (MEAL_RE.test(text)) return 'meal';
  if (HOTEL_RE.test(text)) return 'hotel';
  if (isNonCustomerOptionText(text)) return 'notice';
  if (GOLF_OPTION_DETAIL_RE.test(text)) return 'option';
  if (GOLF_ROUND_RE.test(text)) return 'activity';
  if ((USD_RE.test(text) || /\ud604\uc9c0\s*\uc635\uc158\uac00/i.test(text)) && /\ud638\ud551\ud22c\uc5b4|\uc120\ud0dd|\uc635\uc158/i.test(text)) return 'option';
  if (/^\s*[-–]/.test(text) && ACTIVITY_NOTE_LINE_RE.test(text)) return 'notice';
  if (INCLUDED_ACTIVITY_RE.test(text) && !USD_RE.test(text) && !/\uc120\ud0dd|\uc635\uc158|\ud604\uc9c0\s*\uc635\uc158\uac00/i.test(text)) return 'activity';
  if (/\ub9c8\uc0ac\uc9c0|\uc628\ucc9c\uc695/.test(text) && !USD_RE.test(text) && !/\uc120\ud0dd|\uc635\uc158|\ud604\uc9c0\s*\uc9c0\ubd88|\ud604\uc9c0\uc9c0\ubd88/i.test(text)) return 'activity';
  if (/(?:\uc1fc|show|\ud06c\ub8e8\uc988|\uc720\ub78c\uc120|\uccb4\ud5d8)/i.test(text) && !USD_RE.test(text) && !/\uc120\ud0dd|\uc635\uc158|\ud604\uc9c0\s*\uc9c0\ubd88|\ud604\uc9c0\uc635\uc158/i.test(text)) return 'activity';
  if (OPTION_RE.test(text)) return 'option';
  if (SHOPPING_RE.test(text) || SHOPPING_DETAIL_RE.test(text)) return 'shopping';
  if (FREE_TIME_RE.test(text)) return 'free_time';
  if (NOTICE_RE.test(text)) return 'notice';
  if (INCLUDED_ACTIVITY_RE.test(text)) return 'activity';
  if (/^\s*[▶●•·◆◇■□★☆+\-○▪◦*♣]/.test(text) && TOUR_ACTIVITY_LINE_RE.test(text)) return 'activity';
  if (/^\s*[▶●•·◆◇■□★☆+\-○▪◦*♣]/.test(text) && BROAD_TOUR_ACTIVITY_LINE_RE.test(text)) return 'activity';
  if (/^\s*[-–]/.test(text) && BROAD_TOUR_ACTIVITY_LINE_RE.test(text)) return 'activity';
  if (ATTRACTION_DECOY_RE.test(text) || PRICE_RE.test(text)) return 'price_noise';
  return text.length >= 2 ? 'attraction' : null;
}

function dayNumberFromMatch(match: RegExpMatchArray): number {
  return Number(match[1] ?? match[2] ?? match[3] ?? 0);
}

function stripDayHeader(text: string, match: RegExpMatchArray): string {
  return text.slice((match.index ?? 0) + match[0].length).trim();
}

function optionCategory(text: string): V3OptionCandidate['category'] {
  if (/\ub9c8\uc0ac\uc9c0|\uc2a4\ud30c|massage|spa/i.test(text)) return 'massage';
  if (/\uacf5\uc5f0|\uc1fc|show/i.test(text)) return 'show';
  if (/\ud06c\ub8e8\uc988|cruise/i.test(text)) return 'cruise';
  if (/\ud2b9\uc2dd|meal|upgrade/i.test(text)) return 'meal_upgrade';
  if (/\ud2f0\ucf13|\uc785\uc7a5|ticket/i.test(text)) return 'ticket';
  if (/\uccb4\ud5d8|activity/i.test(text)) return 'activity';
  return 'other';
}

function splitOptionLine(line: V3SourceLine): Array<{ text: string; line: V3SourceLine }> {
  const text = line.quote.trim();
  if (!USD_RE.test(text) || !/[,\uff0c，]/.test(text)) return [{ text, line }];
  return text
    .split(/\s*[,，]\s*/)
    .map(segment => segment.trim())
    .filter(segment => segment.length > 0)
    .map(segment => ({ text: segment, line }));
}

function optionDurationMinutes(text: string): number | null {
  const hourMinute = text.match(/(\d+)\s*(?:\uc2dc\uac04|hour)s?\s*(\d+)\s*(?:\ubd84|min|minutes?)?/i);
  if (hourMinute) return Number(hourMinute[1]) * 60 + Number(hourMinute[2]);
  const duration = text.match(/(\d+)\s*(?:\ubd84|min|minutes?|\uc2dc\uac04|hour)/i);
  if (!duration) return null;
  return Number(duration[1]) * (/hour|\uc2dc\uac04/i.test(duration[0]) ? 60 : 1);
}

function normalizeOptionName(text: string): string {
  return text
    .replace(/^[\s\u25b6\u25cf\u2022\u00b7\u25c6\u25c7\u25a0\u25a1\u2605\u2606+\-\u2663\u220e\u203b]+/, '')
    .replace(/^(?:\ud604\uc9c0\uc9c0\ubd88\uc635\uc158|\uac15\ub825\ucd94\ucc9c\uc635\uc158|\ucd94\ucc9c\uc635\uc158|\uad00\uad11|\ub9c8\uc0ac\uc9c0|\uc2dd\uc0ac)\s*[:：]\s*/i, '')
    .replace(/\(\s*\$\s*\d+(?:\.\d+)?\s*\)/g, '')
    .replace(/\s*\/\s*\ud604\uc9c0\s*\uc635\uc158\uac00\s*(?:\/\s*\uc778)?/gi, '')
    .replace(USD_RE, '')
    .replace(/\s*\/\s*\uc778/g, '')
    .replace(/\s*\uc778\.?$/g, '')
    .replace(/\(\s*\ud301\ubcc4\ub3c4\s*\)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isOptionHeadingOrNonCustomerOption(text: string): boolean {
  const normalized = text.replace(/^[\s\u25b6\u25cf\u2022\u00b7\u25c6\u25c7\u25a0\u25a1\u2605\u2606+\-○▪◦*\u2663]+/, '').trim();
  const compact = normalized.replace(/\s+/g, '');
  if (/^(?:현지지불옵션|강력추천옵션|추천옵션|\(?현지지불옵션\)?)$/i.test(compact)) return true;
  if (/^(?:선택관광비용|유류변동분|매너팁및개인경비|개인경비)$/.test(compact)) return true;
  if (/^(?:기사\/?가이드경비|가이드\/?기사경비)\$?\d+/i.test(compact)) return true;
  if (/^(?:\uc120\ud0dd\uad00\uad11|\ucd94\ucc9c\uc120\ud0dd\uad00\uad11|\uc635\uc158|\uc635\uc158\ud22c\uc5b4)$/.test(compact)) return true;
  if (/^(?:\uc1fc\ud551\uc13c\ud130|\uc1fc\ud551)$/.test(compact)) return true;
  if (INCLUDED_ACTIVITY_RE.test(normalized) && !USD_RE.test(normalized) && !/\uc120\ud0dd|\uc635\uc158|\ud604\uc9c0\s*\uc635\uc158\uac00/i.test(normalized)) return true;
  if (/^(?:\ub178\uc635\uc158|no\s*option|\uc120\ud0dd\uad00\uad11\s*(?:\uc5c6\uc74c|\ubb34|0\ud68c))$/i.test(compact)) return true;
  if (isNonCustomerOptionText(normalized)) return true;
  return false;
}

function isOptionPriceCandidate(text: string): boolean {
  return USD_RE.test(text)
    && (OPTION_PRICE_CANDIDATE_RE.test(text) || /\b(?:5D|VIP)\b|VIP|5D/i.test(text))
    && isCustomerOptionalTourCandidate(text);
}

function buildPriceCalendarFromIR(sectionLines: V3SourceLine[], title: string): V3LedgerVariant['price_calendar'] {
  const rawText = sectionLines.map(line => line.quote).join('\n');
  const result = extractPriceIR(rawText, { title });
  return result.tiers
    .filter(tier => typeof tier.adult_price === 'number' && tier.adult_price > 0)
    .map(tier => {
      const evidenceLine = sectionLines.find(line =>
        line.quote.includes(String(tier.adult_price))
        || line.quote.includes(tier.adult_price.toLocaleString('ko-KR'))
        || (tier.period_label && line.quote.includes(tier.period_label.slice(0, 8)))
      ) ?? sectionLines[0];
      return {
        date: tier.departure_dates?.[0] ?? tier.date_range?.start ?? null,
        label: tier.period_label || result.source,
        amount: tier.adult_price,
        currency: 'KRW',
        evidence: evidenceFromLines(sectionLines, evidenceLine.lineNumber),
      };
    });
}

function titleParts(lines: V3SourceLine[], boundary: V3StructurePlan['product_boundaries'][number]): string[] {
  const header = lines[boundary.line_start - 1]?.quote.replace(PRODUCT_HEADER_RE, '').trim();
  const body = lines
    .slice(boundary.line_start - 1, boundary.line_end)
    .map(line => line.quote.trim())
    .filter(Boolean)
    .filter(line => !DAY_HEADER_RE.test(line) && !PRICE_RE.test(line) && !PRICE_HEADER_RE.test(line))
    .slice(0, 3);
  return [header || boundary.title_hint, ...body.filter(line => line !== header)].filter(Boolean).slice(0, 3);
}

function buildEvent(line: V3SourceLine, type: V3EventType, rawText = line.quote.trim()): V3LedgerEvent {
  return {
    type,
    time: rawText.match(TIME_RE)?.[0] ?? null,
    raw_text: rawText,
    canonical_id: null,
    canonical_type: null,
    match_status: type === 'attraction' ? 'unmatched' : type === 'option' ? 'review' : 'ignored',
    evidence: evidenceFromLines([line], 1),
  };
}

function parseDuration(title: string, dayCount: number): { durationDays: number | null; nights: number | null } {
  const nd = title.match(/\b(\d+)N(\d+)D\b/i);
  if (nd) return { nights: Number(nd[1]), durationDays: Number(nd[2]) };
  const korean = title.match(/(\d+)\s*\ubc15\s*(\d+)\s*\uc77c/);
  if (korean) return { nights: Number(korean[1]), durationDays: Number(korean[2]) };
  return {
    durationDays: dayCount || null,
    nights: dayCount > 0 ? Math.max(0, dayCount - 1) : null,
  };
}

function resolveAdjacentFlightTimes(
  sectionLines: V3SourceLine[],
  sectionIndex: number,
  sameLineTimes: string[],
): { depTime: string | null; arrTime: string | null } {
  let depTime = sameLineTimes[0] ?? null;
  let arrTime = sameLineTimes[1] ?? null;
  const lookahead = sectionLines.slice(sectionIndex + 1, sectionIndex + 7);
  for (const next of lookahead) {
    if (FLIGHT_CODE_RE.test(next.quote)) break;
    const nextTime = next.quote.match(TIME_RE)?.[0] ?? null;
    if (!nextTime) continue;
    if (!depTime && /\ucd9c\ubc1c/.test(next.quote)) {
      depTime = nextTime;
      continue;
    }
    if (!arrTime && /\ub3c4\ucc29/.test(next.quote)) {
      arrTime = nextTime;
      continue;
    }
    if (!depTime) depTime = nextTime;
    else if (!arrTime && nextTime !== depTime) arrTime = nextTime;
    if (depTime && arrTime) break;
  }
  return { depTime, arrTime };
}

function resolveSeparatedArrivalTime(
  sectionLines: V3SourceLine[],
  sectionIndex: number,
): string | null {
  const lookahead = sectionLines.slice(sectionIndex + 1, sectionIndex + 32);
  let previousTime: string | null = null;
  for (const next of lookahead) {
    if (FLIGHT_CODE_RE.test(next.quote)) break;
    const nextTime = next.quote.match(TIME_RE)?.[0] ?? null;
    if (/\ub3c4\ucc29/.test(next.quote)) return nextTime ?? previousTime;
    if (nextTime) previousTime = nextTime;
  }
  return null;
}

function buildVariant(lines: V3SourceLine[], boundary: V3StructurePlan['product_boundaries'][number]): V3LedgerVariant {
  const sectionLines = lines.slice(boundary.line_start - 1, boundary.line_end);
  const linePrices = sectionLines
    .map(line => ({ line, match: line.quote.match(PRICE_RE) }))
    .filter((row): row is { line: V3SourceLine; match: RegExpMatchArray } => Boolean(row.match))
    .map(({ line, match }) => ({
      date: line.quote.match(/\b20\d{2}[./-]\d{1,2}[./-]\d{1,2}\b/)?.[0]?.replace(/[./]/g, '-') ?? null,
      label: line.quote.trim(),
      amount: normalizePrice(match[1]),
      currency: match[2] === '$' || match[2]?.toUpperCase() === 'USD' ? 'USD' : 'KRW',
      evidence: evidenceFromLines(lines, line.lineNumber),
    }))
    .filter(price => price.amount > 0);
  const prices = linePrices.length > 0 ? linePrices : buildPriceCalendarFromIR(sectionLines, boundary.title_hint);

  const flightRows = sectionLines
    .map((line, sectionIndex) => ({ line, sectionIndex, match: line.quote.match(FLIGHT_CODE_RE) }))
    .filter((row): row is { line: V3SourceLine; sectionIndex: number; match: RegExpMatchArray } => Boolean(row.match));
  const flight_segments = flightRows.map(({ line, match, sectionIndex }, index) => {
    const times = [...line.quote.matchAll(TIME_RE_GLOBAL)].map(m => m[0]);
    const resolvedTimes = resolveAdjacentFlightTimes(sectionLines, sectionIndex, times);
    let arrTime = resolvedTimes.arrTime;
    if (!arrTime) {
      for (const next of sectionLines.slice(sectionIndex + 1, sectionIndex + 4)) {
        if (FLIGHT_CODE_RE.test(next.quote)) break;
        if (!/\ub3c4\ucc29/.test(next.quote)) continue;
        const nextTime = next.quote.match(TIME_RE)?.[0] ?? null;
        if (nextTime) {
          arrTime = nextTime;
          break;
        }
      }
    }
    arrTime ??= resolveSeparatedArrivalTime(sectionLines, sectionIndex);
    return {
      leg: index === 0 ? 'outbound' as const : index === 1 ? 'inbound' as const : 'unknown' as const,
      code: `${match[1]}${match[2]}`,
      dep_time: resolvedTimes.depTime,
      arr_time: arrTime,
      evidence: evidenceFromLines(lines, line.lineNumber),
    };
  });

  const days: V3LedgerVariant['days'] = [];
  let currentDay: V3LedgerVariant['days'][number] | null = null;
  let inRemarkSection = false;
  let seenItineraryDay = false;
  let itineraryClosed = false;
  for (const line of sectionLines) {
    const trimmed = line.quote.trim();
    if (/^(REMARK|비고|주의\s*사항|공지\s*사항)\s*$/i.test(trimmed)) {
      inRemarkSection = true;
      continue;
    }
    if (seenItineraryDay && (ITINERARY_TAIL_SECTION_RE.test(trimmed) || /^(?:살펴보기|여권|입국|이트래블|eTravel|만\s*15세\s*미만)/i.test(trimmed.replace(/\s+/g, '')))) {
      itineraryClosed = true;
      continue;
    }
    if (
      seenItineraryDay
      && /^(?:include|exclude|remark|\ud3ec\ud568\s*\ub0b4\uc5ed|\ubd88\s*\ud3ec\ud568\s*\ub0b4\uc5ed|\uc120\ud0dd\uad00\uad11|\ud604\uc9c0\uc9c0\ubd88\uc635\uc158|\uac15\ub825\ucd94\ucc9c\uc635\uc158|\uc1fc\ud551\uc13c\ud130|\uc1fc\ud551)(?:\b|\s|$)/i.test(trimmed)
    ) {
      itineraryClosed = true;
      continue;
    }
    if (itineraryClosed) continue;
    const dayMatch = trimmed.match(DAY_HEADER_RE);
    let eventText = line.quote;
    if (dayMatch) {
      seenItineraryDay = true;
      inRemarkSection = false;
      currentDay = {
        day: dayNumberFromMatch(dayMatch),
        route: [],
        events: [],
        meals: { breakfast: {}, lunch: {}, dinner: {} },
        hotel: {},
      };
      days.push(currentDay);
      eventText = stripDayHeader(trimmed, dayMatch);
      if (!eventText) continue;
    }
    if (!seenItineraryDay) continue;
    if (inRemarkSection) continue;
    const type = eventTypeForLine(eventText);
    if (!type) continue;
    if (!currentDay) continue;
    const event = buildEvent(line, type, eventText.trim());
    currentDay.events.push(event);
    if (type === 'attraction' || type === 'activity') currentDay.route.push(event.raw_text);
    if (type === 'meal') {
      if (/breakfast|\uc870\s*:|\uc870\uc2dd/i.test(line.quote)) currentDay.meals.breakfast = { raw_text: line.quote.trim(), evidence: event.evidence };
      if (/lunch|\uc911\s*:|\uc911\uc2dd/i.test(line.quote)) currentDay.meals.lunch = { raw_text: line.quote.trim(), evidence: event.evidence };
      if (/dinner|\uc11d\s*:|\uc11d\uc2dd|\ud2b9\uc2dd/i.test(line.quote)) currentDay.meals.dinner = { raw_text: line.quote.trim(), evidence: event.evidence };
    }
    if (type === 'hotel') currentDay.hotel = { raw_text: line.quote.trim(), evidence: event.evidence };
  }

  const optionCandidates = sectionLines
    .filter(line => eventTypeForLine(line.quote) === 'option' || isOptionPriceCandidate(line.quote))
    .flatMap(splitOptionLine)
    .filter(candidate => !isOptionHeadingOrNonCustomerOption(candidate.text))
    .filter(candidate => isCustomerOptionalTourCandidate(candidate.text));
  const options = optionCandidates.map(candidate => {
    const usd = candidate.text.match(USD_RE);
    const day = [...days].reverse().find(d => d.events.some(event => event.evidence.line_start <= candidate.line.lineNumber));
    return {
      region: null,
      city: null,
      raw_name: candidate.text,
      normalized_name: normalizeOptionName(candidate.text),
      category: optionCategory(candidate.text),
      price_amount: usd ? Number(usd[1]) : null,
      currency: usd ? 'USD' : null,
      duration_minutes: optionDurationMinutes(candidate.text),
      day_number: day?.day ?? null,
      evidence: evidenceFromLines(lines, candidate.line.lineNumber),
      match_status: 'review' as const,
    };
  });

  const inclusions = sectionLines
    .filter(line => INCLUSION_LINE_RE.test(line.quote) && !EXCLUSION_LINE_RE.test(line.quote))
    .map(line => ({ value: line.quote.trim(), evidence: evidenceFromLines(lines, line.lineNumber) }));
  const exclusions = sectionLines
    .filter(line => EXCLUSION_LINE_RE.test(line.quote))
    .map(line => ({ value: line.quote.trim(), evidence: evidenceFromLines(lines, line.lineNumber) }));
  const shopping: V3LedgerVariant['shopping'] = [];
  for (let index = 0; index < sectionLines.length; index++) {
    const line = sectionLines[index];
    if (eventTypeForLine(line.quote) !== 'shopping') continue;
    const value = line.quote.trim();
    const compactValue = value.replace(/\s+/g, '');
    const nextDetail = sectionLines
      .slice(index + 1, Math.min(sectionLines.length, index + 4))
      .find(next => {
        const candidate = next.quote.trim();
        return candidate
          && !DAY_HEADER_RE.test(candidate)
          && !/^(?:비\s*고|REMARK|선택관광)$/i.test(candidate)
          && eventTypeForLine(candidate) !== 'price_noise';
      });
    if (/^(?:\uc1fc\ud551\uc13c\ud130|\uc1fc\ud551)$/.test(compactValue)) {
      const detailText = nextDetail?.quote.trim() ?? '';
      if (!detailText || /^(?:\ub178\uc1fc\ud551|no\s*shopping)$/i.test(detailText.replace(/\s+/g, ''))) continue;
      shopping.push({
        value: `${value} ${detailText}`.trim(),
        evidence: evidenceFromLines(lines, line.lineNumber),
      });
      continue;
    }
    if (/^(?:\ub178\uc1fc\ud551|no\s*shopping)$/i.test(compactValue)) continue;
    shopping.push({ value, evidence: evidenceFromLines(lines, line.lineNumber) });
  }
  const remarkLines = sectionLines
    .filter(line => REMARK_RE.test(line.quote))
    .map(line => ({ text: line.quote.trim(), evidence: evidenceFromLines(lines, line.lineNumber) }));
  const standard_notices = extractStandardNoticesFromRemarkLines(remarkLines);
  const structured = extractStructuredFactsFromSupplierText({
    lines: sectionLines,
    title: boundary.title_hint,
    rawText: sectionLines.map(line => line.quote).join('\n'),
  });
  const mergedStandardNotices = [...standard_notices];
  for (const notice of structured.standardNotices) {
    const key = `${notice.category}:${notice.template_key}:${notice.standard_text}`;
    if (!mergedStandardNotices.some(existing => `${existing.category}:${existing.template_key}:${existing.standard_text}` === key)) {
      mergedStandardNotices.push(notice);
    }
  }
  const cleanStandardNotices = mergedStandardNotices.filter(notice => {
    if (
      notice.category !== 'tip_guideline'
      || notice.template_key !== 'guide.tip_amount_local_payment'
      || notice.review_status !== 'review_needed'
      || notice.values.amount != null
    ) {
      return true;
    }
    return !mergedStandardNotices.some(other =>
      other.category === 'tip_guideline'
      && other.template_key === 'guide.tip_included'
      && other.evidence.some(evidence =>
        notice.evidence.some(existing =>
          existing.line_start === evidence.line_start
          && existing.line_end === evidence.line_end
        )
      )
    );
  });
  const hasIncludedGuideTipNotice = cleanStandardNotices.some(notice =>
    notice.category === 'tip_guideline'
    && notice.template_key === 'guide.tip_included'
    && notice.review_status !== 'review_needed'
  );
  const customerSafeStandardNotices = cleanStandardNotices.filter(notice => {
    if (
      notice.category !== 'tip_guideline'
      || notice.template_key !== 'guide.tip_amount_local_payment'
      || notice.review_status !== 'review_needed'
      || notice.values.amount != null
    ) {
      return true;
    }
    return !hasIncludedGuideTipNotice;
  });
  const minDepartureLine = sectionLines.find(line =>
    /minimum|min\.?|\ucd5c\uc18c|\uc778\s*\uc6d0|\d+\s*(?:\uba85|\uc778)\s*(?:\uc774\uc0c1|\ubd80\ud130)\s*\ucd9c\ubc1c/i.test(line.quote)
    && /\d+/.test(line.quote)
  );
  const structuredMinPaxFact = structured.structuredFacts.find(fact =>
    fact.category === 'min_pax'
    && typeof fact.values.count === 'number'
    && Number.isFinite(fact.values.count)
    && fact.values.count > 0
  );
  const minimum_departure = minDepartureLine
    ? {
        value: Number(
          minDepartureLine.quote.match(/(?:minimum|min\.?|\ucd5c\uc18c(?:\ucd9c\ubc1c)?)\D*(\d+)/i)?.[1]
            ?? minDepartureLine.quote.match(/(\d+)\s*(?:\uba85|\uc778)\s*\uc774\uc0c1\s*\ucd9c\ubc1c/)?.[1]
            ?? minDepartureLine.quote.match(/(\d+)\s*(?:\uba85|\uc778)\s*\ubd80\ud130\s*\ucd9c\ubc1c/)?.[1]
            ?? minDepartureLine.quote.match(/(\d+)\s*(?:\uba85|\uc778)\s*\uc774\uc0c1/)?.[1]
            ?? minDepartureLine.quote.match(/\d+/)?.[0]
            ?? 0,
        ),
        evidence: evidenceFromLines(lines, minDepartureLine.lineNumber),
      }
    : structuredMinPaxFact
      ? {
          value: Number(structuredMinPaxFact.values.count),
          evidence: structuredMinPaxFact.evidence[0] ?? evidenceFromLines(lines, sectionLines[0]?.lineNumber ?? 1),
        }
    : null;
  const title = boundary.title_hint;
  const duration = parseDuration(title, days.length);

  return {
    variant_key: `v${boundary.index + 1}`,
    grade: title.match(/\b(standard|premium|lilac|deluxe|basic|vip)\b/i)?.[1] ?? null,
    course: title,
    duration_days: duration.durationDays,
    nights: duration.nights,
    title_parts: titleParts(lines, boundary),
    price_calendar: prices,
    flight_segments,
    days,
    inclusions,
    exclusions,
    options,
    shopping,
    structured_facts: structured.structuredFacts,
    standard_notices: customerSafeStandardNotices,
    minimum_departure,
    evidence_coverage: {
      price: prices.length > 0,
      flight: flight_segments.length > 0,
      itinerary: days.length > 0,
      meals: days.some(day => Object.values(day.meals).some(value => Object.keys(value).length > 0)),
      hotel: days.some(day => Object.keys(day.hotel).length > 0),
      inclusions: inclusions.length > 0,
      exclusions: exclusions.length > 0,
      minimum_departure: Boolean(minimum_departure),
      options: options.length > 0,
      shopping: shopping.length > 0,
    },
  };
}

export function buildProductRegistrationV3Ledger(lines: V3SourceLine[], plan: V3StructurePlan): V3DraftLedger {
  const variants = plan.product_boundaries.map(boundary => buildVariant(lines, boundary));
  return {
    document: {
      type: plan.document_type,
      expected_products: plan.expected_products,
      variant_axes: plan.variant_axes,
    },
    variants,
  };
}
