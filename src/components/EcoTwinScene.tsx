import { useState } from "react";
import { Canvas, type ThreeEvent } from "@react-three/fiber";
import { Grid, OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { GRID_SIZE } from "../lib/ecotwin/generateGrid";
import { SURFACE_COLORS } from "../lib/ecotwin/cellProperties";
import type { EcoCell, ViewMode } from "../lib/ecotwin/types";

function heatColor(temperature: number) {
  const normalized = THREE.MathUtils.clamp((temperature - 31) / 10, 0, 1);
  return new THREE.Color().setHSL(0.13 - normalized * 0.13, 0.78, 0.54).getStyle();
}

function runoffColor(water: number) {
  const normalized = THREE.MathUtils.clamp(water / 10, 0, 1);
  return new THREE.Color().setHSL(0.53 + normalized * 0.08, 0.7, 0.68 - normalized * 0.34).getStyle();
}

function cellColor(cell: EcoCell, viewMode: ViewMode) {
  if (viewMode === "heat") return heatColor(cell.temperature);
  if (viewMode === "runoff") return runoffColor(cell.water);
  return SURFACE_COLORS[cell.surfaceType];
}

function Cell({ cell, viewMode, selected, onSelect }: { cell: EcoCell; viewMode: ViewMode; selected: boolean; onSelect: (id: string) => void }) {
  const x = cell.col - GRID_SIZE / 2 + 0.5;
  const z = cell.row - GRID_SIZE / 2 + 0.5;
  const baseColor = cellColor(cell, viewMode);
  const isBuilding = cell.surfaceType === "building" || cell.surfaceType === "green_roof";

  function select(event: ThreeEvent<MouseEvent>) {
    event.stopPropagation();
    onSelect(cell.id);
  }

  return (
    <group position={[x, cell.elevation, z]} onClick={select}>
      <mesh receiveShadow position={[0, 0.02, 0]}>
        <boxGeometry args={[0.94, 0.1, 0.94]} />
        <meshStandardMaterial color={selected ? "#d9f99d" : baseColor} roughness={0.85} />
      </mesh>

      {isBuilding && (
        <>
          <mesh castShadow receiveShadow position={[0, 0.68, 0]}>
            <boxGeometry args={[0.82, 1.28, 0.82]} />
            <meshStandardMaterial color={viewMode === "surface" ? "#d8d1c4" : baseColor} roughness={0.76} />
          </mesh>
          {cell.surfaceType === "green_roof" && (
            <mesh castShadow position={[0, 1.34, 0]}>
              <boxGeometry args={[0.86, 0.08, 0.86]} />
              <meshStandardMaterial color="#62a850" />
            </mesh>
          )}
        </>
      )}

      {cell.surfaceType === "tree" && (
        <>
          <mesh castShadow position={[0, 0.42, 0]}>
            <cylinderGeometry args={[0.07, 0.1, 0.75, 8]} />
            <meshStandardMaterial color="#79563a" />
          </mesh>
          <mesh castShadow position={[0, 1.02, 0]}>
            <icosahedronGeometry args={[0.42, 1]} />
            <meshStandardMaterial color={viewMode === "surface" ? "#2f864d" : baseColor} roughness={0.9} />
          </mesh>
        </>
      )}

      {cell.surfaceType === "rain_garden" && (
        <mesh position={[0, 0.1, 0]}>
          <cylinderGeometry args={[0.34, 0.42, 0.08, 16]} />
          <meshStandardMaterial color={viewMode === "surface" ? "#3fa68b" : baseColor} />
        </mesh>
      )}
    </group>
  );
}

export function EcoTwinScene({ cells, viewMode, onCellClick }: { cells: EcoCell[]; viewMode: ViewMode; onCellClick: (id: string) => void }) {
  const [selectedCell, setSelectedCell] = useState<string | null>(null);

  function selectCell(id: string) {
    setSelectedCell(id);
    onCellClick(id);
  }

  return (
    <div className="scene-canvas">
      <Canvas shadows dpr={[1, 1.5]} camera={{ position: [22, 24, 22], fov: 43, near: 0.1, far: 180 }}>
        <color attach="background" args={["#dce8e0"]} />
        <fog attach="fog" args={["#dce8e0", 32, 72]} />
        <ambientLight intensity={1.35} />
        <directionalLight castShadow position={[12, 24, 8]} intensity={2.1} shadow-mapSize={[1024, 1024]} />
        <group rotation={[0, -0.18, 0]}>
          {cells.map((cell) => (
            <Cell key={cell.id} cell={cell} viewMode={viewMode} selected={selectedCell === cell.id} onSelect={selectCell} />
          ))}
          <Grid position={[0, -0.06, 0]} args={[GRID_SIZE, GRID_SIZE]} cellSize={1} cellThickness={0.6} cellColor="#91a99c" sectionSize={5} sectionThickness={1.2} sectionColor="#6b8879" fadeDistance={48} fadeStrength={1} infiniteGrid={false} />
        </group>
        <OrbitControls makeDefault enableDamping dampingFactor={0.08} minDistance={9} maxDistance={58} maxPolarAngle={Math.PI / 2.08} target={[0, 0, 0]} />
      </Canvas>
      <div className="scene-help">Drag to orbit · Scroll to zoom · Right-drag to pan</div>
    </div>
  );
}
