import { calculateCellEnvironment } from "./simulation";
import type { EcoCell, InterventionTool, SurfaceType } from "./types";

export function applyIntervention(cell: EcoCell, tool: InterventionTool): EcoCell {
  const surfaceType: SurfaceType = tool === "erase" ? cell.baselineSurfaceType : tool;
  return { ...cell, surfaceType, ...calculateCellEnvironment(surfaceType) };
}
