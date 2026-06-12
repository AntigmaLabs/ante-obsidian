type ElementTag = "div" | "span" | "button" | "textarea" | "h2" | "select";

type FactoryOptions = {
  cls?: string;
  text?: string;
};

// Callers must pass elements from Obsidian's patched DOM surface, where
// createDiv/createSpan/createEl are available on HTMLElements.
export type ObsidianDomParent = HTMLElement;

type FactoryNode<T extends HTMLElement> = {
  appendTo(parent: ObsidianDomParent): T;
};

const createFactoryNode = <T extends HTMLElement>(
  tag: ElementTag,
  options?: FactoryOptions,
): FactoryNode<T> => ({
  appendTo(parent: ObsidianDomParent): T {
    const host = parent as HTMLElement & {
      createDiv: (options?: FactoryOptions) => HTMLDivElement;
      createSpan: (options?: FactoryOptions) => HTMLSpanElement;
      createEl: (tag: string, options?: FactoryOptions) => HTMLElement;
    };
    return (
      tag === "div"
        ? host.createDiv(options)
        : tag === "span"
          ? host.createSpan(options)
          : host.createEl(tag, options)
    ) as T;
  },
});

export const div = (options?: FactoryOptions): FactoryNode<HTMLDivElement> =>
  createFactoryNode("div", options);

export const span = (options?: FactoryOptions): FactoryNode<HTMLSpanElement> =>
  createFactoryNode("span", options);

export const button = (options?: FactoryOptions): FactoryNode<HTMLButtonElement> =>
  createFactoryNode("button", options);

export const textarea = (options?: FactoryOptions): FactoryNode<HTMLTextAreaElement> =>
  createFactoryNode("textarea", options);

export const h2 = (options?: FactoryOptions): FactoryNode<HTMLHeadingElement> =>
  createFactoryNode("h2", options);

export const select = (options?: FactoryOptions): FactoryNode<HTMLSelectElement> =>
  createFactoryNode("select", options);
