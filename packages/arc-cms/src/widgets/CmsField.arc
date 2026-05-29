# CmsField - labelled input row. Wraps arc-ui .input-label + .input.
# Pass bind:value="..." to attach two-way binding from the parent page.
widget CmsField(label: String, name: String, type: String = "text", placeholder: String = "", required: Bool = false, hint: String = "")
  col class="!input-wrap"
    label class="!input-label {required ? '!input-label--required' : ''}" for="{name}" "{label}"
    input class="!input" type="{type}" id="{name}" name="{name}" placeholder="{placeholder}" bind:value="{name}"
    if hint
      text class="!input-hint" "{hint}"
