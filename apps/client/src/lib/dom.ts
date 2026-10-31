/** Minimal DOM builder — no framework, no runtime deps. */
type Child = Node | string | number | null | undefined | false;

export interface ElProps {
  class?: string;
  text?: string;
  html?: string;
  title?: string;
  type?: string;
  value?: string;
  placeholder?: string;
  maxlength?: number;
  inputmode?: 'text' | 'numeric' | 'decimal' | 'none' | 'search' | 'email' | 'tel' | 'url';
  autocomplete?: string;
  disabled?: boolean;
  role?: string;
  ariaChecked?: string;
  dataset?: Record<string, string>;
  on?: Partial<Record<keyof HTMLElementEventMap, (ev: Event) => void>>;
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: ElProps = {},
  children: Child[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (props.class) node.className = props.class;
  if (props.text !== undefined) node.textContent = props.text;
  if (props.html !== undefined) node.innerHTML = props.html;
  if (props.title) node.title = props.title;
  if (props.role) node.setAttribute('role', props.role);
  if (props.ariaChecked !== undefined) node.setAttribute('aria-checked', props.ariaChecked);
  if (props.dataset) for (const [k, v] of Object.entries(props.dataset)) node.dataset[k] = v;

  if (tag === 'input') {
    const input = node as unknown as HTMLInputElement;
    if (props.type) input.type = props.type;
    if (props.value !== undefined) input.value = props.value;
    if (props.placeholder) input.placeholder = props.placeholder;
    if (props.maxlength !== undefined) input.maxLength = props.maxlength;
    if (props.inputmode) input.inputMode = props.inputmode;
    if (props.autocomplete) input.setAttribute('autocomplete', props.autocomplete);
  }
  if (tag === 'button') {
    const button = node as unknown as HTMLButtonElement;
    if (props.type) button.type = props.type as 'button' | 'submit' | 'reset';
  }
  if (props.disabled !== undefined) (node as unknown as { disabled: boolean }).disabled = props.disabled;

  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    node.append(typeof child === 'number' ? String(child) : child);
  }
  if (props.on) {
    for (const [event, handler] of Object.entries(props.on)) {
      if (handler) node.addEventListener(event, handler as EventListener);
    }
  }
  return node;
}

export function clear(node: HTMLElement): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function mount(host: HTMLElement, ...nodes: Child[]): void {
  clear(host);
  for (const n of nodes) {
    if (n === null || n === undefined || n === false) continue;
    host.append(typeof n === 'number' ? String(n) : n);
  }
}
