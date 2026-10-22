// Reads a tool's zod input shape and describes each field in CLI terms
// (flag name, kind of value, whether it is required), so flags and help
// are generated from the same schemas the MCP server uses.

// list_campaigns' "campaign_id" -> "campaign-id"; enrich_twitter's "firstName" -> "first-name"
export function toFlag(key) {
  return key.replace(/_/g, "-").replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
}

// Peel optional/nullable/default wrappers to reach the real type.
function unwrap(schema) {
  let inner = schema;
  let optional = false;
  let nullable = false;
  let description = schema.description;
  let defaultValue;
  for (;;) {
    const type = inner._def.typeName;
    if (type === "ZodDefault") defaultValue = inner._def.defaultValue();
    if (type === "ZodOptional" || type === "ZodDefault") optional = true;
    else if (type === "ZodNullable") nullable = true;
    else if (type !== "ZodEffects") break;
    inner = type === "ZodEffects" ? inner._def.schema : inner._def.innerType;
    description = description || inner.description;
  }
  return { inner, optional, nullable, description, defaultValue };
}

function primitiveKind(schema) {
  const type = unwrap(schema).inner._def.typeName;
  if (type === "ZodString") return "string";
  if (type === "ZodNumber") return "number";
  return null;
}

// kind is one of: string, number, boolean, enum, list (repeatable scalars), json
export function describeField(key, schema) {
  const { inner, optional, nullable, description, defaultValue } = unwrap(schema);
  const type = inner._def.typeName;
  const field = { key, flag: toFlag(key), optional, nullable, defaultValue, description: description || "" };

  if (type === "ZodString") return { ...field, kind: "string" };
  if (type === "ZodNumber") return { ...field, kind: "number" };
  if (type === "ZodBoolean") return { ...field, kind: "boolean" };
  if (type === "ZodEnum") return { ...field, kind: "enum", values: inner._def.values };
  if (type === "ZodArray" && primitiveKind(inner._def.type)) {
    return { ...field, kind: "list", itemKind: primitiveKind(inner._def.type) };
  }
  return { ...field, kind: "json" };
}

export function describeInputs(inputs) {
  return Object.entries(inputs).map(([key, schema]) => describeField(key, schema));
}
