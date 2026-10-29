/**
 * Small, dependency-free validation layer. Rules are data, errors are plain
 * records keyed by field name, so the same validators work for any form.
 */
export type FieldErrors = Record<string, string>;

export interface ValidationRule {
  readonly required?: boolean;
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly email?: boolean;
  readonly pattern?: RegExp;
  readonly message?: string;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function validateField(value: string, rule: ValidationRule): string | null {
  const trimmed = value.trim();
  if (rule.required === true && trimmed === '') {
    return rule.message ?? 'This field is required';
  }
  if (trimmed === '') return null;
  if (rule.minLength !== undefined && trimmed.length < rule.minLength) {
    return rule.message ?? `Must be at least ${rule.minLength} characters`;
  }
  if (rule.maxLength !== undefined && trimmed.length > rule.maxLength) {
    return rule.message ?? `Must be at most ${rule.maxLength} characters`;
  }
  if (rule.email === true && !EMAIL_PATTERN.test(trimmed)) {
    return rule.message ?? 'Enter a valid email address';
  }
  if (rule.pattern !== undefined && !rule.pattern.test(trimmed)) {
    return rule.message ?? 'The value has an invalid format';
  }
  return null;
}

export function validateFields(
  values: Readonly<Record<string, string>>,
  rules: Readonly<Record<string, ValidationRule>>,
): FieldErrors {
  const errors: FieldErrors = {};
  for (const [field, rule] of Object.entries(rules)) {
    const error = validateField(values[field] ?? '', rule);
    if (error !== null) errors[field] = error;
  }
  return errors;
}

export function hasErrors(errors: FieldErrors): boolean {
  return Object.keys(errors).length > 0;
}
