export type CaseTextSections = {
  setup?: string;
  actions?: string;
  expected?: string;
  breakdown?: string;
};

const HEADING = /^##\s+(setup|steps|actions|expected|breakdown)\s*$/i;

export function composeCaseText(sections: CaseTextSections): string {
  const parts: string[] = [];
  const add = (heading: string, body?: string) => {
    const value = body?.trim();
    if (value) parts.push(`## ${heading}\n${value}`);
  };
  add("Setup", sections.setup);
  add("Steps", sections.actions);
  add("Expected", sections.expected);
  add("Breakdown", sections.breakdown);
  return parts.join("\n\n");
}

export function parseCaseText(text: string): Required<CaseTextSections> {
  const out: Required<CaseTextSections> = { setup: "", actions: "", expected: "", breakdown: "" };
  if (!text) return out;

  const lines = text.replace(/\r\n/g, "\n").split("\n");
  let current: keyof Required<CaseTextSections> | null = null;
  const buf: string[] = [];

  const flush = () => {
    if (current) out[current] = buf.join("\n").trim();
    buf.length = 0;
  };

  for (const line of lines) {
    const match = line.match(HEADING);
    if (match) {
      flush();
      const name = match[1].toLowerCase();
      current =
        name === "steps" || name === "actions"
          ? "actions"
          : (name as keyof Required<CaseTextSections>);
      continue;
    }
    if (current) buf.push(line);
  }
  flush();
  return out;
}

export function resolveCaseText(
  input: CaseTextSections & { text?: string },
  current?: CaseTextSections & { text?: string },
): string | undefined {
  if (input.text !== undefined) return input.text;

  const hasPart =
    input.setup !== undefined ||
    input.actions !== undefined ||
    input.expected !== undefined ||
    input.breakdown !== undefined;
  if (!hasPart) return undefined;

  const base = current?.text
    ? parseCaseText(current.text)
    : {
        setup: current?.setup ?? "",
        actions: current?.actions ?? "",
        expected: current?.expected ?? "",
        breakdown: current?.breakdown ?? "",
      };

  return composeCaseText({
    setup: input.setup !== undefined ? input.setup : base.setup,
    actions: input.actions !== undefined ? input.actions : base.actions,
    expected: input.expected !== undefined ? input.expected : base.expected,
    breakdown: input.breakdown !== undefined ? input.breakdown : base.breakdown,
  });
}
