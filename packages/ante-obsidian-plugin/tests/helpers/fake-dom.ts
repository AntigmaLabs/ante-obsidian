type Listener = () => void

export class FakeElement {
  tagName: string
  className = ""
  textContent = ""
  dataset: Record<string, string> = {}
  attributes: Record<string, string> = {}
  children: FakeElement[] = []
  open = false
  hidden = false
  private listeners = new Map<string, Array<(event?: unknown) => void>>()

  constructor(
    tagName = "div",
    options?: {
      cls?: string
      text?: string
    },
  ) {
    this.tagName = tagName
    this.className = options?.cls ?? ""
    this.textContent = options?.text ?? ""
  }

  createDiv(options?: { cls?: string; text?: string }): FakeElement {
    return this.append(new FakeElement("div", options))
  }

  createSpan(options?: { cls?: string; text?: string }): FakeElement {
    return this.append(new FakeElement("span", options))
  }

  createEl(
    tagName: string,
    options?: {
      cls?: string
      text?: string
    },
  ): FakeElement {
    return this.append(new FakeElement(tagName, options))
  }

  empty(): void {
    this.children = []
    this.textContent = ""
  }

  setText(text: string): void {
    this.textContent = text
  }

  setAttr(name: string, value: string): void {
    this.attributes[name] = value
  }

  hide(): void {
    this.hidden = true
  }

  show(): void {
    this.hidden = false
  }

  addEventListener(type: string, listener: (event?: unknown) => void): void {
    const listeners = this.listeners.get(type) ?? []
    listeners.push(listener)
    this.listeners.set(type, listeners)
  }

  click(): void {
    for (const listener of this.listeners.get("click") ?? []) {
      listener()
    }
  }

  dispatch(type: string, event?: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event)
    }
  }

  get allText(): string {
    return [this.textContent, ...this.children.map((child) => child.allText)].join(
      "\n",
    )
  }

  findByClass(className: string): FakeElement[] {
    const matches: FakeElement[] = []
    const classes = this.className.split(/\s+/).filter(Boolean)
    if (classes.includes(className)) {
      matches.push(this)
    }
    for (const child of this.children) {
      matches.push(...child.findByClass(className))
    }
    return matches
  }

  findByTag(tagName: string): FakeElement[] {
    const matches: FakeElement[] = []
    if (this.tagName === tagName) {
      matches.push(this)
    }
    for (const child of this.children) {
      matches.push(...child.findByTag(tagName))
    }
    return matches
  }

  private append(child: FakeElement): FakeElement {
    this.children.push(child)
    return child
  }
}
