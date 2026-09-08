import { calculateCellEnvironment } from "./simulation";
import type { EcoCell, InterventionTool, SurfaceType } from "./types";

export function applyIntervention(cell: EcoCell, tool: InterventionTool): EcoCell {
  if (tool === "green_roof" && !cell.buildingId) return cell;
  if (cell.buildingId && tool !== "green_roof" && tool !== "erase") return cell;
  const surfaceType: SurfaceType = tool === "erase" ? cell.baselineSurfaceType : tool;
  return { ...cell, surfaceType, ...calculateCellEnvironment(surfaceType) };
}
