export type HandoffParamReader = {
  get(name: string): string | null;
};

export type HandoffQueryContext = {
  source: string | null;
  intent: string | null;
  partyType: string | null;
  query: string | null;
  destination: string | null;
  budget: string | null;
  selectedProducts: string[];
};

function readFirstParam(params: HandoffParamReader, names: string[]): string | null {
  for (const name of names) {
    const value = params.get(name)?.trim();
    if (value) return value;
  }
  return null;
}

export function splitHandoffList(value: string | null): string[] {
  const seen = new Set<string>();
  return (value ?? '')
    .split(/[,\n|]+/)
    .map((item) => item.trim())
    .filter((item) => {
      if (!item || seen.has(item)) return false;
      seen.add(item);
      return true;
    })
    .slice(0, 8);
}

export function readHandoffContext(params: HandoffParamReader): HandoffQueryContext {
  return {
    source: readFirstParam(params, ['source', 'handoff_source', 'from']),
    intent: readFirstParam(params, ['intent', 'trip_intent', 'category']),
    partyType: readFirstParam(params, ['party_type', 'partyType', 'party']),
    query: readFirstParam(params, ['query', 'q', 'prompt']),
    destination: readFirstParam(params, ['destination', 'dest', 'region']),
    budget: readFirstParam(params, ['budget', 'budget_label', 'price']),
    selectedProducts: splitHandoffList(
      readFirstParam(params, ['selected_products', 'selectedProducts', 'products', 'product', 'product_name']),
    ),
  };
}

export function hasHandoffContext(context: HandoffQueryContext): boolean {
  return Boolean(
    context.source ||
      context.intent ||
      context.partyType ||
      context.query ||
      context.destination ||
      context.budget ||
      context.selectedProducts.length > 0,
  );
}
