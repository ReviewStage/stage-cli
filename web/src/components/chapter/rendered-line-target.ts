import { DIFF_SIDE, type DiffSide } from "@/lib/diff-types";

function sideSelector(side: DiffSide): string {
  return side === DIFF_SIDE.ADDITIONS ? "[data-additions]" : "[data-deletions]";
}

function changeLineType(side: DiffSide): string {
  return side === DIFF_SIDE.ADDITIONS ? "change-addition" : "change-deletion";
}

export function findRenderedDiffLine(
  root: ParentNode,
  side: DiffSide,
  line: number,
): HTMLElement | null {
  const splitLine = root.querySelector<HTMLElement>(`${sideSelector(side)} [data-line="${line}"]`);
  if (splitLine) return splitLine;

  const unifiedSelectors = [
    `[data-unified] [data-line="${line}"][data-line-type="${changeLineType(side)}"]`,
    `[data-unified] [data-line="${line}"][data-line-type="context"]`,
    `[data-unified] [data-line="${line}"][data-line-type="context-expanded"]`,
  ];
  for (const selector of unifiedSelectors) {
    const el = root.querySelector<HTMLElement>(selector);
    if (el) return el;
  }

  return root.querySelector<HTMLElement>(`[data-line="${line}"]`);
}
