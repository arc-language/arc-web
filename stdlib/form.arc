// Arc Form — validated forms with field-level errors
// Usage: import { createForm, Field, FormError } from "arc/form"
//
// Example:
//   const loginForm = createForm({
//     email: { required: true, type: "email" },
//     password: { required: true, minLength: 8 }
//   })
//
//   form on:submit={ loginForm.submit(fn values => doLogin(values)) }
//     Field form={ loginForm } name="email" label="Email"
//     Field form={ loginForm } name="password" label="Password" type="password"
//     button type="submit" "Log in"

// Validators — pure functions, return error string or none
fn _required(value) {
  if !value || value.trim() == "" { return "This field is required" }
  return none
}

fn _email(value) {
  unless value { return none }
  const atIdx = value.indexOf("@")
  if atIdx < 1 { return "Enter a valid email address" }
  const domain = value.slice(atIdx + 1)
  if domain.length < 3 || !domain.includes(".") { return "Enter a valid email address" }
  if value.includes(" ") { return "Enter a valid email address" }
  return none
}

fn _minLength(min) {
  return fn(value) {
    unless value { return none }
    if value.length < min { return "Must be at least {min} characters" }
    return none
  }
}

fn _maxLength(max) {
  return fn(value) {
    unless value { return none }
    if value.length > max { return "Must be {max} characters or fewer" }
    return none
  }
}

fn _pattern(regex, message) {
  return fn(value) {
    unless value { return none }
    unless regex.test(value) { return message ?? "Invalid format" }
    return none
  }
}

fn _numeric(value) {
  unless value { return none }
  if isNaN(Number(value)) { return "Must be a number" }
  return none
}

fn _min(minimum) {
  return fn(value) {
    unless value { return none }
    if Number(value) < minimum { return "Must be at least {minimum}" }
    return none
  }
}

fn _max(maximum) {
  return fn(value) {
    unless value { return none }
    if Number(value) > maximum { return "Must be {maximum} or less" }
    return none
  }
}

// Build a validator list from a field config object
fn _buildValidators(config) {
  const validators = []
  if config.required { validators.push(_required) }
  if config.type == "email" { validators.push(_email) }
  if config.type == "number" || config.numeric { validators.push(_numeric) }
  if config.minLength { validators.push(_minLength(config.minLength)) }
  if config.maxLength { validators.push(_maxLength(config.maxLength)) }
  if config.min != none { validators.push(_min(config.min)) }
  if config.max != none { validators.push(_max(config.max)) }
  if config.pattern { validators.push(_pattern(config.pattern, config.patternMessage)) }
  if config.validate { validators.push(config.validate) }
  return validators
}

// Validate a single field value against its validators
fn _validateField(value, validators) {
  for v in validators {
    const err = v(value)
    if err { return err }
  }
  return none
}

// createForm — returns a form handle with reactive state
fn createForm(schema) {
  @state let values = {}
  @state let errors = {}
  @state let touched = {}
  @state let isSubmitting = false
  @state let isSubmitted = false

  // Pre-build validators for each field
  const validators = {}
  for name, config in schema {
    validators[name] = _buildValidators(config)
  }

  fn getValue(name) { return values[name] ?? "" }

  fn setValue(name, value) {
    values = { ...values, [name]: value }
    // Re-validate on change if field was already touched
    if touched[name] {
      const err = _validateField(value, validators[name] ?? [])
      errors = { ...errors, [name]: err }
    }
  }

  fn touch(name) {
    touched = { ...touched, [name]: true }
    // Validate on blur
    const err = _validateField(values[name], validators[name] ?? [])
    errors = { ...errors, [name]: err }
  }

  fn validateAll() {
    const newErrors = {}
    let valid = true
    for name, fieldValidators in validators {
      const err = _validateField(values[name], fieldValidators)
      if err {
        newErrors[name] = err
        valid = false
      }
    }
    errors = newErrors
    touched = Object.fromEntries(Object.keys(schema).map(fn k => [k, true]))
    return valid
  }

  fn reset() {
    values = {}
    errors = {}
    touched = {}
    isSubmitting = false
    isSubmitted = false
  }

  fn submit(handler) {
    return fn(e) {
      e.preventDefault()
      isSubmitted = true
      const valid = validateAll()
      unless valid { return }
      isSubmitting = true
      Promise.resolve(handler(values))
        .then(fn() { isSubmitting = false })
        .catch(fn(err) {
          isSubmitting = false
          // If handler throws { field: "message" }, show field errors
          if err && !err.message {
            errors = { ...errors, ...err }
          }
        })
    }
  }

  return {
    get values() { return values },
    get errors() { return errors },
    get touched() { return touched },
    get isSubmitting() { return isSubmitting },
    get isSubmitted() { return isSubmitted },
    getValue,
    setValue,
    touch,
    validateAll,
    reset,
    submit,
    // For Field widget
    _validators: validators,
    _schema: schema
  }
}

// Field widget — renders a labeled input with inline error
widget Field
  // Attrs: form (handle from createForm), name, label, type, placeholder
  const fieldType = @type ?? @form._schema[@name]?.type ?? "text"
  const error = @form.errors[@name]
  const isTouched = @form.touched[@name]

  col gap="4px"
    if @label
      label id={"label-" + @name} class="field-label" "{@label}"
    input
      id={"field-" + @name}
      type={ fieldType }
      value={ @form.getValue(@name) }
      placeholder={ @placeholder ?? "" }
      aria-labelledby={"label-" + @name}
      aria-invalid={ isTouched && error ? "true" : "false" }
      aria-describedby={ isTouched && error ? "error-" + @name : none }
      on:input={ fn e => @form.setValue(@name, e.target.value) }
      on:blur={ fn() => @form.touch(@name) }
      class={ isTouched && error ? "field-error" : "" }
    if isTouched && error
      span id={"error-" + @name} class="field-error-msg" role="alert" "{error}"

  design
    .field-label
      size: 14px
      weight: 500
      fg: #374151
    .field-error-msg
      size: 12px
      fg: #dc2626
    input.field-error
      border: 1px #dc2626
      outline-color: #dc2626

// FormError widget — shows a top-level form error message
widget FormError
  // Attrs: message
  if @message
    div role="alert" aria-live="assertive" class="form-error-banner" "{@message}"

  design
    .form-error-banner
      p: 12px 16px
      bg: #fee2e2
      fg: #991b1b
      radius: 6px
      size: 14px
