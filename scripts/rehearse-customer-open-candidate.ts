#!/usr/bin/env tsx

import fs from 'node:fs';
import process from 'node:process';

import './load-script-env';

import { supabaseAdmin } from '@/lib/supabase';
import { loadCustomerOpenContractForPackage } from '@/lib/product-registration/customer-open-contract';
import { runUploadToOpenAutopilot } from '@/lib/product-registration/upload-to-open-autopilot';
import { registerProductFromRaw } from '@/lib/product-registration/register-product-from-raw';
import { resolveUploadDestinationAndCodes } from '@/lib/product-registration/destination-resolution';
import { validateStandardProductRegistrationObject } from '@/lib/product-registration/standard-registration-schema';
import type { ExtractedData } from '@/lib/parser';

type Options = {
  json: boolean;
  packageId: string | null;
  code: string | null;
  latestPending: boolean;
  rawFile: string | null;
  baseUrl: string;
  title: string | null;
  destination: string | null;
};

function parseOptions(args: string[]): Options {
  return {
    json: args.includes('--json'),
    packageId: args.find((arg) => arg.startsWith('--package-id='))?.split('=')[1] ?? null,
    code: args.find((arg) => arg.startsWith('--code='))?.split('=')[1] ?? null,
    latestPending: args.includes('--latest-pending'),
    rawFile: args.find((arg) => arg.startsWith('--raw-file='))?.split('=')[1] ?? null,
    baseUrl: args.find((arg) => arg.startsWith('--base='))?.split('=')[1]
      ?? process.env.PRODUCTION_URL
      ?? process.env.VISUAL_TEST_URL
      ?? 'https://www.yeosonam.com',
    title: args.find((arg) => arg.startsWith('--title='))?.split('=').slice(1).join('=') ?? null,
    destination: args.find((arg) => arg.startsWith('--destination='))?.split('=').slice(1).join('=') ?? null,
  };
}

async function resolvePackageId(options: Options): Promise<string | null> {
  if (options.packageId) return options.packageId;

  let query = supabaseAdmin
    .from('travel_packages')
    .select('id,internal_code,title,status,created_at')
    .order('created_at', { ascending: false })
    .limit(1);

  if (options.code) {
    query = query.eq('internal_code', options.code);
  } else if (options.latestPending) {
    query = query.in('status', ['pending', 'pending_review']);
  } else {
    return null;
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  const row = data?.[0] as { id?: string } | undefined;
  return row?.id ?? null;
}

function buildSeedExtractedData(rawText: string, options: Options): ExtractedData {
  const title =
    options.title
    ?? rawText.split(/\r?\n/).map((line) => line.trim()).find((line) => line.length >= 4)?.slice(0, 120)
    ?? '상품등록 리허설';
  return {
    title,
    destination: options.destination ?? undefined,
    rawText,
  };
}

async function runRawInputRehearsal(options: Options) {
  if (!options.rawFile) return null;
  const rawText = fs.readFileSync(options.rawFile, 'utf8');
  const extractedData = buildSeedExtractedData(rawText, options);
  const destinationResolution = resolveUploadDestinationAndCodes({
    destination: extractedData.destination,
    departureAirport: extractedData.departure_airport,
    durationDays: extractedData.duration,
    productRawText: rawText,
    documentRawText: rawText,
  });

  const registration = await registerProductFromRaw({
    rawText,
    originalRawText: rawText,
    parserRawText: rawText,
    documentRawText: rawText,
    analysisNormalizedText: rawText.replace(/\s+/g, ' ').trim(),
    extractedData,
    title: extractedData.title,
    activeAttractions: [],
    destinationResolution,
    destinationCode: destinationResolution.destinationCode,
    enableGeminiFallback: true,
  });
  const schema = validateStandardProductRegistrationObject(registration);

  return {
    mode: 'raw_input_registration_rehearsal',
    saved: false,
    note: 'Raw-file rehearsal validates the central registration object only. Use admin/upload or --package-id for saved DB proof/contract rehearsal.',
    title: registration.extractedData.title,
    destination: registration.extractedData.destination,
    priceDates: registration.pricing.priceDates.length,
    priceRows: registration.pricing.productPrices.length,
    itineraryDays: registration.itinerary.itineraryDataToSave?.days?.length ?? 0,
    deliverabilityOk: registration.deliverability.ok,
    deliverabilityBlockers: registration.deliverability.blockers,
    schemaOk: schema.ok,
    schemaIssues: schema.issues,
    publishable: registration.publishable,
  };
}

async function runSavedPackageRehearsal(options: Options, packageId: string) {
  const autopilot = await runUploadToOpenAutopilot({
    supabase: supabaseAdmin,
    isSupabaseConfigured: true,
    options: {
      packageIds: [packageId],
      autoOpen: false,
      baseUrl: options.baseUrl,
      attempts: 1,
      limit: 1,
    },
  });
  const contract = await loadCustomerOpenContractForPackage(supabaseAdmin, packageId);

  return {
    mode: 'saved_package_customer_open_rehearsal',
    packageId,
    autoOpen: false,
    baseUrl: options.baseUrl,
    autopilot: {
      ok: autopilot.ok,
      scanned: autopilot.scanned,
      opened: autopilot.opened,
      readyNotOpened: autopilot.ready_not_opened,
      blocked: autopilot.blocked,
      openable: autopilot.openable,
      needsHumanSourceReview: autopilot.needs_human_source_review,
      errors: autopilot.errors,
      results: autopilot.results,
    },
    customerOpenContract: {
      ok: contract.ok,
      status: contract.status,
      blockers: contract.blockers,
      nextAction: contract.nextAction,
      mobileProof: contract.mobileProof,
      qualityScorecard: contract.qualityScorecard,
    },
    finalState: contract.ok ? 'customer_open_candidate' : 'needs_human_source_review',
  };
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const rawRehearsal = await runRawInputRehearsal(options);
  const packageId = await resolvePackageId(options);
  const savedRehearsal = packageId ? await runSavedPackageRehearsal(options, packageId) : null;

  const result = {
    checkedAt: new Date().toISOString(),
    rawInput: rawRehearsal,
    savedPackage: savedRehearsal,
    ok: Boolean((!rawRehearsal || rawRehearsal.schemaOk) && (!savedRehearsal || savedRehearsal.customerOpenContract.ok || savedRehearsal.finalState === 'needs_human_source_review')),
  };

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`Customer-open rehearsal checked at ${result.checkedAt}`);
    if (rawRehearsal) {
      console.log(`Raw input: schema=${rawRehearsal.schemaOk ? 'pass' : 'fail'}, deliverability=${rawRehearsal.deliverabilityOk ? 'pass' : 'blocked'}`);
    }
    if (savedRehearsal) {
      console.log(`Saved package ${savedRehearsal.packageId}: ${savedRehearsal.finalState}`);
      console.log(`Contract: ${savedRehearsal.customerOpenContract.status}`);
    }
  }

  if (!result.ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
