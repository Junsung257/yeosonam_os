import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { renderPackage } from '@/lib/render-contract';
import { runProductRegistrationV2 } from '.';
import { REQUIRED_V2_CUSTOMER_EVIDENCE_FIELDS } from './evidence-verifier';
import { evidenceCoverage } from '@/lib/source-evidence';

const raw = readFileSync(join(__dirname, '..', 'parser', 'fixtures', 'baekdu-e2e-input.txt'), 'utf8');

describe('Product Registration V2 - Baekdu multi-variant catalog', () => {
  it('plans structure only and executes 4 grade x 2 course products deterministically', async () => {
    const result = await runProductRegistrationV2(raw);

    expect(result.plan.document_type).toBe('multi_variant_catalog');
    expect(result.plan.planner_source).toBe('deterministic');
    expect(result.plan.expected_products).toBe(8);
    expect(result.plan.variant_axes).toEqual([
      { name: 'grade', values: ['세이브', '스탠다드', '프리미엄', '크라운'] },
      { name: 'course', values: ['북파 2박3일', '북+서파 3박4일'] },
    ]);
    expect(result.plan.product_boundaries).toHaveLength(8);
    expect(result.plan.price_mapping_strategy).toBe('vertical_grade_columns');
    expect(result.plan.flight_pattern.outbound).toMatchObject({ code: 'BX337', dep: '09:40', arr: '11:30' });
    expect(result.plan.flight_pattern.inbound).toMatchObject({ code: 'BX338', dep: '12:30', arr: '16:25' });
    expect(result.plan.flight_pattern.meetingTimes).toContain('06:30');

    expect(result.products).toHaveLength(8);
    expect(result.products.map(p => p.extractedData.product_type)).toEqual([
      '세이브 실속',
      '스탠다드 품격 노노',
      '프리미엄 노노노',
      '크라운 노노노+',
      '세이브 실속',
      '스탠다드 품격 노노',
      '프리미엄 노노노',
      '크라운 노노노+',
    ]);
    expect(result.products.map(p => p.extractedData.title)).toEqual([
      '연길/백두산(북파) 2박3일',
      '연길/백두산 (북파) 2박3일',
      '연길/백두산 (북파) 2박3일',
      '연길/백두산 (북파) 2박3일',
      '연길/백두산(북+서파) 3박4일',
      '연길/백두산(북+서파) 3박4일',
      '연길/백두산(북+서파) 3박4일',
      '연길/백두산(북+서파) 3박4일',
    ]);
  });

  it('keeps flight times, evidence, render contract, and attraction candidates gate-clean', async () => {
    const result = await runProductRegistrationV2(raw);

    for (const product of result.products) {
      const view = renderPackage(product.renderInput);
      expect(view.flightHeader.outbound).toMatchObject({
        code: 'BX337',
        depTime: '09:40',
        arrTime: '11:30',
        depCity: '부산',
        arrCity: '연길',
      });
      expect(view.flightHeader.inbound).toMatchObject({
        code: 'BX338',
        depTime: '12:30',
        arrTime: '16:25',
        depCity: '연길',
        arrCity: '부산',
      });
      expect(view.flightHeader.outbound?.depTime).not.toBe('06:30');
      const extractedPrice = product.extractedData.price;
      if (typeof extractedPrice !== 'number') throw new Error('Expected extracted product price');
      expect(product.renderInput.price_dates?.some(d => d.price === extractedPrice)).toBe(true);
      const duration = product.extractedData.duration;
      if (typeof duration !== 'number') throw new Error('Expected extracted product duration');
      expect(view.days).toHaveLength(duration);

      const evidence = evidenceCoverage(product.sourceEvidence, [...REQUIRED_V2_CUSTOMER_EVIDENCE_FIELDS]);
      expect(evidence.missing).toEqual([]);
      expect(product.sourceEvidence['flight.outbound.dep_time']?.[0]?.quote).toBe('09:40');
      expect(product.sourceEvidence['flight.inbound.dep_time']?.[0]?.quote).toBe('12:30');

      const noisy = product.attractionCandidates.filter(c =>
        ['부산', '연길', '도문', '용정', '이도백하', '북파', '서파', '전용차량', '전일', '호텔식', '현지식', '김밥', '냉면', '꿔바로우', '삼겹살', '샤브샤브', '무제한']
          .includes(c.replace(/\s+/g, '')),
      );
      expect(noisy).toEqual([]);
    }

    expect(result.gate.status).toBe('clean');
    expect(result.gate.customer_publishable).toBe(true);
    expect(result.gate.checks.filter(c => c.status === 'fail')).toEqual([]);
  });
});
