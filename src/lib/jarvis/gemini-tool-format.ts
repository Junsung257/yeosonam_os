// Anthropic Tool 선언 → Gemini FunctionDeclaration 자동 변환

export interface GeminiFunctionDeclaration {
  name: string
  description: string
  parameters: {
    type: 'OBJECT'
    properties: Record<string, any>
    required?: string[]
  }
}

const TYPE_MAP: Record<string, string> = {
  string: 'STRING',
  number: 'NUMBER',
  boolean: 'BOOLEAN',
  object: 'OBJECT',
  array: 'ARRAY',
  integer: 'INTEGER',
}

function convertType(val: string): string {
  return TYPE_MAP[val.toLowerCase()] || val.toUpperCase()
}

function convertProperties(props: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {}
  for (const [key, val] of Object.entries(props)) {
    const converted: any = { ...val, type: convertType(val.type) }
    if (val.properties) {
      converted.properties = convertProperties(val.properties)
    }
    if (val.items) {
      converted.items = { ...val.items, type: convertType(val.items.type) }
    }
    out[key] = converted
  }
  return out
}

export function convertTools(
  anthropicTools: Array<{ name: string; description: string; input_schema: any }>
): GeminiFunctionDeclaration[] {
  return anthropicTools.map(tool => ({
    name: tool.name,
    description: tool.description,
    parameters: {
      type: 'OBJECT' as const,
      properties: convertProperties(tool.input_schema.properties || {}),
      ...(tool.input_schema.required ? { required: tool.input_schema.required } : {}),
    },
  }))
}
