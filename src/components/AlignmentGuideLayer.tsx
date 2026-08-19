import { ViewportPortal } from "@xyflow/react";
import type { CSSProperties } from "react";
import type { AlignmentGuide, AlignmentSizeGuide } from "../layout";

function LineGuide({ guide }: { guide: Extract<AlignmentGuide, { kind: "line" }> }) {
  const vertical = guide.axis === "x";
  const style = vertical
    ? { left: guide.coordinate, top: guide.from, height: guide.to - guide.from }
    : { left: guide.from, top: guide.coordinate, width: guide.to - guide.from };
  return (
    <div
      className={`bd-alignment-guide bd-alignment-guide-${guide.axis}`}
      data-axis={guide.axis}
      data-subject-anchor={guide.subjectAnchor}
      data-target-anchor={guide.targetAnchor}
      data-target-id={guide.targetId}
      style={style}
    />
  );
}

function sizeGuideStyle(guide: AlignmentSizeGuide, target: boolean): CSSProperties {
  const rect = target ? guide.target : guide.subject;
  return guide.axis === "width"
    ? { left: rect.x, top: rect.y - 12, width: rect.width }
    : { left: rect.x - 12, top: rect.y, height: rect.height };
}

function SizeGuide({ guide }: { guide: AlignmentSizeGuide }) {
  return (
    <>
      <div
        className={`bd-size-guide bd-size-guide-${guide.axis}`}
        data-axis={guide.axis}
        data-role="subject"
        data-target-id={guide.targetId}
        style={sizeGuideStyle(guide, false)}
      />
      <div
        className={`bd-size-guide bd-size-guide-${guide.axis}`}
        data-axis={guide.axis}
        data-role="target"
        data-target-id={guide.targetId}
        style={sizeGuideStyle(guide, true)}
      />
    </>
  );
}

export function AlignmentGuideLayer({ guides }: { guides: readonly AlignmentGuide[] }) {
  if (guides.length === 0) return null;
  return (
    <ViewportPortal>
      <div className="bd-alignment-guide-layer" aria-hidden="true">
        {guides.map((guide, index) => guide.kind === "line"
          ? <LineGuide key={`line:${guide.axis}:${guide.targetId}:${index}`} guide={guide} />
          : <SizeGuide key={`size:${guide.axis}:${guide.targetId}:${index}`} guide={guide} />)}
      </div>
    </ViewportPortal>
  );
}
