export type MutationType =
  | 'missing_required'
  | 'wrong_type'
  | 'null_value'
  | 'empty_value'
  | 'boundary'
  | 'extra_field'
  | 'valid'; // Control case

export interface Mutation {
  type: MutationType;
  field?: string;
  input: unknown;
  description: string;
}

export interface JsonSchema {
  type: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
}

export function generateMutations(schema: JsonSchema): Mutation[] {
  const mutations: Mutation[] = [];
  const properties = schema.properties ?? {};
  const required = schema.required ?? [];

  // Generate a valid input first (control case)
  const validInput = generateValidInput(schema);
  mutations.push({
    type: 'valid',
    input: validInput,
    description: 'Valid input (control case)',
  });

  // Missing required fields
  for (const field of required) {
    const input = { ...validInput };
    delete (input as Record<string, unknown>)[field];
    mutations.push({
      type: 'missing_required',
      field,
      input,
      description: `Missing required field: ${field}`,
    });
  }

  // Wrong types for each field
  for (const [field, fieldSchema] of Object.entries(properties)) {
    const wrongTypeValue = getWrongTypeValue(fieldSchema.type);
    mutations.push({
      type: 'wrong_type',
      field,
      input: { ...validInput, [field]: wrongTypeValue },
      description: `Wrong type for ${field}: expected ${fieldSchema.type}, got ${typeof wrongTypeValue}`,
    });
  }

  // Null values for each field
  for (const field of Object.keys(properties)) {
    mutations.push({
      type: 'null_value',
      field,
      input: { ...validInput, [field]: null },
      description: `Null value for field: ${field}`,
    });
  }

  // Empty values for string/array fields
  for (const [field, fieldSchema] of Object.entries(properties)) {
    if (fieldSchema.type === 'string') {
      mutations.push({
        type: 'empty_value',
        field,
        input: { ...validInput, [field]: '' },
        description: `Empty string for field: ${field}`,
      });
    } else if (fieldSchema.type === 'array') {
      mutations.push({
        type: 'empty_value',
        field,
        input: { ...validInput, [field]: [] },
        description: `Empty array for field: ${field}`,
      });
    }
  }

  // Boundary values
  for (const [field, fieldSchema] of Object.entries(properties)) {
    if (fieldSchema.type === 'string') {
      // Very long string
      mutations.push({
        type: 'boundary',
        field,
        input: { ...validInput, [field]: 'x'.repeat(10000) },
        description: `Very long string for field: ${field}`,
      });
      // String with special characters
      mutations.push({
        type: 'boundary',
        field,
        input: { ...validInput, [field]: '../../../etc/passwd' },
        description: `Path traversal attempt for field: ${field}`,
      });
    } else if (fieldSchema.type === 'number' || fieldSchema.type === 'integer') {
      mutations.push({
        type: 'boundary',
        field,
        input: { ...validInput, [field]: -1 },
        description: `Negative number for field: ${field}`,
      });
      mutations.push({
        type: 'boundary',
        field,
        input: { ...validInput, [field]: Number.MAX_SAFE_INTEGER },
        description: `Max safe integer for field: ${field}`,
      });
    }
  }

  // Extra unknown field
  mutations.push({
    type: 'extra_field',
    field: '_unknown_field',
    input: { ...validInput, _unknown_field: 'unexpected' },
    description: 'Extra unknown field added',
  });

  return mutations;
}

function generateValidInput(schema: JsonSchema): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const properties = schema.properties ?? {};

  for (const [field, fieldSchema] of Object.entries(properties)) {
    result[field] = getDefaultValue(fieldSchema.type);
  }

  return result;
}

function getDefaultValue(type: string): unknown {
  switch (type) {
    case 'string':
      return 'test_value';
    case 'number':
    case 'integer':
      return 42;
    case 'boolean':
      return true;
    case 'array':
      return [];
    case 'object':
      return {};
    default:
      return null;
  }
}

function getWrongTypeValue(expectedType: string): unknown {
  // Return a value of a different type
  switch (expectedType) {
    case 'string':
      return 12345; // number instead of string
    case 'number':
    case 'integer':
      return 'not_a_number'; // string instead of number
    case 'boolean':
      return 'not_a_boolean'; // string instead of boolean
    case 'array':
      return 'not_an_array'; // string instead of array
    case 'object':
      return 'not_an_object'; // string instead of object
    default:
      return {};
  }
}
