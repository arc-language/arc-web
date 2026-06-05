// Arc Form — validated forms with field-level errors
// Usage: import { createForm, Field, SubmitButton, FormError } from "arc/form"
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
//     SubmitButton form={ loginForm } "Log in"

// Built-in locale message maps — add more keys or locales as needed
// Pass locale="fr" (or any BCP 47 language tag) to createForm() to use built-in translations
const _FORM_MESSAGES = {
  en: { required: "This field is required", email: "Enter a valid email address", phone: "Enter a valid phone number", number: "Must be a number", amount: "Enter a valid amount", positive: "Amount must be positive" },
  fr: { required: "Ce champ est obligatoire", email: "Saisissez une adresse e-mail valide", phone: "Saisissez un numéro de téléphone valide", number: "Doit être un nombre", amount: "Saisissez un montant valide", positive: "Le montant doit être positif" },
  es: { required: "Este campo es obligatorio", email: "Introduce un correo electrónico válido", phone: "Introduce un número de teléfono válido", number: "Debe ser un número", amount: "Introduce un importe válido", positive: "El importe debe ser positivo" },
  de: { required: "Dieses Feld ist erforderlich", email: "Gib eine gültige E-Mail-Adresse ein", phone: "Gib eine gültige Telefonnummer ein", number: "Muss eine Zahl sein", amount: "Gib einen gültigen Betrag ein", positive: "Der Betrag muss positiv sein" },
  nl: { required: "Dit veld is verplicht", email: "Voer een geldig e-mailadres in", phone: "Voer een geldig telefoonnummer in", number: "Moet een getal zijn", amount: "Voer een geldig bedrag in", positive: "Het bedrag moet positief zijn" },
  pt: { required: "Este campo é obrigatório", email: "Insira um endereço de e-mail válido", phone: "Insira um número de telefone válido", number: "Deve ser um número", amount: "Insira um valor válido", positive: "O valor deve ser positivo" },
  ja: { required: "このフィールドは必須です", email: "有効なメールアドレスを入力してください", phone: "有効な電話番号を入力してください", number: "数値を入力してください", amount: "有効な金額を入力してください", positive: "金額は正の数にしてください" }
}

const _SUBMIT_LABELS = {
  en: "Submitting…", fr: "Envoi en cours…", es: "Enviando…", de: "Wird gesendet…", nl: "Bezig met verzenden…", pt: "Enviando…", ja: "送信中…"
}

// Validators — pure functions, return error string or none
fn _required(value) {
  if !value || value.trim() == "" { return "This field is required" }
  return none
}

fn _email(value) {
  unless value { return none }
  if value.length > 254 { return "Enter a valid email address" }
  const atIdx = value.indexOf("@")
  if atIdx < 1 { return "Enter a valid email address" }
  const domain = value.slice(atIdx + 1)
  if domain.length < 3 || !domain.includes(".") { return "Enter a valid email address" }
  if value.includes(" ") { return "Enter a valid email address" }
  return none
}

fn _minLength(min, message) {
  return fn(value) {
    unless value { return none }
    if value.length < min { return message ?? "Must be at least {min} characters" }
    return none
  }
}

fn _maxLength(max, message) {
  return fn(value) {
    unless value { return none }
    if value.length > max { return message ?? "Must be {max} characters or fewer" }
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

fn _phone(value) {
  unless value { return none }
  const stripped = value.replace(/[\s\-().]/g, "")
  const digits = stripped.replace(/\D/g, "")
  if digits.length < 7 || digits.length > 15 { return "Enter a valid phone number" }
  unless /^\+?[1-9]\d{6,14}$/.test(stripped) { return "Enter a valid phone number" }
  return none
}

fn _money(value) {
  unless value { return none }
  const n = Number(String(value).replace(/,/g, ""))
  if isNaN(n) { return "Enter a valid amount" }
  if n < 0 { return "Amount must be positive" }
  return none
}

// Build a validator list from a field config object
// config._messages: optional overrides e.g. { required: "Required field", email: "Bad email" }
fn _buildValidators(config) {
  const m = config._messages ?? {}
  const validators = []
  if config.required { validators.push(m.required ? fn(v) { if !v || v.trim() == "" { return m.required } return none } : _required) }
  if config.type == "email" { validators.push(m.email ? fn(v) { unless v { return none }; if v.length > 254 { return m.email }; const ai = v.indexOf("@"); if ai < 1 { return m.email }; const d = v.slice(ai + 1); if d.length < 3 || !d.includes(".") { return m.email }; if v.includes(" ") { return m.email }; return none } : _email) }
  if config.type == "phone" { validators.push(m.phone ? fn(v) { unless v { return none }; const s = v.replace(/[\s\-().]/g, ""); const d = s.replace(/\D/g, ""); if d.length < 7 || d.length > 15 { return m.phone }; unless /^\+?[1-9]\d{6,14}$/.test(s) { return m.phone }; return none } : _phone) }
  if config.type == "money" { validators.push(_money) }
  if config.type == "number" || config.numeric { validators.push(_numeric) }
  if config.minLength { validators.push(_minLength(config.minLength, m.minLength)) }
  if config.maxLength { validators.push(_maxLength(config.maxLength, m.maxLength)) }
  if config.min != none { validators.push(_min(config.min)) }
  if config.max != none { validators.push(_max(config.max)) }
  if config.pattern { validators.push(_pattern(config.pattern, config.patternMessage ?? m.pattern)) }
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
// messages: optional object to override default validator error messages,
//   e.g. { required: "Verplicht veld", email: "Ongeldig e-mailadres", ... }
// locale: BCP 47 language tag (e.g. "fr", "nl", "de") — picks built-in translations as defaults
//   before any messages overrides. Falls back to "en" for unknown locales.
fn createForm(schema, messages, locale) {
  @state let values = {}
  @state let errors = {}
  @state let touched = {}
  @state let isSubmitting = false
  @state let isSubmitted = false

  // Pre-build validators for each field; merge locale defaults → form messages → field overrides
  const _localeDefaults = _FORM_MESSAGES[locale?.split("-")[0]] ?? _FORM_MESSAGES.en
  const _baseMessages = messages ? { ..._localeDefaults, ...messages } : _localeDefaults
  const validators = {}
  for name, config in schema {
    const fieldConfig = { ...config, _messages: { ..._baseMessages, ...(config._messages ?? {}) } }
    validators[name] = _buildValidators(fieldConfig)
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
          // Handle plain string errors, field-map errors, and Error instances
          if err is String {
            errors = { ...errors, _form: err }
          } else if err && !err.message {
            // If handler throws { field: "message" }, show field errors
            errors = { ...errors, ...err }
          } else if err {
            errors = { ...errors, _form: err.message }
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
    // For Field widget and SubmitButton locale defaults
    _validators: validators,
    _schema: schema,
    locale
  }
}

// Field widget — renders a labeled input with inline error
widget Field
  // Attrs: form (handle from createForm), name, label, type, placeholder
  const fieldType = @type ?? @form._schema[@name]?.type ?? "text"
  const error = @form.errors[@name]
  const isTouched = @form.touched[@name]
  const isRequired = @form._schema[@name]?.required ?? false

  col gap="4px"
    if @label
      label id={"label-" + @name} for={"field-" + @name} class="field-label" "{@label}"
    input
      id={"field-" + @name}
      type={ fieldType }
      value={ @form.getValue(@name) }
      placeholder={ @placeholder ?? "" }
      required={ isRequired ? true : none }
      aria-required={ isRequired ? "true" : none }
      aria-label={ @label ? none : @name }
      aria-invalid={ isTouched ? (error ? "true" : "false") : none }
      aria-describedby={ isTouched && error ? "error-" + @name : none }
      on:input={ fn e => @form.setValue(@name, e.target.value) }
      on:blur={ fn() => @form.touch(@name) }
      class={ isTouched && error ? "field-error" : "" }
    span
      id={"error-" + @name}
      class="field-error-msg"
      aria-live="polite"
      role="status"
      aria-atomic="true"
      "{isTouched && error ? error : ""}"

  design
    .field-label
      size: 14px
      weight: 500
      fg: #374151
    .field-error-msg
      size: 12px
      fg: #b91c1c
    input.field-error
      border: 1px #b91c1c
      outline-color: #b91c1c

// SubmitButton widget — submit button that auto-disables during submission
// Usage: SubmitButton form={ loginForm } locale="nl" "Log in"
// locale attr picks a built-in submitting label; submittingLabel overrides fully
widget SubmitButton
  // Attrs: form (handle from createForm), locale (optional BCP 47 tag), submittingLabel (optional), (slot for children)
  const _submittingText = @submittingLabel ?? (_SUBMIT_LABELS[@locale?.split("-")[0]] ?? _SUBMIT_LABELS.en)
  button
    type="submit"
    disabled={ @form.isSubmitting }
    aria-busy={ @form.isSubmitting ? "true" : none }
    class={ @form.isSubmitting ? "btn-submitting" : "" }
    if @form.isSubmitting
      span aria-hidden="true" "⏳ "
      span class="btn-label" "{_submittingText}"
    if !@form.isSubmitting
      @slot

  design
    .btn-submitting
      opacity: 0.6
      cursor: not-allowed

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
