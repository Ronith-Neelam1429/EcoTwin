import polygonClipping from "polygon-clipping";
import { calculateCellEnvironment } from "./simulation";
import { CELL_METERS, cellPolygon, contains, type Neighborhood } from "./geography";
import type { EcoCell, TwinLocation } from "./types";

const SAMPLE_GRID = 9;
const MIN_VEGETATION_FRACTION = 0.28;

export type VegetationDetection = {
  cells: number;
  treeCells: number;
  areaM2: number;
  source: "Google Maps satellite";
};

export type DetectedVegetationCell = {
  cell: EcoCell;
  surface: "grass" | "tree";
};

export type VegetationSample = {
  fraction: number;
  meanLuminance: number;
  luminanceDeviation: number;
};

export type VegetationNeighborhood = Neighborhood & {
  vegetationDetection?: VegetationDetection;
  vegetationDetectionError?: string;
};

/** Conservative RGB vegetation test for unlabelled satellite pixels. */
export function isVegetationPixel(red: number, green: number, blue: number, alpha = 255) {
  if (alpha < 200) return false;
  const max = Math.max(red, green, blue), min = Math.min(red, green, blue);
  if (max < 28 || max > 242 || max === min) return false;
  const saturation = (max - min) / max;
  const excessGreen = 2 * green - red - blue;
  let hue: number;
  if (max === red) hue = 60 * (((green - blue) / (max - min)) % 6);
  else if (max === green) hue = 60 * ((blue - red) / (max - min) + 2);
  else hue = 60 * ((red - green) / (max - min) + 4);
  if (hue < 0) hue += 360;
  return hue >= 48 && hue <= 172 && saturation >= 0.14 && excessGreen >= 12;
}

export function vegetationSurface(sample: VegetationSample): "grass" | "tree" {
  // Tree crowns are normally darker and more locally varied than lawns because
  // leaves, gaps and cast shadows produce a mottled canopy texture.
  return sample.meanLuminance < 102 || sample.luminanceDeviation >= 19 ? "tree" : "grass";
}

function sampleVegetation(cell: EcoCell, gridSize: number, image: ImageData, metersPerPixel: number, boundary: Neighborhood["boundary"]): VegetationSample {
  const sceneX = cell.col - gridSize / 2 + 0.5;
  const sceneZ = cell.row - gridSize / 2 + 0.5;
  let vegetation = 0, samples = 0, luminanceTotal = 0, luminanceSquaredTotal = 0;
  for (let sampleRow = 0; sampleRow < SAMPLE_GRID; sampleRow++) {
    for (let sampleCol = 0; sampleCol < SAMPLE_GRID; sampleCol++) {
      const x = sceneX + (sampleCol + 0.5) / SAMPLE_GRID - 0.5;
      const z = sceneZ + (sampleRow + 0.5) / SAMPLE_GRID - 0.5;
      if (!contains([x, z], boundary)) continue;
      const pixelX = Math.floor(image.width / 2 + x * CELL_METERS / metersPerPixel);
      const pixelY = Math.floor(image.height / 2 + z * CELL_METERS / metersPerPixel);
      if (pixelX < 0 || pixelY < 0 || pixelX >= image.width || pixelY >= image.height) continue;
      const offset = (pixelY * image.width + pixelX) * 4;
      samples++;
      const red = image.data[offset], green = image.data[offset + 1], blue = image.data[offset + 2];
      if (isVegetationPixel(red, green, blue, image.data[offset + 3])) {
        vegetation++;
        const luminance = red * 0.2126 + green * 0.7152 + blue * 0.0722;
        luminanceTotal += luminance;
        luminanceSquaredTotal += luminance ** 2;
      }
    }
  }
  if (!samples || !vegetation) return { fraction: 0, meanLuminance: 0, luminanceDeviation: 0 };
  const meanLuminance = luminanceTotal / vegetation;
  return {
    fraction: vegetation / samples,
    meanLuminance,
    luminanceDeviation: Math.sqrt(Math.max(0, luminanceSquaredTotal / vegetation - meanLuminance ** 2)),
  };
}

function detectCells(neighborhood: Neighborhood, image: ImageData, metersPerPixel: number) {
  return neighborhood.baseline.flatMap((cell): DetectedVegetationCell[] => {
    if (cell.buildingId || cell.surfaceType !== "unknown") return [];
    const sample = sampleVegetation(cell, neighborhood.gridSize, image, metersPerPixel, neighborhood.boundary);
    return sample.fraction >= MIN_VEGETATION_FRACTION ? [{ cell, surface: vegetationSurface(sample) }] : [];
  });
}

export function applyDetectedVegetation(neighborhood: Neighborhood, detected: DetectedVegetationCell[]): VegetationNeighborhood {
  const eligible = detected.filter(({ cell }) => !cell.buildingId && cell.surfaceType === "unknown");
  if (!eligible.length)
    return { ...neighborhood, vegetationDetection: { cells: 0, treeCells: 0, areaM2: 0, source: "Google Maps satellite" } };
  const detectedById = new Map(eligible.map((item) => [item.cell.id, item.surface]));
  const baseline = neighborhood.baseline.map((cell) => {
    const surface = detectedById.get(cell.id);
    return surface
      ? { ...cell, surfaceType: surface, baselineSurfaceType: surface, ...calculateCellEnvironment(surface) }
      : cell;
  });
  const mappedImpervious = neighborhood.features
    .filter((feature) => feature.surface === "building" || feature.surface === "asphalt")
    .map((feature) => feature.polygons);
  const features = [...neighborhood.features, ...eligible.flatMap(({ cell, surface }) => {
    const clippedCell = polygonClipping.intersection(neighborhood.boundary, cellPolygon(cell.row, cell.col, neighborhood.gridSize));
    const polygons = mappedImpervious.length
      ? polygonClipping.difference(clippedCell, ...mappedImpervious)
      : clippedCell;
    return polygons.length ? [{
      id: `google-vegetation-${cell.id}`,
      polygons,
      surface,
      kind: "landscape" as const,
      height: 0,
      heightSource: "assumed" as const,
    }] : [];
  })];
  return {
    ...neighborhood,
    baseline,
    features,
    trees: [
      ...neighborhood.trees,
      ...eligible.filter(({ surface }) => surface === "tree").map(({ cell }) => ({
        id: `google-tree-${cell.id}`,
        point: [cell.col - neighborhood.gridSize / 2 + 0.5, cell.row - neighborhood.gridSize / 2 + 0.5] as [number, number],
      })),
    ],
    unknownCells: baseline.filter((cell) => cell.surfaceType === "unknown").length,
    vegetationDetection: {
      cells: eligible.length,
      treeCells: eligible.filter(({ surface }) => surface === "tree").length,
      areaM2: eligible.reduce((sum, { cell }) => sum + cell.coverage * CELL_METERS ** 2, 0),
      source: "Google Maps satellite",
    },
  };
}

export async function addGoogleVegetation(location: TwinLocation, neighborhood: Neighborhood, signal?: AbortSignal) {
  const response = await fetch(`/api/google-satellite?${new URLSearchParams({
    lat: String(location.lat), lng: String(location.lng), diameter: String(location.radiusMeters * 2),
  })}`, { signal });
  if (!response.ok) {
    let message = "Google vegetation detection is unavailable.";
    try { message = (await response.json() as { error?: string }).error ?? message; } catch { /* Image services can return plain text. */ }
    throw new Error(message);
  }
  const metersPerPixel = Number(response.headers.get("X-EcoTwin-Meters-Per-Pixel"));
  if (!Number.isFinite(metersPerPixel) || metersPerPixel <= 0) throw new Error("Google satellite alignment data is missing.");
  const bitmap = await createImageBitmap(await response.blob());
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("This browser cannot analyze the satellite image.");
    context.drawImage(bitmap, 0, 0);
    const image = context.getImageData(0, 0, canvas.width, canvas.height);
    return applyDetectedVegetation(neighborhood, detectCells(neighborhood, image, metersPerPixel));
  } finally {
    bitmap.close();
  }
}
