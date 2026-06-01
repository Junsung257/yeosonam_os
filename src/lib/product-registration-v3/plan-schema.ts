import { z } from 'zod';

export const V3StructurePlanSchema = z.object({
  document_type: z.enum(['catalog', 'single_package', 'mixed', 'unknown']),
  planner_source: z.enum(['deterministic', 'ai_schema']),
  expected_products: z.number().int().min(0),
  shared_sections: z.array(z.object({
    label: z.string(),
    line_start: z.number().int().min(1),
    line_end: z.number().int().min(1),
  })),
  product_boundaries: z.array(z.object({
    index: z.number().int().min(0),
    line_start: z.number().int().min(1),
    line_end: z.number().int().min(1),
    title_hint: z.string(),
  })),
  variant_axes: z.array(z.object({
    name: z.string(),
    values: z.array(z.string()),
  })),
  price_table_location: z.object({
    line_start: z.number().int().min(1),
    line_end: z.number().int().min(1),
    label: z.string(),
  }).nullable(),
  price_mapping_strategy: z.enum(['single_table', 'variant_table', 'none', 'unknown']),
  flight_pattern: z.object({
    outbound_codes: z.array(z.string()),
    inbound_codes: z.array(z.string()),
    meeting_times: z.array(z.string()),
  }),
  itinerary_boundary_pattern: z.string().nullable(),
  option_section_locations: z.array(z.object({
    line_start: z.number().int().min(1),
    line_end: z.number().int().min(1),
    label: z.string(),
  })),
  shopping_section_locations: z.array(z.object({
    line_start: z.number().int().min(1),
    line_end: z.number().int().min(1),
    label: z.string(),
  })),
  confidence: z.number().min(0).max(1),
  unresolved_parts: z.array(z.string()),
}).strict();

export type V3StructurePlanSchemaOutput = z.infer<typeof V3StructurePlanSchema>;

export function parseV3AiStructurePlan(value: unknown): V3StructurePlanSchemaOutput {
  const parsed = V3StructurePlanSchema.parse(value);
  return {
    ...parsed,
    planner_source: 'ai_schema',
  };
}
